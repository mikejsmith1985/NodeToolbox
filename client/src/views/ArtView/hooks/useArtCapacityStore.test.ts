// useArtCapacityStore.test.ts — Unit tests for ART capacity persistence and team-scoped mutations.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CapacityRow } from '../../SprintDashboard/capacityModel.ts';
import { useArtCapacityStore } from './useArtCapacityStore.ts';

function buildCapacityRow(overrides: Partial<CapacityRow> = {}): CapacityRow {
  return {
    id: 'row-1',
    role: 'Dev',
    memberCount: 2,
    capacityPercentage: 100,
    totalPtoDays: 0,
    ...overrides,
  };
}

function resetStoreToDefaults(): void {
  useArtCapacityStore.setState({ teamConfigs: {} });
}

beforeEach(() => {
  resetStoreToDefaults();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('useArtCapacityStore', () => {
  it('creates an empty config for a team when requested', () => {
    useArtCapacityStore.getState().ensureTeamConfig('team-a');
    expect(useArtCapacityStore.getState().teamConfigs['team-a']).toEqual({
      startDate: '',
      endDate: '',
      rows: [],
    });
  });

  it('stores team-scoped start and end dates', () => {
    useArtCapacityStore.getState().setTeamStartDate('team-a', '2025-01-06');
    useArtCapacityStore.getState().setTeamEndDate('team-a', '2025-01-17');
    expect(useArtCapacityStore.getState().teamConfigs['team-a'].startDate).toBe('2025-01-06');
    expect(useArtCapacityStore.getState().teamConfigs['team-a'].endDate).toBe('2025-01-17');
  });

  it('adds, updates, and removes rows for the requested team only', () => {
    useArtCapacityStore.getState().addTeamRow('team-a', buildCapacityRow({ id: 'row-a' }));
    useArtCapacityStore.getState().addTeamRow('team-b', buildCapacityRow({ id: 'row-b', role: 'QE' }));
    useArtCapacityStore.getState().updateTeamRow('team-a', 'row-a', { memberCount: 5 });
    useArtCapacityStore.getState().removeTeamRow('team-b', 'row-b');

    expect(useArtCapacityStore.getState().teamConfigs['team-a'].rows[0].memberCount).toBe(5);
    expect(useArtCapacityStore.getState().teamConfigs['team-b'].rows).toHaveLength(0);
  });

  it('prunes orphaned team configs and persists the remaining teams', () => {
    useArtCapacityStore.getState().setTeamStartDate('team-a', '2025-01-06');
    useArtCapacityStore.getState().setTeamStartDate('team-b', '2025-01-06');
    useArtCapacityStore.getState().pruneTeamConfigs(['team-b']);

    expect(useArtCapacityStore.getState().teamConfigs['team-a']).toBeUndefined();
    expect(useArtCapacityStore.getState().teamConfigs['team-b']).toBeDefined();

    const storedValue = JSON.parse(localStorage.getItem('tbxArtCapacityConfig') ?? '{}') as {
      teamConfigs?: Record<string, unknown>;
    };
    expect(Object.keys(storedValue.teamConfigs ?? {})).toEqual(['team-b']);
  });
});
