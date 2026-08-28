// projectScope.ts — Narrowing a person-scoped report down to a single Jira project.
//
// The flow reports query by roster member, never by project, so they follow the PEOPLE wherever their
// work lives — across ENCUC, ENFCT, INTTEST and any other project the team touches. That is right for
// "where did this team's time go", but wrong for "how does the ENCUC project flow": issues from other
// projects then land in the same roll-ups and distort them, and testing tickets in a testing project
// can quietly skew the internal-testing figures.
//
// The dropdown is populated from the projects that ACTUALLY appear in a run's results, so it can only
// offer projects the roster really worked in — and the filter is applied to the already-fetched data,
// needing no second Jira query.

/** The value that means "do not narrow to a project". */
export const ALL_PROJECTS = '';

/**
 * Extracts the Jira project key from an issue key: the part before the final dash.
 *
 * A Jira issue key is `<PROJECT>-<number>` and project keys never contain a dash, so the text before
 * the last dash is the project. Returns the whole key unchanged if it has no dash, rather than
 * inventing a project that is not there.
 */
export function extractProjectKey(issueKey: string): string {
  const lastDashIndex = issueKey.lastIndexOf('-');
  return lastDashIndex === -1 ? issueKey : issueKey.slice(0, lastDashIndex);
}

/** One project present in a run, and how much of the run it accounts for. */
export interface ProjectFlowCount {
  projectKey: string;
  issueCount: number;
}

/**
 * The projects present in a run, largest first, with how many issues each holds.
 *
 * Counted rather than merely listed, because a bare list of keys says nothing about which of them the
 * report is really about: a roster that delivered two hundred issues in its own project and three in a
 * testing project reads as two equal choices, and the operator has to guess.
 */
export function collectProjectCounts(issueKeys: readonly string[]): ProjectFlowCount[] {
  const countByProject = new Map<string, number>();
  issueKeys.forEach((issueKey) => {
    const projectKey = extractProjectKey(issueKey);
    if (projectKey !== '') {
      countByProject.set(projectKey, (countByProject.get(projectKey) ?? 0) + 1);
    }
  });

  return [...countByProject.entries()]
    .map(([projectKey, issueCount]) => ({ projectKey, issueCount }))
    .sort((first, second) => second.issueCount - first.issueCount
      || first.projectKey.localeCompare(second.projectKey));
}

/**
 * The project a run should open on: the one holding the most of it.
 *
 * A mixed view is a legitimate thing to want and a poor thing to default to. The flow figures are
 * distorted by mixing projects — a testing project's tickets skew a delivery project's coverage — so
 * the report opens on the project it is mostly about and leaves mixing as a deliberate choice.
 *
 * Returns ALL_PROJECTS when a run produced nothing, which is the only honest answer to "which project".
 */
export function readDefaultProjectKey(issueKeys: readonly string[]): string {
  return collectProjectCounts(issueKeys)[0]?.projectKey ?? ALL_PROJECTS;
}

/** The distinct project keys present in a set of issue keys, alphabetically, for the dropdown. */
export function collectProjectKeys(issueKeys: readonly string[]): string[] {
  const projectKeys = new Set(issueKeys.map(extractProjectKey).filter((key) => key !== ''));
  return [...projectKeys].sort((first, second) => first.localeCompare(second));
}

/**
 * Filters items to a single project by their issue key.
 *
 * `ALL_PROJECTS` returns the list untouched, so the default un-narrowed view costs nothing and the
 * caller needs no special case.
 */
export function filterByProject<TItem extends { issueKey: string }>(
  items: readonly TItem[],
  projectKey: string,
): TItem[] {
  if (projectKey === ALL_PROJECTS) {
    return [...items];
  }
  return items.filter((item) => extractProjectKey(item.issueKey) === projectKey);
}
