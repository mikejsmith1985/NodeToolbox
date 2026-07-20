// normalizeIssueKey.ts — Turns whatever the user typed or pasted into a canonical Jira issue key.
//
// The lookup box should be "dead simple": a bare key in any case, a key with stray whitespace, or
// a full "…/browse/KEY" URL pasted from Jira should all resolve to the same issue. When the input
// is not a plausible Jira key we return null so the search UI can show a hint instead of firing a
// doomed request.

/** A Jira issue key: a project code (letter then letters/digits) plus a numeric id, e.g. ENCUC-1234. */
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]+-\d+$/;

/** Captures the key segment of a Jira browse URL, stopping at the next path/query/hash boundary. */
const BROWSE_URL_KEY_PATTERN = /\/browse\/([^/?#]+)/i;

/** Result of normalizing raw lookup input: a canonical key, or null when the input is not a key. */
export interface NormalizedIssueKey {
  key: string | null;
}

/**
 * Normalizes raw lookup input into a canonical Jira issue key.
 * Unwraps a pasted "/browse/KEY" URL, trims and upper-cases, then validates the key shape.
 */
export function normalizeIssueKey(rawInput: string): NormalizedIssueKey {
  const browseUrlMatch = BROWSE_URL_KEY_PATTERN.exec(rawInput);
  const candidate = browseUrlMatch ? browseUrlMatch[1] : rawInput;
  const cleanedKey = candidate.trim().toUpperCase();
  return { key: ISSUE_KEY_PATTERN.test(cleanedKey) ? cleanedKey : null };
}
