// jqlTextTerms.ts — Turning free text into terms Jira's `~` (text contains) operator will accept and match.
//
// Moved here from HygieneFixControl.tsx so the Epic Intake duplicate search can share the exact same
// reserved-character rule. Two copies of this rule drifting apart is how one surface silently returns nothing.

/** Options for `buildIssueTextMatchTerms`. */
export interface IssueTextMatchTermOptions {
  /**
   * True (the default) when the text is somebody still typing, so the last word gets a trailing wildcard.
   * False when the text is a finished phrase, such as a stored search term, which should match whole words only.
   */
  shouldWildcardLastTerm?: boolean;
}

/** The shortest last term that is worth a wildcard. One character plus a wildcard matches most of the instance. */
const MIN_WILDCARD_TERM_LENGTH = 2;

/**
 * Characters Jira's text index treats as OPERATORS rather than as text.
 *
 * Left in, they are not merely ignored — they make the query invalid, and Jira answers a summary
 * like "ENCUC-1972: Critical Vulnerabilities" with a 400 rather than with that issue. Since a
 * Feature summary routinely carries a key and a colon, typing what you can see was the surest way
 * to get nothing back.
 */
export const JIRA_TEXT_RESERVED_PATTERN = /[+\-&|!(){}[\]^~*?\\:"]/g;

/**
 * Turns what somebody typed into terms Jira's `~` operator will actually match.
 *
 * Two things were wrong with passing the raw text through. Reserved characters made the query
 * invalid. And `~` matches WHOLE WORDS — `summary ~ "crit"` finds nothing at all against "Critical
 * Vulnerabilities" — so anybody typing while they think, which is everybody, saw an empty dropdown
 * and concluded the search was broken. It was, for that input.
 *
 * The trailing term gets a wildcard because that is the one still being typed. Earlier terms are
 * left whole: somebody who typed a space has finished that word, and wildcarding it would widen the
 * match for no reason. Callers searching with finished phrases pass `shouldWildcardLastTerm: false`.
 *
 * Returns null when nothing usable survives, so the caller can say "keep typing" rather than run a
 * query that cannot match.
 */
export function buildIssueTextMatchTerms(query: string, options: IssueTextMatchTermOptions = {}): string | null {
  const shouldWildcardLastTerm = options.shouldWildcardLastTerm ?? true;
  const terms = query
    .replace(JIRA_TEXT_RESERVED_PATTERN, ' ')
    .split(/\s+/)
    .filter((term) => term !== '');
  if (terms.length === 0) {
    return null;
  }
  if (!shouldWildcardLastTerm) {
    return terms.join(' ');
  }

  const lastTerm = terms[terms.length - 1];
  const wildcardedLastTerm = lastTerm.length >= MIN_WILDCARD_TERM_LENGTH ? `${lastTerm}*` : lastTerm;
  return [...terms.slice(0, -1), wildcardedLastTerm].join(' ');
}
