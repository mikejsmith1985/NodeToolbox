// piNameMatch.ts — Comparing the PI somebody typed with the PI Jira holds.
//
// A PI Review page records which Program Increment it belongs to, typed by a person. The value it is
// compared against comes out of Jira, and Jira's carries the window: "PI 26.4 (07/30/26 - 10/07/26)".
// As whole strings those two never match.
//
// The cost of that is not a missing match, which would at least be visible. The page vanishes from
// its own PI, and a LEGACY page -- one saved with no PI at all -- is adopted in its place, because
// adopting one is the documented fallback. A 26.4 board then quietly loads the 26.3 page, offers to
// save onto it, and reports the wrong PI's numbers as this PI's.

/** The window Jira appends to a PI name: a parenthesised run at the end of the string. */
const TRAILING_WINDOW_PATTERN = /\s*\([^)]*\)\s*$/;

/**
 * A leading "PI" label, with or without the space after it.
 *
 * People write the same Increment as "PI 26.4", "PI26.4" and plain "26.4". The number is the only
 * part every spelling shares, so the label is dropped and the number compared. It must be followed
 * by a DIGIT: "PIVOT 1" keeps its name, because a prefix rule that ate letters would invent
 * matches rather than find them.
 */
const LEADING_PI_LABEL_PATTERN = /^pi\s*(?=\d)/;

/**
 * Reduces a PI name to the part that actually names the PI.
 *
 * Only a TRAILING parenthesised run is dropped, and only one: a PI genuinely named with brackets in
 * the middle keeps them, and nothing here tries to interpret what was inside.
 */
export function readPiIdentifier(piName: string): string {
  return piName
    .replace(TRAILING_WINDOW_PATTERN, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(LEADING_PI_LABEL_PATTERN, '');
}

/**
 * Whether two PI names refer to the same Program Increment.
 *
 * Deliberately narrow: it forgives the window, case and spacing, and nothing else. "PI 26.4" and
 * "PI 26.40" stay different PIs, and an empty name matches nothing at all -- an empty name is the
 * mark of a page belonging to NO PI, and letting it match everything is the failure this exists to
 * stop rather than a convenience.
 */
export function doPiNamesMatch(leftPiName: string, rightPiName: string): boolean {
  const leftIdentifier = readPiIdentifier(leftPiName);
  const rightIdentifier = readPiIdentifier(rightPiName);
  if (leftIdentifier === '' || rightIdentifier === '') {
    return false;
  }
  return leftIdentifier === rightIdentifier;
}
