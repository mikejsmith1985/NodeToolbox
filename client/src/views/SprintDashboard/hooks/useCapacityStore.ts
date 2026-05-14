// useCapacityStore.ts — Zustand store for the Capacity tab configuration, persisted to localStorage.
//
// Stores the date range and team composition rows that drive the capacity calculator.
// Each CapacityRow represents a group of people in the same role working at the same
// weighted allocation, with a shared PTO day pool for that group.

import { create } from 'zustand';

// ── Named constants ──

/** localStorage key for persisting capacity configuration between sessions. */
const CAPACITY_CONFIG_STORAGE_KEY = 'tbxCapacityConfig';

// ── Type definitions ──

/** Supported team roles in the capacity calculator. */
export type TeamRole = 'Dev' | 'QE' | 'BT' | 'SL' | 'SA' | 'PO' | 'SM';

/**
 * One row in the capacity table — represents a group of people sharing the same
 * role and weighted allocation percentage.
 */
export interface CapacityRow {
  /** Unique identifier for this row (used as React key and for targeted updates). */
  id: string;
  /** The team role this group fills (e.g. Dev, QE, PO). */
  role: TeamRole;
  /** How many people are in this group. */
  memberCount: number;
  /**
   * Fraction of each work day these people dedicate to this team's work, expressed
   * as a whole number (0–100). A dev lead orchestrating at 50% enters 50.
   */
  capacityPercentage: number;
  /**
   * Total PTO days across everyone in this row for the selected date range.
   * These days are subtracted before the capacity multiplier is applied.
   */
  totalPtoDays: number;
}

/** The full persisted capacity configuration. */
interface PersistedCapacityConfig {
  startDate: string;
  endDate: string;
  rows: CapacityRow[];
}

interface CapacityState extends PersistedCapacityConfig {
  /** Replace the start date of the planning window. */
  setStartDate: (startDate: string) => void;
  /** Replace the end date of the planning window. */
  setEndDate: (endDate: string) => void;
  /** Append a new row to the team composition table. */
  addRow: (newRow: CapacityRow) => void;
  /** Apply a partial update to a specific row identified by its id. */
  updateRow: (rowId: string, rowUpdates: Partial<Omit<CapacityRow, 'id'>>) => void;
  /** Remove a row from the team composition table. */
  removeRow: (rowId: string) => void;
}

// ── localStorage helpers ──

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
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

/** Read the persisted capacity config from localStorage, returning null if absent or corrupt. */
function readPersistedConfig(): PersistedCapacityConfig | null {
  if (!canUseLocalStorage()) {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(CAPACITY_CONFIG_STORAGE_KEY);
    if (rawValue === null) {
      return null;
    }

    const parsedValue: unknown = JSON.parse(rawValue);
    return isPersistedCapacityConfig(parsedValue) ? parsedValue : null;
  } catch {
    // Corrupted storage — fall back to defaults.
    return null;
  }
}

/** Write the current capacity config to localStorage. */
function writePersistedConfig(config: PersistedCapacityConfig): void {
  if (!canUseLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(CAPACITY_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Storage write can fail in private-browsing modes; in-memory state remains authoritative.
  }
}

// ── Default state ──

const INITIAL_START_DATE = '';
const INITIAL_END_DATE = '';
const INITIAL_ROWS: CapacityRow[] = [];

function buildInitialState(): PersistedCapacityConfig {
  const persistedConfig = readPersistedConfig();
  if (persistedConfig !== null) {
    return persistedConfig;
  }

  return {
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
  ...buildInitialState(),

  setStartDate: (startDate) => {
    setState({ startDate });
    writePersistedConfig({ ...getState(), startDate });
  },

  setEndDate: (endDate) => {
    setState({ endDate });
    writePersistedConfig({ ...getState(), endDate });
  },

  addRow: (newRow) => {
    const updatedRows = [...getState().rows, newRow];
    setState({ rows: updatedRows });
    writePersistedConfig({ ...getState(), rows: updatedRows });
  },

  updateRow: (rowId, rowUpdates) => {
    const updatedRows = getState().rows.map((existingRow) =>
      existingRow.id === rowId ? { ...existingRow, ...rowUpdates } : existingRow,
    );
    setState({ rows: updatedRows });
    writePersistedConfig({ ...getState(), rows: updatedRows });
  },

  removeRow: (rowId) => {
    const updatedRows = getState().rows.filter((existingRow) => existingRow.id !== rowId);
    setState({ rows: updatedRows });
    writePersistedConfig({ ...getState(), rows: updatedRows });
  },
}));
