// useArtCapacityStore.ts — Zustand store for ART capacity planning by team.

import { create } from 'zustand';

import type { CapacityRow } from '../../SprintDashboard/capacityModel.ts';

const ART_CAPACITY_CONFIG_STORAGE_KEY = 'tbxArtCapacityConfig';

export interface ArtCapacityTeamConfig {
  startDate: string;
  endDate: string;
  rows: CapacityRow[];
}

export interface PersistedArtCapacityConfig {
  teamConfigs: Record<string, ArtCapacityTeamConfig>;
}

interface ArtCapacityState extends PersistedArtCapacityConfig {
  ensureTeamConfig: (teamId: string) => void;
  pruneTeamConfigs: (validTeamIds: string[]) => void;
  setTeamStartDate: (teamId: string, startDate: string) => void;
  setTeamEndDate: (teamId: string, endDate: string) => void;
  addTeamRow: (teamId: string, newRow: CapacityRow) => void;
  updateTeamRow: (teamId: string, rowId: string, rowUpdates: Partial<Omit<CapacityRow, 'id'>>) => void;
  removeTeamRow: (teamId: string, rowId: string) => void;
}

const EMPTY_TEAM_CONFIG: ArtCapacityTeamConfig = {
  startDate: '',
  endDate: '',
  rows: [],
};

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isArtCapacityTeamConfig(value: unknown): value is ArtCapacityTeamConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.startDate === 'string'
    && typeof candidate.endDate === 'string'
    && Array.isArray(candidate.rows);
}

function readPersistedArtCapacityConfig(): PersistedArtCapacityConfig {
  if (!canUseLocalStorage()) {
    return { teamConfigs: {} };
  }

  try {
    const rawValue = window.localStorage.getItem(ART_CAPACITY_CONFIG_STORAGE_KEY);
    if (!rawValue) {
      return { teamConfigs: {} };
    }

    const parsedValue = JSON.parse(rawValue) as { teamConfigs?: Record<string, unknown> };
    const persistedTeamConfigs = parsedValue.teamConfigs ?? {};
    const validTeamConfigs = Object.fromEntries(
      Object.entries(persistedTeamConfigs).filter(([, teamConfig]) => isArtCapacityTeamConfig(teamConfig)),
    ) as Record<string, ArtCapacityTeamConfig>;
    return { teamConfigs: validTeamConfigs };
  } catch {
    return { teamConfigs: {} };
  }
}

function writePersistedArtCapacityConfig(config: PersistedArtCapacityConfig): void {
  if (!canUseLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(ART_CAPACITY_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // The in-memory state remains authoritative if localStorage is unavailable.
  }
}

function readTeamConfig(teamConfigs: Record<string, ArtCapacityTeamConfig>, teamId: string): ArtCapacityTeamConfig {
  return teamConfigs[teamId] ?? EMPTY_TEAM_CONFIG;
}

/** Shared ART capacity store that keeps separate date ranges and role rows for each configured ART team. */
export const useArtCapacityStore = create<ArtCapacityState>((setState, getState) => ({
  ...readPersistedArtCapacityConfig(),

  ensureTeamConfig: (teamId) => {
    const existingTeamConfig = getState().teamConfigs[teamId];
    if (existingTeamConfig) {
      return;
    }

    const nextTeamConfigs = {
      ...getState().teamConfigs,
      [teamId]: EMPTY_TEAM_CONFIG,
    };
    setState({ teamConfigs: nextTeamConfigs });
    writePersistedArtCapacityConfig({ teamConfigs: nextTeamConfigs });
  },

  pruneTeamConfigs: (validTeamIds) => {
    const validTeamIdSet = new Set(validTeamIds);
    const nextTeamConfigs = Object.fromEntries(
      Object.entries(getState().teamConfigs).filter(([teamId]) => validTeamIdSet.has(teamId)),
    );
    setState({ teamConfigs: nextTeamConfigs });
    writePersistedArtCapacityConfig({ teamConfigs: nextTeamConfigs });
  },

  setTeamStartDate: (teamId, startDate) => {
    const currentTeamConfig = readTeamConfig(getState().teamConfigs, teamId);
    const nextTeamConfigs = {
      ...getState().teamConfigs,
      [teamId]: { ...currentTeamConfig, startDate },
    };
    setState({ teamConfigs: nextTeamConfigs });
    writePersistedArtCapacityConfig({ teamConfigs: nextTeamConfigs });
  },

  setTeamEndDate: (teamId, endDate) => {
    const currentTeamConfig = readTeamConfig(getState().teamConfigs, teamId);
    const nextTeamConfigs = {
      ...getState().teamConfigs,
      [teamId]: { ...currentTeamConfig, endDate },
    };
    setState({ teamConfigs: nextTeamConfigs });
    writePersistedArtCapacityConfig({ teamConfigs: nextTeamConfigs });
  },

  addTeamRow: (teamId, newRow) => {
    const currentTeamConfig = readTeamConfig(getState().teamConfigs, teamId);
    const nextTeamConfigs = {
      ...getState().teamConfigs,
      [teamId]: { ...currentTeamConfig, rows: [...currentTeamConfig.rows, newRow] },
    };
    setState({ teamConfigs: nextTeamConfigs });
    writePersistedArtCapacityConfig({ teamConfigs: nextTeamConfigs });
  },

  updateTeamRow: (teamId, rowId, rowUpdates) => {
    const currentTeamConfig = readTeamConfig(getState().teamConfigs, teamId);
    const nextRows = currentTeamConfig.rows.map((existingRow) =>
      existingRow.id === rowId ? { ...existingRow, ...rowUpdates } : existingRow,
    );
    const nextTeamConfigs = {
      ...getState().teamConfigs,
      [teamId]: { ...currentTeamConfig, rows: nextRows },
    };
    setState({ teamConfigs: nextTeamConfigs });
    writePersistedArtCapacityConfig({ teamConfigs: nextTeamConfigs });
  },

  removeTeamRow: (teamId, rowId) => {
    const currentTeamConfig = readTeamConfig(getState().teamConfigs, teamId);
    const nextRows = currentTeamConfig.rows.filter((existingRow) => existingRow.id !== rowId);
    const nextTeamConfigs = {
      ...getState().teamConfigs,
      [teamId]: { ...currentTeamConfig, rows: nextRows },
    };
    setState({ teamConfigs: nextTeamConfigs });
    writePersistedArtCapacityConfig({ teamConfigs: nextTeamConfigs });
  },
}));
