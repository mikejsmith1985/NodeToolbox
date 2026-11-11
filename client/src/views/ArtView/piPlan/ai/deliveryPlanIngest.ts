// deliveryPlanIngest.ts — Parses the AI delivery-plan reply into accepted Stories + bottleneck mitigations
// (spec 032, US1, contract ai-delivery-plan.md). This is the hallucination firewall: any Story naming a
// Feature key or a repo NOT in the fact sheet is rejected with a reason and nothing is written for it; any
// mitigation whose bottleneckId is not engine-flagged is rejected; any AI-supplied date/assignee/sprint is
// ignored. Propose-only — nothing writes until per-item accept downstream.
//
// The reply is read from the prompt's two fill-in tables first (what Google's AI Mode answers with, GH #499),
// then from JSON as before; either way it lands in the same object, so the firewall below is unchanged.

import { readRecordTableItems, type ReplyRecordSpec } from '../../../../utils/aiReplyRecords.ts';
import { extractJsonPayload, repairJsonPayload } from '../../../../utils/extractJsonPayload.ts';
import type { Bottleneck, PiPlanningFactSheet } from '../piPlanTypes.ts';
import {
  AC_HINT_SEPARATOR,
  DELIVERY_MITIGATION_SPEC,
  DELIVERY_PLAN_REPLY_KIND,
  DELIVERY_STORY_SPEC,
  buildDeliveryPlanReplyTables,
} from './deliveryPlanPrompt.ts';

/** One Story accepted from the reply after allowlist validation — carries only what the engine needs. */
export interface AcceptedPlanStory {
  featureKey: string;
  summary: string;
  repos: string[];
  acHints: string[];
}

/** The full outcome of ingesting a reply: accepted Stories, mitigations by bottleneck id, and rejections. */
export interface DeliveryPlanIngestResult {
  stories: AcceptedPlanStory[];
  mitigationsById: Record<string, string>;
  rejected: { item: string; reason: string }[];
  error: string | null;
}

/**
 * Splits a reply into the text under each table's header row, so one table's rows are never read as the
 * other's (the shared reader keeps reading every row after a header it has found). Prose before the first
 * header — an answer engine's intro — belongs to neither.
 */
function splitReplyByTable(replyText: string): Map<ReplyRecordSpec, string[]> {
  const linesBySpec = new Map<ReplyRecordSpec, string[]>([[DELIVERY_STORY_SPEC, []], [DELIVERY_MITIGATION_SPEC, []]]);
  let currentLines: string[] | null = null;
  for (const replyLine of replyText.split(/\r?\n/)) {
    // A line that is a table's own header row starts that table's text.
    const headedSpec = [...linesBySpec.keys()].find((spec) => readRecordTableItems(replyLine, spec) !== null);
    if (headedSpec) currentLines = linesBySpec.get(headedSpec) ?? null;
    currentLines?.push(replyLine);
  }
  return linesBySpec;
}

/** One Story table row as the JSON story the firewall reads. A row left wholly blank is an unanswered Feature. */
function readStoryRow(row: Record<string, unknown>): Record<string, unknown> | null {
  if (row.summary === undefined && row.repos === undefined) return null;
  const acHints = typeof row.acHints === 'string'
    ? row.acHints.split(AC_HINT_SEPARATOR).map((hint) => hint.trim()).filter((hint) => hint !== '')
    : [];
  return { featureKey: row.featureKey, summary: row.summary ?? '', repos: row.repos ?? [], acHints };
}

/** The reply's tables as the delivery-plan object, or null when it holds neither table. */
function readReplyTables(replyText: string): Record<string, unknown> | null {
  const linesBySpec = splitReplyByTable(replyText);
  const storyRows = readRecordTableItems((linesBySpec.get(DELIVERY_STORY_SPEC) ?? []).join('\n'), DELIVERY_STORY_SPEC) ?? [];
  const mitigationRows = readRecordTableItems((linesBySpec.get(DELIVERY_MITIGATION_SPEC) ?? []).join('\n'), DELIVERY_MITIGATION_SPEC) ?? [];
  if (storyRows.length === 0 && mitigationRows.length === 0) return null;
  const stories = storyRows.map(readStoryRow).filter((story): story is Record<string, unknown> => story !== null);
  return { kind: DELIVERY_PLAN_REPLY_KIND, stories, mitigations: mitigationRows };
}

/** Reads the reply text — its tables, else JSON (tolerant of prose/fences, auto-repairing) — into a plain object. */
function readReply(replyText: string): { parsed: unknown; error: string | null } {
  const tableReply = readReplyTables(replyText);
  if (tableReply !== null) return { parsed: tableReply, error: null };
  try {
    return { parsed: JSON.parse(repairJsonPayload(extractJsonPayload(replyText))), error: null };
  } catch (parseError) {
    return { parsed: null, error: parseError instanceof Error ? parseError.message : 'Could not read JSON from the reply.' };
  }
}

/**
 * Validates a delivery-plan reply against the fact sheet. Every Feature key and repo must exist in the fact
 * sheet (repos in `repoAllowlist`); unknown ones are rejected. Mitigations must reference a flagged bottleneck
 * id. AI-supplied dates/assignees/sprints are never read. Returns a propose-only result — no writes here.
 */
export function parseDeliveryPlanReply(
  replyText: string,
  factSheet: PiPlanningFactSheet,
  bottlenecks: Bottleneck[] = [],
): DeliveryPlanIngestResult {
  const { parsed, error } = readReply(replyText);
  const rejected: { item: string; reason: string }[] = [];
  if (parsed === null || typeof parsed !== 'object') {
    return { stories: [], mitigationsById: {}, rejected, error: error ?? 'The reply was not a JSON object.' };
  }
  const container = parsed as Record<string, unknown>;
  if ('kind' in container && container.kind !== DELIVERY_PLAN_REPLY_KIND) {
    return { stories: [], mitigationsById: {}, rejected, error: `This reply is for "${String(container.kind)}", not a delivery plan.` };
  }

  const featureKeys = new Set(factSheet.features.map((feature) => feature.key));
  // Carryover Features are reconciled, not decomposed — an AI Story targeting one is rejected (it must not
  // create a duplicate of work already in flight).
  const carryoverKeys = new Set(factSheet.features.filter((feature) => feature.isCarryover).map((feature) => feature.key));
  const repoAllowlist = new Set(factSheet.repoAllowlist.map((repo) => repo.toLowerCase()));
  const bottleneckIds = new Set(bottlenecks.map((bottleneck) => bottleneck.id));

  // ── Stories ──
  const stories: AcceptedPlanStory[] = [];
  const rawStories = Array.isArray(container.stories) ? container.stories : [];
  rawStories.forEach((rawStory, index) => {
    const story = (rawStory && typeof rawStory === 'object') ? rawStory as Record<string, unknown> : {};
    const featureKey = typeof story.featureKey === 'string' ? story.featureKey : '';
    const summary = typeof story.summary === 'string' ? story.summary.trim() : '';
    const repos = Array.isArray(story.repos) ? story.repos.filter((repo): repo is string => typeof repo === 'string') : [];
    if (!featureKeys.has(featureKey)) {
      rejected.push({ item: `story[${index}] "${summary || featureKey}"`, reason: `unknown Feature key "${featureKey}"` });
      return;
    }
    if (carryoverKeys.has(featureKey)) {
      rejected.push({ item: `story "${summary}"`, reason: `Feature ${featureKey} is carryover — reconciled, not decomposed` });
      return;
    }
    const unknownRepo = repos.find((repo) => !repoAllowlist.has(repo.toLowerCase()));
    if (unknownRepo !== undefined) {
      rejected.push({ item: `story "${summary}"`, reason: `repo "${unknownRepo}" is not in the fact sheet's repo allowlist` });
      return;
    }
    if (summary === '') {
      rejected.push({ item: `story[${index}] for ${featureKey}`, reason: 'missing summary' });
      return;
    }
    const acHints = Array.isArray(story.acHints) ? story.acHints.filter((hint): hint is string => typeof hint === 'string') : [];
    // Any AI-supplied dates/assignee/sprint/points are intentionally NOT read here (engine owns them).
    stories.push({ featureKey, summary, repos, acHints });
  });

  // ── Mitigations ──
  const mitigationsById: Record<string, string> = {};
  const rawMitigations = Array.isArray(container.mitigations) ? container.mitigations : [];
  rawMitigations.forEach((rawMitigation, index) => {
    const mitigation = (rawMitigation && typeof rawMitigation === 'object') ? rawMitigation as Record<string, unknown> : {};
    const bottleneckId = typeof mitigation.bottleneckId === 'string' ? mitigation.bottleneckId : '';
    const text = typeof mitigation.mitigation === 'string' ? mitigation.mitigation.trim() : '';
    if (!bottleneckIds.has(bottleneckId)) {
      rejected.push({ item: `mitigation[${index}]`, reason: `unknown bottleneck id "${bottleneckId}"` });
      return;
    }
    if (text !== '') {
      mitigationsById[bottleneckId] = text;
    }
  });

  return { stories, mitigationsById, rejected, error: null };
}

/**
 * The follow-up to paste into the same AI chat, or '' when the reply needs none. An unreadable reply gets both
 * tables again; a reply that left new Features without an accepted Story, or flagged bottlenecks without a
 * mitigation, gets tables of just those. Nothing missing is ever guessed — the assistant is asked.
 */
export function buildDeliveryPlanFollowUpPrompt(
  factSheet: PiPlanningFactSheet,
  bottlenecks: Bottleneck[],
  ingestResult: DeliveryPlanIngestResult,
): string {
  // Carryover Features are reconciled, never decomposed, so they are never asked for.
  const newFeatures = factSheet.features.filter((feature) => !feature.isCarryover);
  if (ingestResult.error !== null) {
    return [
      'Your last reply was not in the form I need, so it could not be read. Keep what you already proposed, but put it in these tables.',
      ...buildDeliveryPlanReplyTables(newFeatures, bottlenecks),
    ].join('\n');
  }
  const answeredFeatureKeys = new Set(ingestResult.stories.map((story) => story.featureKey));
  const missingFeatures = newFeatures.filter((feature) => !answeredFeatureKeys.has(feature.key));
  const missingBottlenecks = bottlenecks.filter((bottleneck) => ingestResult.mitigationsById[bottleneck.id] === undefined);
  if (missingFeatures.length === 0 && missingBottlenecks.length === 0) return '';
  const missingNames = [...missingFeatures.map((feature) => feature.key), ...missingBottlenecks.map((bottleneck) => bottleneck.id)];
  return [
    `Your last reply gave no usable answer for ${missingNames.join(', ')}. Answer only those now, in these tables.`,
    ...buildDeliveryPlanReplyTables(missingFeatures, missingBottlenecks),
  ].join('\n');
}
