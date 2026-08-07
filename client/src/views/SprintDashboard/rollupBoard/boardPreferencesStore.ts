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
  return { teamProfileId, boardId, laneOrder: [], collapsedByFeatureKey: {} };
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
export function moveLaneBefore(
  preferences: BoardPreferences,
  movedFeatureKey: string,
  targetFeatureKey: string,
  allFeatureKeys: readonly string[],
): BoardPreferences {
  const seededOrder = preferences.laneOrder.length > 0
    ? preferences.laneOrder.filter((orderedKey) => allFeatureKeys.includes(orderedKey))
    : [...allFeatureKeys];

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
  // Seed from the currently displayed order so a first-ever move does not reshuffle everything else.
  const seededOrder = preferences.laneOrder.length > 0
    ? preferences.laneOrder.filter((orderedKey) => allFeatureKeys.includes(orderedKey))
    : [...allFeatureKeys];
  const withoutMovedKey = seededOrder.filter((orderedKey) => orderedKey !== featureKey);

  return {
    ...preferences,
    laneOrder: destination === 'top' ? [featureKey, ...withoutMovedKey] : [...withoutMovedKey, featureKey],
  };
}
