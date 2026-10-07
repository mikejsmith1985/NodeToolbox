// epicOrderAiAssist.ts — The AI Assist round that proposes the order a PI's Epics are worked in.
//
// Dates are arithmetic, and arithmetic is what a language model gets wrong — so the assistant is asked only
// for what needs judgement: which Epic goes first given dependencies and value, and how many to run at once.
// Toolbox turns that order into every Target Start and Target End with its own rule (epicDateSchedule.ts).
// Copy-out / paste-back only, like every AI Assist surface; the reply is checked against the Epics it was
// given, and a key it invents is rejected rather than trusted.

import { extractJsonPayload } from '../../../utils/extractJsonPayload.ts';
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
}

const EPIC_ORDER_REPLY_KIND = 'epicDatePlan';
// A parallel limit outside this range is not a plan for one team.
const MIN_PARALLEL_EPICS = 1;
const MAX_PARALLEL_EPICS = 10;

/** One Epic as the assistant reads it. */
function renderEpicLine(epic: EpicToSchedule, dependencyText: string): string {
  const pointsText = epic.points === null ? 'no estimate' : `${epic.points} points`;
  const stateText = epic.isStarted ? 'already in progress' : 'not started';
  const dependencyLine = dependencyText.trim() ? `\n  Dependencies / risks: ${dependencyText.trim().replace(/\s*\n\s*/g, '; ')}` : '';
  return `- ${epic.epicKey} — ${epic.summary} — ${pointsText} — ${stateText}${dependencyLine}`;
}

/** The order-proposal prompt: the PI, the team's throughput, every Epic, and a JSON reply format. */
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
    'Reply with ONLY this JSON, listing every Epic key above exactly once, in your proposed order:',
    '{',
    `  "kind": "${EPIC_ORDER_REPLY_KIND}",`,
    `  "maxParallelEpics": <a whole number from ${MIN_PARALLEL_EPICS} to ${MAX_PARALLEL_EPICS}>,`,
    '  "order": [ { "key": "<Epic key>", "rationale": "<one sentence: why it goes here>" } ]',
    '}',
  ].join('\n');
}

/** The parallel limit from a reply, when it is a sensible whole number. */
function readParallelLimit(rawLimit: unknown): number | null {
  return typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit >= MIN_PARALLEL_EPICS && rawLimit <= MAX_PARALLEL_EPICS
    ? rawLimit
    : null;
}

/**
 * Reads a pasted order. Keys are matched without regard to case; a key the prompt did not list is rejected, a
 * repeat is ignored, and any listed Epic the reply left out keeps its original place after the rest — so the
 * order always covers every Epic exactly once. Throws only for a reply that is not this round's JSON.
 */
export function parseEpicOrderReply(replyText: string, knownEpicKeys: readonly string[]): EpicOrderReply {
  const parsedEnvelope = JSON.parse(extractJsonPayload(replyText)) as Record<string, unknown>;
  if (parsedEnvelope.kind !== EPIC_ORDER_REPLY_KIND) {
    throw new Error(`Response kind "${String(parsedEnvelope.kind)}" does not match the requested "${EPIC_ORDER_REPLY_KIND}".`);
  }
  const knownKeyByUpperCase = new Map(knownEpicKeys.map((epicKey) => [epicKey.toUpperCase(), epicKey]));
  const reply: EpicOrderReply = { order: [], rationaleByKey: {}, maxParallelEpics: readParallelLimit(parsedEnvelope.maxParallelEpics), rejectedKeys: [] };
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
  reply.order.push(...knownEpicKeys.filter((epicKey) => !reply.order.includes(epicKey)));
  return reply;
}
