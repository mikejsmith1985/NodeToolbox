// productOwnerFeatureReview.ts — Union Feature discovery for the PO Tool's Feature Review tab.
//
// The Team Dashboard rollup discovers Features bottom-up from the blueprint, which only finds a Feature
// once it already has child stories. At the start of a new Program Increment nothing has been broken
// down yet, so that list is empty exactly when a Product Owner needs it most. This module adds the
// PI Review tab's proven top-down query — every `issuetype = Feature` in the PI assigned to the team's
// roster Product Owner(s) — and unions it with the blueprint result, so nothing visible today can
// disappear and newly created Features show up before their first story exists.
//
// The two sources are deliberately additive: a Feature can have team stories but a different assignee
// (blueprint-only), or an assignee but no stories yet (PO-only). Both are the PO's work.

import type { ArtTeam } from '../ArtView/hooks/useArtData.ts';
import { buildDirectFeatureJql, readPiReviewPullSettings } from '../ArtView/piReviewPullFeatures.ts';
import type { HygieneFieldConfig } from '../Hygiene/checks/hygieneChecks.ts';
import {
  fetchFeatureReviewItems,
  fetchFeatureReviewItemsByJql,
  type FeatureReviewItem,
} from './featureReview.ts';

// ── Honest, user-facing explanations for a partial result ──
// Each says what is missing AND what the user is still looking at, so the tab never implies the list
// is complete when only one of the two discovery paths actually ran.
const NO_PRODUCT_OWNER_WARNING =
  'No Product Owner is flagged in the team roster, so only Features that already have team stories are listed. '
  + 'Flag a Product Owner in the roster to see Features planned for a new PI.';
const NO_PI_SELECTED_WARNING =
  'No PI is selected, so Features assigned to the Product Owner could not be listed.';

/** Feature Review items plus an honest account of whether both discovery paths actually ran. */
export interface ProductOwnerFeatureDiscoveryResult {
  /** The union of blueprint-discovered and PO-assigned Features, de-duplicated and sorted by key. */
  items: FeatureReviewItem[];
  /** How many Features came only from the PO-assignee query — i.e. have no child stories yet. */
  productOwnerOnlyCount: number;
  /** Non-fatal explanation when the PO-assignee query was skipped or failed; null when it ran cleanly. */
  productOwnerQueryWarning: string | null;
}

/** The outcome of the top-down PO query on its own, before it is merged with the blueprint result. */
interface ProductOwnerQueryOutcome {
  items: FeatureReviewItem[];
  warning: string | null;
}

/** Case-insensitive key, so a Feature returned by both sources is recognised as one Feature. */
function readFeatureLookupKey(reviewItem: FeatureReviewItem): string {
  return reviewItem.feature.key.trim().toUpperCase();
}

/**
 * Unions two Feature Review lists into one, keyed by Feature key and sorted for a stable render order.
 * When both sources describe the same Feature the primary (blueprint) item wins, because its child
 * roll-up is scoped to the team rather than to whatever the key-based lookup returned.
 */
export function mergeFeatureReviewItemsByKey(
  primaryItems: readonly FeatureReviewItem[],
  additionalItems: readonly FeatureReviewItem[],
): FeatureReviewItem[] {
  const itemsByFeatureKey = new Map<string, FeatureReviewItem>();
  for (const additionalItem of additionalItems) {
    itemsByFeatureKey.set(readFeatureLookupKey(additionalItem), additionalItem);
  }
  // Written second so a blueprint item overwrites the PO-query item for the same Feature.
  for (const primaryItem of primaryItems) {
    itemsByFeatureKey.set(readFeatureLookupKey(primaryItem), primaryItem);
  }
  return [...itemsByFeatureKey.values()].sort(
    (leftItem, rightItem) => leftItem.feature.key.localeCompare(rightItem.feature.key),
  );
}

/**
 * Runs the PI Review Feature query for the team's Product Owner(s). A failure here is never fatal:
 * the blueprint result is still worth showing, so the error is returned as a warning instead of thrown.
 */
async function runProductOwnerFeatureQuery(
  selectedPiName: string,
  productOwnerAssigneeQueryValues: readonly string[],
  featureReviewFieldConfig: HygieneFieldConfig | undefined,
  customStoryPointsFieldId: string,
): Promise<ProductOwnerQueryOutcome> {
  if (productOwnerAssigneeQueryValues.length === 0) {
    return { items: [], warning: NO_PRODUCT_OWNER_WARNING };
  }
  const { piFieldId } = readPiReviewPullSettings();
  const productOwnerFeatureJql = buildDirectFeatureJql(selectedPiName, productOwnerAssigneeQueryValues, piFieldId);
  if (productOwnerFeatureJql === null) {
    return { items: [], warning: NO_PI_SELECTED_WARNING };
  }

  try {
    const productOwnerItems = await fetchFeatureReviewItemsByJql(
      productOwnerFeatureJql,
      featureReviewFieldConfig,
      customStoryPointsFieldId,
    );
    return { items: productOwnerItems, warning: null };
  } catch (queryError) {
    const queryErrorMessage = queryError instanceof Error ? queryError.message : String(queryError);
    return {
      items: [],
      warning: `Could not list Features assigned to the Product Owner: ${queryErrorMessage}. `
        + 'Showing only Features that already have team stories.',
    };
  }
}

/** Counts the Features that only the PO-assignee query found — the ones with no child stories yet. */
function countProductOwnerOnlyFeatures(
  blueprintItems: readonly FeatureReviewItem[],
  productOwnerItems: readonly FeatureReviewItem[],
): number {
  const blueprintFeatureKeys = new Set(blueprintItems.map(readFeatureLookupKey));
  const productOwnerOnlyKeys = new Set(
    productOwnerItems.map(readFeatureLookupKey).filter((featureKey) => !blueprintFeatureKeys.has(featureKey)),
  );
  return productOwnerOnlyKeys.size;
}

/**
 * Loads the Feature Review rollup for a Product Owner: the blueprint bottom-up result unioned with
 * every Feature in the PI assigned to the team's roster Product Owner(s). A blueprint failure rejects
 * (it is the baseline the tab has always shown); a PO-query failure only downgrades to a warning.
 */
export async function fetchFeatureReviewItemsWithProductOwnerFeatures(
  team: ArtTeam,
  selectedPiName: string,
  productOwnerAssigneeQueryValues: readonly string[],
  featureReviewFieldConfig?: HygieneFieldConfig,
  customStoryPointsFieldId = '',
): Promise<ProductOwnerFeatureDiscoveryResult> {
  const blueprintItems = await fetchFeatureReviewItems(
    team,
    selectedPiName,
    featureReviewFieldConfig,
    customStoryPointsFieldId,
  );
  const productOwnerQueryOutcome = await runProductOwnerFeatureQuery(
    selectedPiName,
    productOwnerAssigneeQueryValues,
    featureReviewFieldConfig,
    customStoryPointsFieldId,
  );

  return {
    items: mergeFeatureReviewItemsByKey(blueprintItems, productOwnerQueryOutcome.items),
    productOwnerOnlyCount: countProductOwnerOnlyFeatures(blueprintItems, productOwnerQueryOutcome.items),
    productOwnerQueryWarning: productOwnerQueryOutcome.warning,
  };
}
