// intakeMatchRound.ts — Checks one duplicate verdict from a pasted answer: does an open DENP Epic Toolbox found
// already cover this item, and if so, which one (spec 037, contracts/ai-rounds.md §2).
//
// The answer may only name a key Toolbox actually found for THAT item. Anything else is refused, so an Epic that
// does not exist, or belongs to another item, can never be recorded as a match (FR-018). The exchange that asks the
// question is `intakeResolveRound.ts`; this module owns only the rule, so every caller applies it identically.

import type { DuplicateVerdict, IntakeItem } from '../epicIntakeModel.ts';
import { readVocabularyValue, type RawReplyItem } from './intakeReplyEnvelope.ts';

/** How sure the answer is. Anything but "high" is treated as unsure, so the PO is shown the row to check. */
export const MATCH_CONFIDENCES = ['high', 'low'] as const;

/** The two verdicts an answer may give; "not actionable" is only ever the PO's or a rule's call. */
const MATCH_VERDICTS = ['existing', 'createNew'] as const;

/**
 * Reads the verdict an answer gave for one item. Returns the verdict — an "existing" key always in the spelling
 * Toolbox found — or a plain sentence saying why it cannot be used (unknown verdict, or a key that was not among
 * this item's own candidates).
 */
export function validateMatchVerdict(rawItem: RawReplyItem, item: IntakeItem): DuplicateVerdict | string {
  const verdict = readVocabularyValue(rawItem.verdict, MATCH_VERDICTS);
  if (verdict === null) {
    return `"${String(rawItem.verdict)}" is not a verdict — use "existing" or "createNew".`;
  }
  if (verdict === 'createNew') {
    return { verdict: 'createNew' };
  }
  const rawKey = typeof rawItem.key === 'string' ? rawItem.key.trim().toUpperCase() : '';
  const candidate = item.candidates.find((found) => found.key.toUpperCase() === rawKey);
  return candidate === undefined
    ? `${rawKey || 'The key'} was not among the Epics found for ${item.id}.`
    : { verdict: 'existing', key: candidate.key };
}

/** A short plain-language description of a verdict, used as the start of the decision's recorded reason. */
export function describeMatchVerdict(verdict: DuplicateVerdict): string {
  if (verdict.verdict === 'existing') {
    return `Matches ${verdict.key}`;
  }
  return verdict.verdict === 'createNew' ? 'No open Epic covers it' : 'Not actionable';
}
