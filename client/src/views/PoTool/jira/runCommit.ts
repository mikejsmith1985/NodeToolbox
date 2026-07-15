// runCommit.ts — Performs the Jira writes a reviewed split diff describes.
//
// This is the ONLY place in the Feature Splitter that writes to Jira, and it runs only when a human
// clicks Commit on a diff they have read.
//
// Two rules shape everything here:
//
//  1. Report every item's outcome individually, with the reason Jira actually gave. A PO whose commit
//     half-worked needs to know exactly what landed, and a generic "commit failed" is useless.
//
//  2. Links are best effort. Jira has no transaction across create-and-link, so a link failure must
//     never be allowed to undo or orphan an issue that was created successfully. It is reported, not
//     thrown — the same shape the server's sprint-release orchestrator has used for years.

import { createIssue, createIssueLink } from '../../../services/jiraApi.ts';
import type { CompositionCommitDiff } from './buildCompositionCommit';
import type { PlannedIssueCreate, PlannedIssueLink, SplitCommitDiff } from './buildSplitCommit';

/** What happened to one planned write. */
export interface CommitOutcomeItem {
  /** The increment's localId, or `link:<localId>` for a link. */
  scope: string;
  status: 'created' | 'linked' | 'updated' | 'failed';
  /** The resulting Jira key, when something was created. */
  jiraKey?: string;
  /** Jira's actual rejection reason — never a generic message (FR-041). */
  failureReason?: string;
}

export interface CommitOutcome {
  items: CommitOutcomeItem[];
  /** Which increments now exist, so the draft can mark them and never re-create them on a retry. */
  createdKeysByLocalId: Record<string, string>;
  /** Drives clear-vs-retain of the draft (FR-045). */
  isFullySuccessful: boolean;
}

/** Injected so the commit can be proven without touching a real Jira. */
export interface RunSplitCommitDependencies {
  createIssue: typeof createIssue;
  createIssueLink: typeof createIssueLink;
}

const DEFAULT_DEPENDENCIES: RunSplitCommitDependencies = { createIssue, createIssueLink };

/** Pulls a human-readable reason out of whatever was thrown. */
function readFailureReason(thrownError: unknown): string {
  if (thrownError instanceof Error && thrownError.message.trim() !== '') {
    return thrownError.message;
  }
  return 'Jira rejected the request without giving a reason.';
}

/** Creates one increment, returning its new key or recording why it could not be created. */
async function createOneIncrement(
  plannedCreate: PlannedIssueCreate,
  dependencies: RunSplitCommitDependencies,
): Promise<{ item: CommitOutcomeItem; createdKey: string | null }> {
  try {
    const createdIssue = await dependencies.createIssue({
      fields: {
        project: { key: plannedCreate.projectKey },
        issuetype: { id: plannedCreate.issueTypeId },
        ...plannedCreate.fields,
      },
    });
    return {
      item: { scope: plannedCreate.localId, status: 'created', jiraKey: createdIssue.key },
      createdKey: createdIssue.key,
    };
  } catch (createError) {
    return {
      item: { scope: plannedCreate.localId, status: 'failed', failureReason: readFailureReason(createError) },
      createdKey: null,
    };
  }
}

/**
 * Links one new increment back to the original — best effort.
 *
 * Never throws: the increment already exists in Jira by this point, and losing that fact because a link
 * failed would be a far worse outcome than an unlinked issue the PO can link by hand.
 */
async function linkOneIncrement(
  plannedLink: PlannedIssueLink,
  createdKey: string,
  dependencies: RunSplitCommitDependencies,
): Promise<CommitOutcomeItem> {
  try {
    await dependencies.createIssueLink({
      type: { name: plannedLink.linkTypeName },
      inwardIssue: { key: createdKey },
      outwardIssue: { key: plannedLink.toIssueKey },
    });
    return { scope: `link:${plannedLink.fromLocalId}`, status: 'linked', jiraKey: createdKey };
  } catch (linkError) {
    return {
      scope: `link:${plannedLink.fromLocalId}`,
      status: 'failed',
      jiraKey: createdKey,
      failureReason: `${createdKey} was created, but linking it to ${plannedLink.toIssueKey} failed: ${readFailureReason(linkError)}`,
    };
  }
}

/**
 * Runs a reviewed split: create every planned increment, then link each one back to the original.
 *
 * Creates run before links so a link always has something to point at. A create failure skips only its
 * own link — the other increments still go ahead, because one bad field on one increment is no reason to
 * deny the PO the rest of their work.
 */
export async function runSplitCommit(
  diff: SplitCommitDiff,
  dependencies: RunSplitCommitDependencies = DEFAULT_DEPENDENCIES,
): Promise<CommitOutcome> {
  const items: CommitOutcomeItem[] = [];
  const createdKeysByLocalId: Record<string, string> = {};

  for (const plannedCreate of diff.creates) {
    const { item, createdKey } = await createOneIncrement(plannedCreate, dependencies);
    items.push(item);
    if (createdKey !== null) {
      createdKeysByLocalId[plannedCreate.localId] = createdKey;
    }
  }

  for (const plannedLink of diff.links) {
    const createdKey = createdKeysByLocalId[plannedLink.fromLocalId];
    // Nothing was created for this increment, so there is nothing to link. Its create failure is
    // already reported; a second "link failed" line would only add noise.
    if (createdKey === undefined) {
      continue;
    }
    items.push(await linkOneIncrement(plannedLink, createdKey, dependencies));
  }

  return {
    items,
    createdKeysByLocalId,
    isFullySuccessful: items.every((item) => item.status !== 'failed'),
  };
}

// ── Composition ──

/** The write helpers a composition commit needs, injected so it can be proven without a real Jira. */
export interface RunCompositionCommitDependencies {
  createIssue: typeof createIssue;
  /** Writes one field, resolving the payload shape against the instance's own metadata. */
  saveField: (issueKey: string, fieldId: string, value: unknown) => Promise<void>;
}

/**
 * Performs a reviewed composition: either creates the Feature or updates the existing one.
 *
 * The two paths never both run — the diff already decided which, and that is the property that stops a
 * PO enriching a Feature and getting a duplicate instead (FR-036, SC-012).
 *
 * On update, each field is written individually and reported individually: a rejected field must not
 * silently discard the ones that saved, and the PO needs to know which one Jira refused.
 */
export async function runCompositionCommit(
  diff: CompositionCommitDiff,
  dependencies: RunCompositionCommitDependencies,
): Promise<CommitOutcome> {
  const items: CommitOutcomeItem[] = [];
  const createdKeysByLocalId: Record<string, string> = {};

  if (diff.create) {
    try {
      const createdIssue = await dependencies.createIssue({
        fields: {
          project: { key: diff.create.projectKey },
          issuetype: { id: diff.create.issueTypeId },
          ...diff.create.fields,
        },
      });
      items.push({ scope: 'feature', status: 'created', jiraKey: createdIssue.key });
      createdKeysByLocalId.feature = createdIssue.key;
    } catch (createError) {
      items.push({ scope: 'feature', status: 'failed', failureReason: readFailureReason(createError) });
    }
  }

  if (diff.update) {
    for (const changedField of diff.update.changedFields) {
      try {
        await dependencies.saveField(diff.update.issueKey, changedField.fieldId, changedField.after);
        items.push({ scope: changedField.fieldId, status: 'updated', jiraKey: diff.update.issueKey });
      } catch (updateError) {
        items.push({
          scope: changedField.fieldId,
          status: 'failed',
          jiraKey: diff.update.issueKey,
          failureReason: `${changedField.label} could not be saved: ${readFailureReason(updateError)}`,
        });
      }
    }
  }

  return {
    items,
    createdKeysByLocalId,
    isFullySuccessful: items.length > 0 && items.every((item) => item.status !== 'failed'),
  };
}
