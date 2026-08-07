// masterCards.ts — Groups the board's work into one swimlane per Feature.
//
// Two behaviours here carry most of the board's honesty. First, work that cannot be traced to any
// Feature gets its own lane and a visible count, so the hygiene backlog is a number the team can act
// on rather than a vague sense that "some things aren't linked". Second, a Feature whose issue could
// not be read still gets a lane — folding it into "No Feature" would misreport a permissions or
// visibility problem as a data-quality one.

import { detectImpedimentReasons } from '../../ArtView/hooks/artHelpers.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import { computeFeatureProgress } from './featureProgress.ts';
import {
  NO_FEATURE_KEY,
  type MasterCard,
  type MasterCardVitals,
  type RollupBoardItem,
} from './rollupBoardTypes.ts';

const NO_FEATURE_LANE_SUMMARY = 'Work that does not roll up to any Feature — a hygiene problem to resolve';
const UNREADABLE_FEATURE_SUMMARY = 'This Feature could not be read (it may be in a project you cannot see)';

/**
 * Reads whether Jira's impediment flag is set on a Feature.
 *
 * The shared impediment detection reads `fields.status.name` unguarded, so an issue Jira returned
 * without a status would throw. One Feature missing one field must not take the whole board down —
 * a board that fails to render hides far more than a missing flag does.
 */
function readIsFeatureFlagged(featureIssue: JiraIssue | null): boolean {
  const hasStatusName = Boolean((featureIssue?.fields as { status?: { name?: string } } | undefined)?.status?.name);
  if (!featureIssue || !hasStatusName) return false;
  return detectImpedimentReasons(featureIssue).includes('Flagged');
}

/** Counts the blocking relationships on a Feature, which is what "dependencies" means on this board. */
function countBlockingDependencies(featureIssue: JiraIssue | null): number {
  if (!featureIssue) return 0;
  const issueLinks = (featureIssue.fields as { issuelinks?: unknown[] }).issuelinks ?? [];
  return issueLinks.filter((rawLink) => {
    const linkType = (rawLink as { type?: { inward?: string; outward?: string } }).type;
    const inwardName = linkType?.inward?.toLowerCase() ?? '';
    const outwardName = linkType?.outward?.toLowerCase() ?? '';
    return inwardName.includes('block') || outwardName.includes('block');
  }).length;
}

/** Reads the Feature's own story-point value, or null when it carries none. */
function readFeatureStoryPoints(featureIssue: JiraIssue | null, storyPointsFieldIds: readonly string[]): number | null {
  if (!featureIssue) return null;
  const issueFields = featureIssue.fields as unknown as Record<string, unknown>;
  for (const fieldId of storyPointsFieldIds) {
    const rawValue = issueFields[fieldId];
    if (typeof rawValue === 'number') return rawValue;
    if (rawValue && typeof rawValue === 'object') {
      const parsedValue = Number((rawValue as { value?: string }).value);
      if (!Number.isNaN(parsedValue)) return parsedValue;
    }
  }
  return null;
}

/** Builds the vital signs shown in a lane header, readable without expanding the lane. */
function buildVitals(
  featureKey: string,
  featureIssue: JiraIssue | null,
  items: readonly RollupBoardItem[],
  isSynthetic: boolean,
  storyPointsFieldIds: readonly string[],
): MasterCardVitals {
  const issueFields = (featureIssue?.fields ?? {}) as {
    summary?: string;
    status?: { name?: string };
    priority?: { name?: string };
  };

  const summary = isSynthetic
    ? NO_FEATURE_LANE_SUMMARY
    : issueFields.summary ?? UNREADABLE_FEATURE_SUMMARY;

  return {
    key: isSynthetic ? 'No Feature' : featureKey,
    summary,
    statusName: issueFields.status?.name ?? null,
    progress: computeFeatureProgress(items),
    dependencyCount: countBlockingDependencies(featureIssue),
    isFlagged: readIsFeatureFlagged(featureIssue),
    // null, not 0 — an absent estimate is a different statement from an estimate of nothing.
    storyPoints: readFeatureStoryPoints(featureIssue, storyPointsFieldIds),
    priorityName: issueFields.priority?.name ?? null,
    childCount: items.length,
  };
}

/** Groups items by the Feature they deliver, keeping unattributed work under its own bucket key. */
function groupItemsByFeatureKey(items: readonly RollupBoardItem[]): Map<string, RollupBoardItem[]> {
  const itemsByFeatureKey = new Map<string, RollupBoardItem[]>();
  for (const item of items) {
    const bucketKey = item.featureKey ?? NO_FEATURE_KEY;
    itemsByFeatureKey.set(bucketKey, [...(itemsByFeatureKey.get(bucketKey) ?? []), item]);
  }
  return itemsByFeatureKey;
}

/**
 * Builds one Master Card per Feature that has work on this board, plus the "No Feature" card when
 * anything could not be attributed.
 *
 * A Feature with nothing on this board gets no lane: the board's scope is the team's board, not the
 * Feature backlog, so showing empty lanes would imply work that is not there.
 */
export function buildMasterCards(
  items: readonly RollupBoardItem[],
  featureIssues: ReadonlyMap<string, JiraIssue>,
  storyPointsFieldIds: readonly string[] = [],
): MasterCard[] {
  const itemsByFeatureKey = groupItemsByFeatureKey(items);

  const realFeatureCards: MasterCard[] = [...itemsByFeatureKey.entries()]
    .filter(([featureKey]) => featureKey !== NO_FEATURE_KEY)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([featureKey, featureItems]) => {
      const featureIssue = featureIssues.get(featureKey) ?? null;
      return {
        featureKey,
        isSynthetic: false,
        featureIssue,
        isFeatureUnreadable: featureIssue === null,
        vitals: buildVitals(featureKey, featureIssue, featureItems, false, storyPointsFieldIds),
        items: featureItems,
      };
    });

  const unattributedItems = itemsByFeatureKey.get(NO_FEATURE_KEY) ?? [];
  if (unattributedItems.length === 0) {
    return realFeatureCards;
  }

  // Last, deliberately: hygiene sits below the real delivery it is getting in the way of.
  return [
    ...realFeatureCards,
    {
      featureKey: NO_FEATURE_KEY,
      isSynthetic: true,
      featureIssue: null,
      isFeatureUnreadable: false,
      vitals: buildVitals(NO_FEATURE_KEY, null, unattributedItems, true, storyPointsFieldIds),
      items: unattributedItems,
    },
  ];
}
