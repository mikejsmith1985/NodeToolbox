// columnOptionSources.ts — The status and sub-status values the mapping editor is allowed to offer.
//
// A column may only be mapped to a state Jira will actually accept. Offering free text would push
// the failure to the worst possible moment — the instant someone drags a card — so the editor picks
// from values observed on real issues instead.
//
// This instance removed the legacy global createmeta, so there is no single call that lists every
// option. The values are therefore assembled from the issues actually in scope: their own statuses,
// the destinations of their available transitions, and the allowed values Jira reports for the
// sub-status field on those issues.

import {
  fetchFeatureReviewEditMeta,
  fetchFeatureReviewTransitions,
  type FeatureReviewEditMetaAllowedValue,
  type FeatureReviewEditMetaField,
} from '../featureReviewFixes.ts';
import type { RollupBoardItem } from './rollupBoardTypes.ts';

/** How many issues to sample when asking Jira what a field will accept. */
const OPTION_SAMPLE_ISSUE_LIMIT = 5;

export interface ColumnOptionSources {
  statusNames: string[];
  subStatusValues: string[];
  /**
   * True when no in-scope issue exposed the sub-status field.
   *
   * The editor says so and offers status-only mapping rather than falling back to a text box — a
   * value Jira rejects would only be discovered when a card refused to move.
   */
  isSubStatusUnavailable: boolean;
}

/** Sorted, de-duplicated, blank-free. */
function toSortedDistinct(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

/** The statuses the in-scope issues are currently sitting in. */
function collectStatusNamesFromItems(items: readonly RollupBoardItem[]): string[] {
  return items.map((item) => item.statusName);
}

/** Picks a spread of issues to sample, so the options are not all drawn from one workflow. */
function selectSampleIssueKeys(items: readonly RollupBoardItem[]): string[] {
  const keysByStatusName = new Map<string, string>();
  for (const item of items) {
    if (!keysByStatusName.has(item.statusName)) {
      keysByStatusName.set(item.statusName, item.key);
    }
  }
  return [...keysByStatusName.values()].slice(0, OPTION_SAMPLE_ISSUE_LIMIT);
}

/**
 * Assembles every status and sub-status value the editor may offer.
 *
 * Sampling failures are tolerated: a status list drawn from the issues alone is still usable, and
 * refusing to open the editor because one metadata call failed would be a poor trade.
 */
export async function loadColumnOptionSources(
  items: readonly RollupBoardItem[],
  subStatusFieldId: string,
): Promise<ColumnOptionSources> {
  const sampleIssueKeys = selectSampleIssueKeys(items);
  const observedStatusNames = collectStatusNamesFromItems(items);

  const transitionResults = await Promise.all(
    sampleIssueKeys.map((issueKey) => fetchFeatureReviewTransitions(issueKey).catch(() => [])),
  );
  const transitionStatusNames = transitionResults
    .flat()
    .map((transition) => transition.to?.name ?? '');

  if (subStatusFieldId === '') {
    return {
      statusNames: toSortedDistinct([...observedStatusNames, ...transitionStatusNames]),
      subStatusValues: [],
      isSubStatusUnavailable: true,
    };
  }

  const editMetaResults = await Promise.all(
    sampleIssueKeys.map((issueKey) =>
      fetchFeatureReviewEditMeta(issueKey).catch(() => ({} as Record<string, FeatureReviewEditMetaField | undefined>))),
  );
  const subStatusValues = editMetaResults.flatMap((editMeta) =>
    (editMeta[subStatusFieldId]?.allowedValues ?? []).map(
      (allowedValue: FeatureReviewEditMetaAllowedValue) => allowedValue.value ?? allowedValue.name ?? '',
    ),
  );

  // Values already sitting on issues count too — an option Jira has assigned is one Jira accepts.
  const observedSubStatusValues = items
    .map((item) => item.subStatusValue)
    .filter((subStatusValue): subStatusValue is string => subStatusValue !== null);

  const allSubStatusValues = toSortedDistinct([...subStatusValues, ...observedSubStatusValues]);
  return {
    statusNames: toSortedDistinct([...observedStatusNames, ...transitionStatusNames]),
    subStatusValues: allSubStatusValues,
    isSubStatusUnavailable: allSubStatusValues.length === 0,
  };
}
