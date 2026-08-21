// masterCards.ts — Groups the board's work into one swimlane per Feature.
//
// Two behaviours here carry most of the board's honesty. First, work that cannot be traced to any
// Feature gets its own lane and a visible count, so the hygiene backlog is a number the team can act
// on rather than a vague sense that "some things aren't linked". Second, a Feature whose issue could
// not be read still gets a lane — folding it into "No Feature" would misreport a permissions or
// visibility problem as a data-quality one.

import { readIsFlagSet } from './issueFlagWrite.ts';
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
 * Reads the field id this instance actually keeps the flag in, exactly as the CARDS do. It used to
 * go through the shared impediment detector, whose own flag check hard-codes Jira's default id —
 * which is not the id here. That fails in both directions at once and looks like two bugs: the
 * board could write a flag to the right field and then never show it, so the action appeared to do
 * nothing at all.
 *
 * The status guard stays: the shared detector reads `fields.status.name` unguarded, and one Feature
 * Jira returned without a status must not take the whole board down — a board that fails to render
 * hides far more than a missing flag does.
 */
function readIsFeatureFlagged(featureIssue: JiraIssue | null, flagFieldId: string): boolean {
  const hasStatusName = Boolean((featureIssue?.fields as { status?: { name?: string } } | undefined)?.status?.name);
  if (!featureIssue || !hasStatusName) return false;
  return readIsFlagSet(featureIssue.fields as unknown as Record<string, unknown>, flagFieldId);
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
  orderedColumnIds: readonly string[],
  /** The field this instance keeps the impediment flag in. Empty reads as "not flagged". */
  flagFieldId = '',
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
    progress: computeFeatureProgress(items, orderedColumnIds),
    dependencyCount: countBlockingDependencies(featureIssue),
    isFlagged: readIsFeatureFlagged(featureIssue, flagFieldId),
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
  /**
   * The team's columns in workflow order, so unfinished work earns credit for how far it has got.
   *
   * Optional: without them the figure is exactly what it was before part credit existed, so a caller
   * that has no vocabulary to hand cannot accidentally change what a Feature appears to be worth.
   */
  orderedColumnIds: readonly string[] = [],
  /**
   * The field this instance keeps the impediment flag in, discovered by name.
   *
   * Optional and empty by default, which reads as "not flagged" rather than guessing at Jira's
   * default id — a wrong id here would show every Feature as flagged or none of them, and both look
   * like the data rather than the configuration.
   */
  flagFieldId = '',
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
        vitals: buildVitals(featureKey, featureIssue, featureItems, false, storyPointsFieldIds, orderedColumnIds, flagFieldId),
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
      vitals: buildVitals(NO_FEATURE_KEY, null, unattributedItems, true, storyPointsFieldIds, orderedColumnIds, flagFieldId),
      items: unattributedItems,
    },
  ];
}

/**
 * Builds the lane for a Feature the team owns but has not broken down.
 *
 * These are the deliberate exception to the rule above. A lane normally means real work, and an empty
 * one would imply work that is not there — but a Feature committed to the PI with nothing under it is
 * itself the thing worth seeing, and burying it in a list below the board proved easy to scroll past.
 * It carries no items, so it reads as a gap rather than as progress.
 */
export function buildFeatureWithoutWorkCard(
  featureKey: string,
  featureIssue: JiraIssue | null,
  storyPointsFieldIds: readonly string[] = [],
  /** The field this instance keeps the impediment flag in. Empty reads as "not flagged". */
  flagFieldId = '',
): MasterCard {
  return {
    featureKey,
    isSynthetic: false,
    featureIssue,
    // Never "unreadable": this Feature came back from the PI query moments ago, so it demonstrably
    // reads. A missing issue here only means it was not carried through, which is not the same thing
    // as Jira refusing it — and claiming otherwise put a permissions warning on a healthy Feature.
    isFeatureUnreadable: false,
    hasNoWorkYet: true,
    vitals: buildVitals(featureKey, featureIssue, [], false, storyPointsFieldIds, [], flagFieldId),
    items: [],
  };
}

/**
 * Puts every lane in one sequence, ordered the way the PI Review page orders the same PI.
 *
 * Features the team has not broken down were previously appended after the ones that have work, which
 * split the board into two separately-sorted groups. PI Review lists the PI's Features in one run of
 * key order, so a Feature like DENP-1387 sat first there and last here — the same PI apparently in two
 * different orders, which is exactly the sort of disagreement this board exists to remove.
 *
 * "No Feature" stays last regardless: it is a hygiene bucket rather than a Feature, and it has no key
 * that would sort meaningfully among real ones.
 */
export function orderLanesLikePiReview(masterCards: readonly MasterCard[]): MasterCard[] {
  // One lane per Feature, always. A Feature can arrive twice — once because work rolls up to it, and
  // again from the "committed to the PI with nothing underneath" scan if those two ran against
  // different snapshots — and two lanes sharing a key means two headers, a collapse toggle that
  // appears not to work because it flips both, and duplicate React keys. The lane carrying work wins:
  // it is the one that is true.
  const bestCardByFeatureKey = new Map<string, MasterCard>();
  for (const masterCard of masterCards) {
    const existingCard = bestCardByFeatureKey.get(masterCard.featureKey);
    if (existingCard === undefined || (existingCard.items.length === 0 && masterCard.items.length > 0)) {
      bestCardByFeatureKey.set(masterCard.featureKey, masterCard);
    }
  }
  const uniqueCards = [...bestCardByFeatureKey.values()];

  const realFeatureCards = uniqueCards.filter((masterCard) => !masterCard.isSynthetic);
  const syntheticCards = uniqueCards.filter((masterCard) => masterCard.isSynthetic);

  // Feature KEY order, despite this function's name -- it is a deterministic default, not a
  // priority, and the two were being confused. A board with no saved lane order puts whichever
  // Feature's key sorts first at the top, and the lane rank box used to present that alphabetical
  // accident as rank 1. It now draws itself as unset until somebody really sets an order.
  const orderedRealCards = [...realFeatureCards].sort(
    (leftCard, rightCard) => leftCard.featureKey.localeCompare(rightCard.featureKey, undefined, { numeric: true }),
  );

  return [...orderedRealCards, ...syntheticCards];
}
