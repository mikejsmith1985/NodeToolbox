// rewriteSubmit.ts — Submits approved re-writes to Jira, one issue at a time, via the REUSED single-issue
// write path (buildCompositionCommit + runCompositionCommit), with a live drift re-read before each write
// (spec 030, US4/US5). Propose-only: only approved items; a `submitted` item is never re-written; a
// changed-since-capture item is held out; a no-op (proposal already == live) is a success, not a failure.

import { createEmptyCompositionDraft } from '../drafts/draftModel';
import { buildCompositionCommit } from '../jira/buildCompositionCommit';
import { runCompositionCommit } from '../jira/runCommit';
import type { CreateMetaFieldEntry } from '../../../types/jira.ts';
import type { CapturedOriginal, RewriteBatch, RewriteItem } from './rewriteBatchModel';

/** Injected so the submit can be proven without a real Jira. */
export interface SubmitDeps {
  /** Re-reads the issue's current (normalized) content for the drift check. */
  fetchLive: (jiraKey: string) => Promise<CapturedOriginal>;
  /** Writes one field to an issue (the same resolver composition uses). */
  saveField: (issueKey: string, fieldId: string, value: unknown) => Promise<void>;
}

export interface SubmitContext {
  acceptanceCriteriaFieldId: string | null;
  fieldDescriptors: CreateMetaFieldEntry[];
}

/** create is never called on the update path; guard it so a bug can't silently create an issue. */
const NEVER_CREATE = (async () => {
  throw new Error('Bulk re-write submits updates only — it never creates issues.');
}) as unknown as Parameters<typeof runCompositionCommit>[1]['createIssue'];

/** Whether the live content still matches what was captured (description + AC). */
function isUnchangedSinceCapture(original: CapturedOriginal, live: CapturedOriginal): boolean {
  return original.description === live.description && original.acceptanceCriteria === live.acceptanceCriteria;
}

/** Submits one approved item; returns the updated item (pure w.r.t. the batch — caller replaces it). */
async function submitOneItem(
  item: RewriteItem,
  context: SubmitContext,
  deps: SubmitDeps,
  submitAnyway: boolean,
): Promise<RewriteItem> {
  if (item.state === 'submitted' || item.state !== 'approved' || !item.proposed) {
    return item; // only approved-with-a-proposal items are written; submitted/others untouched
  }

  // Drift check — re-read the live issue; a mismatch holds the item unless the PO chose "submit anyway".
  const live = await deps.fetchLive(item.jiraKey);
  if (!submitAnyway && !isUnchangedSinceCapture(item.original, live)) {
    return { ...item, state: 'changed' };
  }

  // Build a composition-style update, diffed against the LIVE values so an equal proposal is a no-op.
  const draft = {
    ...createEmptyCompositionDraft(item.jiraKey, `rewrite:${item.jiraKey}`),
    existingIssueKey: item.jiraKey,
    summary: live.summary,
    description: item.proposed.description,
    acceptanceCriteria: item.proposed.acceptanceCriteria,
  };
  // Baseline the diff against the live values (incl. summary) so only description/AC ever count as changed.
  const existingFieldValues: Record<string, unknown> = { summary: live.summary, description: live.description };
  if (context.acceptanceCriteriaFieldId) {
    existingFieldValues[context.acceptanceCriteriaFieldId] = live.acceptanceCriteria;
  }
  const diff = buildCompositionCommit({
    draft,
    requiredFieldDescriptors: context.fieldDescriptors,
    acceptanceCriteriaFieldId: context.acceptanceCriteriaFieldId,
    existingFieldValues,
  });

  // No-op: nothing to write (proposal already equals live) → success, not failure (FR-045).
  if (diff.update === null) {
    return { ...item, state: 'submitted', submitResult: { ok: true } };
  }

  const outcome = await runCompositionCommit(diff, { createIssue: NEVER_CREATE, saveField: deps.saveField });
  if (outcome.isFullySuccessful) {
    return { ...item, state: 'submitted', submitResult: { ok: true } };
  }
  const fieldErrors = outcome.items.filter((each) => each.status === 'failed').map((each) => each.failureReason ?? 'unknown');
  return { ...item, state: 'failed', submitResult: { ok: false, fieldErrors } };
}

/**
 * On-demand drift check (FR-053): re-reads every approved/held item's live content and flags a mismatch
 * as `changed` WITHOUT writing anything. An item previously held as `changed` that now matches the capture
 * returns to `approved`. This is the only non-submit trigger for the live re-read — it never runs on open.
 */
export async function checkForDrift(
  batch: RewriteBatch,
  deps: Pick<SubmitDeps, 'fetchLive'>,
): Promise<RewriteBatch> {
  const items: RewriteItem[] = [];
  for (const item of batch.items) {
    if (item.state !== 'approved' && item.state !== 'changed') {
      items.push(item);
      continue;
    }
    const live = await deps.fetchLive(item.jiraKey);
    const isUnchanged = isUnchangedSinceCapture(item.original, live);
    // Flag a fresh change; un-flag one that has since been reverted to match the capture again.
    items.push({ ...item, state: isUnchanged ? 'approved' : 'changed' });
  }
  return { ...batch, items };
}

/**
 * Submits every approved item in the batch, in order, each independently. Returns a new batch with the
 * per-item state/outcome updated. A drift-held (`changed`) item, a failure, or a no-op never blocks the rest.
 */
export async function submitApprovedItems(
  batch: RewriteBatch,
  context: SubmitContext,
  deps: SubmitDeps,
  overrides: { submitAnywayKeys?: string[] } = {},
): Promise<RewriteBatch> {
  const submitAnywaySet = new Set(overrides.submitAnywayKeys ?? []);
  const items: RewriteItem[] = [];
  for (const item of batch.items) {
    items.push(await submitOneItem(item, context, deps, submitAnywaySet.has(item.jiraKey)));
  }
  return { ...batch, items };
}
