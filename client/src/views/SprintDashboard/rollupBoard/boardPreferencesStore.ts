// boardPreferencesStore.ts — One person's view of the board: their lane order and what they collapsed.
//
// These are working preferences, not team decisions. They stay in this browser, are never published
// to the shared workspace, and are never written to Jira — one person dragging a lane must not
// silently rearrange a colleague's board, and must not touch Jira's own ranking.

import type { BoardPreferences } from './rollupBoardTypes.ts';

const PREFERENCES_STORAGE_KEY = 'tbxRollupBoardPreferences';

/** Preferences are per team AND per board, since the same team can look at more than one. */
function buildPreferencesKey(teamProfileId: string, boardId: number): string {
  return `${teamProfileId}:${boardId}`;
}

/** A viewer who has never touched this board: no order of their own, every lane collapsed. */
export function buildDefaultPreferences(teamProfileId: string, boardId: number): BoardPreferences {
  return { teamProfileId, boardId, laneOrder: [], collapsedByFeatureKey: {}, cardOrderByCell: {} };
}

/** The storage key for one lane's column — where a hand-ordered sequence of cards is remembered. */
export function buildCardCellKey(featureKey: string, columnId: string): string {
  return `${featureKey}::${columnId}`;
}

/**
 * Moves one card to sit where another currently is, within the same lane and column.
 *
 * The order is seeded from what is on screen the first time someone drags, so a single move
 * reorders one card rather than appearing to shuffle the whole column.
 */
export function moveCardBefore(
  preferences: BoardPreferences,
  featureKey: string,
  columnId: string,
  movedIssueKey: string,
  targetIssueKey: string,
  displayedIssueKeys: readonly string[],
): BoardPreferences {
  const cellKey = buildCardCellKey(featureKey, columnId);
  const storedOrder = preferences.cardOrderByCell?.[cellKey] ?? [];
  const seededOrder = storedOrder.length > 0
    ? storedOrder.filter((issueKey) => displayedIssueKeys.includes(issueKey))
    : [...displayedIssueKeys];

  if (movedIssueKey === targetIssueKey) {
    return { ...preferences, cardOrderByCell: { ...preferences.cardOrderByCell, [cellKey]: seededOrder } };
  }

  const withoutMoved = seededOrder.filter((issueKey) => issueKey !== movedIssueKey);
  const targetIndex = withoutMoved.indexOf(targetIssueKey);
  const nextOrder = targetIndex < 0
    ? [...withoutMoved, movedIssueKey]
    : [...withoutMoved.slice(0, targetIndex), movedIssueKey, ...withoutMoved.slice(targetIndex)];

  return { ...preferences, cardOrderByCell: { ...preferences.cardOrderByCell, [cellKey]: nextOrder } };
}

/** Reads every stored preference set; unreadable storage is treated as "nothing stored yet". */
function readAllPreferences(): Record<string, BoardPreferences> {
  try {
    return JSON.parse(window.localStorage.getItem(PREFERENCES_STORAGE_KEY) || '{}') as Record<string, BoardPreferences>;
  } catch {
    return {};
  }
}

/** Loads this viewer's preferences for one board, falling back to the untouched defaults. */
export function loadBoardPreferences(teamProfileId: string, boardId: number): BoardPreferences {
  const storedPreferences = readAllPreferences()[buildPreferencesKey(teamProfileId, boardId)];
  return storedPreferences ?? buildDefaultPreferences(teamProfileId, boardId);
}

/** Saves this viewer's preferences, leaving every other board's untouched. */
export function saveBoardPreferences(preferences: BoardPreferences): void {
  const allPreferences = readAllPreferences();
  allPreferences[buildPreferencesKey(preferences.teamProfileId, preferences.boardId)] = preferences;
  window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(allPreferences));
}

/** Flips one lane between collapsed and expanded. */
export function toggleLaneCollapsed(preferences: BoardPreferences, featureKey: string): BoardPreferences {
  const isCurrentlyCollapsed = preferences.collapsedByFeatureKey[featureKey] ?? true;
  return {
    ...preferences,
    collapsedByFeatureKey: { ...preferences.collapsedByFeatureKey, [featureKey]: !isCurrentlyCollapsed },
  };
}

/** Sets every named lane to the same collapsed state, for the expand-all / collapse-all actions. */
export function setAllLanesCollapsed(
  preferences: BoardPreferences,
  featureKeys: readonly string[],
  shouldCollapse: boolean,
): BoardPreferences {
  const collapsedByFeatureKey = { ...preferences.collapsedByFeatureKey };
  for (const featureKey of featureKeys) {
    collapsedByFeatureKey[featureKey] = shouldCollapse;
  }
  return { ...preferences, collapsedByFeatureKey };
}

/**
 * Moves one lane to sit where another one currently is — the drag-and-drop reorder.
 *
 * The order is seeded from what is on screen the first time someone drags, so a single drag moves
 * one lane rather than appearing to shuffle everything.
 */
/**
 * Every lane in a single ordered list, so a drop always has somewhere to land.
 *
 * Seeding from the stored order ALONE was the bug behind "only the top few lanes can be dragged": any
 * lane never explicitly ordered was absent from the array, so `indexOf` on it returned -1 and the drop
 * fell through to "append to the bottom" instead of landing where it was released. Since unordered
 * lanes render after ordered ones, that looked exactly like the tail of the board being stuck.
 *
 * The stored order still wins for the lanes that have one; the rest follow in the order they are
 * currently displayed, which is the board's default sequence.
 */
function seedFullLaneOrder(
  preferences: BoardPreferences,
  allFeatureKeys: readonly string[],
): string[] {
  const storedOrder = preferences.laneOrder.filter((orderedKey) => allFeatureKeys.includes(orderedKey));
  const unorderedKeys = allFeatureKeys.filter((featureKey) => !storedOrder.includes(featureKey));
  return [...storedOrder, ...unorderedKeys];
}

export function moveLaneBefore(
  preferences: BoardPreferences,
  movedFeatureKey: string,
  targetFeatureKey: string,
  allFeatureKeys: readonly string[],
): BoardPreferences {
  const seededOrder = seedFullLaneOrder(preferences, allFeatureKeys);

  // Dropping a lane on itself is a non-event. Without this it would fall through to the append
  // branch below and send the lane to the bottom — the opposite of "nothing happened".
  if (movedFeatureKey === targetFeatureKey) {
    return { ...preferences, laneOrder: seededOrder };
  }

  const withoutMovedKey = seededOrder.filter((orderedKey) => orderedKey !== movedFeatureKey);
  const targetIndex = withoutMovedKey.indexOf(targetFeatureKey);

  if (targetIndex < 0) {
    return { ...preferences, laneOrder: [...withoutMovedKey, movedFeatureKey] };
  }

  return {
    ...preferences,
    laneOrder: [
      ...withoutMovedKey.slice(0, targetIndex),
      movedFeatureKey,
      ...withoutMovedKey.slice(targetIndex),
    ],
  };
}

/** Moves one lane to the top or the bottom of this viewer's order. */
export function moveLaneToEnd(
  preferences: BoardPreferences,
  featureKey: string,
  allFeatureKeys: readonly string[],
  destination: 'top' | 'bottom',
): BoardPreferences {
  // Seed from the currently displayed order so a first-ever move does not reshuffle everything else,
  // and so a lane that has never been ordered is still somewhere in the list rather than nowhere.
  const seededOrder = seedFullLaneOrder(preferences, allFeatureKeys);
  const withoutMovedKey = seededOrder.filter((orderedKey) => orderedKey !== featureKey);

  return {
    ...preferences,
    laneOrder: destination === 'top' ? [featureKey, ...withoutMovedKey] : [...withoutMovedKey, featureKey],
  };
}

/**
 * Drops every manual ordering, returning the board to its default sequence.
 *
 * That default is Feature key ascending, which is the order the PI Review page shows the same PI in —
 * so a board nobody has re-ordered and the PI Review read the same way round.
 *
 * This exists because manual order is sticky by design: once a lane has been sent to the top it stays
 * there across sessions, and there was previously no way back short of dragging every lane. Card
 * sequencing inside the cells is cleared with it, since "reset the order" plainly means all of it.
 */
export function clearManualOrder(preferences: BoardPreferences): BoardPreferences {
  return { ...preferences, laneOrder: [], cardOrderByCell: {} };
}

/** True when anything has been manually ordered, so the reset control can hide when it would do nothing. */
export function hasManualOrder(preferences: BoardPreferences): boolean {
  return preferences.laneOrder.length > 0
    || Object.keys(preferences.cardOrderByCell ?? {}).length > 0;
}
