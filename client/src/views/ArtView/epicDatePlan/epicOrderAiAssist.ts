// epicOrderAiAssist.ts — The AI Assist round that proposes the order a PI's Epics are worked in.
//
// Dates are arithmetic, and arithmetic is what a language model gets wrong — so the assistant is asked only
// for what needs judgement: which Epic goes first given dependencies and value, and how many to run at once.
// Toolbox turns that order into every Target Start and Target End with its own rule (epicDateSchedule.ts).
// Copy-out / paste-back only, like every AI Assist surface; the reply is checked against the Epics it was
// given, and a key it invents is rejected rather than trusted.
//
// Google's AI Mode — the team's only assistant (GH #499) — ignores JSON, so the prompt ends with a fill-in
// table listing every Epic, where the assistant writes each Epic's position and reason, plus one
// "EPICS_AT_ONCE:" line. A JSON reply from any other assistant is still read.

import {
  buildRecordReplyInstructions,
  extractRecordReplyPayload,
  type ReplyRecordSpec,
} from '../../../utils/aiReplyRecords.ts';
import { readReplySections, type ReplySection } from '../../../utils/aiReplySections.ts';
import type { EpicToSchedule } from './epicDateSchedule.ts';

/** The PI and team facts the assistant needs to judge an order. */
export interface EpicOrderPromptContext {
  piName: string;
  piStartDate: string;
  piEndDate: string;
  dailyCapacityPoints: number;
  maxParallelEpics: number;
  /** Each Epic's Dependency / Risks text from the PI Review page, so ordering respects what blocks what. */
  dependencyTextByKey: Readonly<Record<string, string>>;
}

/** A pasted order, checked against the Epics the prompt listed. */
export interface EpicOrderReply {
  /** Every listed Epic exactly once: the assistant's order, then any it left out in their original order. */
  order: string[];
  rationaleByKey: Record<string, string>;
  /** The assistant's parallel limit, or null when it gave none worth using. */
  maxParallelEpics: number | null;
  /** Keys in the reply that were not in the prompt. */
  rejectedKeys: string[];
  /** Listed Epics the reply gave no place to — kept at the end in their original order, and asked about again. */
  unplacedKeys: string[];
}

const EPIC_ORDER_REPLY_KIND = 'epicDatePlan';
// A parallel limit outside this range is not a plan for one team.
const MIN_PARALLEL_EPICS = 1;
const MAX_PARALLEL_EPICS = 10;
// A "|" or line break inside a summary would split its table row, so it is written as a space.
const TABLE_CELL_BREAKING_PATTERN = /[|\r\n]+/g;
// The first whole number in the parallel-limit answer: "3", "3 Epics", "**3** (two in flight plus one)".
const FIRST_WHOLE_NUMBER_PATTERN = /\d+/;

/** The fill-in table: every Epic by key and summary, its position and reason left blank. */
const EPIC_ORDER_SPEC: ReplyRecordSpec = {
  kind: EPIC_ORDER_REPLY_KIND,
  replyMarker: 'EPIC_ORDER_TABLE:',
  columns: [
    { field: 'key', header: 'Epic key' },
    { field: 'summary', header: 'Epic', isNamingOnly: true },
    { field: 'position', header: 'Position', valueKind: 'number', answerHint: '1 for the Epic worked first, 2 for the next, and so on — a different number for every Epic' },
    { field: 'rationale', header: 'Why it goes here', answerHint: 'one sentence' },
  ],
};

/** The one line that carries how many Epics run at once — found by its marker or a heading AI Mode writes instead. */
const PARALLEL_LIMIT_SECTION: ReplySection<'parallelLimit'> = {
  key: 'parallelLimit',
  marker: 'EPICS_AT_ONCE',
  headingPattern: /^(?:number of )?epics?(?: worked| run| running)? at once$|^parallel(?: epics| limit)?$/i,
};

/** One Epic as the assistant reads it. */
function renderEpicLine(epic: EpicToSchedule, dependencyText: string): string {
  const pointsText = epic.points === null ? 'no estimate' : `${epic.points} points`;
  const stateText = epic.isStarted ? 'already in progress' : 'not started';
  const dependencyLine = dependencyText.trim() ? `\n  Dependencies / risks: ${dependencyText.trim().replace(/\s*\n\s*/g, '; ')}` : '';
  return `- ${epic.epicKey} — ${epic.summary} — ${pointsText} — ${stateText}${dependencyLine}`;
}

/** One pre-filled row per Epic — its key and summary — so the reply cannot invent or drop an Epic. */
function listEpicRowNamingCells(epics: readonly EpicToSchedule[]): string[][] {
  return epics.map((epic) => [epic.epicKey, epic.summary.replace(TABLE_CELL_BREAKING_PATTERN, ' ')]);
}

/** The reply form: the parallel-limit line, then the Epic table to fill in. */
function buildEpicOrderReplyForm(epics: readonly EpicToSchedule[]): string {
  return [
    `First write the line ${PARALLEL_LIMIT_SECTION.marker}: followed by how many Epics should run at once — a whole `
      + `number from ${MIN_PARALLEL_EPICS} to ${MAX_PARALLEL_EPICS}.`,
    'Then give every Epic its position in the order you propose.',
    buildRecordReplyInstructions(EPIC_ORDER_SPEC, listEpicRowNamingCells(epics)),
  ].join('\n');
}

/** The order-proposal prompt: the PI, the team's throughput, every Epic, and a fill-in reply form. */
export function buildEpicOrderPrompt(epics: readonly EpicToSchedule[], context: EpicOrderPromptContext): string {
  return [
    `You are helping a Product Owner plan ${context.piName} (${context.piStartDate} to ${context.piEndDate}).`,
    `The team delivers about ${context.dailyCapacityPoints.toFixed(1)} points per working day and currently works up to `
      + `${context.maxParallelEpics} Epics at once, sharing that capacity.`,
    'Propose the ORDER the Epics below should be worked in, and how many should run at once.',
    'Put Epics already in progress first. Respect dependencies: an Epic that is blocked by another goes after it. '
      + 'Then favour the highest value and the smallest risk of slipping out of the PI.',
    'Do not give dates — they are calculated from your order. Do not add, rename or drop Epics.',
    '',
    'Epics, in their current priority order:',
    ...epics.map((epic) => renderEpicLine(epic, context.dependencyTextByKey[epic.epicKey] ?? '')),
    '',
    buildEpicOrderReplyForm(epics),
  ].join('\n');
}

/**
 * The follow-up to paste into the same AI chat, or '' when the reply needs none. An unreadable reply gets the
 * whole form again; a reply that left Epics without a position gets the form again with those Epics named,
 * because an order is judged as a whole. Nothing is guessed for an Epic the assistant did not place.
 *
 * @param orderReply - The parsed reply, or null when the reply could not be read at all.
 */
export function buildEpicOrderFollowUpPrompt(epics: readonly EpicToSchedule[], orderReply: EpicOrderReply | null): string {
  if (orderReply === null) {
    return ['Your last reply was not in the form I need, so it could not be read. Keep the order you chose, but put it in this form.',
      buildEpicOrderReplyForm(epics)].join('\n');
  }
  if (orderReply.unplacedKeys.length === 0) {
    return '';
  }
  return [`Your last reply gave no position for ${orderReply.unplacedKeys.join(', ')}. Keep the order you chose, and give `
    + 'every Epic its position in this form.', buildEpicOrderReplyForm(epics)].join('\n');
}

/** The parallel limit from a reply, when it is a sensible whole number. */
function readParallelLimit(rawLimit: unknown): number | null {
  return typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit >= MIN_PARALLEL_EPICS && rawLimit <= MAX_PARALLEL_EPICS
    ? rawLimit
    : null;
}

/**
 * The table's rows as the JSON envelope's "order": sorted by the position the assistant wrote. When it wrote no
 * position at all, its row order is its order. A row without a position, when others have one, is left out —
 * so that Epic is reported as unplaced rather than given a guessed place.
 */
function readTableOrderEntries(tableItems: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const hasAnyPosition = tableItems.some((tableItem) => typeof tableItem.position === 'number');
  if (!hasAnyPosition) {
    return [...tableItems];
  }
  return tableItems
    .filter((tableItem) => typeof tableItem.position === 'number')
    .sort((first, second) => (first.position as number) - (second.position as number));
}

/** The parallel limit written on the reply's "EPICS_AT_ONCE:" line, or undefined when there is none. */
function readParallelLimitLine(replyText: string): number | undefined {
  const limitText = readReplySections(replyText, [PARALLEL_LIMIT_SECTION]).parallelLimit ?? '';
  const numberMatch = FIRST_WHOLE_NUMBER_PATTERN.exec(limitText.split(/\r?\n/)[0] ?? '');
  return numberMatch ? Number(numberMatch[0]) : undefined;
}

/**
 * The reply as this round's JSON envelope. A filled-in table becomes { kind, order, maxParallelEpics }; a JSON
 * reply is returned as written. Throws the usual "No JSON object found" error when the reply is neither.
 */
function readEpicOrderEnvelope(replyText: string): Record<string, unknown> {
  const parsedPayload = JSON.parse(extractRecordReplyPayload(replyText, EPIC_ORDER_SPEC)) as Record<string, unknown>;
  // A JSON reply carries "order"; the table reader's envelope carries "items".
  if (Array.isArray(parsedPayload.order) || !Array.isArray(parsedPayload.items)) {
    return parsedPayload;
  }
  return {
    kind: parsedPayload.kind,
    order: readTableOrderEntries(parsedPayload.items as Record<string, unknown>[]),
    maxParallelEpics: readParallelLimitLine(replyText),
  };
}

/**
 * Reads a pasted order — the filled-in table or JSON. Keys are matched without regard to case; a key the prompt
 * did not list is rejected, a repeat is ignored, and any listed Epic the reply left out keeps its original place
 * after the rest (and is reported as unplaced) — so the order always covers every Epic exactly once. Throws only
 * for a reply that is neither this round's table nor its JSON.
 */
export function parseEpicOrderReply(replyText: string, knownEpicKeys: readonly string[]): EpicOrderReply {
  const parsedEnvelope = readEpicOrderEnvelope(replyText);
  if (parsedEnvelope.kind !== EPIC_ORDER_REPLY_KIND) {
    throw new Error(`Response kind "${String(parsedEnvelope.kind)}" does not match the requested "${EPIC_ORDER_REPLY_KIND}".`);
  }
  const knownKeyByUpperCase = new Map(knownEpicKeys.map((epicKey) => [epicKey.toUpperCase(), epicKey]));
  const reply: EpicOrderReply = {
    order: [], rationaleByKey: {}, maxParallelEpics: readParallelLimit(parsedEnvelope.maxParallelEpics), rejectedKeys: [], unplacedKeys: [],
  };
  const orderEntries = Array.isArray(parsedEnvelope.order) ? parsedEnvelope.order : [];
  for (const orderEntry of orderEntries) {
    const entryRecord = (typeof orderEntry === 'object' && orderEntry !== null ? orderEntry : {}) as Record<string, unknown>;
    const rawKey = String(entryRecord.key ?? '').trim();
    const epicKey = knownKeyByUpperCase.get(rawKey.toUpperCase());
    if (epicKey === undefined) {
      if (rawKey !== '') reply.rejectedKeys.push(rawKey);
      continue;
    }
    if (reply.order.includes(epicKey)) {
      continue;
    }
    reply.order.push(epicKey);
    if (typeof entryRecord.rationale === 'string' && entryRecord.rationale.trim() !== '') {
      reply.rationaleByKey[epicKey] = entryRecord.rationale.trim();
    }
  }
  reply.unplacedKeys = knownEpicKeys.filter((epicKey) => !reply.order.includes(epicKey));
  reply.order.push(...reply.unplacedKeys);
  return reply;
}
