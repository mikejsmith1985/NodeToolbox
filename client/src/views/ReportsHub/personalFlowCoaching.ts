// personalFlowCoaching.ts — The hidden, passphrase-gated AI coaching round-trip for the Personal Flow report.
//
// Personal Flow reports one person's throughput and hands-on cycle time as hard numbers. This module turns
// those numbers into a copy-paste prompt asking an external assistant for a short, constructive coaching
// read — strengths, concerns, and concrete suggestions — then INGESTS a strict JSON reply. It is advisory
// only: nothing here writes to Jira, and no AI service is called from here. The report is fully usable
// without ever unlocking this feature.

import { extractJsonPayload } from '../../utils/extractJsonPayload.ts';

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * The already-computed Personal Flow headline figures the coaching prompt reasons from. These are read
 * straight off the report result so the assistant never re-derives anything — it only interprets. Cycle
 * times are nullable because a window with no measurable in-progress time has no cycle time.
 */
export interface PersonalFlowCoachingInput {
  personName: string;
  windowDays: number;
  issuesAdvanced: number;
  totalStoryPoints: number;
  issuesPerWeek: number;
  pointsPerWeek: number;
  averageCycleTimeDays: number | null;
  medianCycleTimeDays: number | null;
  /** The status that absorbed the most hands-on time — a big queue-like bucket flags wasted cycle time. */
  topStatusByHandsOnDays: string | null;
}

/** The structured coaching read the assistant returns: a headline plus three short, actionable lists. */
export interface PersonalFlowCoaching {
  summary: string;
  strengths: string[];
  concerns: string[];
  recommendations: string[];
}

// ── Prompt construction ────────────────────────────────────────────────────────

// The task instruction embedded at the top of every generated prompt. It frames a supportive coaching
// tone and pins the reply to a single strict JSON shape so ingestion can validate it.
const COACHING_INSTRUCTION =
  'You are an engineering delivery coach. Read the flow metrics below for one team member and write a '
  + 'short, constructive coaching summary. Be specific and supportive: call out what the numbers show is '
  + 'going well, where the flow looks strained (e.g. cycle time inflated by time sitting in a queue-like '
  + 'status), and give a few concrete, actionable suggestions. Base everything ONLY on the numbers shown; '
  + 'do NOT invent data. Respond ONLY with valid JSON: {"kind":"personalFlowCoaching","summary":"...",'
  + '"strengths":["..."],"concerns":["..."],"recommendations":["..."]}';

/** Formats a nullable cycle-time figure, showing an em-dash when it could not be measured. */
function formatNullableDays(value: number | null): string {
  return value === null ? '—' : String(value);
}

/**
 * Builds the full copy-paste coaching prompt: the instruction and JSON contract, then a compact block of
 * the person's headline flow figures. Read this into a textarea the operator copies into an assistant.
 */
export function buildPersonalFlowCoachingPrompt(input: PersonalFlowCoachingInput): string {
  const lines = [
    `Person: ${input.personName}`,
    `Reporting window: ${input.windowDays} days`,
    `Issues advanced: ${input.issuesAdvanced}`,
    `Story points completed: ${input.totalStoryPoints}`,
    `Throughput: ${input.issuesPerWeek} issues/week, ${input.pointsPerWeek} points/week`,
    `Average hands-on cycle time: ${formatNullableDays(input.averageCycleTimeDays)} days`,
    `Median hands-on cycle time: ${formatNullableDays(input.medianCycleTimeDays)} days`,
  ];
  if (input.topStatusByHandsOnDays !== null && input.topStatusByHandsOnDays.trim() !== '') {
    lines.push(`Status holding the most hands-on time: ${input.topStatusByHandsOnDays}`);
  }
  return `${COACHING_INSTRUCTION}\n\nMetrics:\n${lines.join('\n')}`;
}

// ── Reply ingestion ──────────────────────────────────────────────────────────

/** Coerces a raw value into a clean string array, dropping anything that is not a non-empty string. */
function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim());
}

/**
 * Parses and strictly validates an assistant reply into a coaching read. Tolerates prose and markdown
 * fences around the JSON, and defaults the three lists to empty when they are absent, but throws a
 * descriptive error (changing nothing) when the JSON is unreadable, the kind does not match, or the
 * required summary is missing.
 */
export function parsePersonalFlowCoachingResponse(responseText: string): PersonalFlowCoaching {
  const parsed = JSON.parse(extractJsonPayload(responseText)) as Record<string, unknown>;
  if (parsed.kind !== 'personalFlowCoaching') {
    throw new Error(`Response kind "${String(parsed.kind)}" does not match the requested "personalFlowCoaching".`);
  }
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  if (summary === '') {
    throw new Error('Missing or empty "summary" in the personalFlowCoaching response.');
  }
  return {
    summary,
    strengths: readStringList(parsed.strengths),
    concerns: readStringList(parsed.concerns),
    recommendations: readStringList(parsed.recommendations),
  };
}
