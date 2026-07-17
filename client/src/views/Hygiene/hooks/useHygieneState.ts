// useHygieneState.ts — State, persistence, and Jira loading for the Hygiene view.
//
// The hook owns the standalone Hygiene workflow: keep the user's project/filter
// choices across refreshes, run one Jira search through the existing proxy helper,
// and compose the pure health checks into summary and drill-down state for the view.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import { buildJqlFieldReference, loadHygieneFieldConfig } from '../checks/hygieneFieldConfig.ts';
import {
  loadEnterpriseRulesFromStorage,
  readEnabledBuiltInCheckIds,
  readEnabledEnterpriseCheckDefinitions,
  readEnabledRequiredFieldRules,
} from '../../AdminHub/enterpriseRules.ts';
import { loadDashboardConfigFromStorage } from '../../SprintDashboard/hooks/useDashboardConfig.ts';
import { useSettingsStore } from '../../../store/settingsStore.ts';
import {
  evaluateHygieneIssue,
  isFeatureLikeIssue,
  resolveHygieneFieldConfig,
  summarizeHygieneFindings,
  type HygieneEvaluationContext,
  type HygieneFieldConfig,
  type HygieneFinding,
  type HygieneSummary,
  type JiraIssue,
} from '../checks/hygieneChecks.ts';

const BASE_HYGIENE_FIELDS = [
  'summary',
  'status',
  'assignee',
  'issuetype',
  'priority',
  'created',
  'updated',
  'description',
  'customfield_10028',
  'customfield_10016',
  'customfield_10020',
  'duedate',
  'fixVersions',
  'parent',
];
const HYGIENE_MAX_RESULTS = 200;
const DEFAULT_ASSIGNEE_CLAUSE = 'assignee = currentUser()';
const EMPTY_FILTER = null;
const MODERN_STORY_POINTS_FIELD = 'customfield_10028';
const LEGACY_STORY_POINTS_FIELD = 'customfield_10016';

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

export interface JiraSearchResponse {
  issues?: JiraIssue[];
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

/**
 * Builds the single Jira search URL required by the Hygiene view.
 *
 * `assigneeClause` may be null/empty to scope the search to every in-scope issue
 * regardless of who it is assigned to — the team-mode behaviour, which keeps Hygiene
 * aligned with the dashboard's issue list (the dashboard is not assignee-filtered).
 *
 * `projectKey` may be empty for the "All my projects" scope: the project clause is
 * dropped so the search matches the Today tab's cross-project personal count. That
 * scope is only ever used with the assignee clause, which keeps the query bounded.
 */
export function buildHygieneSearchPath(
  projectKey: string,
  extraJql: string,
  requestedFields: string[] = BASE_HYGIENE_FIELDS,
  assigneeClause: string | null = DEFAULT_ASSIGNEE_CLAUSE,
): string {
  const normalizedProjectKey = projectKey.trim().toUpperCase();
  const extraJqlClause = extraJql.trim();
  const assigneeFilter = assigneeClause && assigneeClause.trim() ? ` AND ${assigneeClause.trim()}` : '';
  const projectClause = normalizedProjectKey ? `project=${normalizedProjectKey} AND ` : '';
  const jqlText = `${projectClause}statusCategory != Done${assigneeFilter}${extraJqlClause ? ` ${extraJqlClause}` : ''}`;
  return `/rest/api/2/search?jql=${encodeURIComponent(jqlText)}&fields=${encodeURIComponent(buildUniqueFieldIds(requestedFields).join(','))}&maxResults=${HYGIENE_MAX_RESULTS}`;
}

/** Converts a Jira issue into a finding, returning only issues that violate at least one Hygiene check. */
export function mapJiraIssueToHygieneFinding(
  issue: JiraIssue,
  evaluationContext: HygieneEvaluationContext = {},
): HygieneFinding | null {
  const flags = evaluateHygieneIssue(issue, evaluationContext);
  if (flags.length === 0) {
    return null;
  }
  const programIncrement = readProgramIncrementValue(issue, evaluationContext.fieldConfig);
  return { issue, flags, programIncrement };
}

export function readProgramIncrementValue(issue: JiraIssue, fieldConfig?: Partial<HygieneFieldConfig>): string | null {
  if (!fieldConfig?.programIncrementFieldIds) {
    return null;
  }
  for (const fieldId of fieldConfig.programIncrementFieldIds) {
    const value = issue.fields[fieldId];
    if (value !== null && value !== undefined) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) return trimmed;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string') {
            const trimmed = item.trim();
            if (trimmed) return trimmed;
          }
          if (item && typeof item === 'object') {
            const piObj = item as { value?: string; name?: string };
            const name = piObj.name?.trim() || piObj.value?.trim();
            if (name) return name;
          }
        }
      }
      if (value && typeof value === 'object') {
        const piObj = value as { value?: string; name?: string };
        const name = piObj.name?.trim() || piObj.value?.trim();
        if (name) return name;
      }
    }
  }
  return null;
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
      const enterpriseRules = loadEnterpriseRulesFromStorage();
      const enabledCheckDefinitions = readEnabledEnterpriseCheckDefinitions(enterpriseRules);
      const enabledCustomRules = readEnabledRequiredFieldRules(enterpriseRules);
      const enabledBuiltInCheckIds = readEnabledBuiltInCheckIds(enterpriseRules);
      const hygieneFieldConfig = await loadHygieneFieldConfig();
      setFieldConfig(hygieneFieldConfig);
      setAvailableCheckIds(enabledCheckDefinitions.map((checkDefinition) => checkDefinition.checkId));
      setCheckLabelsById(buildCheckLabelsById(enabledCheckDefinitions));

      // In team mode Hygiene must audit every in-scope issue, matching the dashboard's issue list
      // (which is not assignee-filtered). A null clause drops the assignee filter so unassigned and
      // teammate-owned stale issues surface here too. Standalone mode stays scoped to the current user.
      const assigneeClause = isTeamMode ? null : DEFAULT_ASSIGNEE_CLAUSE;

      // Read the team's configured story-points field so the missing-SP check uses the right field.
      // Pass the active team profile ID so we read the correct team-scoped storage slot.
      const dashboardConfig = loadDashboardConfigFromStorage(activeDashboardTeamProfileId);
      const customStoryPointsFieldId = dashboardConfig.customStoryPointsFieldId || '';
      // Use the same stale threshold the Blockers tab uses so both surfaces agree on which
      // in-progress issues are stale (previously Hygiene hard-coded 14 days and under-counted).
      const staleDaysThreshold = dashboardConfig.staleDaysThreshold;

      const jiraSearchResponse = await jiraGet<JiraSearchResponse>(
        buildHygieneSearchPath(
          normalizedProjectKey,
          extraJql,
          buildRequestedHygieneFields(hygieneFieldConfig, enabledCustomRules, customStoryPointsFieldId),
          assigneeClause,
        ),
      );
      const loadedIssues = jiraSearchResponse.issues ?? [];
      // The child-story rollup is a SECONDARY query over instance-matched fields; a surprise on it
      // (an unexpected 400, a permission gap) must not take down the whole run. On failure the
      // missing-pointed-child-story check is skipped for this run — an empty rollup set would
      // instead flag every Feature as unpointed, which is worse than saying nothing (GH #167).
      let featureKeysWithPointedStories = new Set<string>();
      let runCheckIds = enabledBuiltInCheckIds;
      try {
        featureKeysWithPointedStories = await loadFeatureKeysWithPointedStories(loadedIssues, hygieneFieldConfig, customStoryPointsFieldId);
      } catch {
        runCheckIds = new Set([...enabledBuiltInCheckIds].filter((checkId) => checkId !== 'missing-child-story-points'));
      }
      setScannedIssueCount(loadedIssues.length);
      setFindings(mapIssuesToFindings(loadedIssues, {
        customRules: enabledCustomRules,
        enabledBuiltInCheckIds: runCheckIds,
        fieldConfig: hygieneFieldConfig,
        featureKeysWithPointedStories,
        customStoryPointsFieldId,
        staleDaysThreshold,
      }));
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

function mapIssuesToFindings(issues: JiraIssue[], evaluationContext: HygieneEvaluationContext): HygieneFinding[] {
  return issues
    .map((issue) => mapJiraIssueToHygieneFinding(issue, evaluationContext))
    .filter((finding): finding is HygieneFinding => finding !== null);
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

function buildUniqueFieldIds(fieldIds: readonly string[]): string[] {
  return Array.from(new Set(fieldIds.filter(Boolean)));
}

function buildRequestedHygieneFields(
  fieldConfig: HygieneFieldConfig,
  customRules = readEnabledRequiredFieldRules(),
  customStoryPointsFieldId = '',
): string[] {
  return buildUniqueFieldIds([
    ...BASE_HYGIENE_FIELDS,
    ...(customStoryPointsFieldId ? [customStoryPointsFieldId] : []),
    ...customRules.map((customRule) => customRule.fieldId),
    ...fieldConfig.acceptanceCriteriaFieldIds,
    ...fieldConfig.applicationFieldIds,
    ...fieldConfig.featureLinkFieldIds,
    ...fieldConfig.initiativeTypeFieldIds,
    ...fieldConfig.parentLinkFieldIds.filter((fieldId) => fieldId !== 'parent'),
    ...fieldConfig.productOwnerFieldIds,
    ...fieldConfig.programIncrementFieldIds,
    ...fieldConfig.targetStartFieldIds,
    ...fieldConfig.targetEndFieldIds,
  ]);
}

function buildCheckLabelsById(checkDefinitions: Array<{ checkId: string; label: string }>): Record<string, string> {
  return checkDefinitions.reduce<Record<string, string>>(
    (labelLookup, checkDefinition) => ({ ...labelLookup, [checkDefinition.checkId]: checkDefinition.label }),
    {},
  );
}

async function loadFeatureKeysWithPointedStories(
  issues: JiraIssue[],
  fieldConfig: HygieneFieldConfig,
  customStoryPointsFieldId: string,
): Promise<Set<string>> {
  const featureKeys = issues.filter(isFeatureLikeIssue).map((issue) => issue.key);
  if (featureKeys.length === 0) {
    return new Set<string>();
  }

  const encodedFeatureKeys = featureKeys.map((featureKey) => `"${featureKey}"`).join(',');
  // Build an OR clause covering every possible feature-link field (the configured default may differ
  // from the field the Jira instance actually uses) plus the native Jira parent relationship, so
  // child stories are found regardless of which field stores the link.
  const featureLinkJqlClauses = fieldConfig.featureLinkFieldIds
    .filter((fieldId) => fieldId !== 'parent')
    .map((fieldId) => `${buildJqlFieldReference(fieldId)} in (${encodedFeatureKeys})`);
  const childIssueJql = `(${[...featureLinkJqlClauses, `parent in (${encodedFeatureKeys})`].join(' OR ')}) AND issuetype = Story`;

  // Include the configured story-points field so Select-type values are available for the check.
  const isRealCustomField = customStoryPointsFieldId.startsWith('customfield_');
  const childIssueFields = buildUniqueFieldIds([
    MODERN_STORY_POINTS_FIELD,
    LEGACY_STORY_POINTS_FIELD,
    ...(isRealCustomField ? [customStoryPointsFieldId] : []),
    ...fieldConfig.featureLinkFieldIds,
  ]);
  const childIssueSearchPath =
    `/rest/api/2/search?jql=${encodeURIComponent(childIssueJql)}&fields=${encodeURIComponent(childIssueFields.join(','))}&maxResults=${HYGIENE_MAX_RESULTS}`;
  const childIssueResponse = await jiraGet<JiraSearchResponse>(childIssueSearchPath);

  return (childIssueResponse.issues ?? []).reduce((featureKeySet, childIssue) => {
    const linkedFeatureKey = readLinkedFeatureKey(childIssue, fieldConfig.featureLinkFieldIds);
    // When a real custom field is configured, it is the authoritative source — consistent with
    // the pointing queue and Hygiene missing-SP check. Fall back to legacy fields otherwise.
    const hasPointedStory = isRealCustomField
      ? hasPositiveStoryPoints((childIssue.fields as Record<string, unknown>)[customStoryPointsFieldId])
      : hasPositiveStoryPoints(childIssue.fields[MODERN_STORY_POINTS_FIELD])
        || hasPositiveStoryPoints(childIssue.fields[LEGACY_STORY_POINTS_FIELD]);
    if (linkedFeatureKey && hasPointedStory) {
      featureKeySet.add(linkedFeatureKey);
    }
    return featureKeySet;
  }, new Set<string>());
}

function readLinkedFeatureKey(issue: JiraIssue, fieldIds: string[]): string | null {
  for (const fieldId of fieldIds) {
    const rawValue = issue.fields[fieldId];
    const linkedKey = readIssueKeyValue(rawValue);
    if (linkedKey) {
      return linkedKey;
    }
  }

  return issue.fields.parent?.key ?? null;
}

function readIssueKeyValue(rawValue: unknown): string | null {
  if (typeof rawValue === 'string' && rawValue.includes('-')) {
    return rawValue;
  }

  // Jira multi-value feature-link fields return an array of issue references.
  // typeof [] === 'object' so we must check for arrays BEFORE the object branch.
  if (Array.isArray(rawValue)) {
    for (const item of rawValue) {
      const issueKey = readIssueKeyValue(item);
      if (issueKey) return issueKey;
    }
    return null;
  }

  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const keyRecord = rawValue as { key?: string; data?: { key?: string } };
  return keyRecord.key ?? keyRecord.data?.key ?? null;
}

function hasPositiveStoryPoints(fieldValue: unknown): boolean {
  if (fieldValue === null || fieldValue === undefined || fieldValue === '') return false;
  if (typeof fieldValue === 'number') return fieldValue > 0;
  // Non-numeric strings like "None" have no story points; numeric strings like "5" do.
  if (typeof fieldValue === 'string') {
    const parsedNumber = Number(fieldValue);
    return Number.isFinite(parsedNumber) && parsedNumber > 0;
  }
  // Jira Select-type fields return {id, value} objects — recurse into the value.
  if (typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
    return hasPositiveStoryPoints((fieldValue as Record<string, unknown>).value);
  }
  return false;
}
