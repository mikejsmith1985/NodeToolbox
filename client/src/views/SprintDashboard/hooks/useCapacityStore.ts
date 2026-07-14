// useCapacityStore.ts — Zustand store for the Capacity tab configuration, persisted to localStorage.
//
// Stores the date range and team composition rows that drive the capacity calculator.
// Each CapacityRow represents a group of people in the same role working at the same
// weighted allocation, with a shared PTO day pool for that group.

import { create } from 'zustand';

import { useSettingsStore } from '../../../store/settingsStore.ts';
import { coerceLegacyCapacityRole } from '../capacityModel.ts';
import type { CapacityRow } from '../capacityModel.ts';
import {
  buildTeamScopedStorageKey,
  readTeamScopedStorageValue,
  resolveTeamScopedStorageProfileId,
} from './teamScopedStorage.ts';
/** localStorage key for persisting capacity configuration between sessions. */
const CAPACITY_CONFIG_STORAGE_KEY = 'tbxCapacityConfig';

/** The full persisted capacity configuration. */
interface PersistedCapacityConfig {
  dateMode: 'pi' | 'custom';
  startDate: string;
  endDate: string;
  rows: CapacityRow[];
}

interface CapacityState extends PersistedCapacityConfig {
  dashboardTeamProfileId: string;
  /** Reload persisted capacity data for the active Team Dashboard team. */
  setDashboardTeamProfileId: (dashboardTeamProfileId: string) => void;
  /** Switch between PI-derived dates and a manual custom date range. */
  setDateMode: (dateMode: 'pi' | 'custom') => void;
  /** Replace the start date of the planning window. */
  setStartDate: (startDate: string) => void;
  /** Replace the end date of the planning window. */
  setEndDate: (endDate: string) => void;
  /** Append a new row to the team composition table. */
  addRow: (newRow: CapacityRow) => void;
  /** Replace every row at once (used when seeding the team composition from the roster). */
  setRows: (nextRows: CapacityRow[]) => void;
  /** Apply a partial update to a specific row identified by its id. */
  updateRow: (rowId: string, rowUpdates: Partial<Omit<CapacityRow, 'id'>>) => void;
  /** Remove a row from the team composition table. */
  removeRow: (rowId: string) => void;
}

// ── localStorage helpers ──

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function resolveDashboardTeamProfileId(dashboardTeamProfileId: string): string {
  return resolveTeamScopedStorageProfileId(dashboardTeamProfileId);
}

function buildCapacityConfigStorageKey(dashboardTeamProfileId: string): string {
  return buildTeamScopedStorageKey(CAPACITY_CONFIG_STORAGE_KEY, dashboardTeamProfileId);
}

/** Validate that a parsed JSON value has the shape of PersistedCapacityConfig. */
function isPersistedCapacityConfig(value: unknown): value is PersistedCapacityConfig {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.startDate === 'string' &&
    typeof candidate.endDate === 'string' &&
    Array.isArray(candidate.rows)
  );
}

/**
 * Normalizes persisted rows to the current role taxonomy: legacy role codes are translated to their
 * current label and rows whose role no longer counts toward capacity (retired SM/PO/TPO) are dropped.
 * This overwrites old data with the new format on load — there is no attempt to preserve old semantics.
 */
function normalizePersistedRows(persistedRows: CapacityRow[]): CapacityRow[] {
  return persistedRows
    .map((persistedRow) => {
      const normalizedRole = coerceLegacyCapacityRole(persistedRow.role);
      return normalizedRole === null ? null : { ...persistedRow, role: normalizedRole };
    })
    .filter((normalizedRow): normalizedRow is CapacityRow => normalizedRow !== null);
}

/** Read the persisted capacity config from localStorage, returning null if absent or corrupt. */
function readPersistedConfig(dashboardTeamProfileId = ''): PersistedCapacityConfig | null {
  if (!canUseLocalStorage()) {
    return null;
  }

  try {
    const rawValue = readTeamScopedStorageValue(CAPACITY_CONFIG_STORAGE_KEY, dashboardTeamProfileId);
    if (rawValue === null) {
      return null;
    }

    const parsedValue: unknown = JSON.parse(rawValue);
    if (!isPersistedCapacityConfig(parsedValue)) {
      return null;
    }

    return {
      dateMode: parsedValue.dateMode === 'custom' ? 'custom' : INITIAL_DATE_MODE,
      startDate: parsedValue.startDate,
      endDate: parsedValue.endDate,
      rows: normalizePersistedRows(parsedValue.rows),
    };
  } catch {
    // Corrupted storage — fall back to defaults.
    return null;
  }
}

/** Write the current capacity config to localStorage. */
function writePersistedConfig(
  config: PersistedCapacityConfig,
  dashboardTeamProfileId: string,
): void {
  if (!canUseLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(
      buildCapacityConfigStorageKey(dashboardTeamProfileId),
      JSON.stringify(config),
    );
  } catch {
    // Storage write can fail in private-browsing modes; in-memory state remains authoritative.
  }
}

// ── Default state ──

const INITIAL_START_DATE = '';
const INITIAL_END_DATE = '';
const INITIAL_ROWS: CapacityRow[] = [];
const INITIAL_DATE_MODE: PersistedCapacityConfig['dateMode'] = 'pi';

function buildInitialState(dashboardTeamProfileId = ''): PersistedCapacityConfig {
  const persistedConfig = readPersistedConfig(dashboardTeamProfileId);
  if (persistedConfig !== null) {
    return persistedConfig;
  }

  return {
    dateMode: INITIAL_DATE_MODE,
    startDate: INITIAL_START_DATE,
    endDate: INITIAL_END_DATE,
    rows: INITIAL_ROWS,
  };
}

// ── Store ──

/**
 * Zustand store for the Capacity tab.
 * All mutations are immediately persisted to localStorage so the configuration
 * survives page refreshes and tab switches.
 */
export const useCapacityStore = create<CapacityState>((setState, getState) => ({
  dashboardTeamProfileId: resolveDashboardTeamProfileId(
    useSettingsStore.getState().sprintDashboardActiveTeamProfileId,
  ),
  ...buildInitialState(useSettingsStore.getState().sprintDashboardActiveTeamProfileId),

  setDashboardTeamProfileId: (dashboardTeamProfileId) => {
    const resolvedTeamProfileId = resolveDashboardTeamProfileId(dashboardTeamProfileId);
    setState({
      dashboardTeamProfileId: resolvedTeamProfileId,
      ...buildInitialState(resolvedTeamProfileId),
    });
  },

  setDateMode: (dateMode) => {
    setState({ dateMode });
    writePersistedConfig({ ...getState(), dateMode }, getState().dashboardTeamProfileId);
  },

  setStartDate: (startDate) => {
    setState({ startDate });
    writePersistedConfig({ ...getState(), startDate }, getState().dashboardTeamProfileId);
  },

  setEndDate: (endDate) => {
    setState({ endDate });
    writePersistedConfig({ ...getState(), endDate }, getState().dashboardTeamProfileId);
  },

  addRow: (newRow) => {
    const updatedRows = [...getState().rows, newRow];
    setState({ rows: updatedRows });
    writePersistedConfig({ ...getState(), rows: updatedRows }, getState().dashboardTeamProfileId);
  },

  setRows: (nextRows) => {
    setState({ rows: nextRows });
    writePersistedConfig({ ...getState(), rows: nextRows }, getState().dashboardTeamProfileId);
  },

  updateRow: (rowId, rowUpdates) => {
    const updatedRows = getState().rows.map((existingRow) =>
      existingRow.id === rowId ? { ...existingRow, ...rowUpdates } : existingRow,
    );
    setState({ rows: updatedRows });
    writePersistedConfig({ ...getState(), rows: updatedRows }, getState().dashboardTeamProfileId);
  },

  removeRow: (rowId) => {
    const updatedRows = getState().rows.filter((existingRow) => existingRow.id !== rowId);
    setState({ rows: updatedRows });
    writePersistedConfig({ ...getState(), rows: updatedRows }, getState().dashboardTeamProfileId);
  },
}));
