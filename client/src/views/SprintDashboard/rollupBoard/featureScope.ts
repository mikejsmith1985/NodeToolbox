// featureScope.ts — Narrows the board to the Features a team actually tracks.
//
// A team board can carry work linked to Features across many portfolio projects, and lanes for
// Features nobody on the team owns are pure noise. This filters them out — but not bluntly, because
// HOW an issue reached its Feature says how much to trust the connection:
//
//   • The Feature Link FIELD is a deliberate, structural statement. If it points outside the team's
//     projects that is not supposed to happen, and hiding it would hide the evidence. Always shown.
//   • A plain "relates to" issue link is an inference the board made. Outside the team's projects
//     that is noise, hidden until the viewer asks for it.
//
// Whatever is hidden is counted, so the board can say what it left out rather than quietly looking
// smaller than the team's Jira board.

import type { RollUpRoute, RollupBoardItem } from './rollupBoardTypes.ts';

/** Which Features a team tracks, and whether to include loosely-linked ones from elsewhere. */
export interface FeatureScopeSettings {
  /** Jira project keys whose Features this team owns. Empty means "no filtering at all". */
  featureProjectKeys: readonly string[];
  /** When true, out-of-project Features reached only by an issue link are shown too. */
  shouldIncludeIssueLinkedFeatures: boolean;
}

/** What survived the scope, and what did not. */
export interface FeatureScopeResult {
  items: RollupBoardItem[];
  hiddenIssueCount: number;
  /** The Features whose work was hidden, so the board can name them if asked. */
  hiddenFeatureKeys: string[];
  /** Features shown despite sitting outside the team's projects — worth flagging, not hiding. */
  outOfScopeFeatureKeys: string[];
}

/** The project key part of a Jira issue key, upper-cased for comparison. */
function readProjectKey(issueKey: string): string {
  const [projectKey = ''] = issueKey.split('-', 1);
  return projectKey.trim().toUpperCase();
}

/**
 * True when the roll-up rests on the Feature Link field rather than on an inference.
 *
 * The test is the LAST hop into the Feature. A defect attached to a Story by "relates to" still
 * counts as authoritative, because the Story itself carries a real Feature Link — the defect is
 * simply hanging off properly-linked work. Only a defect wired straight to a Feature by an issue
 * link has nothing structural behind it.
 */
export function isAuthoritativeFeatureRoute(route: RollUpRoute): boolean {
  if (route.featureKey === null || route.steps.length === 0) {
    return false;
  }
  const finalStep = route.steps[route.steps.length - 1];
  return finalStep.kind === 'featureLink' || finalStep.kind === 'parent';
}

/**
 * Filters board items to the Features this team tracks.
 *
 * Work with no Feature at all is never touched — that is a hygiene problem the "No Feature" lane
 * exists to surface, and it has nothing to do with other people's projects.
 */
export function applyFeatureScope(
  items: readonly RollupBoardItem[],
  settings: FeatureScopeSettings,
): FeatureScopeResult {
  const trackedProjectKeys = new Set(
    settings.featureProjectKeys.map((projectKey) => projectKey.trim().toUpperCase()).filter(Boolean),
  );

  // Nothing configured means the board behaves exactly as it did before scoping existed.
  if (trackedProjectKeys.size === 0) {
    return { items: [...items], hiddenIssueCount: 0, hiddenFeatureKeys: [], outOfScopeFeatureKeys: [] };
  }

  const keptItems: RollupBoardItem[] = [];
  const hiddenFeatureKeys = new Set<string>();
  const outOfScopeFeatureKeys = new Set<string>();

  for (const item of items) {
    if (item.featureKey === null) {
      keptItems.push(item);
      continue;
    }
    if (trackedProjectKeys.has(readProjectKey(item.featureKey))) {
      keptItems.push(item);
      continue;
    }

    // Outside the team's projects. Whether it stays depends on how firmly it got here.
    if (isAuthoritativeFeatureRoute(item.route) || settings.shouldIncludeIssueLinkedFeatures) {
      outOfScopeFeatureKeys.add(item.featureKey);
      keptItems.push(item);
      continue;
    }
    hiddenFeatureKeys.add(item.featureKey);
  }

  return {
    items: keptItems,
    hiddenIssueCount: items.length - keptItems.length,
    hiddenFeatureKeys: [...hiddenFeatureKeys],
    outOfScopeFeatureKeys: [...outOfScopeFeatureKeys],
  };
}
