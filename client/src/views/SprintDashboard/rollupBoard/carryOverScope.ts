// carryOverScope.ts — Pulls last PI's unfinished Features, and their work, into this PI's board.
//
// A Feature that did not finish keeps its original PI in Jira — that is how the ART records what was
// committed where, and rewriting it would falsify last PI's history. But the team is working it NOW,
// so a board scoped to `<PI field> = "PI 26.4"` cannot see it, and neither can it see the child stories
// that also still carry the old PI. The work is real, in flight, and invisible.
//
// "Unfinished Features from the previous PI" IS the definition of carry-over, which is why this derives
// it rather than reading a flag: a derivation cannot drift out of step with Jira, and nobody has to
// remember to maintain it as the set changes. The trade-off is stated where the setting lives — a
// Feature genuinely abandoned rather than carried will also appear, and is excluded by key.

// ── Named constants ──

/** Features are their own issue type; this is the type name every project here uses. */
const FEATURE_ISSUE_TYPE_NAME = 'Feature';

/** Escapes a value for safe inclusion inside a double-quoted JQL string. */
function quoteJqlValue(rawValue: string): string {
  return `"${rawValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Builds the query for the previous PI's Features that never finished.
 *
 * Deliberately the same shape as the current-PI Feature query, differing only in which PI it names, so
 * the two cannot disagree about what counts as a Feature or as finished.
 *
 * @returns The JQL, or null when there is nothing safe to ask — no carry-over PI chosen, no Feature
 *          project configured, or no PI field on this instance. A null must skip the request entirely.
 */
export function buildCarryOverFeatureJql(
  featureProjectKeys: readonly string[],
  carryOverPiValue: string,
  piFieldReference: string,
): string | null {
  const trimmedPiValue = carryOverPiValue.trim();
  if (trimmedPiValue === '' || featureProjectKeys.length === 0 || !piFieldReference) {
    return null;
  }

  const projectList = featureProjectKeys.map((projectKey) => quoteJqlValue(projectKey)).join(', ');
  return [
    `issuetype = ${FEATURE_ISSUE_TYPE_NAME}`,
    `project in (${projectList})`,
    `${piFieldReference} = ${quoteJqlValue(trimmedPiValue)}`,
    // A Feature that finished last PI is not carried over; it is done.
    'statusCategory != Done',
  ].join(' AND ') + ' ORDER BY key ASC';
}

/**
 * Builds the query for the work sitting under those Features.
 *
 * No PI clause on purpose. The children of a carried-over Feature may still carry the OLD PI, may have
 * been moved to the new one, or may never have had one — and all three are the same work. Filtering by
 * PI here would reintroduce exactly the blindness this exists to remove.
 *
 * @returns The JQL, or null when there are no Features to ask about.
 */
export function buildCarryOverWorkJql(
  carryOverFeatureKeys: readonly string[],
  featureLinkFieldReference: string,
): string | null {
  if (carryOverFeatureKeys.length === 0 || !featureLinkFieldReference) {
    return null;
  }

  return `${featureLinkFieldReference} in (${carryOverFeatureKeys.join(', ')}) ORDER BY key ASC`;
}

// ── Describing what was pulled in ──

/** What the carry-over sweep found, so the board can say so rather than quietly growing. */
export interface CarryOverScope {
  /** Features from the earlier PI that are still in flight. */
  featureKeys: string[];
  /** Their child work, whatever PI those children carry. */
  issueKeys: string[];
  /** The PI these came from, for the badge on each lane. */
  fromPiValue: string;
}

export const EMPTY_CARRY_OVER_SCOPE: CarryOverScope = { featureKeys: [], issueKeys: [], fromPiValue: '' };

/**
 * Merges carried-over work into the PI's own scope, without double-counting.
 *
 * A child already tagged to the current PI is in both sets; it must appear once. Order is preserved so
 * the board's own scope leads and the carried-over work follows, which is also the order a reader
 * would expect to find them in.
 */
export function mergeScopedIssueKeys(
  currentPiIssueKeys: readonly string[],
  carryOverIssueKeys: readonly string[],
): string[] {
  return [...new Set([...currentPiIssueKeys, ...carryOverIssueKeys])];
}

/** One sentence naming what was added, so the board never silently shows more than its PI. */
export function describeCarryOverScope(carryOverScope: CarryOverScope): string {
  if (carryOverScope.featureKeys.length === 0) return '';

  const featureWord = carryOverScope.featureKeys.length === 1 ? 'Feature' : 'Features';
  return `${carryOverScope.featureKeys.length} unfinished ${featureWord} carried over from`
    + ` ${carryOverScope.fromPiValue}, with ${carryOverScope.issueKeys.length} of their issues:`
    + ` ${carryOverScope.featureKeys.join(', ')}.`;
}
