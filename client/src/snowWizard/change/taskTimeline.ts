// taskTimeline.ts — The tasks' timeline (pure): an AI round that times every task card, and the back-to-back schedule
// each change's tasks run to inside that change's window.
//
// The Change Advisory Board asks every task for three estimates (implementation, validation, backout) and for the
// window to hold them (ctaskDurations.ts). The Wizard never asked, so tasks went out "not estimated" and each one was
// dated with the whole change window. The AI times every task here — from the Jira work and the task's own words when
// nothing states a length, never "unknown" (owner's rule) — and the cards are then dated back to back in Toolbox's
// stage order (Implementation → Technical Checkout → Business Checkout), so the dates, the duration block on each task
// and the change's implementation plan all agree.

import { stripCodeFences, CODE_BLOCK_REPLY_INSTRUCTION } from '../../views/SnowHub/chgFormula/assistantReplyText.ts';
import { rankCtaskStage } from '../../views/SnowHub/chgFormula/ctaskTimeline.ts';
import {
  formatMinutes, listMissingEstimateLabels, normalizeEstimates, readEstimateMinutes, readPlannedWindowMinutes, type DurationEstimates,
} from '../../views/SnowHub/ctaskDurations.ts';
import type { CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import { buildIssueDetailText } from '../../views/SnowHub/hooks/useAiAssist.ts';
import { DRAFT_ENVIRONMENTS, readEnabledPlanEnvironments, readSelectedIssues, type CrgDraftState } from './changeDraft.ts';
import { readTaskEnvironmentTicks, type PlanEnvironmentKey } from './ctaskEnvironmentPlan.ts';
import { describeTaskCard } from './taskCards.ts';

/** One card dated inside its change's window. */
export interface ScheduledTaskCard {
  card: CtaskTemplate;
  /** Implementation plus validation — the time the task holds on the timeline. Backout is held in reserve. */
  minutes: number;
  plannedStartDate: string;
  plannedEndDate: string;
}

/** One change's timeline: its window, its tasks back to back, and whether they fit. */
export interface EnvironmentTimeline {
  label: PlanEnvironmentKey;
  plannedStartDate: string;
  plannedEndDate: string;
  windowMinutes: number | null;
  schedule: ScheduledTaskCard[];
  /** Minutes the tasks run past the window's end; 0 when they fit. */
  overrunMinutes: number;
}

/** A pasted timing reply, read. */
export interface TaskTimelineReply {
  isUsable: boolean;
  message: string;
  /** The three estimates for each card the reply timed, by card id. */
  estimatesByTaskId: Record<string, DurationEstimates>;
}

/** The line that starts the reply's timings. */
export const TIMELINE_REPLY_MARKER = 'TIMELINE:';
// One cell's length: "30", "30 min", "1h 30m", "1.5 hours", "2 hrs". Assistants word it every way, so all are read.
const DURATION_CELL_PATTERN = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*(?:m(?:in(?:ute)?s?)?)?)?$/i;
const PROMPT_ID_PATTERN = /\bT(\d+)\b/i;
const CTASK_NUMBER_PATTERN = /CTASK\d+/i;
// Bold, italic and code marks an assistant puts around a table cell or a list item.
const MARKDOWN_MARK_PATTERN = /\*\*|__|`/g;
const MINUTES_PER_HOUR = 60;
const ESTIMATES_PER_LINE = 3;
const IMPLEMENTATION_TASK_TYPE = 'implementation';
const MILLISECONDS_PER_MINUTE = 60_000;
// The form's date-time length: "YYYY-MM-DDTHH:mm".
const FORM_DATE_TIME_LENGTH = 16;
const NOT_A_TIMING_MESSAGE = '⚠️ No task timings could be read from that reply. Each task needs a line with its id (T1, T2…) '
  + 'and three lengths, like “T1 | 30 | 15 | 20 | why”. Ask the assistant to answer in that form, then paste its whole reply again.';

/** "T1", "T2": how the prompt names each card, so the reply can say which is which. */
function readTaskPromptId(taskIndex: number): string {
  return `T${taskIndex + 1}`;
}

/** True when a card carries all three estimates the CAB asks for. */
export function isTaskTimed(card: CtaskTemplate): boolean {
  return listMissingEstimateLabels(normalizeEstimates(card.durationEstimates)).length === 0;
}

/** The time a card holds on the timeline: implementation plus validation (backout waits in reserve). */
export function readTaskTimelineMinutes(card: CtaskTemplate): number {
  const estimates = normalizeEstimates(card.durationEstimates);
  return (readEstimateMinutes(estimates.implementationMinutes) ?? 0) + (readEstimateMinutes(estimates.validationMinutes) ?? 0);
}

/** "implementation 30 minutes, validation 15 minutes, backout 20 minutes", or '' for a card not timed yet. */
export function describeTaskTiming(card: CtaskTemplate): string {
  if (!isTaskTimed(card)) return '';
  const estimates = normalizeEstimates(card.durationEstimates);
  const phaseText = (typedMinutes: string) => formatMinutes(readEstimateMinutes(typedMinutes) ?? 0);
  return `implementation ${phaseText(estimates.implementationMinutes)}, validation ${phaseText(estimates.validationMinutes)}, `
    + `backout ${phaseText(estimates.backoutMinutes)}`;
}

/** A form date-time moved on by some minutes, in the same form (wall-clock arithmetic, as Toolbox's timeline does). */
function addMinutes(formDateTime: string, minutes: number): string {
  const startInstant = new Date(`${formDateTime.slice(0, FORM_DATE_TIME_LENGTH)}:00Z`);
  return new Date(startInstant.getTime() + minutes * MILLISECONDS_PER_MINUTE).toISOString().slice(0, FORM_DATE_TIME_LENGTH);
}

/** A card's stage: 0 implementation, 1 technical checkout, 2 business checkout, 3 anything else (Toolbox's rule). */
function rankCardStage(card: CtaskTemplate): number {
  const typeValue = card.changeTaskType ?? '';
  return rankCtaskStage({ typeLabel: typeValue, shortDescription: card.shortDescription, isImplementation: typeValue.toLowerCase() === IMPLEMENTATION_TASK_TYPE });
}

/**
 * The timed cards dated back to back from the window's start, Implementation first, then the checkouts; the user's own
 * card order is kept within a stage. A card with no timing is left out — it is never given an invented length.
 */
export function scheduleTaskCards(cards: readonly CtaskTemplate[], windowStartDate: string): ScheduledTaskCard[] {
  if (windowStartDate.trim() === '') return [];
  const orderedCards = cards
    .map((card, cardIndex) => ({ card, cardIndex, stage: rankCardStage(card) }))
    .filter(({ card }) => isTaskTimed(card))
    .sort((first, second) => first.stage - second.stage || first.cardIndex - second.cardIndex);
  let nextStartDate = windowStartDate.slice(0, FORM_DATE_TIME_LENGTH);
  return orderedCards.map(({ card }) => {
    const minutes = readTaskTimelineMinutes(card);
    const plannedStartDate = nextStartDate;
    const plannedEndDate = addMinutes(plannedStartDate, minutes);
    nextStartDate = plannedEndDate;
    return { card, minutes, plannedStartDate, plannedEndDate };
  });
}

/** The cards with their planned dates set from the schedule; a card the schedule does not hold is returned as it was. */
export function dateTaskCards(cards: readonly CtaskTemplate[], windowStartDate: string): CtaskTemplate[] {
  const schedule = scheduleTaskCards(cards, windowStartDate);
  return cards.map((card) => {
    const scheduled = schedule.find((scheduledCard) => scheduledCard.card === card);
    return scheduled ? { ...card, plannedStartDate: scheduled.plannedStartDate, plannedEndDate: scheduled.plannedEndDate } : card;
  });
}

/** The cards one environment's change gets. */
function listEnvironmentCards(draft: CrgDraftState, environmentKey: PlanEnvironmentKey): CtaskTemplate[] {
  const enabledEnvironments = readEnabledPlanEnvironments(draft);
  return draft.changeTasks.filter((card) => readTaskEnvironmentTicks(card, enabledEnvironments)[environmentKey]);
}

/** Each change in use with its window and its tasks' back-to-back schedule. */
export function buildEnvironmentTimelines(draft: CrgDraftState): EnvironmentTimeline[] {
  return DRAFT_ENVIRONMENTS.filter(({ stateKey }) => draft[stateKey].isEnabled).map(({ stateKey, label }) => {
    const { plannedStartDate, plannedEndDate } = draft[stateKey];
    const schedule = scheduleTaskCards(listEnvironmentCards(draft, label), plannedStartDate);
    const lastTask = schedule[schedule.length - 1];
    const overrunMinutes = lastTask && plannedEndDate !== '' ? readPlannedWindowMinutes(plannedEndDate, lastTask.plannedEndDate) ?? 0 : 0;
    return { label, plannedStartDate, plannedEndDate, windowMinutes: readPlannedWindowMinutes(plannedStartDate, plannedEndDate), schedule, overrunMinutes };
  });
}

/** Each task with no timing yet, in plain words — these hold the tasks step, since a task must never go out unestimated. */
export function listUntimedTaskProblems(draft: CrgDraftState): string[] {
  return draft.changeTasks
    .map((card, cardIndex) => (isTaskTimed(card) ? '' : `${describeTaskCard(card, cardIndex)} has no timing yet. Use “Time the tasks with AI” below.`))
    .filter((problem) => problem !== '');
}

/** Each change whose timed tasks run past its window's end, in plain words. */
export function listTimelineOverruns(draft: CrgDraftState): string[] {
  return buildEnvironmentTimelines(draft)
    .filter((timeline) => timeline.overrunMinutes > 0)
    .map((timeline) => `On the ${timeline.label} change the tasks run ${formatMinutes(timeline.overrunMinutes)} past the window's end. `
      + 'Make the window longer, or shorten the tasks.');
}

/** "22:00" from "2026-10-24T22:00", with the date only when the task does not start on the window's first day. */
function formatClock(formDateTime: string, windowStartDate: string): string {
  const [datePart, timePart] = formDateTime.split('T');
  return datePart === windowStartDate.split('T')[0] ? timePart : `${datePart} ${timePart}`;
}

/**
 * One change's window and task timeline as prompt lines: "PRD: 2026-10-24T22:00 → 2026-10-25T01:00 (3 hours)", then
 * each task with its planned times and estimates, in the order they run.
 */
export function describeEnvironmentTimeline(timeline: EnvironmentTimeline): string[] {
  const windowLength = timeline.windowMinutes === null ? 'window length not set' : formatMinutes(timeline.windowMinutes);
  const windowLine = `${timeline.label}: ${timeline.plannedStartDate || 'no start'} → ${timeline.plannedEndDate || 'no end'} (${windowLength})`;
  const taskLines = timeline.schedule.map((scheduled, scheduleIndex) => `  ${scheduleIndex + 1}. ${scheduled.card.shortDescription.trim()}: `
    + `${formatClock(scheduled.plannedStartDate, timeline.plannedStartDate)} → ${formatClock(scheduled.plannedEndDate, timeline.plannedStartDate)} `
    + `(${describeTaskTiming(scheduled.card)})`);
  const overrunLine = timeline.overrunMinutes > 0 ? [`  The tasks run ${formatMinutes(timeline.overrunMinutes)} past this window's end.`] : [];
  return [windowLine, ...taskLines, ...overrunLine];
}

/** " [CTASK0012345]" for a task the change already has (a modify names its cards by number), else ''. */
function readCtaskNumberText(card: CtaskTemplate): string {
  return CTASK_NUMBER_PATTERN.test(card.name) ? ` [${card.name.trim()}]` : '';
}

/** One card as the timing prompt shows it: its id, title, type, which changes get it, and its instructions. */
function describeTaskForPrompt(card: CtaskTemplate, cardIndex: number, enabledEnvironments: readonly PlanEnvironmentKey[]): string[] {
  const ticks = readTaskEnvironmentTicks(card, enabledEnvironments);
  const environmentText = enabledEnvironments.filter((environmentKey) => ticks[environmentKey]).join(' and ') || 'no change yet';
  return [
    `${readTaskPromptId(cardIndex)} — ${describeTaskCard(card, cardIndex)}${readCtaskNumberText(card)} (type: ${card.changeTaskType || 'not chosen'}; on the ${environmentText} change)`,
    `  Instructions: ${card.description.trim() || '(none written)'}`,
  ];
}

/** Each change's window and its length, for the timing prompt. */
function describeWindowsForPrompt(draft: CrgDraftState): string[] {
  return buildEnvironmentTimelines(draft).map((timeline) => {
    const windowLength = timeline.windowMinutes === null ? 'length not set' : formatMinutes(timeline.windowMinutes);
    return `  ${timeline.label}: ${timeline.plannedStartDate || 'no start'} → ${timeline.plannedEndDate || 'no end'} (${windowLength})`;
  });
}

const TIMING_RULES = [
  'For EVERY task give three estimates in whole minutes — the three the Change Advisory Board asks for on every task:',
  '  implementation = carrying the task out; validation = post-deployment validation/monitoring; backout = backing it out and proving the restore worked.',
  'Every estimate must be a number above zero. When nothing above states how long a task takes, estimate it from the Jira work, '
    + 'the task\'s type and instructions, and how long that kind of work usually takes. Never answer "unknown", "TBD", '
    + '"not estimated", 0 or a range, and do not ask me — a best estimate is what is wanted.',
  'The tasks run back to back in this order: Implementation → Technical Checkout → Business Checkout. Their implementation '
    + 'and validation must fit inside each change\'s window; backout time is held in reserve.',
];

/** The timing prompt: the windows, every task, the Jira work, the rules, and the exact reply form. */
export function buildTaskTimelinePrompt(draft: CrgDraftState): string {
  const enabledEnvironments = readEnabledPlanEnvironments(draft);
  const selectedIssues = readSelectedIssues(draft);
  return [
    'You are a Release Manager timing the tasks (CTASKs) of a ServiceNow change, so they can be scheduled back to back inside the change window.',
    '',
    'The change windows (one change per environment):',
    ...describeWindowsForPrompt(draft),
    '',
    'The tasks:',
    ...draft.changeTasks.flatMap((card, cardIndex) => describeTaskForPrompt(card, cardIndex, enabledEnvironments)),
    ...(selectedIssues.length > 0 ? ['', 'Jira work this change delivers:', buildIssueDetailText(selectedIssues)] : []),
    '',
    ...TIMING_RULES,
    '',
    `Reply with ${TIMELINE_REPLY_MARKER} and then one line per task:`,
    '<task id> | <implementation minutes> | <validation minutes> | <backout minutes> | <why this long>',
    '',
    CODE_BLOCK_REPLY_INSTRUCTION,
  ].join('\n');
}

/** A cell's length in whole minutes, or null when the cell is not a length (a title, a reason, an empty cell). */
function readDurationCell(cellText: string): number | null {
  const durationMatch = DURATION_CELL_PATTERN.exec(cellText.trim());
  if (!durationMatch || (durationMatch[1] === undefined && durationMatch[2] === undefined)) return null;
  const totalMinutes = Number(durationMatch[1] ?? 0) * MINUTES_PER_HOUR + Number(durationMatch[2] ?? 0);
  return totalMinutes > 0 ? Math.round(totalMinutes) : null;
}

/** A reply line as cells: split on "|" (a table or the asked-for form), else on tabs or commas. */
function splitReplyCells(replyLine: string): string[] {
  const plainLine = replyLine.replace(MARKDOWN_MARK_PATTERN, '').trim();
  const separator = plainLine.includes('|') ? '|' : /\t|,/;
  return plainLine.split(separator).map((cellText) => cellText.trim()).filter((cellText) => cellText !== '');
}

/** Lower-case letters and digits only, so a title compares without punctuation or spacing. */
function normaliseTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The card a line's naming text is about: its prompt id (T2), its CTASK number, or its exact title. */
function findNamedCard(namingText: string, cards: readonly CtaskTemplate[]): CtaskTemplate | undefined {
  const ctaskNumber = CTASK_NUMBER_PATTERN.exec(namingText)?.[0].toUpperCase();
  const numberedCard = ctaskNumber ? cards.find((card) => card.name.trim().toUpperCase() === ctaskNumber) : undefined;
  if (numberedCard) return numberedCard;
  const promptIdMatch = PROMPT_ID_PATTERN.exec(namingText);
  if (promptIdMatch) return cards[Number(promptIdMatch[1]) - 1];
  const namingKey = normaliseTitle(namingText.replace(/^[-–—•\d.)\s]+/, ''));
  return namingKey === '' ? undefined : cards.find((card, cardIndex) => normaliseTitle(describeTaskCard(card, cardIndex)) === namingKey);
}

/** One reply line read: the card it names and its three estimates, or null when it is not a timing line. */
function readTimingLine(replyLine: string, cards: readonly CtaskTemplate[]): { card: CtaskTemplate; estimates: DurationEstimates } | null {
  const cells = splitReplyCells(replyLine);
  const firstLengthIndex = cells.findIndex((cellText) => readDurationCell(cellText) !== null);
  if (firstLengthIndex < 1) return null;
  const lengths = cells.slice(firstLengthIndex).map(readDurationCell).filter((minutes): minutes is number => minutes !== null);
  const card = findNamedCard(cells.slice(0, firstLengthIndex).join(' '), cards);
  if (!card || lengths.length < ESTIMATES_PER_LINE) return null;
  const [implementationMinutes, validationMinutes, backoutMinutes] = lengths.map(String);
  return { card, estimates: { implementationMinutes, validationMinutes, backoutMinutes } };
}

/**
 * Reads a pasted timing reply into each card's three estimates, naming any card it left untimed. Lines are matched by
 * the task's prompt id, its CTASK number or its title, in the asked-for form, a markdown table, or a list.
 */
export function readTaskTimelineReply(replyText: string, cards: readonly CtaskTemplate[]): TaskTimelineReply {
  const estimatesByTaskId: Record<string, DurationEstimates> = {};
  for (const replyLine of stripCodeFences(replyText).split(/\r?\n/)) {
    const timingLine = readTimingLine(replyLine, cards);
    if (timingLine && !estimatesByTaskId[timingLine.card.id]) estimatesByTaskId[timingLine.card.id] = timingLine.estimates;
  }
  const timedCount = Object.keys(estimatesByTaskId).length;
  if (timedCount === 0) return { isUsable: false, message: NOT_A_TIMING_MESSAGE, estimatesByTaskId };
  const untimedLabels = cards.flatMap((card, cardIndex) => (estimatesByTaskId[card.id] ? [] : [describeTaskCard(card, cardIndex)]));
  const message = untimedLabels.length === 0
    ? `✓ Every task is timed (${timedCount}). The schedule below shows when each one runs.`
    : `Timed ${timedCount} of ${cards.length}. The reply left out ${untimedLabels.join(', ')} — ask the assistant to time ${untimedLabels.length === 1 ? 'it' : 'them'} too, then paste the whole reply again.`;
  return { isUsable: true, message, estimatesByTaskId };
}
