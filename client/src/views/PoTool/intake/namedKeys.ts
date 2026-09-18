// namedKeys.ts — Reads Jira keys the notes name explicitly (e.g. "Core Integration (denp-632)"), so an item that
// already has a key on it can skip straight to a lookup instead of a text search (spec 037,
// contracts/deterministic-rules.md §2).

import type { NamedKey, SourceLine } from './epicIntakeModel.ts';

// ── Patterns ──

/**
 * Matches a Jira-shaped key inside free text: a project prefix (a letter then more letters/digits) followed by a
 * dash and an issue number. It is deliberately loose — `namedKeys.ts` narrows the matches, not this pattern.
 */
export const JIRA_KEY_IN_TEXT_PATTERN = /\b([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,7})\b/g;

/**
 * Prefixes that match the key shape but are really a PI name, a quarter, or a fiscal year ("PI-26", "Q3-2026",
 * "FY-27", "H1-2027"). These have a 1–2 letter prefix with no real project behind them, so they are rejected here
 * rather than sent to Jira as a lookup that can never succeed.
 */
const NON_PROJECT_PREFIX_PATTERN = /^(?:PI|Q|FY|H)$|^(?:PI|Q|FY|H)\d/i;

// ── Extraction ──

/**
 * True when a matched prefix is a PI/quarter/fiscal-year name rather than a real Jira project. A false positive
 * here only costs one PO question later (the key comes back "not found"), never a wrong Jira write.
 */
function isNonProjectPrefix(candidatePrefix: string): boolean {
  return NON_PROJECT_PREFIX_PATTERN.test(candidatePrefix);
}

/**
 * Finds every Jira key named in one line of text, skipping tokens that only look like a key. Order follows where
 * the key first appears in the text.
 */
function findKeysInLineText(lineText: string): Array<{ upperKey: string; upperProjectKey: string }> {
  const foundKeys: Array<{ upperKey: string; upperProjectKey: string }> = [];
  for (const match of lineText.matchAll(JIRA_KEY_IN_TEXT_PATTERN)) {
    const [, rawProjectKey, rawIssueNumber] = match;
    if (isNonProjectPrefix(rawProjectKey)) {
      continue;
    }
    const upperProjectKey = rawProjectKey.toUpperCase();
    foundKeys.push({ upperKey: `${upperProjectKey}-${rawIssueNumber}`, upperProjectKey });
  }
  return foundKeys;
}

/**
 * Reads every Jira key named in the given lines of the notes (scanning only the requested line numbers), ready
 * for the search step to look each one up. The same key named twice keeps only its first mention.
 */
export function extractNamedKeys(lines: readonly SourceLine[], lineNumbers: readonly number[]): NamedKey[] {
  const wantedLineNumbers = new Set(lineNumbers);
  const seenKeys = new Set<string>();
  const namedKeys: NamedKey[] = [];
  for (const line of lines) {
    if (!wantedLineNumbers.has(line.lineNumber)) {
      continue;
    }
    for (const { upperKey, upperProjectKey } of findKeysInLineText(line.text)) {
      if (seenKeys.has(upperKey)) {
        continue;
      }
      seenKeys.add(upperKey);
      namedKeys.push({ key: upperKey, projectKey: upperProjectKey, lineNumber: line.lineNumber, lookup: { status: 'notRun' } });
    }
  }
  return namedKeys;
}
