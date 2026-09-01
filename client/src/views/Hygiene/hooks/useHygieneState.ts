// useHygieneState.ts — State and persistence for the Hygiene view.
//
// The hook owns the standalone Hygiene workflow: keep the user's project/filter
// choices across refreshes, run the SHARED hygiene scan (hygieneScan.ts — the same
// pipeline the Today dashboard's team cards count from), and compose the results
// into summary and drill-down state for the view.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSettingsStore } from '../../../store/settingsStore.ts';
import {
  readEnabledEnterpriseCheckDefinitions,
} from '../../AdminHub/enterpriseRules.ts';
import {
  resolveHygieneFieldConfig,
  summarizeHygieneFindings,
  type HygieneEvaluationContext,
  type HygieneFieldConfig,
  type HygieneFinding,
  type HygieneSummary,
} from '../checks/hygieneChecks.ts';
import { buildHygieneScopeJql, DEFAULT_ASSIGNEE_CLAUSE, rescanSingleHygieneIssue, runHygieneScan } from './hygieneScan.ts';
import type { HygieneCheckApplicability } from '../checks/hygieneEligibility.ts';

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
  /** The exact scope JQL the scan runs within; reused by the per-check "open in Jira" links (US2). */
  scopeJql: string;
  findings: HygieneFinding[];
  filteredFindings: HygieneFinding[];
  summary: HygieneSummary;
  selectedFilter: string | null;
  availableCheckIds: string[];
  checkLabelsById: Record<string, string>;
  /** Resolved Jira field-id lists so the inline fix controls can target the right custom fields. */
  fieldConfig: HygieneFieldConfig;
  /**
   * Per check, how many scanned issues it governs and whether its field exists on this instance.
   *
   * Empty before the first run. A tile reads its own denominator from here so a zero can say which
   * kind of zero it is — clean, inapplicable, or never checked at all.
   */
  checkApplicability: Record<string, HygieneCheckApplicability>;
  isLoading: boolean;
  loadError: string | null;
  /**
   * How many issues the last run actually scanned, or null before the first run. This is what
   * separates "N clean issues" from "the scope matched nothing" — without it, a broken scope
   * (wrong project key, PI value no issue carries) silently renders as a perfect score (GH #167).
   */
  scannedIssueCount: number | null;
  /** Everything in scope, whether or not it was scanned; null before the first run. */
  totalMatchingCount: number | null;
  /** True when the scan hit its ceiling, so every count on screen is a floor. */
  isTruncated: boolean;
  /** Standalone-only: search across every project the user is assigned in, matching the Today card. */
  isAllProjectsScope: boolean;
  /**
   * True when the scan was narrowed to the viewer's OWN issues rather than the whole project.
   *
   * The standalone Hygiene tab has always applied `assignee = currentUser()` and never said so, so
   * "ENCUC · 12 scanned" read as "this project has twelve open issues" instead of "twelve of them
   * are yours". A screen that misstates its own scope by an order of magnitude cannot be trusted on
   * anything else it says (GH #377).
   */
  isPersonalScope: boolean;
  /** Standalone-only: audit every issue in the project, not just the viewer's own. */
  isWholeProjectScope: boolean;
}

export interface HygieneActions {
  setProjectKey: (projectKey: string) => void;
  setExtraJql: (extraJql: string) => void;
  selectFilter: (checkId: string | null) => void;
  setAllProjectsScope: (isAllProjects: boolean) => void;
  setWholeProjectScope: (isWholeProject: boolean) => void;
  loadHygiene: () => Promise<void>;
  /**
   * Re-checks ONE issue after a fix and updates just its row — or drops the row when it comes back
   * clean. Costs one Jira request instead of re-scanning the whole board and redrawing the page.
   */
  refreshIssue: (issueKey: string) => Promise<void>;
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
  /**
   * The assignee JQL clause for standalone (non-team) scope. Defaults to `assignee = currentUser()`; the
   * My Issues surface passes a persona clause here so the Hygiene tab follows the tool-wide "simulate as"
   * subject. Ignored in team mode (which drops the assignee filter to audit the whole team).
   */
  assigneeClause?: string;
}

/** Owns Hygiene view state and actions so the render layer can stay declarative. */
export function useHygieneState(options: useHygieneStateOptions = {}): HygieneState & HygieneActions {
  const {
    isTeamMode = false,
    initialExtraJql = '',
    projectKey: controlledProjectKey,
    initialAllProjects = false,
    initialSelectedFilter,
    assigneeClause: personalAssigneeClause = DEFAULT_ASSIGNEE_CLAUSE,
  } = options;
  // When the team dashboard supplies a project key, that prop is authoritative; the standalone
  // view falls back to the user's persisted key. This flag drives both seeding and persistence.
  const isProjectKeyControlled = controlledProjectKey !== undefined;
  // Read the active sprint-dashboard team profile so the story-points field lookup uses the right config slot.
  const activeDashboardTeamProfileId = useSettingsStore(
    (storeState) => storeState.sprintDashboardActiveTeamProfileId,
  );
  // The standalone view owns an editable, persisted project key.
  const [standaloneProjectKey, setStandaloneProjectKey] = useState<string>(() => readStoredProjectKey());
  // In team mode the supplied prop seeds the field and follows the active team, but the user can still
  // type a different key to audit another project ad-hoc. That edit lives in a local override (null means
  // "use the team's key"); the override is cleared whenever the team-supplied key changes, so switching
  // teams re-scopes to the new team rather than replaying the previous team's manual override.
  const [teamProjectKeyOverride, setTeamProjectKeyOverride] = useState<string | null>(null);
  useEffect(() => {
    setTeamProjectKeyOverride(null);
  }, [controlledProjectKey]);
  const projectKey = isProjectKeyControlled
    ? (teamProjectKeyOverride ?? controlledProjectKey)
    : standaloneProjectKey;
  const [extraJql, setExtraJql] = useState<string>(initialExtraJql);
  const [findings, setFindings] = useState<HygieneFinding[]>([]);
  // "All my projects" is a standalone-only scope: team mode audits one team's project, and an
  // unscoped team query (no project, no assignee) would scan the whole instance.
  const [isAllProjectsScope, setAllProjectsScope] = useState<boolean>(initialAllProjects && !isTeamMode);
  // Standalone only. The tab has always audited the viewer's OWN issues, which is the right default
  // for a personal surface and the wrong one for "is project ENCUC healthy?" — a question people
  // were asking it by typing a project key. Offering the wider scope is what stops the answer having
  // to be re-derived in Jira (GH #377).
  const [isWholeProjectScope, setWholeProjectScope] = useState<boolean>(false);
  const [scannedIssueCount, setScannedIssueCount] = useState<number | null>(null);
  // Kept beside the scanned count because the pair is the honest statement: "200 of 240 scanned"
  // means something a bare "200 scanned" does not.
  const [totalMatchingCount, setTotalMatchingCount] = useState<number | null>(null);
  const [isTruncated, setIsTruncated] = useState<boolean>(false);
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
  const [checkApplicability, setCheckApplicability] = useState<Record<string, HygieneCheckApplicability>>({});
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // How the LAST scan evaluated, kept in a ref so a single-issue re-check is judged by exactly the
  // same rules as the rows beside it. A ref rather than state: nothing renders from it, and putting
  // it in state would re-render every row each time a scan finished.
  const lastScanEvaluationRef = useRef<{
    evaluationContext: HygieneEvaluationContext;
    requestedFields: string[];
  } | null>(null);

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
      setCheckApplicability({});
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
        assigneeClause: isTeamMode || isWholeProjectScope ? null : personalAssigneeClause,
        activeTeamProfileId: activeDashboardTeamProfileId,
      });

      setFieldConfig(scanOutcome.fieldConfig);
      setCheckApplicability(scanOutcome.checkApplicability);
      setAvailableCheckIds(scanOutcome.enabledCheckDefinitions.map((checkDefinition) => checkDefinition.checkId));
      setCheckLabelsById(buildCheckLabelsById(scanOutcome.enabledCheckDefinitions));
      setScannedIssueCount(scanOutcome.scannedIssueCount);
      setTotalMatchingCount(scanOutcome.totalMatchingCount);
      setIsTruncated(scanOutcome.isTruncated);
      setFindings(scanOutcome.findings);
      lastScanEvaluationRef.current = {
        evaluationContext: scanOutcome.evaluationContext,
        requestedFields: scanOutcome.requestedFields,
      };
    } catch (caughtError: unknown) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : 'Failed to load Hygiene results';
      setLoadError(errorMessage);
      setFindings([]);
      setScannedIssueCount(null);
    } finally {
      setIsLoading(false);
    }
  }, [activeDashboardTeamProfileId, extraJql, isAllProjectsScope, isTeamMode, isWholeProjectScope, projectKey, personalAssigneeClause]);

  /**
   * Re-checks one issue after a fix, and touches nothing else.
   *
   * The old behaviour was a full re-scan for every single field written: hundreds of issues, several
   * seconds, and the entire page redrawn — so the user's next click landed on a screen still
   * rebuilding itself. This reads the one issue that changed and swaps its row.
   *
   * It re-reads rather than assuming: a date write can clear two flags at once or leave a new
   * mismatch, so guessing would let the row drift from what a real scan says. If the re-read fails
   * for any reason it falls back to the full scan — a stale row is the one outcome worth a redraw.
   */
  const refreshIssue = useCallback(async (issueKey: string): Promise<void> => {
    const lastScanEvaluation = lastScanEvaluationRef.current;
    if (lastScanEvaluation === null) {
      await loadHygiene();
      return;
    }

    try {
      const refreshedFinding = await rescanSingleHygieneIssue(
        issueKey,
        lastScanEvaluation.evaluationContext,
        lastScanEvaluation.requestedFields,
      );
      setFindings((currentFindings) => replaceOrDropFinding(currentFindings, issueKey, refreshedFinding));
    } catch {
      await loadHygiene();
    }
  }, [loadHygiene]);

  // The exact scope JQL the scan runs within — exposed so the per-check "open in Jira" links (GH #200 US2)
  // reuse the SAME scope as the count (agree by construction).
  const scopeJql = buildHygieneScopeJql(
    isAllProjectsScope ? '' : projectKey.trim(),
    extraJql,
    isTeamMode || isWholeProjectScope ? null : personalAssigneeClause,
  );

  return {
    projectKey,
    extraJql,
    scopeJql,
    findings,
    filteredFindings,
    summary,
    selectedFilter,
    availableCheckIds,
    checkLabelsById,
    fieldConfig,
    checkApplicability,
    isLoading,
    loadError,
    scannedIssueCount,
    totalMatchingCount,
    isTruncated,
    isAllProjectsScope,
    isPersonalScope: !isTeamMode && !isWholeProjectScope && Boolean(personalAssigneeClause.trim()),
    isWholeProjectScope,
    setProjectKey: isProjectKeyControlled
      ? (nextProjectKey: string) => setTeamProjectKeyOverride(nextProjectKey)
      : setStandaloneProjectKey,
    setExtraJql,
    selectFilter,
    setAllProjectsScope,
    setWholeProjectScope,
    loadHygiene,
    refreshIssue,
  };
}

/**
 * Swaps one issue's row for its re-checked self, or removes it when it came back clean.
 *
 * Pure and separate because it is the whole behaviour the user actually sees: the fixed row
 * disappears and the ones around it stay exactly where they were. Order is preserved rather than
 * rebuilt — a row that jumps has cost the reader their place just as surely as a full redraw.
 *
 * An issue that was never in the list is not added by a refresh. The list is the last scan's scope,
 * and quietly inserting a row nobody scanned would make the counts beside it wrong.
 */
export function replaceOrDropFinding(
  currentFindings: readonly HygieneFinding[],
  issueKey: string,
  refreshedFinding: HygieneFinding | null,
): HygieneFinding[] {
  if (refreshedFinding === null) {
    return currentFindings.filter((finding) => finding.issue.key !== issueKey);
  }
  return currentFindings.map((finding) => (finding.issue.key === issueKey ? refreshedFinding : finding));
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
