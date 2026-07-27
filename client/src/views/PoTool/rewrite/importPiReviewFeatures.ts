// importPiReviewFeatures.ts — Seeds the Bulk Re-write intake from PI Review (spec 030, GH #220).
//
// Instead of typing Feature keys by hand, a PO can pull every Feature for the tool's selected PI + team.
// This delegates to PI Review's OWN direct Feature pull (pullPiReviewFeatures) and reads the same roster
// rule (Product Owner assignees), so the two surfaces return the same Features by construction — there is
// no second, drifting query. It contacts Jira only through that reused pull; it never writes anything.

import { pullPiReviewFeatures } from '../../ArtView/piReviewPullFeatures.ts';
import { extractPiReviewFeatureKey } from '../../ArtView/piReviewJira.ts';
import type { StandupRosterMember } from '../../SprintDashboard/hooks/useStandupRosterStore.ts';

/** Why an import produced no keys — lets the caller show the honest reason instead of a blank result. */
export type ImportPiFeaturesBlockedReason = 'no-pi' | 'no-product-owner';

export interface ImportPiFeaturesResult {
  /** The discovered Feature keys, de-duplicated and ordered by the reused pull. */
  keys: string[];
  /** How many Features the pull found before extracting keys (for an honest "found N" message). */
  discoveredCount: number;
  /** Set when the import could not be scoped; null when the pull actually ran. */
  blockedReason: ImportPiFeaturesBlockedReason | null;
}

/**
 * The team's Product Owner assignee values — the exact rule PI Review uses to scope a Feature pull
 * (roster members flagged with the Product Owner capability). Kept pure so it is trivially testable.
 */
export function readProductOwnerAssigneeValues(rosterMembers: readonly StandupRosterMember[]): string[] {
  return rosterMembers
    .filter((rosterMember) => rosterMember.roleCapabilities?.canProductOwner === true)
    .map((rosterMember) => rosterMember.assigneeQueryValue.trim())
    .filter((assigneeQueryValue) => assigneeQueryValue !== '');
}

/**
 * Pulls every Feature key for the given PI and the team's Product Owner(s) by delegating to PI Review's
 * pull, then returns the keys ready to seed the intake. Resolves to a blocked result (no Jira call) when
 * there is no PI selected or the roster has no Product Owner to scope by.
 */
export async function importPiReviewFeatureKeys(
  piName: string,
  rosterMembers: readonly StandupRosterMember[],
): Promise<ImportPiFeaturesResult> {
  if (piName.trim() === '') {
    return { keys: [], discoveredCount: 0, blockedReason: 'no-pi' };
  }
  const productOwnerAssigneeValues = readProductOwnerAssigneeValues(rosterMembers);
  if (productOwnerAssigneeValues.length === 0) {
    return { keys: [], discoveredCount: 0, blockedReason: 'no-product-owner' };
  }

  // Delegate to the same pull PI Review runs (existingRows = [] — we want every Feature, not a top-up).
  const pullResult = await pullPiReviewFeatures(piName, productOwnerAssigneeValues, []);
  const keys = pullResult.rows
    .map((featureRow) => extractPiReviewFeatureKey(featureRow.feature))
    .filter((featureKey): featureKey is string => featureKey !== null);

  return { keys, discoveredCount: pullResult.discoveredCount, blockedReason: null };
}
