// useDashboardConfig.ts — Advanced Sprint Dashboard settings hook, persisted to localStorage.
//
// Implements the eight config fields from the legacy sd-cfg-* DOM inputs (07-sprint-dashboard.js lines 31–48).
// All values are serialised as one JSON blob under tbxSprintDashboardConfig so a single
// localStorage.getItem reads the whole config in one shot.

import { useCallback, useMemo, useState } from 'react';

import {
  buildTeamScopedStorageKey,
  readTeamScopedStorageValue,
} from './teamScopedStorage.ts';

// ── Storage key & defaults ──

const DASHBOARD_CONFIG_STORAGE_KEY = 'tbxSprintDashboardConfig';

const DEFAULT_STALE_DAYS_THRESHOLD = 5;
const DEFAULT_STORY_POINT_SCALE = '1,2,3,5,8,13,21';
const DEFAULT_SPRINT_WINDOW = 6;
const DEFAULT_KANBAN_PERIOD_DAYS = 14;
const DEFAULT_CYCLE_TIME_BASELINE_DAYS = 0;
const DEFAULT_CUSTOM_STORY_POINTS_FIELD_ID = 'story_points';
const DEFAULT_SPRINT_POINT_CAPACITY = 20;
const DEFAULT_CUSTOM_EPIC_LINK_FIELD_ID = 'epic_link';
const DEFAULT_RISK_IMPACT_DATE_FIELD_ID = '';
const DEFAULT_RISK_RESPONSE_FIELD_ID = '';

// ── Public types ──

/** All configurable dashboard settings. Every field maps to one legacy sd-cfg-* input. */
export interface DashboardConfig {
  /** Issues not updated within this many days are highlighted as stale. */
  staleDaysThreshold: number;
  /** Comma-separated Fibonacci values used to warn about off-scale estimates. */
  storyPointScale: string;
  /** Number of past sprints to include in velocity trend calculations. */
  sprintWindow: number;
  /** Jira status name that marks the start of the cycle-time clock (e.g. "In Progress"). */
  cycleTimeStartField: string;
  /** Jira status name that marks the end of the cycle-time clock (e.g. "Done"). */
  cycleTimeDoneField: string;
  /** Baseline cycle time in days used to measure improvement against the legacy 20% goal. */
  cycleTimeBaselineDays: number;
  /** Rolling window in days for Kanban throughput calculations. */
  kanbanPeriodDays: number;
  /** Jira custom field ID used for story points (fallback when customfield_10016 is absent). */
  customStoryPointsFieldId: string;
  /** Story-point capacity of one sprint, used as the Feature Canvas sprint-box budget. */
  sprintPointCapacity: number;
  /** Jira custom field ID used for the epic link. */
  customEpicLinkFieldId: string;
  /** Jira custom field ID for Risk Impact Date on Risk issue types. */
  riskImpactDateFieldId: string;
  /** Jira custom field ID for the Risk Response / ROAM disposition field on Risk issue types. */
  riskResponseFieldId: string;
}

export interface DashboardConfigActions {
  updateConfig(partialUpdate: Partial<DashboardConfig>): void;
  resetConfig(): void;
}

// ── Default config ──

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  staleDaysThreshold: DEFAULT_STALE_DAYS_THRESHOLD,
  storyPointScale: DEFAULT_STORY_POINT_SCALE,
  sprintWindow: DEFAULT_SPRINT_WINDOW,
  cycleTimeStartField: '',
  cycleTimeDoneField: '',
  cycleTimeBaselineDays: DEFAULT_CYCLE_TIME_BASELINE_DAYS,
  kanbanPeriodDays: DEFAULT_KANBAN_PERIOD_DAYS,
  customStoryPointsFieldId: DEFAULT_CUSTOM_STORY_POINTS_FIELD_ID,
  sprintPointCapacity: DEFAULT_SPRINT_POINT_CAPACITY,
  customEpicLinkFieldId: DEFAULT_CUSTOM_EPIC_LINK_FIELD_ID,
  riskImpactDateFieldId: DEFAULT_RISK_IMPACT_DATE_FIELD_ID,
  riskResponseFieldId: DEFAULT_RISK_RESPONSE_FIELD_ID,
};

// ── Storage helpers ──

/** Reads the config blob from localStorage, merging with defaults so new fields never go missing. */
function buildDashboardConfigStorageKey(dashboardTeamProfileId: string): string {
  return buildTeamScopedStorageKey(DASHBOARD_CONFIG_STORAGE_KEY, dashboardTeamProfileId);
}

/** Reads the config blob from localStorage, merging with defaults so new fields never go missing. */
export function loadDashboardConfigFromStorage(
  dashboardTeamProfileId = '',
): DashboardConfig {
  try {
    const stored = readTeamScopedStorageValue(DASHBOARD_CONFIG_STORAGE_KEY, dashboardTeamProfileId);
    if (!stored) return { ...DEFAULT_DASHBOARD_CONFIG };
    return { ...DEFAULT_DASHBOARD_CONFIG, ...(JSON.parse(stored) as Partial<DashboardConfig>) };
  } catch {
    return { ...DEFAULT_DASHBOARD_CONFIG };
  }
}

/** Serialises the config blob to localStorage; swallows write failures silently. */
export function saveDashboardConfigToStorage(
  config: DashboardConfig,
  dashboardTeamProfileId = '',
): void {
  try {
    localStorage.setItem(
      buildDashboardConfigStorageKey(dashboardTeamProfileId),
      JSON.stringify(config),
    );
  } catch {
    // localStorage may be unavailable in private-browsing mode; ignore.
  }
}

// ── Hook ──

/**
 * Manages the persisted Sprint Dashboard settings used by the legacy Team Dashboard parity tabs.
 * Reads from localStorage on mount and writes back on every update.
 * Returns a stable `{ config, actions }` tuple.
 */
export function useDashboardConfig(
  dashboardTeamProfileId = '',
): { config: DashboardConfig; actions: DashboardConfigActions } {
  const [configVersion, setConfigVersion] = useState(0);
  const config = useMemo(
    () => {
      void configVersion;
      return loadDashboardConfigFromStorage(dashboardTeamProfileId);
    },
    [configVersion, dashboardTeamProfileId],
  );

  const updateConfig = useCallback((partialUpdate: Partial<DashboardConfig>) => {
    const nextConfig = {
      ...loadDashboardConfigFromStorage(dashboardTeamProfileId),
      ...partialUpdate,
    };
    saveDashboardConfigToStorage(nextConfig, dashboardTeamProfileId);
    setConfigVersion((previousVersion) => previousVersion + 1);
  }, [dashboardTeamProfileId]);

  const resetConfig = useCallback(() => {
    const freshConfig = { ...DEFAULT_DASHBOARD_CONFIG };
    saveDashboardConfigToStorage(freshConfig, dashboardTeamProfileId);
    setConfigVersion((previousVersion) => previousVersion + 1);
  }, [dashboardTeamProfileId]);

  const actions = useMemo<DashboardConfigActions>(
    () => ({ updateConfig, resetConfig }),
    [updateConfig, resetConfig],
  );

  return { config, actions };
}
