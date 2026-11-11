// deliveryPlanPrompt.ts — Builds the propose-only PI Delivery planning prompt (spec 032, US1,
// contract ai-delivery-plan.md). The prompt embeds the PI Planning Fact Sheet verbatim (compact tables) and
// the engine-flagged bottlenecks, and asks the AI for ONLY two judgements: how to group each Feature's repos
// into Stories, and a mitigation per bottleneck. It explicitly forbids dates/capacity/assignments — those
// are computed by the engine — so the AI cannot supply a fact it could get wrong (agree-by-construction).
//
// Google's AI Mode — the team's only assistant (GH #499) — ignores JSON, so the prompt ends with two fill-in
// tables: a Story table listing every Feature once (the assistant copies a Feature's row once per Story) and a
// mitigation table listing every flagged bottleneck. deliveryPlanIngest.ts reads them back into the same
// {kind:'piDeliveryPlan', stories[], mitigations[]} object, so its allowlist firewall applies unchanged.

import { buildRecordFillInTable, type ReplyRecordSpec } from '../../../../utils/aiReplyRecords.ts';
import { FILL_IN_BLANK } from '../../../../utils/aiReplyTable.ts';
import type { Bottleneck, PiPlanningFactSheet } from '../piPlanTypes.ts';

/** The reply envelope kind, so a reply pasted from a different AI surface is caught rather than misread. */
export const DELIVERY_PLAN_REPLY_KIND = 'piDeliveryPlan';

/** How many Features to embed per prompt chunk before splitting (keeps a single reply pasteable). */
const FEATURES_PER_CHUNK = 12;

/** Default max Story size when the caller does not pass the selected per-person-per-sprint capacity. */
const DEFAULT_MAX_STORY_SIZE = 10;

// A "|" or line break inside a summary or statement would split its table row, so it is written as a space.
const TABLE_CELL_BREAKING_PATTERN = /[|\r\n]+/g;
/** Separates the acceptance hints written into one cell — a comma cannot, because a hint is a sentence. */
export const AC_HINT_SEPARATOR = ';';

/** The Story table: one row per Story, keyed by its Feature. The Feature column only names the row. */
export const DELIVERY_STORY_SPEC: ReplyRecordSpec = {
  kind: DELIVERY_PLAN_REPLY_KIND,
  replyMarker: 'DELIVERY_PLAN_STORIES:',
  columns: [
    { field: 'featureKey', header: 'Feature key' },
    { field: 'featureSummary', header: 'Feature', isNamingOnly: true },
    { field: 'summary', header: 'Story' },
    { field: 'repos', header: 'Repos', valueKind: 'list' },
    { field: 'acHints', header: 'Acceptance hints' },
  ],
};

/** The mitigation table: one pre-filled row per flagged bottleneck. The Bottleneck column only names the row. */
export const DELIVERY_MITIGATION_SPEC: ReplyRecordSpec = {
  kind: DELIVERY_PLAN_REPLY_KIND,
  replyMarker: 'DELIVERY_PLAN_MITIGATIONS:',
  columns: [
    { field: 'bottleneckId', header: 'Bottleneck id' },
    { field: 'statement', header: 'Bottleneck', isNamingOnly: true },
    { field: 'mitigation', header: 'Mitigation' },
  ],
};

/** A cell's text with anything that would break its table row written as a space. */
function toTableCell(cellText: string): string {
  return cellText.replace(TABLE_CELL_BREAKING_PATTERN, ' ');
}

/** How to fill the two tables. The Story table GROWS (a row per Story), so the shared "add no rows" wording does not fit. */
function describeDeliveryTableRules(hasStoryTable: boolean, hasMitigationTable: boolean): string[] {
  const storyRule = `- ${DELIVERY_STORY_SPEC.replyMarker} each Feature is listed once. Copy its row once per Story you propose, `
    + 'keeping its Feature key and Feature exactly as written. Repos: the repo names it touches, separated by commas. '
    + `Acceptance hints: 2–4 hints separated by "${AC_HINT_SEPARATOR}". Never add a Feature that is not listed.`;
  const mitigationRule = `- ${DELIVERY_MITIGATION_SPEC.replyMarker} one row per bottleneck, already listed — fill in its Mitigation.`;
  return [
    `Answer ONLY by copying the table(s) below, each starting with its marker line, and replacing every ${FILL_IN_BLANK}.`,
    ...(hasStoryTable ? [storyRule] : []),
    ...(hasMitigationTable ? [mitigationRule] : []),
    'Do not add or rename columns, and do not answer in JSON, bullet points or paragraphs. Keep each cell on one line and '
      + 'never put a "|" inside a cell. Write nothing before or after the tables, and ask no questions: give your best judgement.',
  ];
}

/**
 * The rules and fill-in tables a prompt (or its follow-up) ends with: a Story row for each of these Features and a
 * mitigation row for each of these bottlenecks. A table with no rows is left out.
 */
export function buildDeliveryPlanReplyTables(
  features: readonly Pick<PiPlanningFactSheet['features'][number], 'key' | 'summary'>[],
  bottlenecks: readonly Bottleneck[],
): string[] {
  const storyTable = features.length === 0 ? [] : ['', DELIVERY_STORY_SPEC.replyMarker,
    ...buildRecordFillInTable(DELIVERY_STORY_SPEC, features.map((feature) => [feature.key, toTableCell(feature.summary)]))];
  const mitigationTable = bottlenecks.length === 0 ? [] : ['', DELIVERY_MITIGATION_SPEC.replyMarker,
    ...buildRecordFillInTable(DELIVERY_MITIGATION_SPEC, bottlenecks.map((bottleneck) => [bottleneck.id, toTableCell(bottleneck.statement)]))];
  return [...describeDeliveryTableRules(storyTable.length > 0, mitigationTable.length > 0), ...storyTable, ...mitigationTable];
}

/** Renders each Feature as a brief block — key, size, repos, and (when present) a description snippet — so the
 *  AI decomposes and writes acceptance-criteria hints from real content rather than the title alone. */
function renderFeatureBriefs(factSheet: PiPlanningFactSheet): string {
  return factSheet.features.map((feature) => {
    const repos = feature.repoComponentNames.join(', ') || '(none — map repos first)';
    const lines = [
      `### ${feature.key} — ${feature.summary}`,
      `- Size: ${feature.sizePoints ?? '?'} pts`,
      `- Repo components: ${repos}`,
    ];
    if (feature.description && feature.description.trim() !== '') {
      lines.push(`- Detail: ${feature.description}`);
    }
    return lines.join('\n');
  }).join('\n\n');
}

/** Renders the roster + roles so the AI knows who exists (it never assigns — the engine does). */
function renderRosterTable(factSheet: PiPlanningFactSheet): string {
  const rows = factSheet.people.map((person) => `| ${person.displayName} | ${person.roles.join(', ')} |`);
  return ['| Person | Roles |', '|---|---|', ...rows].join('\n');
}

/** Renders the engine-flagged bottlenecks the AI must write mitigations for (by id). */
function renderBottleneckList(bottlenecks: Bottleneck[]): string {
  if (bottlenecks.length === 0) {
    return '(none flagged)';
  }
  return bottlenecks.map((bottleneck) => `- ${bottleneck.id}: ${bottleneck.statement}`).join('\n');
}

/** Builds the prompt for a single chunk of Features. */
function buildChunkPrompt(factSheet: PiPlanningFactSheet, bottlenecks: Bottleneck[], chunkIndex: number, chunkCount: number, maxStorySize: number): string {
  const chunkNote = chunkCount > 1 ? ` (chunk ${chunkIndex + 1} of ${chunkCount})` : '';
  return [
    `You are helping plan Program Increment ${factSheet.piName}${chunkNote}. Work ONLY from the facts below.`,
    '',
    'Fill in two tables: a Story decomposition and bottleneck mitigations. For each Feature,',
    'group the repositories it touches into one or more Stories (a Story may bridge several repos under one owner);',
    'give each Story a clear, specific summary and 2–4 concrete acceptance-criteria hints DERIVED FROM the Detail',
    'text below — not generic restatements of the title. Use ONLY the repo names and Feature keys shown.',
    '',
    `SIZE RULE: every Story must be independently deliverable within ONE sprint — no larger than ${maxStorySize} points.`,
    `A Feature is split evenly across the Stories you return, so return about ceil(size / ${maxStorySize}) Stories per`,
    'Feature, each a DISTINCT slice of scope with its own clear deliverable. Do NOT return one catch-all Story for a',
    'large Feature — that Story will be flagged as too big to finish in a sprint.',
    '',
    'Do NOT return dates, sprints, assignments, or point estimates — those are computed for you and any you return',
    'will be ignored.',
    '',
    '## Features (decompose each into Stories over its repo components)',
    renderFeatureBriefs(factSheet),
    '',
    '## Roster (for context only — you do NOT assign people)',
    renderRosterTable(factSheet),
    '',
    `## Delivery deadline: all delivery must complete by ${factSheet.deliveryDeadlineIso} (Sprint-5 Week-1).`,
    '',
    '## Bottlenecks flagged by the planner — write a mitigation for each id',
    renderBottleneckList(bottlenecks),
    '',
    ...buildDeliveryPlanReplyTables(factSheet.features, bottlenecks),
  ].join('\n');
}

/** The result of building the prompt(s): one string per chunk (usually one). */
export interface DeliveryPromptResult {
  prompts: string[];
  featureCount: number;
  chunkCount: number;
}

/**
 * Builds the delivery-plan prompt from the fact sheet + engine-flagged bottlenecks. Chunks automatically when
 * the Feature set is large so each reply stays pasteable (FR-021). The AI is constrained to decomposition +
 * mitigations only; everything checkable is embedded as fact.
 */
export function buildDeliveryPlanPrompt(
  factSheet: PiPlanningFactSheet,
  bottlenecks: Bottleneck[] = [],
  maxStorySize: number = DEFAULT_MAX_STORY_SIZE,
): DeliveryPromptResult {
  // Only NEW Features are decomposed by the AI; carryover Features already have Stories in flight and are
  // reconciled deterministically (never sent to the AI, so it can't propose duplicates).
  const newFeatures = factSheet.features.filter((feature) => !feature.isCarryover);
  const chunkCount = Math.max(1, Math.ceil(newFeatures.length / FEATURES_PER_CHUNK));
  const prompts: string[] = [];
  for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
    const chunkFeatures = newFeatures.slice(chunkIndex * FEATURES_PER_CHUNK, (chunkIndex + 1) * FEATURES_PER_CHUNK);
    prompts.push(buildChunkPrompt({ ...factSheet, features: chunkFeatures }, bottlenecks, chunkIndex, chunkCount, maxStorySize));
  }
  return { prompts, featureCount: newFeatures.length, chunkCount };
}
