// useStandupPlanningStore.ts — Persisted daily standup planning store for Sprint and Roster person-walk workflows.

import { create } from 'zustand';

import { useSettingsStore } from '../../../store/settingsStore.ts';
import {
  buildTeamScopedStorageKey,
  readTeamScopedStorageValue,
  resolveTeamScopedStorageProfileId,
} from './teamScopedStorage.ts';

const STANDUP_PLANNING_STORAGE_KEY = 'tbxSprintDashboardStandupPlanning';
const MAX_STANDUP_PLAN_ENTRY_COUNT = 400;

export type StandupScopeMode = 'sprint' | 'roster';

export interface StandupPlanEntry {
  date: string;
  scopeMode: StandupScopeMode;
  projectKey: string;
  personName: string;
  plannedIssueKeys: string[];
  updatedAtIso: string;
}

interface PersistedStandupPlanningState {
  planEntries: StandupPlanEntry[];
}

interface StandupPlanningState extends PersistedStandupPlanningState {
  dashboardTeamProfileId: string;
  setDashboardTeamProfileId: (dashboardTeamProfileId: string) => void;
  setPlannedIssueKeys: (
    date: string,
    scopeMode: StandupScopeMode,
    projectKey: string,
    personName: string,
    plannedIssueKeys: string[],
  ) => void;
  togglePlannedIssueKey: (
    date: string,
    scopeMode: StandupScopeMode,
    projectKey: string,
    personName: string,
    issueKey: string,
  ) => void;
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function resolveDashboardTeamProfileId(dashboardTeamProfileId: string): string {
  return resolveTeamScopedStorageProfileId(dashboardTeamProfileId);
}

function buildStandupPlanningStorageKey(dashboardTeamProfileId: string): string {
  return buildTeamScopedStorageKey(STANDUP_PLANNING_STORAGE_KEY, dashboardTeamProfileId);
}

function normalizeProjectKey(projectKey: string): string {
  return projectKey.trim().toUpperCase();
}

function normalizePersonName(personName: string): string {
  return personName.trim();
}

function normalizePlannedIssueKeys(plannedIssueKeys: string[]): string[] {
  return [...new Set(plannedIssueKeys.map((issueKey) => issueKey.trim().toUpperCase()).filter(Boolean))];
}

function isStandupScopeMode(value: unknown): value is StandupScopeMode {
  return value === 'sprint' || value === 'roster';
}

function isStandupPlanEntry(value: unknown): value is StandupPlanEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.date === 'string' &&
    isStandupScopeMode(candidate.scopeMode) &&
    typeof candidate.projectKey === 'string' &&
    typeof candidate.personName === 'string' &&
    Array.isArray(candidate.plannedIssueKeys) &&
    candidate.plannedIssueKeys.every((issueKey) => typeof issueKey === 'string') &&
    typeof candidate.updatedAtIso === 'string'
  );
}

function readStoredStandupPlanEntries(dashboardTeamProfileId = ''): StandupPlanEntry[] {
  if (!canUseLocalStorage()) {
    return [];
  }

  try {
    const storedValue = readTeamScopedStorageValue(STANDUP_PLANNING_STORAGE_KEY, dashboardTeamProfileId);
    if (storedValue === null) {
      return [];
    }

    const parsedValue: unknown = JSON.parse(storedValue);
    if (typeof parsedValue !== 'object' || parsedValue === null) {
      return [];
    }

    const candidateEntries = (parsedValue as PersistedStandupPlanningState).planEntries;
    return Array.isArray(candidateEntries) ? candidateEntries.filter(isStandupPlanEntry) : [];
  } catch {
    return [];
  }
}

function writeStoredStandupPlanEntries(
  planEntries: StandupPlanEntry[],
  dashboardTeamProfileId: string,
): void {
  if (!canUseLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(
      buildStandupPlanningStorageKey(dashboardTeamProfileId),
      JSON.stringify({ planEntries }),
    );
  } catch {
    // Storage failures are non-fatal because the in-memory plan remains usable.
  }
}

function toggleIssueKey(plannedIssueKeys: string[], issueKey: string): string[] {
  const normalizedIssueKey = issueKey.trim().toUpperCase();
  return plannedIssueKeys.includes(normalizedIssueKey)
    ? plannedIssueKeys.filter((existingIssueKey) => existingIssueKey !== normalizedIssueKey)
    : [...plannedIssueKeys, normalizedIssueKey];
}

function upsertStandupPlanEntry(
  currentPlanEntries: StandupPlanEntry[],
  nextPlanEntry: Omit<StandupPlanEntry, 'updatedAtIso'>,
): StandupPlanEntry[] {
  const normalizedProjectKey = normalizeProjectKey(nextPlanEntry.projectKey);
  const normalizedPersonName = normalizePersonName(nextPlanEntry.personName);
  const normalizedIssueKeys = normalizePlannedIssueKeys(nextPlanEntry.plannedIssueKeys);
  const remainingPlanEntries = currentPlanEntries.filter(
    (planEntry) =>
      !(
        planEntry.date === nextPlanEntry.date &&
        planEntry.scopeMode === nextPlanEntry.scopeMode &&
        normalizeProjectKey(planEntry.projectKey) === normalizedProjectKey &&
        normalizePersonName(planEntry.personName) === normalizedPersonName
      ),
  );
  if (normalizedIssueKeys.length === 0) {
    return remainingPlanEntries;
  }

  const nextStoredEntry: StandupPlanEntry = {
    ...nextPlanEntry,
    projectKey: normalizedProjectKey,
    personName: normalizedPersonName,
    plannedIssueKeys: normalizedIssueKeys,
    updatedAtIso: new Date().toISOString(),
  };
  return [...remainingPlanEntries, nextStoredEntry]
    .sort((firstEntry, secondEntry) => firstEntry.updatedAtIso.localeCompare(secondEntry.updatedAtIso))
    .slice(-MAX_STANDUP_PLAN_ENTRY_COUNT);
}

/** Zustand store for persisted daily standup plans across Sprint and Roster scopes. */
export const useStandupPlanningStore = create<StandupPlanningState>((setState, getState) => ({
  dashboardTeamProfileId: resolveDashboardTeamProfileId(
    useSettingsStore.getState().sprintDashboardActiveTeamProfileId,
  ),
  planEntries: readStoredStandupPlanEntries(
    useSettingsStore.getState().sprintDashboardActiveTeamProfileId,
  ),
  setDashboardTeamProfileId: (dashboardTeamProfileId) => {
    const resolvedTeamProfileId = resolveDashboardTeamProfileId(dashboardTeamProfileId);
    setState({
      dashboardTeamProfileId: resolvedTeamProfileId,
      planEntries: readStoredStandupPlanEntries(resolvedTeamProfileId),
    });
  },
  setPlannedIssueKeys: (date, scopeMode, projectKey, personName, plannedIssueKeys) => {
    const planEntries = upsertStandupPlanEntry(getState().planEntries, {
      date,
      scopeMode,
      projectKey,
      personName,
      plannedIssueKeys,
    });
    setState({ planEntries });
    writeStoredStandupPlanEntries(planEntries, getState().dashboardTeamProfileId);
  },
  togglePlannedIssueKey: (date, scopeMode, projectKey, personName, issueKey) => {
    const currentEntry = getState().planEntries.find(
      (planEntry) =>
        planEntry.date === date &&
        planEntry.scopeMode === scopeMode &&
        normalizeProjectKey(planEntry.projectKey) === normalizeProjectKey(projectKey) &&
        normalizePersonName(planEntry.personName) === normalizePersonName(personName),
    );
    const plannedIssueKeys = toggleIssueKey(currentEntry?.plannedIssueKeys ?? [], issueKey);
    const planEntries = upsertStandupPlanEntry(getState().planEntries, {
      date,
      scopeMode,
      projectKey,
      personName,
      plannedIssueKeys,
    });
    setState({ planEntries });
    writeStoredStandupPlanEntries(planEntries, getState().dashboardTeamProfileId);
  },
}));
