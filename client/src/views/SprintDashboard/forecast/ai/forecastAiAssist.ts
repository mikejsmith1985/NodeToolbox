// forecastAiAssist.ts — Turns computed figures into something a team can be told, and nothing more.
//
// The rule is that every date, point value, capacity figure and flag is rule-derived. The AI writes
// NARRATIVE. It is not asked for a number and it cannot supply one — and that is enforced by SHAPE
// rather than by validation alone: an accepted item carries an id, a headline, prose, and lists of
// keys. There is nowhere in the envelope to put a figure.
//
// Validation then handles the remaining risk, which is a model naming an issue or a person the
// prompt never mentioned. Those items are rejected and NAMED, never dropped quietly — a reply that
// silently lost half its content is worse than one that failed.
//
// Propose-only throughout: nothing here writes to Jira, and no call leaves the browser. The operator
// carries the text out and the reply back.

import { extractJsonPayload } from '../../../../utils/extractJsonPayload.ts';
import type { CapacityAssessment, ForecastResult, IssueForecast } from '../forecastTypes.ts';

/** Which of the three narratives a prompt and its reply belong to. */
export type ForecastAiKind = 'forecastDaily' | 'forecastScopeCut' | 'forecastTestCapacity';

/** One proposed narrative. Note what is NOT here: any numeric field at all. */
export interface ForecastAiItem {
  id: string;
  headline: string;
  narrative: string;
  issueKeys: string[];
  personKeys: string[];
}

/** A parsed reply: what survived, and precisely what did not. */
export interface ForecastAiIngest {
  kind: ForecastAiKind;
  items: ForecastAiItem[];
  rejectedItems: Array<{ id: string; reason: string }>;
}

/** The only properties an item may carry. Anything else is a model inventing a field. */
const ALLOWED_ITEM_PROPERTIES = new Set(['id', 'headline', 'narrative', 'issueKeys', 'personKeys']);

/**
 * The self-describing CLAUSE a model opens with, and only that clause.
 *
 * Deliberately stops at the first comma or full stop rather than consuming the sentence. "As an AI,
 * ENC-1 is late" carries a real finding after the comma, and a rule that took the whole sentence
 * would delete the finding along with the attribution — then reject the item for being empty, which
 * is how tidying turns into losing.
 */
const AI_ATTRIBUTION_PATTERN = /\b(as an ai|as a language model|i am an ai|being an ai)\b[^,.]*[,.]\s*/gi;

/** The instruction block every prompt opens with — the figures are not up for negotiation. */
const PROMPT_PREAMBLE = [
  'You are helping a Scrum Master communicate a delivery forecast.',
  '',
  'EVERY FIGURE BELOW IS ALREADY CALCULATED AND IS NOT NEGOTIABLE.',
  'Do not compute, adjust, re-estimate or invent any date, point value, day count or percentage.',
  'Reference only the issue keys and people named below. Naming anything else invalidates your reply.',
  'Do not describe yourself or attribute the text to an assistant.',
  '',
].join('\n');

/** Spells out the reply shape, including that there is nowhere to put a number. */
function buildReplyInstruction(kind: ForecastAiKind): string {
  return [
    '',
    'Reply with JSON only, in exactly this shape:',
    `{"kind":"${kind}","items":[{"id":"...","headline":"...","narrative":"...",`
      + '"issueKeys":["..."],"personKeys":["..."]}]}',
    'No other properties are permitted on an item.',
  ].join('\n');
}

/** One issue, written out with every figure the engine produced for it. */
function describeIssue(forecast: IssueForecast): string {
  return `  - ${forecast.issueKey} [${forecast.state}] ${forecast.summary}`
    + ` | owner: ${forecast.assigneeDisplayName ?? 'none'}`
    + ` | latest start: ${forecast.latestStartIso ?? 'n/a'}`
    + ` | slack: ${forecast.slackWorkingDays ?? 'n/a'} working days`
    + ` | ${forecast.reason}`;
}

/** One person's load, written out as the engine computed it. */
function describePersonLoad(assessment: CapacityAssessment): string[] {
  return assessment.personLoads.map((load) => `  - ${load.displayName}`
    + ` | in scope: ${load.inScopeWorkingDays}d`
    + ` | all their work: ${load.totalAssignedWorkingDays}d`
    + ` | available: ${load.availableWorkingDays}d`
    + ` | over by: ${load.isOverCapacity ? `${load.overCapacityWorkingDays}d` : 'not over'}`);
}

/** Says what the totals could not see, so the narrative cannot claim more certainty than they have. */
function describeCompleteness(assessment: CapacityAssessment): string {
  return `Unmeasured: ${assessment.unsizedIssueCount} unsized,`
    + ` ${assessment.undatedIssueCount} undated versions,`
    + ` ${assessment.unassignedIssueKeys.length} unassigned.`;
}

/** Builds the daily who-is-behind-and-who-is-ahead prompt. */
export function buildForecastDailyPrompt(result: ForecastResult): string {
  if (result.issueForecasts.length === 0) {
    return `${PROMPT_PREAMBLE}There is no work in scope to report on today.${buildReplyInstruction('forecastDaily')}`;
  }

  return [
    PROMPT_PREAMBLE,
    `Today is ${result.config.todayIso}.`,
    'Every issue in scope, with the verdict already computed for it:',
    ...result.issueForecasts.map((forecast) => describeIssue(forecast)),
    '',
    'Write a short standup narrative naming what must start today and what is running ahead.',
    buildReplyInstruction('forecastDaily'),
  ].join('\n');
}

/** Builds the scope-cut prompt for a release whose work outruns the people holding it. */
export function buildScopeCutPrompt(
  assessment: CapacityAssessment,
  forecasts: readonly IssueForecast[],
): string {
  return [
    PROMPT_PREAMBLE,
    `Window: ${assessment.window.startIso} to ${assessment.window.endIso}`
      + ` (${assessment.window.workingDayCount} working days).`,
    `Work left: ${assessment.totalRemainingWorkingDays}d. Capacity: ${assessment.totalAvailableWorkingDays}d.`,
    `Shortfall: ${assessment.shortfallWorkingDays}d.`,
    describeCompleteness(assessment),
    '',
    'Per person:',
    ...describePersonLoad(assessment),
    '',
    'The work in scope:',
    ...forecasts.map((forecast) => describeIssue(forecast)),
    '',
    'Recommend which scope should come out of this release, and say why for each suggestion.',
    buildReplyInstruction('forecastScopeCut'),
  ].join('\n');
}

/** Builds the mitigation prompt for an external-test window that cannot absorb what is coming. */
export function buildTestCapacityPrompt(
  assessment: CapacityAssessment,
  forecasts: readonly IssueForecast[],
): string {
  return [
    PROMPT_PREAMBLE,
    `External test window: ${assessment.window.startIso} to ${assessment.window.endIso}`
      + ` (${assessment.window.workingDayCount} working days).`,
    `Test work left: ${assessment.totalRemainingWorkingDays}d.`
      + ` Tester capacity: ${assessment.totalAvailableWorkingDays}d.`
      + ` Shortfall: ${assessment.shortfallWorkingDays}d.`,
    describeCompleteness(assessment),
    '',
    'Testers:',
    ...describePersonLoad(assessment),
    '',
    'The test work in scope:',
    ...forecasts.map((forecast) => describeIssue(forecast)),
    '',
    'Weigh the two remedies — reduce scope, or add test resource — and say what each would cost.',
    buildReplyInstruction('forecastTestCapacity'),
  ].join('\n');
}

/** Removes a model's self-description while leaving the substance of the narrative alone. */
export function stripAiAttribution(narrative: string): string {
  return narrative.replace(AI_ATTRIBUTION_PATTERN, '').trim();
}

/** Reads one item, or explains why it cannot be trusted. */
function readItem(
  rawItem: unknown,
  index: number,
  allowedIssueKeys: ReadonlySet<string>,
  allowedPersonKeys: ReadonlySet<string>,
): { item: ForecastAiItem } | { rejection: { id: string; reason: string } } {
  const candidate = rawItem as Record<string, unknown>;
  const itemId = typeof candidate?.id === 'string' && candidate.id.trim() !== ''
    ? candidate.id.trim()
    : `item ${index + 1}`;

  // The numeric guard. There is no numeric field in the schema, so a model that emits one has
  // invented a property — and inventing a property is exactly how a figure would get changed.
  const unexpectedProperty = Object.keys(candidate ?? {})
    .find((propertyName) => !ALLOWED_ITEM_PROPERTIES.has(propertyName));
  if (unexpectedProperty !== undefined) {
    return { rejection: { id: itemId, reason: `carries an unexpected property "${unexpectedProperty}"` } };
  }

  const headline = typeof candidate?.headline === 'string' ? candidate.headline.trim() : '';
  const narrative = typeof candidate?.narrative === 'string' ? stripAiAttribution(candidate.narrative) : '';
  if (headline === '' || narrative === '') {
    return { rejection: { id: itemId, reason: 'has no headline or no narrative' } };
  }

  const issueKeys = Array.isArray(candidate?.issueKeys) ? candidate.issueKeys.map(String) : [];
  const strayIssueKey = issueKeys.find((issueKey) => !allowedIssueKeys.has(issueKey));
  if (strayIssueKey !== undefined) {
    return { rejection: { id: itemId, reason: `names ${strayIssueKey}, which was not in the prompt` } };
  }

  const personKeys = Array.isArray(candidate?.personKeys) ? candidate.personKeys.map(String) : [];
  const strayPersonKey = personKeys.find((personKey) => !allowedPersonKeys.has(personKey));
  if (strayPersonKey !== undefined) {
    return { rejection: { id: itemId, reason: `names ${strayPersonKey}, who was not in the prompt` } };
  }

  return { item: { id: itemId, headline, narrative, issueKeys, personKeys } };
}

/**
 * Parses a pasted reply, keeping what is trustworthy and naming what is not.
 *
 * Never all-or-nothing: one bad item does not discard the rest, and one silently dropped item is
 * worse than a whole reply that failed, because nobody would know to look for it.
 */
export function parseForecastAiReply(
  replyText: string,
  expectedKind: ForecastAiKind,
  allowedIssueKeys: readonly string[],
  allowedPersonKeys: readonly string[],
): ForecastAiIngest {
  const payload = JSON.parse(extractJsonPayload(replyText)) as { kind?: unknown; items?: unknown };

  if (payload.kind !== expectedKind) {
    throw new Error(`This reply is for "${String(payload.kind)}", not "${expectedKind}".`);
  }
  if (!Array.isArray(payload.items)) {
    throw new Error('The reply carries no items array.');
  }

  const issueKeySet = new Set(allowedIssueKeys);
  const personKeySet = new Set(allowedPersonKeys);
  const items: ForecastAiItem[] = [];
  const rejectedItems: Array<{ id: string; reason: string }> = [];

  payload.items.forEach((rawItem, index) => {
    const outcome = readItem(rawItem, index, issueKeySet, personKeySet);
    if ('item' in outcome) {
      items.push(outcome.item);
      return;
    }
    rejectedItems.push(outcome.rejection);
  });

  return { kind: expectedKind, items, rejectedItems };
}
