// personalFlowCoaching.ts — The hidden, passphrase-gated AI coaching round-trip for the Personal Flow report.
//
// Personal Flow reports one person's throughput and hands-on cycle time as hard numbers. This module turns
// those numbers into a copy-paste prompt asking an external assistant for a short, constructive coaching
// read — strengths, concerns, and concrete suggestions — then INGESTS a strict JSON reply. It is advisory
// only: nothing here writes to Jira, and no AI service is called from here. The report is fully usable
// without ever unlocking this feature.
//
// The reply is asked for as four labelled parts (SUMMARY, STRENGTHS, CONCERNS, RECOMMENDATIONS) because
// Google's AI Mode — the team's only assistant (GH #499) — writes a document with headings and ignores a JSON
// reply format. Each part is found by its label or its heading; an intro and a closing offer are dropped. A
// JSON reply is still read. A reply without a summary gets a follow-up for the same chat, never a guess.

import {
  buildSectionsFollowUpPrompt,
  listMissingSections,
  readReplySections,
  type ReplySection,
} from '../../utils/aiReplySections.ts';
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

// ── Reply parts ──────────────────────────────────────────────────────────────

type CoachingPartKey = 'summary' | 'strengths' | 'concerns' | 'recommendations';

/** The four parts of the reply, each found by its label or by the heading AI Mode writes for it. */
const COACHING_PARTS: readonly ReplySection<CoachingPartKey>[] = [
  { key: 'summary', marker: 'SUMMARY', headingPattern: /^(?:coaching )?summary$|^overview$/i },
  { key: 'strengths', marker: 'STRENGTHS', headingPattern: /^(?:key )?strengths$|^what(?:'s| is) going well$/i },
  { key: 'concerns', marker: 'CONCERNS', headingPattern: /^(?:areas of )?concerns?$|^(?:areas for|opportunities for) improvement$/i },
  { key: 'recommendations', marker: 'RECOMMENDATIONS', headingPattern: /^recommendations$|^(?:actionable )?suggestions$|^next steps$/i },
];
// A list entry's bullet or number: "- ", "• ", "1. ".
const LIST_BULLET_PATTERN = /^\s*(?:[•\-*–◦▪]|\d+[.)])\s+/;
// A list entry that says there is nothing to list.
const EMPTY_LIST_ENTRY_PATTERN = /^(?:none|n\/a|nothing (?:to note|notable))\.?$/i;
/** The error every round shows for a reply it cannot read — kept word for word. */
const UNREADABLE_REPLY_MESSAGE = 'No JSON object found in the assistant response.';

/** The reply form the prompt ends with: four labelled parts, lists one entry per line. */
const COACHING_REPLY_FORM = [
  'Answer in these four parts, each starting on its own line with its label exactly as written:',
  'SUMMARY: two or three sentences.',
  'STRENGTHS: one line per strength, each starting with "- ".',
  'CONCERNS: one line per concern, each starting with "- ".',
  'RECOMMENDATIONS: one line per concrete suggestion, each starting with "- ".',
  'Do not answer in JSON. Write nothing before SUMMARY or after the last recommendation, and ask me no questions.',
].join('\n');

// ── Prompt construction ────────────────────────────────────────────────────────

// The task instruction embedded at the top of every generated prompt. It frames a supportive coaching
// tone; the prompt then ends with the labelled reply form ingestion reads.
const COACHING_INSTRUCTION =
  'You are an engineering delivery coach. Read the flow metrics below for one team member and write a '
  + 'short, constructive coaching summary. Be specific and supportive: call out what the numbers show is '
  + 'going well, where the flow looks strained (e.g. cycle time inflated by time sitting in a queue-like '
  + 'status), and give a few concrete, actionable suggestions. Base everything ONLY on the numbers shown; '
  + 'do NOT invent data.';

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
  return `${COACHING_INSTRUCTION}\n\nMetrics:\n${lines.join('\n')}\n\n${COACHING_REPLY_FORM}`;
}

// ── Reply ingestion ──────────────────────────────────────────────────────────

/** Coerces a raw value into a clean string array, dropping anything that is not a non-empty string. */
function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').map((entry) => entry.trim());
}

/** A list part's entries, one per line, bullets removed and "None" dropped. */
function readListPart(partText: string | undefined): string[] {
  return (partText ?? '').split(/\r?\n/).map((partLine) => partLine.replace(LIST_BULLET_PATTERN, '').trim())
    .filter((partLine) => partLine !== '' && !EMPTY_LIST_ENTRY_PATTERN.test(partLine));
}

/** The coaching read from a labelled reply, or null when the reply has none of the four parts. */
function readCoachingDocument(responseText: string): PersonalFlowCoaching | null {
  const partTexts = readReplySections(responseText, COACHING_PARTS);
  if (Object.keys(partTexts).length === 0) return null;
  const summary = (partTexts.summary ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();
  if (summary === '') {
    throw new Error('Missing or empty "summary" in the personalFlowCoaching response.');
  }
  return {
    summary,
    strengths: readListPart(partTexts.strengths),
    concerns: readListPart(partTexts.concerns),
    recommendations: readListPart(partTexts.recommendations),
  };
}

/** The reply's JSON text, refused in the words every round shows when there is none. */
function extractCoachingJson(responseText: string): string {
  try {
    return extractJsonPayload(responseText);
  } catch {
    throw new Error(UNREADABLE_REPLY_MESSAGE);
  }
}

/**
 * The follow-up for the same AI chat after a reply could not be used: only the parts a labelled reply left
 * out, or the whole form when it followed none of it. Nothing missing is filled in by Toolbox.
 */
export function buildPersonalFlowCoachingFollowUpPrompt(responseText: string): string {
  const partTexts = readReplySections(responseText, COACHING_PARTS);
  const hasAnyPart = Object.keys(partTexts).length > 0;
  return buildSectionsFollowUpPrompt(hasAnyPart ? listMissingSections(partTexts, COACHING_PARTS) : COACHING_PARTS, !hasAnyPart);
}

/**
 * Parses and strictly validates an assistant reply into a coaching read: the labelled parts first, then a
 * JSON reply (prose and markdown fences around it tolerated). The three lists default to empty when absent,
 * but it throws a descriptive error (changing nothing) when the reply is unreadable, the kind does not
 * match, or the required summary is missing.
 */
export function parsePersonalFlowCoachingResponse(responseText: string): PersonalFlowCoaching {
  const documentCoaching = readCoachingDocument(responseText);
  if (documentCoaching !== null) return documentCoaching;
  const parsed = JSON.parse(extractCoachingJson(responseText)) as Record<string, unknown>;
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
