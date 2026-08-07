// boardPreferencesStore.test.ts — Proves one person's view of the board stays their own.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildDefaultPreferences,
  loadBoardPreferences,
  moveLaneBefore,
  moveLaneToEnd,
  saveBoardPreferences,
  setAllLanesCollapsed,
  toggleLaneCollapsed,
} from './boardPreferencesStore.ts';

beforeEach(() => {
  window.localStorage.clear();
});

describe('loadBoardPreferences', () => {
  it('starts a viewer who has never opened this board with every lane collapsed', () => {
    const preferences = loadBoardPreferences('team-a', 42);

    expect(preferences.collapsedByFeatureKey).toEqual({});
    expect(preferences.laneOrder).toEqual([]);
  });

  it('keeps one team\'s preferences separate from another\'s', () => {
    saveBoardPreferences({ ...buildDefaultPreferences('team-a', 42), laneOrder: ['FEAT-1'] });

    expect(loadBoardPreferences('team-b', 42).laneOrder).toEqual([]);
  });

  it('keeps preferences separate per board, since one team can watch more than one', () => {
    saveBoardPreferences({ ...buildDefaultPreferences('team-a', 42), laneOrder: ['FEAT-1'] });

    expect(loadBoardPreferences('team-a', 99).laneOrder).toEqual([]);
  });

  it('survives a round trip through storage', () => {
    saveBoardPreferences({ ...buildDefaultPreferences('team-a', 42), laneOrder: ['FEAT-2', 'FEAT-1'] });

    expect(loadBoardPreferences('team-a', 42).laneOrder).toEqual(['FEAT-2', 'FEAT-1']);
  });

  it('treats unreadable storage as nothing stored, rather than throwing on load', () => {
    window.localStorage.setItem('tbxRollupBoardPreferences', 'not json at all');

    expect(loadBoardPreferences('team-a', 42).laneOrder).toEqual([]);
  });
});

describe('toggleLaneCollapsed', () => {
  it('expands a lane that was collapsed', () => {
    const expanded = toggleLaneCollapsed(buildDefaultPreferences('team-a', 42), 'FEAT-1');

    expect(expanded.collapsedByFeatureKey['FEAT-1']).toBe(false);
  });

  it('collapses a lane that was expanded', () => {
    const preferences = { ...buildDefaultPreferences('team-a', 42), collapsedByFeatureKey: { 'FEAT-1': false } };

    expect(toggleLaneCollapsed(preferences, 'FEAT-1').collapsedByFeatureKey['FEAT-1']).toBe(true);
  });

  it('leaves every other lane alone', () => {
    const preferences = { ...buildDefaultPreferences('team-a', 42), collapsedByFeatureKey: { 'FEAT-2': false } };

    expect(toggleLaneCollapsed(preferences, 'FEAT-1').collapsedByFeatureKey['FEAT-2']).toBe(false);
  });
});

describe('setAllLanesCollapsed', () => {
  it('expands everything named in one action', () => {
    const expanded = setAllLanesCollapsed(buildDefaultPreferences('team-a', 42), ['FEAT-1', 'FEAT-2'], false);

    expect(expanded.collapsedByFeatureKey).toEqual({ 'FEAT-1': false, 'FEAT-2': false });
  });

  it('collapses everything named in one action', () => {
    const collapsed = setAllLanesCollapsed(buildDefaultPreferences('team-a', 42), ['FEAT-1'], true);

    expect(collapsed.collapsedByFeatureKey['FEAT-1']).toBe(true);
  });
});

describe('moveLaneToEnd', () => {
  it('sends a lane to the top, keeping the rest in their existing order', () => {
    const moved = moveLaneToEnd(buildDefaultPreferences('team-a', 42), 'FEAT-3', ['FEAT-1', 'FEAT-2', 'FEAT-3'], 'top');

    expect(moved.laneOrder).toEqual(['FEAT-3', 'FEAT-1', 'FEAT-2']);
  });

  it('sends a lane to the bottom, keeping the rest in their existing order', () => {
    const moved = moveLaneToEnd(buildDefaultPreferences('team-a', 42), 'FEAT-1', ['FEAT-1', 'FEAT-2', 'FEAT-3'], 'bottom');

    expect(moved.laneOrder).toEqual(['FEAT-2', 'FEAT-3', 'FEAT-1']);
  });

  it('drops a Feature that has left the board out of the stored order', () => {
    const preferences = { ...buildDefaultPreferences('team-a', 42), laneOrder: ['FEAT-GONE', 'FEAT-1'] };

    const moved = moveLaneToEnd(preferences, 'FEAT-1', ['FEAT-1', 'FEAT-2'], 'top');

    expect(moved.laneOrder).not.toContain('FEAT-GONE');
  });

  it('never records anything that could reach Jira or the shared workspace', () => {
    const moved = moveLaneToEnd(buildDefaultPreferences('team-a', 42), 'FEAT-1', ['FEAT-1'], 'top');

    // The whole entity is: which team, which board, the order, and what is collapsed. Nothing else.
    expect(Object.keys(moved).sort()).toEqual(['boardId', 'collapsedByFeatureKey', 'laneOrder', 'teamProfileId']);
  });
});

describe('moveLaneBefore', () => {
  const ALL_KEYS = ['FEAT-1', 'FEAT-2', 'FEAT-3'];

  it('drops a lane into the position the target lane occupies', () => {
    const moved = moveLaneBefore(buildDefaultPreferences('team-a', 42), 'FEAT-3', 'FEAT-1', ALL_KEYS);

    expect(moved.laneOrder).toEqual(['FEAT-3', 'FEAT-1', 'FEAT-2']);
  });

  it('moves only the dragged lane, leaving the rest in their existing sequence', () => {
    const moved = moveLaneBefore(buildDefaultPreferences('team-a', 42), 'FEAT-1', 'FEAT-3', ALL_KEYS);

    expect(moved.laneOrder).toEqual(['FEAT-2', 'FEAT-1', 'FEAT-3']);
  });

  it('seeds from what is on screen, so a first-ever drag does not reshuffle the board', () => {
    // Without seeding, the order would start empty and every other lane would jump at once.
    const moved = moveLaneBefore(buildDefaultPreferences('team-a', 42), 'FEAT-2', 'FEAT-1', ALL_KEYS);

    expect(moved.laneOrder).toHaveLength(3);
  });

  it('appends when the target has left the board, rather than dropping the lane entirely', () => {
    const moved = moveLaneBefore(buildDefaultPreferences('team-a', 42), 'FEAT-1', 'FEAT-GONE', ALL_KEYS);

    expect(moved.laneOrder[moved.laneOrder.length - 1]).toBe('FEAT-1');
  });

  it('is a no-op when a lane is dropped on itself', () => {
    const moved = moveLaneBefore(buildDefaultPreferences('team-a', 42), 'FEAT-2', 'FEAT-2', ALL_KEYS);

    expect(moved.laneOrder).toEqual(ALL_KEYS);
  });
});
