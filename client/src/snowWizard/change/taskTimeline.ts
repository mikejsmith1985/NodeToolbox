// taskTimeline.ts — The tasks' timeline (pure): an AI round that times and places every task card, and the schedule
// each change's tasks run to inside that change's window.
//
// The Change Advisory Board asks every task for three estimates (implementation, validation, backout) and for the
// window to hold them (ctaskDurations.ts). The Wizard never asked, so tasks went out "not estimated" and each one was
// dated with the whole change window. The AI times every task here — from the Jira work and the task's own words when
// nothing states a length, never "unknown" (owner's rule) — and the cards are then dated back to back in Toolbox's
// stage order (Implementation → Technical Checkout → Business Checkout), so the dates, the duration block on each task
// and the change's implementation plan all agree. Not every task waits for the one before it (GH #475): the AI also says
// which run alongside another, which are only on stand-by for the whole window, and which may not start before a time.

import { stripCodeFences, CODE_BLOCK_REPLY_INSTRUCTION } from '../../views/SnowHub/chgFormula/assistantReplyText.ts';
import { rankCtaskStage } from '../../views/SnowHub/chgFormula/ctaskTimeline.ts';
import {
  formatMinutes, listMissingEstimateLabels, normalizeEstimates, readEstimateMinutes, readPlannedWindowMinutes, type DurationEstimates,
} from '../../views/SnowHub/ctaskDurations.ts';
import type { CtaskTemplate, TaskTimelinePlacement } from '../../views/SnowHub/hooks/useCrgState.ts';
import { DRAFT_ENVIRONMENTS, readEnabledPlanEnvironments, readSelectedIssues, type CrgDraftState } from './changeDraft.ts';
import { readTaskEnvironmentTicks, type PlanEnvironmentKey } from './ctaskEnvironmentPlan.ts';
import { fitPromptToBudget } from './promptBudget.ts';
import { describeTaskCard } from './taskCards.ts';
import {
  describeTaskPlacement, readLaterDate, readLocalTimeZone, readMinutesBetween, readPlacementCell, readTaskPlacement, resolveNotBeforeDate,
  type PlacementReadContext,
} from './taskPlacement.ts';

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
  /** Where each card runs in the window, by card id — only for the lines that said so. */
  placementsByTaskId: Record<string, TaskTimelinePlacement>;
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

/** A card with its stage and its place in the user's own order. */
interface RankedCard {
  card: CtaskTemplate;
  cardIndex: number;
  stage: number;
}

/** The card an "alongside" card runs with, when that task is on this change and timed. */
function findPartnerCard(rankedCard: RankedCard, ranked: readonly RankedCard[]): RankedCard | undefined {
  const placement = readTaskPlacement(rankedCard.card);
  if (placement.runMode !== 'alongside') return undefined;
  const partnerKey = normaliseTitle(placement.alongsideTaskTitle ?? '');
  return ranked.find((other) => other !== rankedCard && normaliseTitle(other.card.shortDescription) === partnerKey);
}

/**
 * The timed cards in the order they are placed: Implementation first, then the checkouts, the user's own order kept
 * within a stage — and each "alongside" card moved to just after the task it runs with. One whose partner is not on
 * this change (or not timed), or a loop of partners, is simply placed one after another.
 */
function orderCardsForSchedule(cards: readonly CtaskTemplate[]): RankedCard[] {
  const ranked = cards
    .map((card, cardIndex) => ({ card, cardIndex, stage: rankCardStage(card) }))
    .filter(({ card }) => isTaskTimed(card))
    .sort((first, second) => first.stage - second.stage || first.cardIndex - second.cardIndex);
  const ordered = ranked.filter((rankedCard) => !findPartnerCard(rankedCard, ranked));
  let pending = ranked.filter((rankedCard) => findPartnerCard(rankedCard, ranked));
  while (pending.length > 0) {
    const placeable = pending.filter((rankedCard) => ordered.includes(findPartnerCard(rankedCard, ranked) as RankedCard));
    if (placeable.length === 0) return [...ordered, ...pending];
    for (const rankedCard of placeable) {
      const partner = findPartnerCard(rankedCard, ranked) as RankedCard;
      let insertPosition = ordered.indexOf(partner) + 1;
      while (insertPosition < ordered.length && findPartnerCard(ordered[insertPosition], ranked) === partner) insertPosition += 1;
      ordered.splice(insertPosition, 0, rankedCard);
    }
    pending = pending.filter((rankedCard) => !placeable.includes(rankedCard));
  }
  return ordered;
}

/** A window's start and end in the form's shape; the end is '' when not set. */
interface ScheduleWindow {
  start: string;
  end: string;
}

/** One card's slot: on stand-by across the window, with its partner, or after the task before it — never before its time. */
function placeCard(card: CtaskTemplate, window: ScheduleWindow, cursor: string, placed: readonly ScheduledTaskCard[]): ScheduledTaskCard {
  const placement = readTaskPlacement(card);
  const minutes = readTaskTimelineMinutes(card);
  const earliestDate = resolveNotBeforeDate(placement.notBeforeTime, window.start, window.end);
  if (placement.runMode === 'wholeWindow') {
    const plannedStartDate = readLaterDate(window.start, earliestDate);
    const hasWindowEnd = window.end !== '' && window.end > plannedStartDate;
    return { card, minutes, plannedStartDate, plannedEndDate: hasWindowEnd ? window.end : addMinutes(plannedStartDate, minutes) };
  }
  const partnerKey = placement.runMode === 'alongside' ? normaliseTitle(placement.alongsideTaskTitle ?? '') : '';
  const partner = partnerKey ? placed.find((scheduled) => normaliseTitle(scheduled.card.shortDescription) === partnerKey) : undefined;
  const plannedStartDate = readLaterDate(partner ? partner.plannedStartDate : cursor, earliestDate);
  return { card, minutes, plannedStartDate, plannedEndDate: addMinutes(plannedStartDate, minutes) };
}

/**
 * The timed cards dated inside the window from its start. By default they run one after another, Implementation first,
 * then the checkouts; a stand-by task spans the whole window and holds nobody up; an "alongside" task starts with its
 * partner, and the next task waits for both; a "not before" time holds a task (and those after it) until then. A card
 * with no timing is left out — it is never given an invented length.
 */
export function scheduleTaskCards(cards: readonly CtaskTemplate[], windowStartDate: string, windowEndDate = ''): ScheduledTaskCard[] {
  if (windowStartDate.trim() === '') return [];
  const window = { start: windowStartDate.slice(0, FORM_DATE_TIME_LENGTH), end: windowEndDate.trim().slice(0, FORM_DATE_TIME_LENGTH) };
  const schedule: ScheduledTaskCard[] = [];
  let cursor = window.start;
  for (const { card } of orderCardsForSchedule(cards)) {
    const scheduled = placeCard(card, window, cursor, schedule);
    schedule.push(scheduled);
    if (readTaskPlacement(card).runMode !== 'wholeWindow') cursor = readLaterDate(cursor, scheduled.plannedEndDate);
  }
  return schedule;
}

/** The cards with their planned dates set from the schedule; a card the schedule does not hold is returned as it was. */
export function dateTaskCards(cards: readonly CtaskTemplate[], windowStartDate: string, windowEndDate = ''): CtaskTemplate[] {
  const schedule = scheduleTaskCards(cards, windowStartDate, windowEndDate);
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
    const schedule = scheduleTaskCards(listEnvironmentCards(draft, label), plannedStartDate, plannedEndDate);
    // Stand-by tasks end with the window by design, so only the tasks the work waits on can overrun it.
    const lastEndDate = schedule
      .filter((scheduled) => readTaskPlacement(scheduled.card).runMode !== 'wholeWindow')
      .reduce((latest, scheduled) => readLaterDate(latest, scheduled.plannedEndDate), '');
    const overrunMinutes = lastEndDate !== '' && plannedEndDate !== '' ? Math.max(0, readMinutesBetween(plannedEndDate, lastEndDate)) : 0;
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
    + `(${describeTaskTiming(scheduled.card)})${describePlacementSuffix(scheduled.card)}`);
  const overrunLine = timeline.overrunMinutes > 0 ? [`  The tasks run ${formatMinutes(timeline.overrunMinutes)} past this window's end.`] : [];
  return [windowLine, ...taskLines, ...overrunLine];
}

/** " — runs alongside “Deploy”" for a task not simply placed after the one before it, else ''. */
export function describePlacementSuffix(card: CtaskTemplate): string {
  const placementText = describeTaskPlacement(readTaskPlacement(card));
  return placementText === '' ? '' : ` — ${placementText}`;
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
  'Then say how each task runs in the window. By default the tasks run one after another in this order: Implementation → '
    + 'Technical Checkout → Business Checkout. Look for every task that need not wait:',
  '  - "whole window": a task kept only for awareness or on stand-by in case it is needed (for example a Prod Support task '
    + 'that keeps the team informed). It spans the whole window and no other task waits for it.',
  '  - "with T<n>": a task that can run at the same time as task T<n> (another team or system, nothing it depends on).',
  '  - "in order": a task that must wait for the one before it.',
  '  Then, when a task\'s title or instructions say it must start or finish after a time ("after 5:00 CST", '
    + '"After-Hours Requirement"), add "; not before HH:MM <zone>" in 24-hour time, with the zone it states. '
    + 'An after-hours time is in the evening, so "5:00" there is 17:00.',
  'The tasks that run in order or alongside must fit inside each change\'s window; backout time is held in reserve.',
];

/** What the earlier steps already say about the change, so each task is timed and placed with the whole picture. */
function describeChangeForPrompt(draft: CrgDraftState): string[] {
  const basicInfo = draft.chgBasicInfo;
  const factLines = [
    ['Category', basicInfo.category], ['Type', basicInfo.changeType], ['Short description', draft.generatedShortDescription],
    ['What is changing', draft.generatedDescription], ['Why it is needed', draft.generatedJustification],
    ['Risk and impact', draft.generatedRiskImpact], ['Implementation plan', draft.chgPlanningContent.implementationPlan],
    ['Backout plan', draft.chgPlanningContent.backoutPlan], ['Test plan', draft.chgPlanningContent.testPlan],
    ...Object.entries(draft.chgPlanningAssessment),
  ].filter(([, factText]) => (factText ?? '').trim() !== '').map(([factLabel, factText]) => `  ${factLabel}: ${factText.trim()}`);
  return factLines.length > 0 ? ['', 'What the earlier steps say about this change:', ...factLines] : [];
}

/** The timing prompt: the windows, every task, the Jira work, the rules, and the exact reply form. */
export function buildTaskTimelinePrompt(draft: CrgDraftState): string {
  const enabledEnvironments = readEnabledPlanEnvironments(draft);
  const selectedIssues = readSelectedIssues(draft);
  return fitPromptToBudget(selectedIssues, (issueDetailText) => [
    'You are a Release Manager timing the tasks (CTASKs) of a ServiceNow change, so they can be scheduled back to back inside the change window.',
    '',
    `The change windows (one change per environment), on the ${readLocalTimeZone()} clock:`,
    ...describeWindowsForPrompt(draft),
    ...describeChangeForPrompt(draft),
    '',
    'The tasks:',
    ...draft.changeTasks.flatMap((card, cardIndex) => describeTaskForPrompt(card, cardIndex, enabledEnvironments)),
    ...(selectedIssues.length > 0 ? ['', 'Jira work this change delivers:', issueDetailText] : []),
    '',
    ...TIMING_RULES,
    '',
    `Reply with ${TIMELINE_REPLY_MARKER} and then one line per task:`,
    '<task id> | <implementation minutes> | <validation minutes> | <backout minutes> | <in order / whole window / with T<n>, then "; not before HH:MM <zone>" if any> | <why>',
    '',
    CODE_BLOCK_REPLY_INSTRUCTION,
  ].join('\n')).promptText;
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

/** One reply line read: the card it names, its three estimates, and where it runs when the line says so. */
interface TimingLine {
  card: CtaskTemplate;
  estimates: DurationEstimates;
  placement: TaskTimelinePlacement | null;
}

/** The cell indexes holding the first three lengths, or null when the line has fewer. */
function findLengthCellIndexes(cells: readonly string[]): number[] | null {
  const lengthIndexes = cells.flatMap((cellText, cellIndex) => (readDurationCell(cellText) !== null ? [cellIndex] : []));
  return lengthIndexes.length >= ESTIMATES_PER_LINE ? lengthIndexes.slice(0, ESTIMATES_PER_LINE) : null;
}

/** One reply line read, or null when it is not a timing line. */
function readTimingLine(replyLine: string, cards: readonly CtaskTemplate[], placementContext: PlacementReadContext): TimingLine | null {
  const cells = splitReplyCells(replyLine);
  const lengthIndexes = findLengthCellIndexes(cells);
  if (!lengthIndexes || lengthIndexes[0] < 1) return null;
  const card = findNamedCard(cells.slice(0, lengthIndexes[0]).join(' '), cards);
  if (!card) return null;
  const [implementationMinutes, validationMinutes, backoutMinutes] = lengthIndexes.map((cellIndex) => String(readDurationCell(cells[cellIndex])));
  // The placement is the cell right after the three lengths; an older reply puts the reason there, which reads as none.
  const placementCell = cells[lengthIndexes[ESTIMATES_PER_LINE - 1] + 1] ?? '';
  const placement = readPlacementCell(placementCell, placementContext);
  return { card, estimates: { implementationMinutes, validationMinutes, backoutMinutes }, placement };
}

/** How the reply's "with T3" and stated zones are read for these cards. */
function buildPlacementContext(cards: readonly CtaskTemplate[], windowDate: string): PlacementReadContext {
  return {
    findTaskTitle: (namingText) => findNamedCard(namingText, cards)?.shortDescription.trim() || undefined,
    windowZone: readLocalTimeZone(),
    windowDate,
  };
}

/**
 * Reads a pasted timing reply into each card's three estimates, naming any card it left untimed. Lines are matched by
 * the task's prompt id, its CTASK number or its title, in the asked-for form, a markdown table, or a list.
 */
export function readTaskTimelineReply(replyText: string, cards: readonly CtaskTemplate[], windowDate = ''): TaskTimelineReply {
  const estimatesByTaskId: Record<string, DurationEstimates> = {};
  const placementsByTaskId: Record<string, TaskTimelinePlacement> = {};
  const placementContext = buildPlacementContext(cards, windowDate);
  for (const replyLine of stripCodeFences(replyText).split(/\r?\n/)) {
    const timingLine = readTimingLine(replyLine, cards, placementContext);
    if (!timingLine || estimatesByTaskId[timingLine.card.id]) continue;
    estimatesByTaskId[timingLine.card.id] = timingLine.estimates;
    if (timingLine.placement) placementsByTaskId[timingLine.card.id] = timingLine.placement;
  }
  const timedCount = Object.keys(estimatesByTaskId).length;
  if (timedCount === 0) return { isUsable: false, message: NOT_A_TIMING_MESSAGE, estimatesByTaskId, placementsByTaskId };
  const untimedLabels = cards.flatMap((card, cardIndex) => (estimatesByTaskId[card.id] ? [] : [describeTaskCard(card, cardIndex)]));
  const message = untimedLabels.length === 0
    ? `✓ Every task is timed (${timedCount}). The schedule below shows when each one runs.`
    : `Timed ${timedCount} of ${cards.length}. The reply left out ${untimedLabels.join(', ')} — ask the assistant to time ${untimedLabels.length === 1 ? 'it' : 'them'} too, then paste the whole reply again.`;
  return { isUsable: true, message, estimatesByTaskId, placementsByTaskId };
}
