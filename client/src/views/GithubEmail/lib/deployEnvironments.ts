// deployEnvironments.ts — Which environment a merge landed in, read from the branch it landed on.
//
// The GitHub Deployments API cannot be reached from this network: the org runs an IP allow list and
// every call returns 403 with "your IP address is not permitted" (GH #375). No credential fixes it.
//
// It turns out nothing needed fixing. The merge notifications already arriving in the intake folder
// say "Merged #967 into prd." — the target branch names the environment, and the classifier was
// discarding it (`readBranch` reads the SOURCE branch, the "from" half, which is the feature branch).
// So the deployment signal was in the building the whole time.
//
// The ladder here is ORDERED, and that order does double duty: it maps a branch to an environment,
// and it is the forward-only guard. An issue that has reached INT must never be dragged back to SL
// because a late `dev` merge email arrived, and comparing two rungs answers that in one place
// instead of a rule remembering it.

/** One rung: an environment and the branch names that mean "deployed to it". */
export interface DeployEnvironment {
  /** Stable id used in rules and configuration. Never shown to a user. */
  environmentId: string;
  /** What a person calls it. */
  label: string;
  /** Every branch name that lands work in this environment, lower-case. */
  branchNames: string[];
}

/**
 * The default ladder: dev → int → rel → prd.
 *
 * `dev`, `int` and `prd` are OBSERVED — they appear verbatim in the team's own merge emails. `rel`
 * is stated to sit between INT and PROD but its branch name has not been seen yet, so the common
 * spellings are listed and the whole ladder is configurable. A branch this list does not know is
 * reported as "no environment" rather than guessed at: a wrong environment would close the wrong
 * deploy sub-task, which is worse than closing none.
 */
export const DEFAULT_DEPLOY_LADDER: readonly DeployEnvironment[] = [
  { environmentId: 'dev', label: 'Dev', branchNames: ['dev', 'develop', 'development'] },
  { environmentId: 'int', label: 'INT', branchNames: ['int', 'integration'] },
  { environmentId: 'rel', label: 'REL', branchNames: ['rel', 'release', 'stg', 'stage', 'staging'] },
  { environmentId: 'prd', label: 'PROD', branchNames: ['prd', 'prod', 'production'] },
];

/**
 * Returns the ladder to use: the team's own if they have configured one, else the default.
 *
 * A configured rung naming no branch is DROPPED. Kept, it would either match nothing (harmless but
 * confusing) or, on a looser implementation, match everything — and an environment that claims every
 * merge would mark work deployed to production that never left dev.
 */
export function resolveDeployLadder(
  configuredLadder: readonly DeployEnvironment[] | undefined | null,
): readonly DeployEnvironment[] {
  if (!configuredLadder || configuredLadder.length === 0) {
    return DEFAULT_DEPLOY_LADDER;
  }
  const usableRungs = configuredLadder.filter((rung) => (rung.branchNames ?? []).length > 0);
  return usableRungs.length === 0 ? DEFAULT_DEPLOY_LADDER : usableRungs;
}

/**
 * Names the environment a merge target belongs to, or null when the branch is not an environment.
 *
 * Most merges land on a feature branch and mean nothing about deployment; null is the honest answer
 * for those, and callers must treat it as "no deploy information", never as "not yet deployed".
 */
export function readDeployEnvironment(
  targetBranchName: string | null | undefined,
  ladder: readonly DeployEnvironment[] = DEFAULT_DEPLOY_LADDER,
): DeployEnvironment | null {
  const normalizedBranch = String(targetBranchName ?? '').trim().toLowerCase();
  if (normalizedBranch === '') {
    return null;
  }
  return ladder.find((rung) => rung.branchNames.includes(normalizedBranch)) ?? null;
}

/**
 * Compares two environments' positions on the ladder: negative when `fromEnvironmentId` comes first.
 *
 * Returns **null** when either side is not on the ladder. Ranking an unknown environment at zero
 * would make every real environment look like a forward move from it, which is exactly the mistake
 * that lets a stray email drag a story backwards — the case the guard exists to prevent.
 */
export function compareDeployRank(
  fromEnvironmentId: string,
  toEnvironmentId: string,
  ladder: readonly DeployEnvironment[] = DEFAULT_DEPLOY_LADDER,
): number | null {
  const fromRank = ladder.findIndex((rung) => rung.environmentId === fromEnvironmentId);
  const toRank = ladder.findIndex((rung) => rung.environmentId === toEnvironmentId);
  if (fromRank === -1 || toRank === -1) {
    return null;
  }
  return fromRank - toRank;
}

/** A literal backslash, built rather than written so no escaping survives a copy into this file. */
const BACKSLASH = String.fromCharCode(92);

/** Escapes every non-word character in a branch name, so none of them can act as a regex operator. */
function escapeForPattern(branchName: string): string {
  return branchName.replace(/[^\w]/g, (metaCharacter) => BACKSLASH + metaCharacter);
}

/** The fixed opening of a merge notification: the "Merged #967 into " of "Merged #967 into prd." */
const MERGED_INTO_PATTERN = /\bmerged\s+(?:#\d+\s+)?into\s+/;

/**
 * Asserts the branch name ENDS here: the next character cannot continue a branch name.
 *
 * A plain word boundary is not enough. "development-spike" is a feature branch, but a hyphen IS a
 * word boundary, so a boundary alone read it as a deployment to "development". A period is left out
 * of the continuing set deliberately, because GitHub ends the sentence with one: "into prd."
 */
const BRANCH_END_PATTERN = /(?![\w/-])/;

/**
 * One classification rule per environment, so each deployment is separately configurable.
 *
 * A single `pr-merged` rule can only carry one Jira action, which is why "merged" had to mean the
 * same thing whether the code reached dev or production. Giving each rung its own rule id lets the
 * operator attach a different parent transition to each in the Rules panel — the existing mechanism,
 * no new plumbing — and the rules are GENERATED from the ladder, so the branch names driving
 * classification and the branch names driving the environment map cannot drift apart.
 *
 * These belong ABOVE the generic `pr-merged` rule: first match wins, and the generic rule would
 * otherwise swallow every environment merge before its specific rule was reached.
 *
 * The patterns are composed from regex LITERALS rather than written as strings. "merged" (not
 * "merge") keeps a pull request merely OPENED against prd from reading as a production deployment.
 *
 * Returned as the loose shape the rule table accepts, so this module stays free of that import and
 * the dependency runs one way.
 */
export function buildEnvironmentMergeRules(
  ladder: readonly DeployEnvironment[] = DEFAULT_DEPLOY_LADDER,
): Array<{ id: string; eventType: string; bodyMarker: RegExp; requiresPrNumber: boolean }> {
  return ladder.map((rung) => ({
    id: `pr-merged-${rung.environmentId}`,
    eventType: 'pr_merged',
    bodyMarker: new RegExp(
      MERGED_INTO_PATTERN.source
      + '(?:' + rung.branchNames.map(escapeForPattern).join('|') + ')'
      + BRANCH_END_PATTERN.source,
      'i',
    ),
    requiresPrNumber: true,
  }));
}
