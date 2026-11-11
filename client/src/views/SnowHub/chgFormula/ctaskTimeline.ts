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
import {
  buildFillInTable, buildFormatFixPrompt, describeFillInRules, findHeaderColumns, readDurationCellMinutes, splitReplyCells,
} from './replyTable.ts';

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
// The reply marker, then the filled-in table: one "CTASK… — title | minutes | why" row per task.
const TIMELINE_MARKER = 'TIMELINE:';
const CTASK_NUMBER_PATTERN = /CTASK\d+/gi;
/** The fill-in table's header; the reader finds each column by these names, in whatever order a reply has them. */
const TIMELINE_TABLE_HEADER = ['Task', 'Minutes', 'Why it runs here'];
const TIMELINE_HEADER_COLUMNS = { task: /^(?:task|ctask)/i, minutes: /minute|duration|length/i };
/** What to say when a reply has no row this reader can use — usually an assistant that answered in its own shape. */
export const NO_TIMELINE_ROWS_MESSAGE = 'No task minutes could be read — the reply needs each CTASK with its minutes, not start '
  + 'and end times. Copy the follow-up below into the same AI chat, then paste its reply here.';
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

/** The table the prompt ends with: every task by number and title, its minutes and reason left blank. */
function buildTimelineFillInTable(ctasks: readonly ReviewedCtask[]): string[] {
  return buildFillInTable(TIMELINE_TABLE_HEADER, ctasks.map((ctask) => [`${ctask.number} — ${ctask.shortDescription.trim()}`]));
}

/**
 * The prompt that asks for the order of operations and each task's minutes. It ends with a table listing every task
 * for the assistant to fill in: an answer engine completes a table far more reliably than it follows a line format
 * (GH #499), and the rows it is given cannot be renumbered or added to.
 */
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
    'Order the rows in the order the tasks run.',
    ...describeFillInRules(TIMELINE_MARKER),
    CODE_BLOCK_REPLY_INSTRUCTION,
    '',
    TIMELINE_MARKER,
    ...buildTimelineFillInTable(ctasks),
  ].join('\n');
}

/** One reply row read: the first of this change's CTASK numbers it names, and its minutes. Null when it is not one. */
function readTimelineRow(
  cells: readonly string[],
  knownNumbers: ReadonlySet<string>,
  headerColumns: Partial<Record<keyof typeof TIMELINE_HEADER_COLUMNS, number>> | null,
): CtaskTimelineEntry | null {
  const taskCellIndex = cells.findIndex((cellText) => (cellText.match(CTASK_NUMBER_PATTERN) ?? [])
    .some((ctaskNumber) => knownNumbers.has(ctaskNumber.toUpperCase())));
  if (taskCellIndex === -1) return null;
  const ctaskNumber = (cells[taskCellIndex].match(CTASK_NUMBER_PATTERN) ?? [])
    .map((matchedNumber) => matchedNumber.toUpperCase()).find((matchedNumber) => knownNumbers.has(matchedNumber)) as string;
  // The header's Minutes column when it holds a length; otherwise the first length after the task, as the form asks.
  const headerMinutes = headerColumns?.minutes === undefined ? null : readDurationCellMinutes(cells[headerColumns.minutes] ?? '');
  const minutes = headerMinutes ?? cells.slice(taskCellIndex + 1).map((cellText) => readDurationCellMinutes(cellText))
    .find((cellMinutes) => cellMinutes !== null) ?? null;
  return minutes === null ? null : { ctaskNumber, minutes };
}

/**
 * The order and minutes from a pasted reply, keeping only this change's tasks, naming any it left out, and — when any
 * are missing — a follow-up asking for just those, in the same table. A start or end time is never read as minutes.
 */
export function parseCtaskTimelineReply(
  replyText: string,
  ctasks: readonly ReviewedCtask[],
): { entries: CtaskTimelineEntry[]; missingNumbers: string[]; followUpPrompt: string } {
  const knownNumbers = new Set(ctasks.map((ctask) => ctask.number.toUpperCase()));
  const entries: CtaskTimelineEntry[] = [];
  let headerColumns: Partial<Record<keyof typeof TIMELINE_HEADER_COLUMNS, number>> | null = null;
  for (const replyLine of stripCodeFences(replyText).split(/\r?\n/)) {
    const cells = splitReplyCells(replyLine);
    headerColumns = findHeaderColumns(cells, TIMELINE_HEADER_COLUMNS) ?? headerColumns;
    const entry = readTimelineRow(cells, knownNumbers, headerColumns);
    if (entry && !entries.some((knownEntry) => knownEntry.ctaskNumber === entry.ctaskNumber)) entries.push(entry);
  }
  const missingTasks = ctasks.filter((ctask) => !entries.some((entry) => entry.ctaskNumber === ctask.number.toUpperCase()));
  const followUpPrompt = missingTasks.length === 0 ? '' : buildFormatFixPrompt(TIMELINE_MARKER, buildTimelineFillInTable(missingTasks));
  return { entries, missingNumbers: missingTasks.map((ctask) => ctask.number), followUpPrompt };
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
