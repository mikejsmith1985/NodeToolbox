// buildSplitCommit.ts — Turns a split draft into the exact list of Jira writes it would perform.
//
// This is the review step's whole purpose: a PO sees every issue that will be created and every link that
// will be made BEFORE anything happens. It is a pure function over the draft — building the diff performs
// no writes and needs no network (FR-013, INV-4).

import type { CreateMetaFieldEntry } from '../../../types/jira.ts';
import type { ProposedIncrement, SplitDraft } from '../drafts/draftModel';

/** One issue the commit would create. */
export interface PlannedIssueCreate {
  localId: string;
  projectKey: string;
  /** The original's own issue type — never a hard-coded "Feature" (A17, INV-J5). */
  issueTypeId: string;
  summary: string;
  fields: Record<string, unknown>;
}

/** One link the commit would make, from a not-yet-created issue back to the original. */
export interface PlannedIssueLink {
  fromLocalId: string;
  toIssueKey: string;
  linkTypeName: string;
}

/** Something that must be resolved before the commit can run at all. */
export interface CommitBlocker {
  /** What the blocker is about — an increment's localId, or 'draft' for a whole-draft problem. */
  scope: string;
  reason: string;
}

/** The full, reviewable picture of what a commit would do. */
export interface SplitCommitDiff {
  creates: PlannedIssueCreate[];
  links: PlannedIssueLink[];
  /** Non-empty means the commit is disabled — no partial issue is ever produced (FR-034, SC-008). */
  blockers: CommitBlocker[];
  /** The original changed in Jira since it was loaded; shown before writing, never auto-resolved. */
  driftWarnings: string[];
}

/** What the caller must supply for the diff to know what this instance demands. */
export interface BuildSplitCommitInput {
  draft: SplitDraft;
  /** The target project/issue-type's field descriptors, as the instance reports them. */
  requiredFieldDescriptors: readonly CreateMetaFieldEntry[];
  /** The original as it looks in Jira right now, if it has been re-read. Used for drift detection. */
  latestSourceSummary?: string;
  /** Link types the instance actually defines; an unknown type is a blocker, not a guess. */
  availableLinkTypeNames?: readonly string[];
}

/** Fields Jira always requires but that this flow supplies itself, so they are never "missing". */
const SELF_SUPPLIED_FIELD_IDS = new Set(['project', 'issuetype', 'summary']);

/** Only increments the PO has accepted are committed — a pending AI proposal is not (FR-020). */
function selectCommittableIncrements(draft: SplitDraft): ProposedIncrement[] {
  return draft.increments.filter(
    // An increment already created by an earlier partial commit must not be created twice (SC-011).
    (increment) => increment.isAccepted && increment.createdJiraKey === null,
  );
}

/** Builds the field payload for one increment, omitting empties so unset optionals are never sent. */
function buildIncrementFields(
  increment: ProposedIncrement,
  acceptanceCriteriaFieldId: string | null,
): Record<string, unknown> {
  const fields: Record<string, unknown> = { summary: increment.summary.trim() };

  if (increment.description.trim() !== '') {
    fields.description = increment.description.trim();
  }
  // Acceptance criteria live in a different custom field on every instance, so it is only written
  // when the caller could tell us where it goes.
  if (acceptanceCriteriaFieldId && increment.acceptanceCriteria.trim() !== '') {
    fields[acceptanceCriteriaFieldId] = increment.acceptanceCriteria.trim();
  }
  return fields;
}

/** Names the instance-required fields this increment has not satisfied (FR-034). */
function findMissingRequiredFieldNames(
  incrementFields: Record<string, unknown>,
  requiredFieldDescriptors: readonly CreateMetaFieldEntry[],
): string[] {
  return requiredFieldDescriptors
    .filter((descriptor) => descriptor.required && !SELF_SUPPLIED_FIELD_IDS.has(descriptor.fieldId))
    .filter((descriptor) => {
      const suppliedValue = incrementFields[descriptor.fieldId];
      return suppliedValue === undefined || suppliedValue === null || suppliedValue === '';
    })
    .map((descriptor) => descriptor.name);
}

/**
 * Builds the reviewable diff for a split.
 *
 * Pure: given the same draft it returns the same plan, and it never touches Jira. Anything that would
 * make a write fail — or make it wrong — surfaces as a blocker rather than being discovered halfway
 * through committing.
 */
export function buildSplitCommit(input: BuildSplitCommitInput): SplitCommitDiff {
  const { draft, requiredFieldDescriptors, latestSourceSummary, availableLinkTypeNames } = input;
  const blockers: CommitBlocker[] = [];
  const driftWarnings: string[] = [];

  if (draft.sourceSnapshot === null) {
    return {
      creates: [],
      links: [],
      blockers: [{ scope: 'draft', reason: 'Load the Feature you want to split before committing.' }],
      driftWarnings: [],
    };
  }

  const targetProjectKey = draft.targetProjectKey.trim() || draft.sourceSnapshot.projectKey;
  if (targetProjectKey === '') {
    blockers.push({ scope: 'draft', reason: 'Choose the project the new Features should be created in.' });
  }

  // The instance defines its own link types; committing an unknown one would fail at the last step.
  if (availableLinkTypeNames && availableLinkTypeNames.length > 0
      && !availableLinkTypeNames.includes(draft.linkTypeName)) {
    blockers.push({
      scope: 'draft',
      reason: `This Jira does not define a "${draft.linkTypeName}" link type. Choose one it offers.`,
    });
  }

  // The PO authored against what they loaded; if the original moved on, say so before writing.
  if (latestSourceSummary !== undefined && latestSourceSummary !== draft.sourceSnapshot.summary) {
    driftWarnings.push(
      `${draft.sourceSnapshot.key} has changed in Jira since you loaded it — its summary is now "${latestSourceSummary}". Your increments are unaffected; re-load if you want the newer wording.`,
    );
  }

  const committableIncrements = selectCommittableIncrements(draft);
  if (committableIncrements.length === 0) {
    blockers.push({ scope: 'draft', reason: 'Add at least one increment to create.' });
  }

  const acceptanceCriteriaFieldId = requiredFieldDescriptors
    .find((descriptor) => descriptor.name.toLowerCase() === 'acceptance criteria')?.fieldId ?? null;

  const creates: PlannedIssueCreate[] = [];
  const links: PlannedIssueLink[] = [];

  committableIncrements.forEach((increment) => {
    if (increment.summary.trim() === '') {
      blockers.push({ scope: increment.localId, reason: 'Give this increment a summary.' });
      return;
    }

    const fields = buildIncrementFields(increment, acceptanceCriteriaFieldId);
    const missingRequiredFieldNames = findMissingRequiredFieldNames(fields, requiredFieldDescriptors);
    if (missingRequiredFieldNames.length > 0) {
      blockers.push({
        scope: increment.localId,
        reason: `Jira requires ${missingRequiredFieldNames.join(', ')} for this issue type.`,
      });
      return;
    }

    creates.push({
      localId: increment.localId,
      projectKey: targetProjectKey,
      // The original's own type: several types are Feature-like and instances differ (A17).
      issueTypeId: draft.sourceSnapshot!.issueTypeId,
      summary: increment.summary.trim(),
      fields,
    });
    links.push({
      fromLocalId: increment.localId,
      toIssueKey: draft.sourceSnapshot!.key,
      linkTypeName: draft.linkTypeName,
    });
  });

  return { creates, links, blockers, driftWarnings };
}

/** Whether the commit may run. A single blocker stops the whole commit — never a partial write. */
export function canCommitSplit(diff: SplitCommitDiff): boolean {
  return diff.blockers.length === 0 && diff.creates.length > 0;
}
