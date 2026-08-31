// jiraIssueTypes.ts — Names the feature-level issue types the CONNECTED Jira instance actually has,
// so a query never names one it does not.
//
// Jira validates every value in an `issuetype in (...)` list. One unknown name does not narrow the
// result — it makes the whole query a 400, and the surface above it goes silently empty. That is
// exactly what happened to the Feature-link search: this instance defines no "Epic" issue type, so
// `issuetype in (Feature, Epic)` was rejected outright and the dropdown never found anything
// (GH #376). Asking the instance what it has costs one cached request and survives the move to a
// different Jira, which hard-coded names do not.

import { jiraGet } from './jiraApi.ts';

/** One Jira issue type as returned by `/rest/api/2/issuetype`. */
export interface JiraIssueTypeSummary {
  id: string;
  name: string;
  subtask: boolean;
}

/**
 * The issue types that can sit at the top of a Feature link, in preference order.
 *
 * Both are candidates, neither is assumed: whichever the instance defines is what gets queried.
 */
const FEATURE_LIKE_ISSUE_TYPE_CANDIDATES = ['Feature', 'Epic'];

/**
 * The single name proven to exist on this instance, used when the instance cannot be asked.
 *
 * The PI Review pull and the Readiness scan both ship `issuetype = Feature` and return results, so
 * this is evidence rather than a guess. A wider fallback would risk reproducing the 400 it fixes.
 */
const PROVEN_FEATURE_ISSUE_TYPE_NAME = 'Feature';

/** Cached across the session: the instance's issue types do not change while somebody is searching. */
let cachedFeatureTypeNamesPromise: Promise<string[]> | null = null;

/**
 * Keeps the candidates the instance defines, in candidate order, spelled the way the INSTANCE spells
 * them — a query has to use the instance's own casing, not ours. Pure.
 */
export function pickAvailableIssueTypeNames(candidateNames: string[], availableNames: string[]): string[] {
  const availableByLowerName = new Map(availableNames.map((name) => [name.toLowerCase(), name]));
  return candidateNames
    .map((candidate) => availableByLowerName.get(candidate.toLowerCase()))
    .filter((name): name is string => name !== undefined);
}

/**
 * Builds the JQL issue-type restriction for a set of names, or an empty string when there is nothing
 * to restrict to.
 *
 * An empty clause is deliberate: a broader search that returns issues is more use than a precise one
 * Jira refuses. Names are quoted so a hyphenated type such as "Sub-task" survives the parser. Pure.
 */
export function buildIssueTypeClause(issueTypeNames: string[]): string {
  if (issueTypeNames.length === 0) {
    return '';
  }
  const quotedNames = issueTypeNames.map((name) => `"${name}"`);
  if (quotedNames.length === 1) {
    return `issuetype = ${quotedNames[0]}`;
  }
  return `issuetype in (${quotedNames.join(', ')})`;
}

/**
 * Returns the feature-level issue-type names this instance defines, asking Jira once per session.
 *
 * A failed lookup is not cached — a search that ran while the VPN was down should not poison every
 * later search for the rest of the session.
 */
export async function loadFeatureIssueTypeNames(): Promise<string[]> {
  if (cachedFeatureTypeNamesPromise === null) {
    cachedFeatureTypeNamesPromise = fetchFeatureIssueTypeNames().catch((caughtError: unknown) => {
      cachedFeatureTypeNamesPromise = null;
      throw caughtError;
    });
  }
  try {
    return await cachedFeatureTypeNamesPromise;
  } catch {
    return [PROVEN_FEATURE_ISSUE_TYPE_NAME];
  }
}

/** Forgets the cached lookup. Used by tests and available if the connected instance ever changes. */
export function clearFeatureIssueTypeCache(): void {
  cachedFeatureTypeNamesPromise = null;
}

/** Reads the instance's issue types and narrows them to the feature-level candidates. */
async function fetchFeatureIssueTypeNames(): Promise<string[]> {
  const issueTypes = await jiraGet<JiraIssueTypeSummary[]>('/rest/api/2/issuetype');
  const availableNames = (Array.isArray(issueTypes) ? issueTypes : [])
    .map((issueType) => issueType?.name)
    .filter((name): name is string => typeof name === 'string' && name !== '');
  return pickAvailableIssueTypeNames(FEATURE_LIKE_ISSUE_TYPE_CANDIDATES, availableNames);
}
