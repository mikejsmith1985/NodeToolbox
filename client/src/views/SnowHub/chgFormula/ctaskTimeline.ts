// ctaskTimeline.ts — Orders a change's CTASKs and dates them back to back from the change's planned start.
//
// Each CTASK's planned start and end must follow the real timeline: implementation first, then the technical
// checkout review, then the business checkout review. The assistant reads every task — its type, instructions and
// estimates — and decides the order of operations and how long each takes. Toolbox then holds it to the stage
// order and does the arithmetic, so the dates are back to back and always add up.

import { describeEstimatesForPrompt, readEstimatesFromText } from '../ctaskDurations.ts';
import { CODE_BLOCK_REPLY_INSTRUCTION, stripCodeFences } from './assistantReplyText.ts';
import type { ReviewedCtask } from './ctaskReviewRecord.ts';
import { EVIDENCE_RULE_LINES } from './evidenceRules.ts';

/** One task's place in the order the assistant gave, and how long it takes. */
export interface CtaskTimelineEntry {
  ctaskNumber: string;
  minutes: number;
}

/** A task with its planned start and end, as the Modify form holds dates ("YYYY-MM-DDTHH:mm", UTC). */
export interface ScheduledCtask {
  ctask: ReviewedCtask;
  minutes: number;
  startUtc: string;
  endUtc: string;
}

/** The change's planned window, in the same UTC form format. */
export interface ChangeWindow {
  startUtc: string;
  endUtc: string;
}

// The stages, in the order they run. A task matching none runs after them.
const STAGE_PATTERNS: readonly RegExp[] = [
  /implement|deploy|release|install|cut ?over/i,
  /technical/i,
  /business/i,
];
const OTHER_STAGE_RANK = STAGE_PATTERNS.length;
const STAGE_ORDER_TEXT = 'Implementation → Review Technical Checkout → Review Business Checkout';
// The reply marker, then one "CTASK… | minutes" line per task.
const TIMELINE_MARKER = 'TIMELINE:';
const TIMELINE_LINE_PATTERN = /^\s*[-*]?\s*(CTASK\d+)\s*\|\s*(\d+)/i;
const MILLISECONDS_PER_MINUTE = 60_000;
// The form's date-time length: "YYYY-MM-DDTHH:mm".
const FORM_DATE_TIME_LENGTH = 16;

/** Where a task falls in the order: 0 implementation, 1 technical checkout, 2 business checkout, 3 anything else. */
export function rankCtaskStage(ctask: Pick<ReviewedCtask, 'typeLabel' | 'shortDescription' | 'isImplementation'>): number {
  if (ctask.isImplementation) {
    return 0;
  }
  const taskText = `${ctask.typeLabel} ${ctask.shortDescription}`;
  const stageIndex = STAGE_PATTERNS.findIndex((stagePattern, patternIndex) => patternIndex > 0 && stagePattern.test(taskText));
  return stageIndex === -1 ? OTHER_STAGE_RANK : stageIndex;
}

/** One task as the assistant reads it: number, type, its estimates when it has them, and its instructions. */
function renderTimelineTask(ctask: ReviewedCtask): string {
  const estimatesText = describeEstimatesForPrompt(readEstimatesFromText(ctask.description));
  return [
    `${ctask.number} — ${ctask.shortDescription.trim()} (${ctask.typeLabel || 'type not recorded'})`
      + (estimatesText ? ` — estimated: ${estimatesText}` : ''),
    `  Instructions: ${ctask.description.trim() || '(none)'}`,
  ].join('\n');
}

/** The prompt that asks for the order of operations and each task's minutes. */
export function buildCtaskTimelinePrompt(ctasks: readonly ReviewedCtask[], changeWindow: ChangeWindow): string {
  return [
    'You are a Release Manager planning the order of operations for a ServiceNow change\'s tasks (CTASKs).',
    `The change window runs ${changeWindow.startUtc.replace('T', ' ')} to ${changeWindow.endUtc.replace('T', ' ')} (UTC).`,
    '',
    'The tasks:',
    ...ctasks.map((ctask) => renderTimelineTask(ctask)),
    '',
    `Order them in stages: ${STAGE_ORDER_TEXT}. Within a stage, order them by what each task's instructions need `
      + 'done first.',
    'Give each task the minutes it takes to carry out: its estimates when it has them (implementation plus '
      + 'validation for an implementation task), otherwise what its instructions support. Backout time is held in '
      + 'reserve — do not schedule it.',
    '',
    ...EVIDENCE_RULE_LINES,
    '',
    `Reply with ${TIMELINE_MARKER} and then one line per task, in the order they run:`,
    '<CTASK number> | <minutes> | <why it runs here>',
    '',
    CODE_BLOCK_REPLY_INSTRUCTION,
  ].join('\n');
}

/** The order and minutes from a pasted reply, keeping only this change's tasks, and naming any it left out. */
export function parseCtaskTimelineReply(
  replyText: string,
  ctasks: readonly ReviewedCtask[],
): { entries: CtaskTimelineEntry[]; missingNumbers: string[] } {
  const knownNumbers = new Set(ctasks.map((ctask) => ctask.number.toUpperCase()));
  const entries: CtaskTimelineEntry[] = [];
  for (const replyLine of stripCodeFences(replyText).split(/\r?\n/)) {
    const lineMatch = TIMELINE_LINE_PATTERN.exec(replyLine);
    const ctaskNumber = lineMatch?.[1].toUpperCase() ?? '';
    if (lineMatch && knownNumbers.has(ctaskNumber) && !entries.some((entry) => entry.ctaskNumber === ctaskNumber)) {
      entries.push({ ctaskNumber, minutes: Number(lineMatch[2]) });
    }
  }
  const missingNumbers = ctasks.map((ctask) => ctask.number).filter((ctaskNumber) => !entries.some((entry) => entry.ctaskNumber === ctaskNumber));
  return { entries, missingNumbers };
}

/** A form date-time moved on by some minutes, in the same form. */
function addMinutes(formDateTimeUtc: string, minutes: number): string {
  const startInstant = new Date(`${formDateTimeUtc.slice(0, FORM_DATE_TIME_LENGTH)}:00Z`);
  return new Date(startInstant.getTime() + minutes * MILLISECONDS_PER_MINUTE).toISOString().slice(0, FORM_DATE_TIME_LENGTH);
}

/**
 * The tasks dated back to back from the window start. The assistant's order is kept within each stage, but the
 * stages themselves always run Implementation → Technical Checkout → Business Checkout.
 */
export function scheduleCtaskTimeline(
  entries: readonly CtaskTimelineEntry[],
  ctasks: readonly ReviewedCtask[],
  windowStartUtc: string,
): ScheduledCtask[] {
  const orderedTasks = entries
    .map((entry, replyIndex) => ({ entry, replyIndex, ctask: ctasks.find((ctask) => ctask.number.toUpperCase() === entry.ctaskNumber) }))
    .filter((planned): planned is { entry: CtaskTimelineEntry; replyIndex: number; ctask: ReviewedCtask } => planned.ctask !== undefined)
    .sort((first, second) => rankCtaskStage(first.ctask) - rankCtaskStage(second.ctask) || first.replyIndex - second.replyIndex);
  let nextStartUtc = windowStartUtc.slice(0, FORM_DATE_TIME_LENGTH);
  return orderedTasks.map(({ entry, ctask }) => {
    const startUtc = nextStartUtc;
    const endUtc = addMinutes(startUtc, entry.minutes);
    nextStartUtc = endUtc;
    return { ctask, minutes: entry.minutes, startUtc, endUtc };
  });
}

/** True when the last task ends after the change's planned end. */
export function isTimelinePastWindow(schedule: readonly ScheduledCtask[], windowEndUtc: string): boolean {
  const lastTask = schedule[schedule.length - 1];
  return lastTask !== undefined && windowEndUtc !== '' && lastTask.endUtc > windowEndUtc.slice(0, FORM_DATE_TIME_LENGTH);
}
