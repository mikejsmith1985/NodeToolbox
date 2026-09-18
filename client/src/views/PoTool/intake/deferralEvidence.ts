// deferralEvidence.ts — Reads the notes' own words that say an item is not current work ("future conversation",
// "no funding"), looking only at an item's title line so a PO call buried in a sub-line never gets promoted to a
// rule (spec 037, contracts/deterministic-rules.md §3).

import type { DeferralEvidence, SourceLine } from './epicIntakeModel.ts';

// ── Phrases ──

const FUTURE_CONVERSATION_PATTERN = /future conversation/i;
const NO_FUNDING_PATTERN = /no funding/i;
/** "rejected" only counts as evidence when it sits inside parentheses, e.g. "(rejected Idea card)". */
const REJECTED_IN_PARENTHESES_PATTERN = /\([^)]*\brejected\b[^)]*\)/i;
const WOULD_BE_FUNDED_PATTERN = /would be funded/i;

/** An item titled exactly "Risks" (after trimming) is itself the deferral evidence, not a phrase within it. */
const RISKS_TITLE_PATTERN = /^risks$/i;

/**
 * The phrases that settle an item as deferred or a risk, in the order they are checked. The first phrase that
 * matches the title line wins, so "no funding" is found before "would be funded" when both appear together.
 */
export const DEFERRAL_PHRASES: readonly { pattern: RegExp; kind: 'deferred' | 'risk' }[] = [
  { pattern: FUTURE_CONVERSATION_PATTERN, kind: 'deferred' },
  { pattern: NO_FUNDING_PATTERN, kind: 'deferred' },
  { pattern: REJECTED_IN_PARENTHESES_PATTERN, kind: 'deferred' },
  { pattern: WOULD_BE_FUNDED_PATTERN, kind: 'deferred' },
];

// ── Lookup ──

/**
 * Looks for deferral or risk evidence on an item's own title line only — the spec's deliberate rule, because a
 * phrase like "rejected" on a sub-line is context, not a settled verdict. Returns the matched phrase as it
 * appears in the text so the PO can see exactly what triggered it, or null when the title carries none.
 */
export function findDeferralEvidence(itemLines: readonly SourceLine[]): DeferralEvidence | null {
  const titleLine = itemLines[0];
  if (!titleLine) {
    return null;
  }
  const trimmedTitle = titleLine.text.trim();
  if (RISKS_TITLE_PATTERN.test(trimmedTitle)) {
    return { phrase: trimmedTitle, kind: 'risk' };
  }
  for (const phraseRule of DEFERRAL_PHRASES) {
    const matchedText = titleLine.text.match(phraseRule.pattern);
    if (matchedText) {
      return { phrase: matchedText[0], kind: phraseRule.kind };
    }
  }
  return null;
}
