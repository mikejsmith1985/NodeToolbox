// ctaskReviewPrompt.ts — The change tasks' part of each risk-check round, and reading their fixes back (GH #395).
//
// An existing change is checked together with its CTASKs in one pass: the same check → fix → check-again loop,
// one prompt per round, covering the change and every task. This module builds the tasks' part of each prompt
// (the records, the backout rule, the gaps, the reply markers) for the change-only builders to carry, and reads
// each task's rewritten backout plan out of a pasted fix reply.

import { CHG_FIELD_REPLY_MARKERS, restoreMarkerLineBreaks, stripCodeFences } from './assistantReplyText.ts';
import { describeTaskPeople, type ExtraPromptPart } from './chgPromptContext.ts';
import type { ReviewedCtask } from './ctaskReviewRecord.ts';
import { buildCtaskFindingField, readCtaskFindingTarget } from './ctaskReviewRules.ts';
import type { RiskCheckFinding } from './riskCheckReview.ts';

/** What an implementation task's backout plan must say to pass — the Release Manager's own standard. */
export const CTASK_BACKOUT_RULE =
  'An implementation change task must carry a detailed backout plan: the trigger that starts the backout, the '
  + 'exact steps that restore the previous state, who performs them, how long they take, and how a successful '
  + 'restore is verified. "Revert the change", "roll back" or "redeploy the previous version" on its own does not pass.';

const NOT_SET_TEXT = '(not set)';
// The reply marker suffix for a task's rewritten backout plan: CTASK0012345_BACKOUT_PLAN.
const BACKOUT_MARKER_SUFFIX = '_BACKOUT_PLAN';
// A task marker at a line start, capturing the task number and anything written after the colon.
const CTASK_MARKER_LINE_PATTERN = /^\s*(CTASK\d+)_BACKOUT_PLAN\s*:\s*(.*)$/i;
// A task marker run into the previous text by a flattened copy, so it can be put back on its own line.
const FLATTENED_CTASK_MARKER_PATTERN = /[ \t]+(?=CTASK\d+_BACKOUT_PLAN\s*:)/gi;
// Any change-field marker at a line start — where a task's block ends.
const CHANGE_MARKER_LINE_PATTERN = new RegExp(`^\\s*(?:${CHG_FIELD_REPLY_MARKERS.join('|')})\\s*:`);

/** The reply marker for one task's rewritten backout plan. */
export function buildCtaskBackoutMarker(ctaskNumber: string): string {
  return `${ctaskNumber}${BACKOUT_MARKER_SUFFIX}`;
}

/** One task as the assistant reads it: what it is, its CI, and its description and backout plan in full. */
function renderCtaskBlock(ctask: ReviewedCtask): string {
  const typeText = ctask.typeLabel || (ctask.isImplementation ? 'Implementation (from its name)' : 'not recorded');
  return [
    `${ctask.number} — ${ctask.shortDescription.trim() || NOT_SET_TEXT}`,
    `  Type: ${typeText}`,
    `  Configuration item: ${ctask.configItem.displayName.trim() || NOT_SET_TEXT}`,
    `  People: ${describeTaskPeople(ctask.assignedTo.displayName, ctask.assignmentGroup.displayName)}`,
    `  Description: ${ctask.description.trim() || NOT_SET_TEXT}`,
    `  Backout plan: ${ctask.backoutPlan.trim() || NOT_SET_TEXT}`,
  ].join('\n');
}

/** The tasks a set of backout gaps is about, in the order the change lists them. */
function selectGapTasks(ctasks: readonly ReviewedCtask[], backoutGaps: readonly RiskCheckFinding[]): ReviewedCtask[] {
  const gapNumbers = new Set(backoutGaps.map((gap) => readCtaskFindingTarget(gap.field)?.ctaskNumber));
  return ctasks.filter((ctask) => gapNumbers.has(ctask.number));
}

/** One backout gap as a gap line, with the reviewer's earlier suggestion when there was one. */
function renderBackoutGapLine(gap: RiskCheckFinding, fixLabel: string): string {
  return `- ${[gap.field, gap.detail, gap.fix ? `${fixLabel}${gap.fix}` : ''].filter((part) => part !== '').join(' — ')}`;
}

/**
 * The tasks' part of the full check: every task listed for context, the backout rule, and a request for one
 * line per implementation task. CIs are checked by Toolbox, so the assistant is told not to judge them.
 * Undefined with no tasks, so the prompt stays exactly the change-only prompt.
 */
export function buildCtaskCheckPart(ctasks: readonly ReviewedCtask[]): ExtraPromptPart | undefined {
  if (ctasks.length === 0) {
    return undefined;
  }
  const implementationTasks = ctasks.filter((ctask) => ctask.isImplementation);
  return {
    contextLines: [
      'The change\'s tasks (CTASKs):',
      ...ctasks.map((ctask) => renderCtaskBlock(ctask)),
      '',
      `Change task rule: ${CTASK_BACKOUT_RULE}`,
      'Configuration items are checked by Toolbox itself — do not judge configuration items.',
    ],
    replyLines: implementationTasks.length === 0 ? [] : [
      'Also, before the VERDICT line, one line for each of these implementation tasks, named exactly as shown: '
        + implementationTasks.map((ctask) => buildCtaskFindingField(ctask.number, 'backoutPlan')).join(', '),
      'PASS | <task> · Backout plan — <why it meets the change task rule>',
      'GAP | <task> · Backout plan — <what is missing> — Fix: <the backout steps to add>',
    ],
  };
}

/** The tasks' part of a re-check: just the tasks with open backout gaps, as they now read, and those gaps. */
export function buildCtaskRecheckPart(
  ctasks: readonly ReviewedCtask[],
  backoutGaps: readonly RiskCheckFinding[],
): ExtraPromptPart {
  return {
    contextLines: [
      'The change tasks these gaps are about, as they now read:',
      ...selectGapTasks(ctasks, backoutGaps).map((ctask) => renderCtaskBlock(ctask)),
      '',
      `Change task rule: ${CTASK_BACKOUT_RULE}`,
    ],
    gapLines: backoutGaps.map((gap) => renderBackoutGapLine(gap, 'Earlier suggested fix: ')),
    replyLines: [],
  };
}

/** The tasks' part of a fix round: the gap tasks, their gaps, and one marker per task for its whole new plan. */
export function buildCtaskFixPart(
  ctasks: readonly ReviewedCtask[],
  backoutGaps: readonly RiskCheckFinding[],
): ExtraPromptPart {
  const gapTasks = selectGapTasks(ctasks, backoutGaps);
  return {
    contextLines: [
      'The change tasks to fix, as they now read:',
      ...gapTasks.map((ctask) => renderCtaskBlock(ctask)),
      '',
      `Change task rule: ${CTASK_BACKOUT_RULE}`,
    ],
    gapLines: backoutGaps.map((gap) => renderBackoutGapLine(gap, 'Fix: ')),
    replyLines: [
      ...gapTasks.map((ctask) => `${buildCtaskBackoutMarker(ctask.number)}:`),
      ...(gapTasks.length > 0 ? ['Each CTASK…_BACKOUT_PLAN is that task\'s complete backout plan as it should now read.'] : []),
    ],
  };
}

/** A pasted fix reply split into each asked-for task's new backout plan and the text left for the change fields. */
export interface CtaskBackoutReply {
  backoutPlansByNumber: Map<string, string>;
  changeReplyText: string;
}

/**
 * Reads each task's rewritten backout plan out of a fix reply. A task block runs to the next task or change
 * marker; everything outside the blocks is handed back for the change-field reader. A plan for a task the
 * prompt did not ask about is dropped — the reply is not trusted with a task it was not shown.
 */
export function parseCtaskBackoutReply(replyText: string, askedCtaskNumbers: readonly string[]): CtaskBackoutReply {
  const restoredReply = restoreMarkerLineBreaks(
    stripCodeFences(replyText).replace(FLATTENED_CTASK_MARKER_PATTERN, '\n'),
    CHG_FIELD_REPLY_MARKERS,
  );
  const askedNumbers = new Set(askedCtaskNumbers.map((ctaskNumber) => ctaskNumber.toUpperCase()));
  const backoutPlansByNumber = new Map<string, string>();
  const changeLines: string[] = [];
  let currentTask: { ctaskNumber: string; lines: string[] } | null = null;

  const closeCurrentTask = () => {
    if (currentTask && askedNumbers.has(currentTask.ctaskNumber) && currentTask.lines.join('\n').trim() !== '') {
      backoutPlansByNumber.set(currentTask.ctaskNumber, currentTask.lines.join('\n').trim());
    }
    currentTask = null;
  };

  for (const replyLine of restoredReply.split(/\r?\n/)) {
    const taskMatch = CTASK_MARKER_LINE_PATTERN.exec(replyLine);
    if (taskMatch) {
      closeCurrentTask();
      currentTask = { ctaskNumber: taskMatch[1].toUpperCase(), lines: taskMatch[2].trim() ? [taskMatch[2].trim()] : [] };
      continue;
    }
    if (currentTask && CHANGE_MARKER_LINE_PATTERN.test(replyLine)) {
      closeCurrentTask();
    }
    (currentTask ? currentTask.lines : changeLines).push(replyLine);
  }
  closeCurrentTask();
  return { backoutPlansByNumber, changeReplyText: changeLines.join('\n') };
}
