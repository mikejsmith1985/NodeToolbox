// pointingAiAssistReply.ts — The story-pointing AI round's reply form and reader (GH #499, Google AI Mode).
//
// The pointing prompt used to end with "Respond ONLY with a valid JSON array". Google's AI Mode ignores that and
// answers with a table, so the prompt now ends with a table listing every story to estimate, and this reader takes
// it back. Every old rule still holds: only stories in the queue, only points on the team's scale. A story the reply
// left out or pointed off the scale is never estimated by Toolbox — it is named in a follow-up for the same AI chat.

import {
  buildArrayFormatFixPrompt,
  buildMissingRowsFollowUpPrompt,
  listUnansweredKeys,
  readArrayOrTableReply,
} from './arrayReplyRecords.ts';
import { buildRecordReplyInstructions, type ReplyRecordSpec } from '../../../utils/aiReplyRecords.ts';

// ── Types ──

/** One story's estimate read from the reply. Points are already on the team's scale. */
export interface AiAssistPointingItem {
  key: string;
  points: number;
  reasoning: string;
}

/** The reply's usable estimates, an error when there are none, and a follow-up when stories are missing. */
export interface PointingAiReplyReading {
  items: AiAssistPointingItem[];
  errorMessage: string | null;
  /** For the same AI chat — the form again, or only the stories left out. '' when nothing needs asking. */
  followUpPrompt: string;
}

// ── Named constants ──

/** The fill-in table: one row per story to estimate, its key filled in. */
export const POINTING_REPLY_SPEC: ReplyRecordSpec = {
  kind: 'pointing',
  replyMarker: 'POINTING_TABLE:',
  columns: [
    { field: 'key', header: 'Issue key' },
    { field: 'points', header: 'Points', valueKind: 'number' },
    { field: 'reasoning', header: 'Reasoning', answerHint: 'one sentence' },
  ],
};

const NO_PAYLOAD_MESSAGE = 'No JSON array found. Make sure AI Assist returned the array format described in the prompt.';
const INVALID_JSON_MESSAGE = 'The JSON in the response could not be parsed — check for missing commas or quotes.';
const NOT_ARRAY_MESSAGE = 'Expected a JSON array but found a different type.';
const NO_VALID_ESTIMATES_MESSAGE = 'No valid estimates matched the current queue. Check that issue keys are correct and '
  + 'point values are on the scale (1 2 3 5 8 13 20 40 100).';
const UNREADABLE_REPLY_MESSAGE = 'The reply was not in the asked-for table, so it could not be read. Copy the '
  + 'follow-up below into the same AI chat, then paste its reply here.';

// ── Prompt ──

/**
 * The lines the pointing prompt ends with: the fill-in rules, what the Points column may hold, and the table
 * listing every story by key.
 */
export function buildPointingReplyFormLines(storyKeys: readonly string[], storyPointScale: readonly number[], breakdownThreshold: number): string {
  const spec: ReplyRecordSpec = {
    ...POINTING_REPLY_SPEC,
    columns: POINTING_REPLY_SPEC.columns.map((column) => {
      if (column.field === 'points') return { ...column, answerHint: `one of ${storyPointScale.join(', ')} — nothing else` };
      if (column.field === 'reasoning') return { ...column, answerHint: `one sentence; end it with "⚠ Consider breakdown." above ${breakdownThreshold} points` };
      return column;
    }),
  };
  return buildRecordReplyInstructions(spec, storyKeys.map((storyKey) => [storyKey]));
}

// ── Reading ──

/** One reply entry (a table row or a JSON object) as an estimate, or null when its key or points are unusable. */
function readPointingEntry(rawEntry: unknown, validQueueKeys: ReadonlySet<string>, validScaleValues: ReadonlySet<number>): AiAssistPointingItem | null {
  if (typeof rawEntry !== 'object' || rawEntry === null) return null;
  const entry = rawEntry as Record<string, unknown>;
  const issueKey = typeof entry.key === 'string' ? entry.key.trim().toUpperCase() : '';
  const pointValue = typeof entry.points === 'number' ? entry.points : null;
  // Off-queue keys and off-scale points are dropped, never rounded to the nearest valid value.
  if (!issueKey || !validQueueKeys.has(issueKey)) return null;
  if (pointValue === null || !validScaleValues.has(pointValue)) return null;
  return { key: issueKey, points: pointValue, reasoning: typeof entry.reasoning === 'string' ? entry.reasoning : '' };
}

/**
 * Reads a pasted pointing reply. The table is read first; the old JSON array still works. When `askedKeys` is
 * given, a table that left stories out (or pointed them off the scale) yields a follow-up for just those, and an
 * unreadable reply yields the whole form again.
 */
export function parsePointingAiReply(
  responseText: string,
  validQueueKeys: ReadonlySet<string>,
  storyPointScale: readonly number[],
  askedKeys: readonly string[] = [],
): PointingAiReplyReading {
  const reading = readArrayOrTableReply(responseText, POINTING_REPLY_SPEC);
  if (reading.source === 'none') {
    const followUpPrompt = buildArrayFormatFixPrompt(POINTING_REPLY_SPEC, askedKeys);
    const failureMessage = { noPayload: NO_PAYLOAD_MESSAGE, invalidJson: INVALID_JSON_MESSAGE, notArray: NOT_ARRAY_MESSAGE }[reading.failure];
    return { items: [], errorMessage: followUpPrompt === '' ? failureMessage : UNREADABLE_REPLY_MESSAGE, followUpPrompt };
  }
  const validScaleValues = new Set(storyPointScale);
  // A later row for the same story replaces an earlier one, so a pasted follow-up's answers win.
  const estimatesByKey = new Map<string, AiAssistPointingItem>();
  for (const rawEntry of reading.items) {
    const estimate = readPointingEntry(rawEntry, validQueueKeys, validScaleValues);
    if (estimate) estimatesByKey.set(estimate.key, estimate);
  }
  const items = [...estimatesByKey.values()];
  const missingKeys = reading.source === 'table' ? listUnansweredKeys(askedKeys, new Set(estimatesByKey.keys())) : [];
  return {
    items,
    errorMessage: items.length === 0 ? NO_VALID_ESTIMATES_MESSAGE : null,
    followUpPrompt: buildMissingRowsFollowUpPrompt(POINTING_REPLY_SPEC, missingKeys),
  };
}
