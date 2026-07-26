// piPlanAiAssist.ts — The propose-only AI envelope for PI planning (spec 028, contract ai-assist-json.md).
// The AI proposes ONLY the Feature→Story breakdown; the engine owns all scheduling, assignment, and
// dates (dates in the reply are ignored, FR-054). Mirrors the shipped piReviewAiAssist.ts shape:
// build a prompt from the full input set, then parse a strict {kind:'piPlan'} reply leniently per field.

import { extractJsonPayload } from '../../../utils/extractJsonPayload.ts';
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
  lines.push('Reply with ONLY this JSON (no prose):');
  lines.push('{"kind":"piPlan","items":[{"featureKey":"KEY","stories":[{"summary":"...","sizePoints":8,"hasTestableOutput":true}],"rationale":"why"}]}');
  return lines.join('\n');
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
  const parsed = JSON.parse(extractJsonPayload(replyText)) as Record<string, unknown>;
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
