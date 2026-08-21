// rewriteRevert.ts — Putting a Feature back exactly as Toolbox found it.
//
// The batch has always captured a "before" snapshot; until now it was only ever shown, never given
// back. That is the wrong half to have: a re-write nobody likes leaves the PO worse off than not
// running one at all, because the original wording is gone and reconstructing it from memory is a
// worse job than the one that was replaced.
//
// The single thing this must never do is quietly undo somebody ELSE's work. Between the write and
// the revert a person may have edited the issue, and restoring the snapshot on top of that would
// discard their edit without either of them knowing. So every revert re-reads the live issue first
// and NAMES the fields that have moved on, rather than deciding on the operator's behalf.
//
// All three captured fields go back together, by decision: a Feature restored to its old
// description while keeping a new summary is a state that never existed and nobody asked for.

import { buildCompositionCommit } from '../jira/buildCompositionCommit';
import { createEmptyCompositionDraft } from '../drafts/draftModel';
import { runCompositionCommit } from '../jira/runCommit';
import type { CapturedOriginal, RewriteBatch, RewriteItem } from './rewriteBatchModel';
import type { SubmitContext, SubmitDeps } from './rewriteSubmit';

/** create is never called on the revert path; guard it so a bug cannot silently create an issue. */
const NEVER_CREATE = (async () => {
  throw new Error('Revert restores an existing issue — it never creates one.');
}) as unknown as Parameters<typeof runCompositionCommit>[1]['createIssue'];

/** Options a caller uses to overrule a held revert, having been shown what it costs. */
export interface RevertOverrides {
  /** Issue keys the operator has explicitly chosen to revert despite a conflict. */
  revertAnywayKeys?: string[];
}

/**
 * Names the fields a revert would overwrite with somebody else's later work.
 *
 * Description and acceptance criteria are compared against what Toolbox WROTE — if the live value
 * still matches the proposal, nothing has happened since and restoring the original is safe.
 *
 * The summary is compared against the SNAPSHOT instead, because Toolbox never writes it. Any
 * difference there is therefore somebody else's rename, and reverting all three fields together
 * would replace it.
 *
 * An item with no proposal was never written by Toolbox, so there is nothing to have moved on from
 * and nothing to warn about.
 */
export function readRevertConflicts(item: RewriteItem, live: CapturedOriginal): string[] {
  if (!item.proposed) {
    return [];
  }

  // A field already holding the ORIGINAL value is never a conflict, whatever route it took to get
  // there. Reverting it writes nothing and discards nothing, so warning about it would be a false
  // alarm — and a warning that cries wolf is the one people click past on the day it is real.
  const conflicts: string[] = [];
  if (live.summary !== item.original.summary) {
    conflicts.push('Summary');
  }
  if (live.description !== item.proposed.description && live.description !== item.original.description) {
    conflicts.push('Description');
  }
  if (live.acceptanceCriteria !== item.proposed.acceptanceCriteria
    && live.acceptanceCriteria !== item.original.acceptanceCriteria) {
    conflicts.push('Acceptance Criteria');
  }
  return conflicts;
}

/** Restores one issue, or explains why it did not. Pure w.r.t. the batch — the caller replaces it. */
async function revertOneItem(
  item: RewriteItem,
  context: SubmitContext,
  deps: SubmitDeps,
  isRevertAnyway: boolean,
): Promise<RewriteItem> {
  // Only work Toolbox actually wrote can be un-written. Anything else has no "after" to undo, and
  // restoring a snapshot over it would be an edit nobody asked for rather than a revert.
  if (item.state !== 'submitted' && item.state !== 'revert-blocked') {
    return item;
  }
  if (!item.proposed) {
    return item;
  }

  const live = await deps.fetchLive(item.jiraKey);
  const conflicts = readRevertConflicts(item, live);
  if (conflicts.length > 0 && !isRevertAnyway) {
    // Held, with the cost named. Deciding for the operator is the one thing a revert must not do.
    return { ...item, state: 'revert-blocked', submitResult: { ok: false, fieldErrors: conflicts } };
  }

  // Diffed against the live values so a field already matching the original is not written again.
  // An issue somebody has already put back by hand costs nothing and is still a successful revert.
  const draft = {
    ...createEmptyCompositionDraft(item.jiraKey, `revert:${item.jiraKey}`),
    existingIssueKey: item.jiraKey,
    summary: item.original.summary,
    description: item.original.description,
    acceptanceCriteria: item.original.acceptanceCriteria,
  };
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

  if (diff.update === null) {
    return { ...item, state: 'reverted', submitResult: { ok: true } };
  }

  const outcome = await runCompositionCommit(diff, { createIssue: NEVER_CREATE, saveField: deps.saveField });
  if (outcome.isFullySuccessful) {
    return { ...item, state: 'reverted', submitResult: { ok: true } };
  }
  // A partial restore is reported as a FAILURE, never as a revert: an issue holding its old summary
  // and its new description is a state nobody chose, and calling it done would hide that.
  const fieldErrors = outcome.items
    .filter((each) => each.status === 'failed')
    .map((each) => each.failureReason ?? 'unknown');
  return { ...item, state: 'failed', submitResult: { ok: false, fieldErrors } };
}

/**
 * Restores the captured original for the named issues, one at a time.
 *
 * Only the keys asked for are touched — a revert is a per-item decision, and a batch-wide undo would
 * throw away re-writes the PO was happy with. One item being held or failing never stops the rest.
 */
export async function revertItems(
  batch: RewriteBatch,
  context: SubmitContext,
  deps: SubmitDeps,
  jiraKeysToRevert: readonly string[],
  overrides: RevertOverrides = {},
): Promise<RewriteBatch> {
  const keysToRevert = new Set(jiraKeysToRevert);
  const revertAnywaySet = new Set(overrides.revertAnywayKeys ?? []);

  const items: RewriteItem[] = [];
  for (const item of batch.items) {
    if (!keysToRevert.has(item.jiraKey)) {
      items.push(item);
      continue;
    }
    items.push(await revertOneItem(item, context, deps, revertAnywaySet.has(item.jiraKey)));
  }
  return { ...batch, items };
}
