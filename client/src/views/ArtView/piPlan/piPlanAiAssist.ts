// piPlanAiAssist.ts — The propose-only AI envelope for PI planning (spec 028, contract ai-assist-json.md).
// The AI proposes ONLY the Feature→Story breakdown; the engine owns all scheduling, assignment, and
// dates (dates in the reply are ignored, FR-054). Mirrors the shipped piReviewAiAssist.ts shape:
// build a prompt from the full input set, then parse a strict {kind:'piPlan'} reply leniently per field.
//
// Google's AI Mode — the team's only assistant (GH #499) — ignores JSON, so the prompt ends with a Story
// table listing every Feature once; the assistant copies a Feature's row once per Story it proposes. The
// reader groups those rows back into the same {kind:'piPlan', items[]} envelope, so every existing rule below
// keeps applying unchanged. A JSON reply from any other assistant is still read.

import {
  buildRecordFillInTable,
  extractRecordReplyPayload,
  readRecordTableItems,
  type ReplyRecordSpec,
} from '../../../utils/aiReplyRecords.ts';
import { FILL_IN_BLANK } from '../../../utils/aiReplyTable.ts';
import type { DeliveryRole } from '../../FeatureCanvas/planner/capacityTypes.ts';
import type {
  BreakdownSuggestion,
  PiPlanParseResult,
  ReleaseSchedule,
  StorySuggestion,
  WorkingCalendar,
} from './piPlanTypes.ts';

/** The reply envelope kind — guarded on ingest so an unrelated JSON blob is rejected clearly. */
export const PI_PLAN_REPLY_KIND = 'piPlan';

/** The line the Story table follows, so the reader can skip any intro the assistant writes first. */
const PI_PLAN_REPLY_MARKER = 'PI_PLAN_STORIES:';
// A "|" or line break inside a Feature summary would split its table row, so it is written as a space.
const TABLE_CELL_BREAKING_PATTERN = /[|\r\n]+/g;

/**
 * The Story table: one row per Story, keyed by its Feature. The Feature column only names the row and is
 * never read back; the reader groups rows by Feature key into the envelope's items.
 */
const PI_PLAN_STORY_SPEC: ReplyRecordSpec = {
  kind: PI_PLAN_REPLY_KIND,
  replyMarker: PI_PLAN_REPLY_MARKER,
  columns: [
    { field: 'featureKey', header: 'Feature key' },
    { field: 'featureSummary', header: 'Feature', isNamingOnly: true },
    { field: 'summary', header: 'Story' },
    { field: 'sizePoints', header: 'Story points', valueKind: 'number' },
    { field: 'hasTestableOutput', header: 'Testable output', valueKind: 'boolean' },
    { field: 'rationale', header: 'Why this split' },
  ],
};

/** The encoded scheduling rules sent as explicit constants so the plan never depends on unstated lore. */
export interface PiPlanRuleConstants {
  devTestSplitLabel: string;   // e.g. "70% development / 30% internal testing"
  maxStoryPoints: number;      // 13
  intWithinHours: number;      // 24
  relWorkingDays: number;      // 5 working days after INT
  keepReleasesMonthly: boolean;
  definitionOfDone: string;    // "code in INT"
}

/** The complete FR-001–011 input set the prompt carries. */
export interface PiPlanPromptContext {
  piName: string;
  piStartIso: string;
  piEndIso: string;
  sprints: { name: string; startIso: string; endIso: string }[];
  workingCalendar: WorkingCalendar;
  roster: { displayName: string; roles: DeliveryRole[]; pointsPerSprint: number }[];
  teamPointsPerSprint: number;
  features: {
    key: string;
    summary: string;
    sizePoints: number | null;
    priorityName: string | null;
    dependencyKeys: string[];
    targetFixVersion: string | null;
  }[];
  releaseSchedule: ReleaseSchedule;
  rules: PiPlanRuleConstants;
}

/** Builds the single planning prompt covering every in-scope Feature, ending with the reply template. */
export function buildPiPlanAiPrompt(context: PiPlanPromptContext): string {
  const { rules } = context;
  const lines: string[] = [];
  lines.push('You are a SAFe PI planning assistant. Break each Feature into independently testable Stories.');
  lines.push('Propose ONLY the Story breakdown. Do NOT assign people, sprints, or dates — the tool computes those.');
  lines.push('');
  lines.push(`PI: ${context.piName} (${context.piStartIso} to ${context.piEndIso})`);
  lines.push(`Sprints: ${context.sprints.map((sprint) => `${sprint.name} [${sprint.startIso}..${sprint.endIso}]`).join(', ')}`);
  lines.push(`Non-working days: weekends ${JSON.stringify(context.workingCalendar.weekendDays)}, holidays ${JSON.stringify(context.workingCalendar.holidayIsoDates)}`);
  lines.push(`Team capacity: ${context.teamPointsPerSprint} points/sprint total.`);
  lines.push('Roster (delivery capabilities & points/sprint):');
  context.roster.forEach((person) => lines.push(`  - ${person.displayName}: [${person.roles.join(', ')}] ${person.pointsPerSprint} pts/sprint`));
  lines.push('Production release schedule (fixVersions in the PI window):');
  context.releaseSchedule.entries.forEach((release) => lines.push(`  - ${release.name} @ ${release.releaseDateIso}`));
  lines.push('Features to break down:');
  context.features.forEach((feature) => lines.push(
    `  - ${feature.key} "${feature.summary}" size=${feature.sizePoints ?? 'UNSIZED'} priority=${feature.priorityName ?? 'n/a'} deps=[${feature.dependencyKeys.join(', ')}] fixVersion=${feature.targetFixVersion ?? 'none'}`,
  ));
  lines.push('');
  lines.push('RULES (apply exactly):');
  lines.push(`  - Effort split per Story: ${rules.devTestSplitLabel}.`);
  lines.push(`  - A Story with testable output gets an internal-test sub-task; its end date gates external testing.`);
  lines.push(`  - Max Story size: ${rules.maxStoryPoints} points, and it must fit one sprint's capacity for its assignee.`);
  lines.push(`  - Deploy INT within ${rules.intWithinHours}h of internal-test complete; REL = INT + ${rules.relWorkingDays} working days; PROD on a fixVersion date.`);
  lines.push(`  - Definition of Done = ${rules.definitionOfDone}. Production may deploy after the PI end.${rules.keepReleasesMonthly ? ' Keep production releases ~monthly.' : ''}`);
  lines.push('  - Each Story must be independently testable. Mark hasTestableOutput=false only for spikes/research.');
  lines.push('');
  lines.push(...describePiPlanTableRules(rules.maxStoryPoints));
  lines.push('');
  lines.push(PI_PLAN_REPLY_MARKER);
  lines.push(...buildRecordFillInTable(PI_PLAN_STORY_SPEC, listFeatureRowNamingCells(context.features)));
  return lines.join('\n');
}

/** One pre-filled row per Feature — its key and summary — so the reply cannot invent or drop a Feature. */
function listFeatureRowNamingCells(features: PiPlanPromptContext['features']): string[][] {
  return features.map((feature) => [feature.key, feature.summary.replace(TABLE_CELL_BREAKING_PATTERN, ' ')]);
}

/**
 * How to fill the Story table. Unlike a one-row-per-item table, the assistant ADDS rows here — a copy of a
 * Feature's row for each Story — so the shared "do not add rows" wording does not fit and is stated here.
 */
function describePiPlanTableRules(maxStoryPoints: number): string[] {
  return [
    `Answer ONLY by copying the table below, starting with the line ${PI_PLAN_REPLY_MARKER}, and replacing every ${FILL_IN_BLANK}.`,
    'Each Feature is listed once. Copy its row once per Story you propose for it, keeping its Feature key and Feature '
      + 'exactly as written. Never add a Feature that is not listed, and do not add or rename columns.',
    `- Story: the Story's summary.  - Story points: a number, at most ${maxStoryPoints}.  `
      + '- Testable output: Yes, or No only for a spike or research.  - Why this split: one line, on the first row of each Feature.',
    'Do not answer in JSON, bullet points or paragraphs. Keep each cell on one line and never put a "|" inside a cell. '
      + 'Write nothing before or after the table, and ask no questions: when something is unclear, give your best judgement.',
  ];
}

/**
 * The follow-up to paste into the same AI chat, or '' when the reply needs none. An unreadable reply gets
 * the whole table again; a reply that left Features without a usable Story gets a table of just those.
 * Nothing missing is ever guessed — the assistant is asked.
 *
 * @param parseResult - The parsed reply, or null when the reply could not be read at all.
 */
export function buildPiPlanAiFollowUpPrompt(context: PiPlanPromptContext, parseResult: PiPlanParseResult | null): string {
  const tableRules = describePiPlanTableRules(context.rules.maxStoryPoints);
  if (parseResult === null) {
    return [
      'Your last reply was not in the form I need, so it could not be read. Keep the Stories you already proposed, but put them in this table.',
      ...tableRules, '', PI_PLAN_REPLY_MARKER, ...buildRecordFillInTable(PI_PLAN_STORY_SPEC, listFeatureRowNamingCells(context.features)),
    ].join('\n');
  }
  const answeredKeys = new Set(parseResult.suggestions.filter((suggestion) => suggestion.stories.length > 0).map((suggestion) => suggestion.featureKey));
  const missingFeatures = context.features.filter((feature) => !answeredKeys.has(feature.key));
  if (missingFeatures.length === 0) {
    return '';
  }
  return [
    `Your last reply proposed no usable Story for ${missingFeatures.map((feature) => feature.key).join(', ')}. Break down only those now, in this table.`,
    ...tableRules, '', PI_PLAN_REPLY_MARKER, ...buildRecordFillInTable(PI_PLAN_STORY_SPEC, listFeatureRowNamingCells(missingFeatures)),
  ].join('\n');
}

/** Adds one table row to its Feature's item: a Story when the row names one, and the first rationale given. */
function addStoryRowToItem(itemsByKey: Map<string, Record<string, unknown>>, row: Record<string, unknown>): void {
  const featureKey = String(row.featureKey);
  const item = itemsByKey.get(featureKey) ?? { featureKey, stories: [] as unknown[], rationale: null };
  itemsByKey.set(featureKey, item);
  if (item.rationale === null && typeof row.rationale === 'string') {
    item.rationale = row.rationale;
  }
  // A row left wholly blank is the Feature unanswered — no Story, so the follow-up asks for it.
  if (row.summary !== undefined || row.sizePoints !== undefined) {
    (item.stories as unknown[]).push({ summary: row.summary, sizePoints: row.sizePoints, hasTestableOutput: row.hasTestableOutput });
  }
}

/**
 * The reply as {kind:'piPlan', items[]} JSON text. A filled-in Story table is read first, its rows grouped
 * by Feature key; otherwise a JSON reply is read as before. Throws the usual "No JSON object found" error
 * when the reply is neither.
 */
function readPiPlanReplyPayload(replyText: string): string {
  const tableRows = readRecordTableItems(replyText, PI_PLAN_STORY_SPEC);
  if (tableRows === null || tableRows.length === 0) {
    return extractRecordReplyPayload(replyText, PI_PLAN_STORY_SPEC);
  }
  const itemsByKey = new Map<string, Record<string, unknown>>();
  tableRows.forEach((row) => addStoryRowToItem(itemsByKey, row));
  return JSON.stringify({ kind: PI_PLAN_REPLY_KIND, items: [...itemsByKey.values()] });
}

/** Reads one story object leniently; returns null when it lacks a usable summary or numeric size. */
function readStory(raw: unknown): StorySuggestion | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
  const sizePoints = typeof record.sizePoints === 'number' && Number.isFinite(record.sizePoints) ? record.sizePoints : null;
  if (summary === '' || sizePoints === null) {
    return null;
  }
  // hasTestableOutput defaults true (FR-021); any date fields present in the reply are ignored (FR-054).
  return { summary, sizePoints, hasTestableOutput: record.hasTestableOutput !== false, matchExistingKey: null };
}

/**
 * Parses a {kind:'piPlan'} reply. Strict per key (unknown Feature keys are rejected with a reason),
 * lenient per field (an unusable Story is dropped and counted, its siblings survive). Throws only on a
 * missing/blank reply or the wrong `kind`.
 */
export function parsePiPlanAiReply(replyText: string, knownFeatureKeys: string[]): PiPlanParseResult {
  const parsed = JSON.parse(readPiPlanReplyPayload(replyText)) as Record<string, unknown>;
  if (parsed.kind !== PI_PLAN_REPLY_KIND) {
    throw new Error(`Expected an AI reply with {"kind":"${PI_PLAN_REPLY_KIND}"}, got "${String(parsed.kind)}".`);
  }
  const knownKeySet = new Set(knownFeatureKeys);
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const suggestions: BreakdownSuggestion[] = [];
  const rejected: { featureKey: string; reason: string }[] = [];
  const unknownKeys: string[] = [];
  let unparsedCount = 0;

  items.forEach((rawItem) => {
    const record = (rawItem && typeof rawItem === 'object' ? rawItem : {}) as Record<string, unknown>;
    const featureKey = typeof record.featureKey === 'string' ? record.featureKey.trim() : '';
    if (featureKey === '' || !knownKeySet.has(featureKey)) {
      unknownKeys.push(featureKey);
      rejected.push({ featureKey, reason: 'Feature is not in the current PI scope' });
      return;
    }
    const rawStories = Array.isArray(record.stories) ? record.stories : [];
    const stories: StorySuggestion[] = [];
    rawStories.forEach((rawStory) => {
      const story = readStory(rawStory);
      if (story) {
        stories.push(story);
      } else {
        unparsedCount += 1;
      }
    });
    const rationale = typeof record.rationale === 'string' ? record.rationale : null;
    suggestions.push({ featureKey, stories, rationale });
  });

  return { suggestions, rejected, unknownKeys, unparsedCount };
}
