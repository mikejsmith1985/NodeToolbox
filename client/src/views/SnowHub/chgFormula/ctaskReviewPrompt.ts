// ctaskReviewPrompt.ts — The change tasks' part of each risk-check round, and reading their fixes back (GH #395).
//
// An existing change is checked together with its CTASKs in one pass: the same check → fix → check-again loop,
// one prompt per round, covering the change and every task. This module builds the tasks' part of each prompt
// (the records, the backout rule, the gaps, the reply markers) for the change-only builders to carry, and reads
// each task's rewritten backout plan out of a pasted fix reply.

import { readReplySections, type ReplySection } from '../../../utils/aiReplySections.ts';
import {
  CHG_FIELD_REPLY_MARKERS,
  CHG_FIELD_REPLY_SECTIONS,
  restoreMarkerLineBreaks,
  stripCodeFences,
} from './assistantReplyText.ts';
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
// A task's plan starting at a line: its marker ("CTASK0012345_BACKOUT_PLAN: …") or the heading Google's AI Mode writes
// instead ("### CTASK0012345 Backout Plan", "**CTASK0012345 — Backout plan:** …") — GH #499. Captures the task number
// and anything written after a colon.
const CTASK_MARKER_LINE_PATTERN = /^[\s#*>_`-]*(CTASK\d+)[\s_·:—–*-]*back[\s_-]?out[\s_]*plan[\s*_`]*(?:[:|]\s*(.*))?$/i;
// The bold or code marks left before a plan's first words when its heading carried them ("**CTASK… plan:** 1. Stop").
const LEADING_MARK_PATTERN = /^[\s*_`]+/;
// Markdown marks around a heading line, removed before it is compared with the change fields' headings.
const HEADING_MARK_PATTERN = /^#{1,6}\s*|\*\*|__/g;
// What a task's labelled plan in the reply form stands for; the assistant replaces it with the plan.
const WHOLE_PLAN_PLACEHOLDER = '[the task\'s complete backout plan as it should now read]';
// A task marker run into the previous text by a flattened copy, so it can be put back on its own line.
const FLATTENED_CTASK_MARKER_PATTERN = /[ \t]+(?=CTASK\d+_BACKOUT_PLAN\s*:)/gi;
// Any change-field marker at a line start — where a task's block ends.
const CHANGE_MARKER_LINE_PATTERN = new RegExp(`^\\s*(?:${CHG_FIELD_REPLY_MARKERS.join('|')})\\s*:`);

/** The reply marker for one task's rewritten backout plan. */
export function buildCtaskBackoutMarker(ctaskNumber: string): string {
  return `${ctaskNumber}${BACKOUT_MARKER_SUFFIX}`;
}

/** One task's rewritten backout plan as a reply section: its marker, or a heading naming the task and its backout plan. */
export function buildCtaskBackoutSection(ctaskNumber: string): ReplySection {
  return {
    key: ctaskNumber,
    marker: buildCtaskBackoutMarker(ctaskNumber),
    headingPattern: new RegExp(`^${ctaskNumber}[\\s·:—–-]*back[\\s-]?out\\s+plan$`, 'i'),
  };
}

/** True when a whole line is a change field's heading ("Backout Plan", "## Test Plan") — where a task's plan ends. */
function isChangeFieldHeadingLine(replyLine: string): boolean {
  const headingText = replyLine.replace(HEADING_MARK_PATTERN, '').trim().replace(/:$/, '').trim();
  return headingText !== '' && CHG_FIELD_REPLY_SECTIONS.some((section) => section.headingPattern.test(headingText));
}

/** One task as the assistant reads it: what it is, its CI, and its description and backout plan in full. */
function renderCtaskBlock(ctask: ReviewedCtask): string {
  const typeText = ctask.typeLabel || (ctask.isImplementation ? 'Implementation (from its name)' : 'not recorded');
  return [
    `${ctask.number} — ${ctask.shortDescription.trim() || NOT_SET_TEXT}`,
    `  Type: ${typeText}`,
    `  Configuration item: ${ctask.configItem.displayName.trim() || NOT_SET_TEXT}`,
    `  People: ${describeTaskPeople(ctask.assignedTo.displayName, ctask.assignmentGroup.displayName)}`,
    // The task's instructions are already written out under "Change task instructions" in the record facts; writing
    // them again here doubled the prompt past what Google's AI Mode reads (GH #499), so the block points to them.
    `  Instructions: ${ctask.description.trim() ? `see ${ctask.number} under "Change task instructions"` : NOT_SET_TEXT}`,
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
      'Each implementation task\'s backout plan also has a row in the table: PASS when it meets the change task rule, '
        + 'GAP when it does not — with the backout steps to add as its Fix.',
    ],
    // One table row per implementation task, named exactly as the review's task findings are (GH #499).
    tableItems: implementationTasks.map((ctask) => buildCtaskFindingField(ctask.number, 'backoutPlan')),
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
    tableItems: backoutGaps.map((gap) => gap.field),
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
    replyLines: gapTasks.map((ctask) => `${buildCtaskBackoutMarker(ctask.number)}: ${WHOLE_PLAN_PLACEHOLDER}`),
  };
}

/** A pasted fix reply split into each asked-for task's new backout plan and the text left for the change fields. */
export interface CtaskBackoutReply {
  backoutPlansByNumber: Map<string, string>;
  changeReplyText: string;
}

/**
 * One task's plan text, trimmed the way every section is read — so a closing offer to help further ("If you'd like, I
 * can…") that an answer engine puts after the last plan is never written into the task (GH #499).
 */
function readTaskPlanText(ctaskNumber: string, planLines: readonly string[]): string {
  const taskSection = buildCtaskBackoutSection(ctaskNumber);
  return readReplySections(`${taskSection.marker}:\n${planLines.join('\n')}`, [taskSection])[ctaskNumber] ?? '';
}

/**
 * Reads each task's rewritten backout plan out of a fix reply. A task block starts at its marker or its heading and
 * runs to the next task, or to a change field's marker or heading; everything outside the blocks is handed back for
 * the change-field reader. A plan for a task the prompt did not ask about is dropped — the reply is not trusted with
 * a task it was not shown.
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
    const planText = currentTask ? readTaskPlanText(currentTask.ctaskNumber, currentTask.lines) : '';
    if (currentTask && askedNumbers.has(currentTask.ctaskNumber) && planText !== '') {
      backoutPlansByNumber.set(currentTask.ctaskNumber, planText);
    }
    currentTask = null;
  };

  for (const replyLine of restoredReply.split(/\r?\n/)) {
    const taskMatch = CTASK_MARKER_LINE_PATTERN.exec(replyLine);
    if (taskMatch) {
      closeCurrentTask();
      const firstText = (taskMatch[2] ?? '').replace(LEADING_MARK_PATTERN, '').trim();
      currentTask = { ctaskNumber: taskMatch[1].toUpperCase(), lines: firstText ? [firstText] : [] };
      continue;
    }
    if (currentTask && (CHANGE_MARKER_LINE_PATTERN.test(replyLine) || isChangeFieldHeadingLine(replyLine))) {
      closeCurrentTask();
    }
    (currentTask ? currentTask.lines : changeLines).push(replyLine);
  }
  closeCurrentTask();
  return { backoutPlansByNumber, changeReplyText: changeLines.join('\n') };
}
