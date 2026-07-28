// deliveryPlanIngest.ts — Parses the AI delivery-plan reply into accepted Stories + bottleneck mitigations
// (spec 032, US1, contract ai-delivery-plan.md). This is the hallucination firewall: any Story naming a
// Feature key or a repo NOT in the fact sheet is rejected with a reason and nothing is written for it; any
// mitigation whose bottleneckId is not engine-flagged is rejected; any AI-supplied date/assignee/sprint is
// ignored. Propose-only — nothing writes until per-item accept downstream.

import { extractJsonPayload, repairJsonPayload } from '../../../../utils/extractJsonPayload.ts';
import type { Bottleneck, PiPlanningFactSheet } from '../piPlanTypes.ts';
import { DELIVERY_PLAN_REPLY_KIND } from './deliveryPlanPrompt.ts';

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

/** Reads the reply text (tolerant of prose/fences, auto-repairing malformed JSON) into a plain object. */
function readReply(replyText: string): { parsed: unknown; error: string | null } {
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
