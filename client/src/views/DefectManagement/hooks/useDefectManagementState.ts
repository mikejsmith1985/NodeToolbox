// useDefectManagementState.ts — State, Jira loading, filtering, and sorting for the standalone Defect Management view.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';

// ── Named constants — legacy-compatible storage and Jira request details. ───────

/** Browser storage key that lets the Defect Management view reopen with the last query. */
export const DEFECT_FILTER_STORAGE_KEY = 'tbxDefectFilters';

/** Jira fields kept intentionally narrow so the standalone defect request stays fast. */
const DEFECT_SEARCH_FIELDS = [
  'summary',
  'status',
  'priority',
  'assignee',
  'issuetype',
  'created',
  'updated',
].join(',');

/** Search window requested by the migration brief; older issues can be added with extra JQL later if needed. */
const DEFECT_CREATED_WINDOW_JQL = 'created >= -90d';
const DEFECT_MAX_RESULTS = 200;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const EMPTY_COUNT = 0;

const PRIORITY_FILTER_VALUES = ['', 'Highest', 'High', 'Medium', 'Low', 'Lowest'] as const;
const STATUS_CATEGORY_VALUES = ['', 'new', 'indeterminate', 'done'] as const;
const DEFECT_SORT_VALUES = ['priority-age', 'age', 'updated'] as const;

// ── Public types exposed by the hook and render layer. ─────────────────────────

export type DefectPriorityFilter = (typeof PRIORITY_FILTER_VALUES)[number];
export type DefectStatusCategoryFilter = (typeof STATUS_CATEGORY_VALUES)[number];
export type DefectSort = (typeof DEFECT_SORT_VALUES)[number];

export interface DefectFilter {
  priority: DefectPriorityFilter;
  statusCat: DefectStatusCategoryFilter;
  unassignedOnly: boolean;
}

export interface DefectIssue {
  key: string;
  summary: string;
  priority: string;
  status: string;
  statusCat: Exclude<DefectStatusCategoryFilter, ''>;
  assignee: string;
  issueType: string;
  created: string;
  updated: string;
  ageDays: number;
  updatedDays: number;
}

export interface UseDefectManagementState {
  projectKey: string;
  setProjectKey: (key: string) => void;
  extraJql: string;
  setExtraJql: (jql: string) => void;
  filter: DefectFilter;
  setFilter: <FilterKey extends keyof DefectFilter>(key: FilterKey, value: DefectFilter[FilterKey]) => void;
  sort: DefectSort;
  setSort: (sort: DefectSort) => void;
  isLoading: boolean;
  errorMessage: string | null;
  defects: DefectIssue[];
  rawIssueCount: number;
  reload: () => Promise<void>;
}

interface PersistedDefectManagementState {
  projectKey: string;
  extraJql: string;
  filter: DefectFilter;
  sort: DefectSort;
}

interface JiraSearchResponse {
  issues?: JiraIssueResponse[];
}

interface JiraIssueResponse {
  key?: string;
  fields?: {
    summary?: string;
    status?: {
      name?: string;
      statusCategory?: { key?: string } | null;
    } | null;
    priority?: { name?: string } | null;
    assignee?: { displayName?: string } | null;
    issuetype?: { name?: string } | null;
    created?: string;
    updated?: string;
  };
}

// ── Pure helpers — exported because the legacy rules are important to test. ─────

/** Detects Jira bug/defect issue types so unexpected search results cannot pollute the defect list. */
export function detectIssueIsDefect(rawIssue: JiraIssueResponse): boolean {
  const issueTypeName = rawIssue.fields?.issuetype?.name?.toLowerCase() ?? '';
  const hasBugTypeName = issueTypeName.includes('bug');
  const hasDefectTypeName = issueTypeName.includes('defect');
  return hasBugTypeName || hasDefectTypeName;
}

/** Calculates whole days since issue creation so sorting matches the legacy age-first dashboard. */
export function calculateDefectAge(rawIssue: JiraIssueResponse): number {
  return calculateDaysSince(rawIssue.fields?.created);
}

/** Calculates whole days since the last Jira update so stale defects can be sorted client-side. */
export function calculateDefectUpdated(rawIssue: JiraIssueResponse): number {
  return calculateDaysSince(rawIssue.fields?.updated);
}

/** Reads Jira's status category key and falls back to "new" when Jira omits the nested field. */
export function getDefectStatusCat(rawIssue: JiraIssueResponse): DefectIssue['statusCat'] {
  const candidateStatusCategory = rawIssue.fields?.status?.statusCategory?.key;
  if (candidateStatusCategory === 'indeterminate' || candidateStatusCategory === 'done') {
    return candidateStatusCategory;
  }
  return 'new';
}

/** Converts Jira priority names to the exact legacy severity order used for triage sorting. */
export function calculatePriorityOrder(priorityName: string): number {
  const normalizedPriorityName = priorityName.trim().toLowerCase();
  if (['highest', 'critical', 'blocker'].includes(normalizedPriorityName)) return 0;
  if (normalizedPriorityName === 'high') return 1;
  if (normalizedPriorityName === 'medium') return 2;
  if (normalizedPriorityName === 'low' || normalizedPriorityName === 'lowest') return 3;
  return 4;
}

/** Applies all client-side defect filters after Jira returns the broad project search. */
export function filterDefects(defects: DefectIssue[], filter: DefectFilter): DefectIssue[] {
  return defects.filter((defectIssue) => {
    const hasPriorityMatch = !filter.priority || defectIssue.priority === filter.priority;
    const hasStatusCategoryMatch = !filter.statusCat || defectIssue.statusCat === filter.statusCat;
    const isUnassignedMatch = !filter.unassignedOnly || !defectIssue.assignee;
    return hasPriorityMatch && hasStatusCategoryMatch && isUnassignedMatch;
  });
}

/** Sorts defects with legacy-compatible triage, age, and stale-update options. */
export function sortDefects(defects: DefectIssue[], sort: DefectSort): DefectIssue[] {
  const sortedDefects = [...defects];
  sortedDefects.sort((firstDefect, secondDefect) => compareDefects(firstDefect, secondDefect, sort));
  return sortedDefects;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/** Owns standalone Defect Management state while keeping the view declarative and easy to test. */
export function useDefectManagementState(): UseDefectManagementState {
  const [persistedState, setPersistedState] = useState<PersistedDefectManagementState>(readPersistedDefectState);
  const [allDefects, setAllDefects] = useState<DefectIssue[]>([]);
  const [rawIssueCount, setRawIssueCount] = useState<number>(EMPTY_COUNT);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    writePersistedDefectState(persistedState);
  }, [persistedState]);

  const setProjectKey = useCallback((projectKey: string) => {
    setPersistedState((previousState) => ({ ...previousState, projectKey }));
  }, []);

  const setExtraJql = useCallback((extraJql: string) => {
    setPersistedState((previousState) => ({ ...previousState, extraJql }));
  }, []);

  const setFilter = useCallback(<FilterKey extends keyof DefectFilter>(key: FilterKey, value: DefectFilter[FilterKey]) => {
    setPersistedState((previousState) => ({
      ...previousState,
      filter: { ...previousState.filter, [key]: value },
    }));
  }, []);

  const setSort = useCallback((sort: DefectSort) => {
    setPersistedState((previousState) => ({ ...previousState, sort }));
  }, []);

  const reload = useCallback(async () => {
    const searchPath = buildDefectSearchPath(persistedState.projectKey, persistedState.extraJql);
    if (!searchPath) {
      setAllDefects([]);
      setRawIssueCount(EMPTY_COUNT);
      setErrorMessage(null);
      return;
    }
    await loadDefectsFromJira(searchPath, setAllDefects, setRawIssueCount, setIsLoading, setErrorMessage);
  }, [persistedState.projectKey, persistedState.extraJql]);

  const defects = useMemo(
    () => sortDefects(filterDefects(allDefects, persistedState.filter), persistedState.sort),
    [allDefects, persistedState.filter, persistedState.sort],
  );

  return useMemo(
    () => ({
      projectKey: persistedState.projectKey,
      setProjectKey,
      extraJql: persistedState.extraJql,
      setExtraJql,
      filter: persistedState.filter,
      setFilter,
      sort: persistedState.sort,
      setSort,
      isLoading,
      errorMessage,
      defects,
      rawIssueCount,
      reload,
    }),
    [persistedState, setProjectKey, setExtraJql, setFilter, setSort, isLoading, errorMessage, defects, rawIssueCount, reload],
  );
}

// ── Internal helpers. ──────────────────────────────────────────────────────────

function calculateDaysSince(dateText: string | undefined): number {
  if (!dateText) return EMPTY_COUNT;
  const dateMilliseconds = new Date(dateText).getTime();
  if (!Number.isFinite(dateMilliseconds)) return EMPTY_COUNT;
  return Math.max(EMPTY_COUNT, Math.floor((Date.now() - dateMilliseconds) / MILLISECONDS_PER_DAY));
}

function compareDefects(firstDefect: DefectIssue, secondDefect: DefectIssue, sort: DefectSort): number {
  if (sort === 'age') return secondDefect.ageDays - firstDefect.ageDays;
  if (sort === 'updated') return secondDefect.updatedDays - firstDefect.updatedDays;
  const priorityDifference = calculatePriorityOrder(firstDefect.priority) - calculatePriorityOrder(secondDefect.priority);
  return priorityDifference || secondDefect.ageDays - firstDefect.ageDays;
}

function mapJiraIssueToDefect(rawIssue: JiraIssueResponse): DefectIssue {
  const fieldsObject = rawIssue.fields ?? {};
  return {
    key: rawIssue.key ?? '',
    summary: fieldsObject.summary ?? '',
    priority: fieldsObject.priority?.name ?? '',
    status: fieldsObject.status?.name ?? '',
    statusCat: getDefectStatusCat(rawIssue),
    assignee: fieldsObject.assignee?.displayName ?? '',
    issueType: fieldsObject.issuetype?.name ?? '',
    created: fieldsObject.created ?? '',
    updated: fieldsObject.updated ?? '',
    ageDays: calculateDefectAge(rawIssue),
    updatedDays: calculateDefectUpdated(rawIssue),
  };
}

function buildDefectSearchPath(projectKey: string, extraJql: string): string | null {
  const normalizedProjectKey = projectKey.trim().toUpperCase();
  if (!normalizedProjectKey) return null;
  const jqlText = buildDefectJql(normalizedProjectKey, extraJql);
  return `/rest/api/2/search?jql=${encodeURIComponent(jqlText)}&fields=${DEFECT_SEARCH_FIELDS}&maxResults=${DEFECT_MAX_RESULTS}`;
}

function buildDefectJql(projectKey: string, extraJql: string): string {
  const baseJql = `project=${projectKey} AND issuetype in (Bug, Defect) AND ${DEFECT_CREATED_WINDOW_JQL}`;
  const normalizedExtraJql = normalizeExtraJql(extraJql);
  return normalizedExtraJql ? `${baseJql} AND ${normalizedExtraJql}` : baseJql;
}

function normalizeExtraJql(extraJql: string): string {
  return extraJql.trim().replace(/^AND\s+/i, '');
}

async function loadDefectsFromJira(
  searchPath: string,
  setAllDefects: (defects: DefectIssue[]) => void,
  setRawIssueCount: (rawIssueCount: number) => void,
  setIsLoading: (isLoading: boolean) => void,
  setErrorMessage: (errorMessage: string | null) => void,
): Promise<void> {
  setIsLoading(true);
  setErrorMessage(null);
  try {
    const response = await jiraGet<JiraSearchResponse>(searchPath);
    const rawIssues = response.issues ?? [];
    setRawIssueCount(rawIssues.length);
    setAllDefects(rawIssues.filter(detectIssueIsDefect).map(mapJiraIssueToDefect));
  } catch (caughtError: unknown) {
    setRawIssueCount(EMPTY_COUNT);
    setAllDefects([]);
    setErrorMessage(caughtError instanceof Error ? caughtError.message : 'Failed to load defects');
  } finally {
    setIsLoading(false);
  }
}

function buildDefaultPersistedDefectState(): PersistedDefectManagementState {
  return {
    projectKey: '',
    extraJql: '',
    filter: { priority: '', statusCat: '', unassignedOnly: false },
    sort: 'priority-age',
  };
}

function readPersistedDefectState(): PersistedDefectManagementState {
  if (typeof window === 'undefined') return buildDefaultPersistedDefectState();
  try {
    const storedJson = window.localStorage.getItem(DEFECT_FILTER_STORAGE_KEY);
    if (!storedJson) return buildDefaultPersistedDefectState();
    return normalizePersistedDefectState(JSON.parse(storedJson) as unknown);
  } catch {
    return buildDefaultPersistedDefectState();
  }
}

function writePersistedDefectState(persistedState: PersistedDefectManagementState): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DEFECT_FILTER_STORAGE_KEY, JSON.stringify(persistedState));
}

function normalizePersistedDefectState(candidateState: unknown): PersistedDefectManagementState {
  if (!isRecord(candidateState)) return buildDefaultPersistedDefectState();
  const defaultState = buildDefaultPersistedDefectState();
  return {
    projectKey: typeof candidateState.projectKey === 'string' ? candidateState.projectKey : defaultState.projectKey,
    extraJql: typeof candidateState.extraJql === 'string' ? candidateState.extraJql : defaultState.extraJql,
    filter: normalizePersistedFilter(candidateState.filter),
    sort: isDefectSort(candidateState.sort) ? candidateState.sort : defaultState.sort,
  };
}

function normalizePersistedFilter(candidateFilter: unknown): DefectFilter {
  if (!isRecord(candidateFilter)) return buildDefaultPersistedDefectState().filter;
  return {
    priority: isPriorityFilter(candidateFilter.priority) ? candidateFilter.priority : '',
    statusCat: isStatusCategoryFilter(candidateFilter.statusCat) ? candidateFilter.statusCat : '',
    unassignedOnly: candidateFilter.unassignedOnly === true,
  };
}

function isPriorityFilter(candidatePriority: unknown): candidatePriority is DefectPriorityFilter {
  return PRIORITY_FILTER_VALUES.includes(candidatePriority as DefectPriorityFilter);
}

function isStatusCategoryFilter(candidateStatusCategory: unknown): candidateStatusCategory is DefectStatusCategoryFilter {
  return STATUS_CATEGORY_VALUES.includes(candidateStatusCategory as DefectStatusCategoryFilter);
}

function isDefectSort(candidateSort: unknown): candidateSort is DefectSort {
  return DEFECT_SORT_VALUES.includes(candidateSort as DefectSort);
}

function isRecord(candidateValue: unknown): candidateValue is Record<string, unknown> {
  return typeof candidateValue === 'object' && candidateValue !== null;
}
