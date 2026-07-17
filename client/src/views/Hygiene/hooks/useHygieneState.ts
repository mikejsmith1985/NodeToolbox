// useHygieneState.ts — State and persistence for the Hygiene view.
//
// The hook owns the standalone Hygiene workflow: keep the user's project/filter
// choices across refreshes, run the SHARED hygiene scan (hygieneScan.ts — the same
// pipeline the Today dashboard's team cards count from), and compose the results
// into summary and drill-down state for the view.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useSettingsStore } from '../../../store/settingsStore.ts';
import {
  readEnabledEnterpriseCheckDefinitions,
} from '../../AdminHub/enterpriseRules.ts';
import {
  resolveHygieneFieldConfig,
  summarizeHygieneFindings,
  type HygieneFieldConfig,
  type HygieneFinding,
  type HygieneSummary,
} from '../checks/hygieneChecks.ts';
import { DEFAULT_ASSIGNEE_CLAUSE, runHygieneScan } from './hygieneScan.ts';

// The scan pipeline moved to hygieneScan.ts so the Today dashboard can run the exact same scan;
// these re-exports keep every existing import of this module working unchanged.
export {
  buildHygieneSearchPath,
  mapJiraIssueToHygieneFinding,
  readProgramIncrementValue,
  type JiraSearchResponse,
} from './hygieneScan.ts';

const EMPTY_FILTER = null;

export const HYGIENE_PROJECT_KEY_STORAGE_KEY = 'tbxHygieneProjectKey';
export const HYGIENE_FILTER_STORAGE_KEY = 'tbxHygieneFilter';

/**
 * Splits a check filter into its individual check ids. A filter is usually one check id, but a
 * deep link may carry several comma-separated ids (the Today "commitment gaps" card counts
 * 'missing-sp' OR 'no-ac', so its drill-through must show issues matching either check).
 */
export function parseHygieneFilterCheckIds(selectedFilter: string | null): string[] {
  if (selectedFilter === null) return [];
  return selectedFilter
    .split(',')
    .map((checkId) => checkId.trim())
    .filter((checkId) => checkId !== '');
}

export interface HygieneState {
  projectKey: string;
  extraJql: string;
  findings: HygieneFinding[];
  filteredFindings: HygieneFinding[];
  summary: HygieneSummary;
  selectedFilter: string | null;
  availableCheckIds: string[];
  checkLabelsById: Record<string, string>;
  /** Resolved Jira field-id lists so the inline fix controls can target the right custom fields. */
  fieldConfig: HygieneFieldConfig;
  isLoading: boolean;
  loadError: string | null;
  /**
   * How many issues the last run actually scanned, or null before the first run. This is what
   * separates "N clean issues" from "the scope matched nothing" — without it, a broken scope
   * (wrong project key, PI value no issue carries) silently renders as a perfect score (GH #167).
   */
  scannedIssueCount: number | null;
  /** Standalone-only: search across every project the user is assigned in, matching the Today card. */
  isAllProjectsScope: boolean;
}

export interface HygieneActions {
  setProjectKey: (projectKey: string) => void;
  setExtraJql: (extraJql: string) => void;
  selectFilter: (checkId: string | null) => void;
  setAllProjectsScope: (isAllProjects: boolean) => void;
  loadHygiene: () => Promise<void>;
}

export interface useHygieneStateOptions {
  isTeamMode?: boolean;
  /** Pre-populated extra JQL clause (e.g. a PI or sprint scope from the Sprint Dashboard). */
  initialExtraJql?: string;
  /**
   * Team-supplied project key. When provided (team mode), it is the authoritative source
   * of truth and overrides the localStorage seed — this prevents the embedded Hygiene tab
   * from showing a previous team's data after the user switches teams.
   */
  projectKey?: string;
  /**
   * Start in the "All my projects" scope (standalone only; ignored in team mode). Set when the
   * Today tab's cross-project cards deep-link here, so the drill-through shows exactly the
   * issues the card counted instead of whatever single project key was last persisted.
   */
  initialAllProjects?: boolean;
  /** Preselect one check filter on arrival (e.g. 'stale' from the "My stale issues" card). */
  initialSelectedFilter?: string;
}

/** Owns Hygiene view state and actions so the render layer can stay declarative. */
export function useHygieneState(options: useHygieneStateOptions = {}): HygieneState & HygieneActions {
  const {
    isTeamMode = false,
    initialExtraJql = '',
    projectKey: controlledProjectKey,
    initialAllProjects = false,
    initialSelectedFilter,
  } = options;
  // When the team dashboard supplies a project key, that prop is authoritative; the standalone
  // view falls back to the user's persisted key. This flag drives both seeding and persistence.
  const isProjectKeyControlled = controlledProjectKey !== undefined;
  // Read the active sprint-dashboard team profile so the story-points field lookup uses the right config slot.
  const activeDashboardTeamProfileId = useSettingsStore(
    (storeState) => storeState.sprintDashboardActiveTeamProfileId,
  );
  // The standalone view owns an editable, persisted project key. In team mode the supplied prop
  // is the single source of truth (derived below) and follows the active team, so switching teams
  // immediately re-scopes Hygiene rather than replaying a previous team from localStorage.
  const [standaloneProjectKey, setStandaloneProjectKey] = useState<string>(() => readStoredProjectKey());
  const projectKey = isProjectKeyControlled ? controlledProjectKey : standaloneProjectKey;
  const [extraJql, setExtraJql] = useState<string>(initialExtraJql);
  const [findings, setFindings] = useState<HygieneFinding[]>([]);
  // "All my projects" is a standalone-only scope: team mode audits one team's project, and an
  // unscoped team query (no project, no assignee) would scan the whole instance.
  const [isAllProjectsScope, setAllProjectsScope] = useState<boolean>(initialAllProjects && !isTeamMode);
  const [scannedIssueCount, setScannedIssueCount] = useState<number | null>(null);
  // A deep-linked filter (e.g. 'stale' from the Today card) outranks the persisted one — the user
  // arrived asking a specific question, and the answer must not be filtered by last week's choice.
  const [selectedFilter, setSelectedFilter] = useState<string | null>(
    () => initialSelectedFilter ?? readStoredFilter(),
  );
  const [availableCheckIds, setAvailableCheckIds] = useState<string[]>(() => readEnabledEnterpriseCheckDefinitions().map((checkDefinition) => checkDefinition.checkId));
  const [checkLabelsById, setCheckLabelsById] = useState<Record<string, string>>(() => buildCheckLabelsById(readEnabledEnterpriseCheckDefinitions()));
  // The resolved field config powers the inline fix controls; it starts at defaults and is replaced
  // with the Jira-name-resolved config once a Hygiene load completes.
  const [fieldConfig, setFieldConfig] = useState<HygieneFieldConfig>(() => resolveHygieneFieldConfig());
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    // Only the standalone view persists the project key. Persisting the team-supplied key would
    // pollute the standalone view's saved project and reintroduce the cross-team staleness bug.
    if (isProjectKeyControlled) {
      return;
    }
    window.localStorage.setItem(HYGIENE_PROJECT_KEY_STORAGE_KEY, standaloneProjectKey);
  }, [isProjectKeyControlled, standaloneProjectKey]);

  useEffect(() => {
    if (selectedFilter === null) {
      window.localStorage.removeItem(HYGIENE_FILTER_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(HYGIENE_FILTER_STORAGE_KEY, selectedFilter);
  }, [selectedFilter]);

  const summary = useMemo(() => summarizeHygieneFindings(findings, availableCheckIds), [availableCheckIds, findings]);
  const filteredFindings = useMemo(
    () => filterFindingsByCheck(findings, selectedFilter),
    [findings, selectedFilter],
  );

  const selectFilter = useCallback((checkId: string | null) => {
    setSelectedFilter((currentFilter) => (currentFilter === checkId ? EMPTY_FILTER : checkId));
  }, []);

  const loadHygiene = useCallback(async () => {
    // In the all-projects scope the project clause is dropped entirely; otherwise a key is required.
    const normalizedProjectKey = isAllProjectsScope ? '' : projectKey.trim();
    if (!normalizedProjectKey && !isAllProjectsScope) {
      setFindings([]);
      setScannedIssueCount(null);
      setLoadError(null);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      // In team mode Hygiene must audit every in-scope issue, matching the dashboard's issue list
      // (which is not assignee-filtered). A null clause drops the assignee filter so unassigned and
      // teammate-owned stale issues surface here too. Standalone mode stays scoped to the current user.
      const scanOutcome = await runHygieneScan({
        projectKey: normalizedProjectKey,
        extraJql,
        assigneeClause: isTeamMode ? null : DEFAULT_ASSIGNEE_CLAUSE,
        activeTeamProfileId: activeDashboardTeamProfileId,
      });

      setFieldConfig(scanOutcome.fieldConfig);
      setAvailableCheckIds(scanOutcome.enabledCheckDefinitions.map((checkDefinition) => checkDefinition.checkId));
      setCheckLabelsById(buildCheckLabelsById(scanOutcome.enabledCheckDefinitions));
      setScannedIssueCount(scanOutcome.scannedIssueCount);
      setFindings(scanOutcome.findings);
    } catch (caughtError: unknown) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : 'Failed to load Hygiene results';
      setLoadError(errorMessage);
      setFindings([]);
      setScannedIssueCount(null);
    } finally {
      setIsLoading(false);
    }
  }, [activeDashboardTeamProfileId, extraJql, isAllProjectsScope, isTeamMode, projectKey]);

  return {
    projectKey,
    extraJql,
    findings,
    filteredFindings,
    summary,
    selectedFilter,
    availableCheckIds,
    checkLabelsById,
    fieldConfig,
    isLoading,
    loadError,
    scannedIssueCount,
    isAllProjectsScope,
    setProjectKey: setStandaloneProjectKey,
    setExtraJql,
    selectFilter,
    setAllProjectsScope,
    loadHygiene,
  };
}

function filterFindingsByCheck(findings: HygieneFinding[], selectedFilter: string | null): HygieneFinding[] {
  const filterCheckIds = parseHygieneFilterCheckIds(selectedFilter);
  if (filterCheckIds.length === 0) return findings;
  return findings.filter((finding) => finding.flags.some((flag) => filterCheckIds.includes(flag.checkId)));
}

function readStoredProjectKey(): string {
  return window.localStorage.getItem(HYGIENE_PROJECT_KEY_STORAGE_KEY) ?? '';
}

function readStoredFilter(): string | null {
  const storedFilter = window.localStorage.getItem(HYGIENE_FILTER_STORAGE_KEY);
  return storedFilter && storedFilter.trim() !== '' ? storedFilter : null;
}

function buildCheckLabelsById(checkDefinitions: Array<{ checkId: string; label: string }>): Record<string, string> {
  return checkDefinitions.reduce<Record<string, string>>(
    (labelLookup, checkDefinition) => ({ ...labelLookup, [checkDefinition.checkId]: checkDefinition.label }),
    {},
  );
}
