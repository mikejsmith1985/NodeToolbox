// usePipelineState.ts — State, filters, and Jira calls for the standalone Pipeline View.
//
// The hook keeps Pipeline View independent from the legacy ToolBox page: it loads
// epics for one Jira project, applies local filters, and lazy-loads child issues
// only when an epic card is expanded so large projects remain responsive.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import {
  calculateCompletionPercent,
  calculateStoryPointRollup,
  normalizeStatusCategoryKey,
  readStoryPoints,
  type ChildIssue,
  type StatusCategoryKey,
} from '../utils/rollup.ts';

// ── Named constants — Jira paths, field lists, and persisted browser state. ─────

/** Browser storage key shared with the legacy ToolBox naming pattern for this view. */
export const PIPELINE_FILTERS_STORAGE_KEY = 'tbxPipelineFilters';

const EPIC_MAX_RESULTS = 200;
const CHILD_MAX_RESULTS = 100;
const EMPTY_COUNT = 0;
const DEFAULT_STATUS_CATEGORY_FILTER: StatusCategoryKey[] = ['new', 'indeterminate', 'done'];

const EPIC_FIELDS = [
  'summary',
  'status',
  'assignee',
  'priority',
  'customfield_10028',
  'customfield_10016',
].join(',');

const CHILD_FIELDS = ['summary', 'status', 'customfield_10028', 'customfield_10016'].join(',');

// ── Public types exposed by the hook. ──────────────────────────────────────────

export interface EpicSummary {
  key: string;
  summary: string;
  status: string;
  statusCategoryKey: StatusCategoryKey;
  assignee: string | null;
  storyPoints: number | null;
  children: ChildIssue[] | null;
  isLoadingChildren: boolean;
  rolledUpStoryPoints: number;
  completionPercent: number;
}

export interface PersistedPipelineFilters {
  projectKey: string;
  statusCategoryFilter: StatusCategoryKey[];
  assigneeFilter: string;
}

export interface UsePipelineState {
  projectKey: string;
  setProjectKey: (projectKey: string) => void;
  statusCategoryFilter: StatusCategoryKey[];
  toggleStatusCategory: (statusCategory: StatusCategoryKey) => void;
  assigneeFilter: string;
  setAssigneeFilter: (assigneeFilter: string) => void;
  isLoading: boolean;
  errorMessage: string | null;
  epics: EpicSummary[];
  reload: () => Promise<void>;
  loadChildren: (epicKey: string) => Promise<void>;
}

// ── Jira response shapes (narrow — only consumed fields are represented). ──────

interface JiraSearchResponse {
  issues?: JiraIssueResponse[];
}

interface JiraIssueResponse {
  key: string;
  fields?: {
    summary?: string;
    status?: {
      name?: string;
      statusCategory?: { key?: string } | null;
    } | null;
    assignee?: { displayName?: string } | null;
    [customField: string]: unknown;
  };
}

// ── Hook. ─────────────────────────────────────────────────────────────────────

/** Owns Pipeline View filtering and Jira interactions while the component stays declarative. */
export function usePipelineState(): UsePipelineState {
  const [persistedFilters] = useState<PersistedPipelineFilters>(() => readPersistedPipelineFilters());
  const [projectKey, setProjectKey] = useState<string>(persistedFilters.projectKey);
  const [statusCategoryFilter, setStatusCategoryFilter] = useState<StatusCategoryKey[]>(
    persistedFilters.statusCategoryFilter,
  );
  const [assigneeFilter, setAssigneeFilter] = useState<string>(persistedFilters.assigneeFilter);
  const [loadedEpics, setLoadedEpics] = useState<EpicSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    persistPipelineFilters({ projectKey, statusCategoryFilter, assigneeFilter });
  }, [projectKey, statusCategoryFilter, assigneeFilter]);

  const reload = useCallback(async () => {
    const trimmedProjectKey = projectKey.trim().toUpperCase();
    if (!trimmedProjectKey) {
      setErrorMessage('Enter a Jira project key before loading the pipeline.');
      setLoadedEpics([]);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await jiraGet<JiraSearchResponse>(buildEpicsSearchPath(trimmedProjectKey));
      setLoadedEpics((response.issues ?? []).map(mapJiraIssueToEpicSummary));
    } catch (caughtError: unknown) {
      setErrorMessage(readErrorMessage(caughtError, 'Failed to load pipeline epics.'));
      setLoadedEpics([]);
    } finally {
      setIsLoading(false);
    }
  }, [projectKey]);

  const loadChildren = useCallback(async (epicKey: string) => {
    const matchingEpic = loadedEpics.find((epicSummary) => epicSummary.key === epicKey);
    if (!matchingEpic || matchingEpic.children !== null || matchingEpic.isLoadingChildren) return;

    setLoadedEpics((previousEpics) => markEpicChildrenLoading(previousEpics, epicKey, true));
    try {
      const childIssues = await fetchChildrenForEpic(epicKey);
      setLoadedEpics((previousEpics) => updateEpicChildren(previousEpics, epicKey, childIssues));
    } catch (caughtError: unknown) {
      setErrorMessage(readErrorMessage(caughtError, `Failed to load children for ${epicKey}.`));
      setLoadedEpics((previousEpics) => markEpicChildrenLoading(previousEpics, epicKey, false));
    }
  }, [loadedEpics]);

  const epics = useMemo(() => {
    return loadedEpics.filter((epicSummary) => {
      const hasAllowedStatusCategory = statusCategoryFilter.includes(epicSummary.statusCategoryKey);
      const hasMatchingAssignee = matchesAssigneeFilter(epicSummary.assignee, assigneeFilter);
      return hasAllowedStatusCategory && hasMatchingAssignee;
    });
  }, [assigneeFilter, loadedEpics, statusCategoryFilter]);

  const toggleStatusCategory = useCallback((statusCategory: StatusCategoryKey) => {
    setStatusCategoryFilter((previousFilter) => {
      const hasStatusCategory = previousFilter.includes(statusCategory);
      if (hasStatusCategory) {
        return previousFilter.filter((selectedStatusCategory) => selectedStatusCategory !== statusCategory);
      }
      return [...previousFilter, statusCategory];
    });
  }, []);

  return {
    projectKey,
    setProjectKey,
    statusCategoryFilter,
    toggleStatusCategory,
    assigneeFilter,
    setAssigneeFilter,
    isLoading,
    errorMessage,
    epics,
    reload,
    loadChildren,
  };
}

// ── Jira mapping and fetch helpers. ────────────────────────────────────────────

function buildEpicsSearchPath(projectKey: string): string {
  const epicJql = `project=${projectKey} AND issuetype=Epic ORDER BY status,created`;
  return buildSearchPath(epicJql, EPIC_FIELDS, EPIC_MAX_RESULTS);
}

function buildChildSearchPath(epicKey: string, relationshipClause: string): string {
  const childJql = `${relationshipClause}=${epicKey}`;
  return buildSearchPath(childJql, CHILD_FIELDS, CHILD_MAX_RESULTS);
}

function buildSearchPath(jqlText: string, fieldList: string, maximumResults: number): string {
  return `/rest/api/2/search?jql=${encodeURIComponent(jqlText)}&fields=${fieldList}&maxResults=${maximumResults}`;
}

function mapJiraIssueToEpicSummary(rawIssue: JiraIssueResponse): EpicSummary {
  const fieldsObject = rawIssue.fields ?? {};
  const storyPoints = readStoryPoints(fieldsObject as Record<string, unknown>);
  const epicWithoutRollup: EpicSummary = {
    key: rawIssue.key,
    summary: fieldsObject.summary ?? '',
    status: fieldsObject.status?.name ?? '',
    statusCategoryKey: normalizeStatusCategoryKey(fieldsObject.status?.statusCategory?.key),
    assignee: fieldsObject.assignee?.displayName ?? null,
    storyPoints,
    children: null,
    isLoadingChildren: false,
    rolledUpStoryPoints: storyPoints ?? EMPTY_COUNT,
    completionPercent: EMPTY_COUNT,
  };
  return rebuildEpicRollup(epicWithoutRollup);
}

function mapJiraIssueToChildIssue(rawIssue: JiraIssueResponse): ChildIssue {
  const fieldsObject = rawIssue.fields ?? {};
  return {
    key: rawIssue.key,
    summary: fieldsObject.summary ?? '',
    status: fieldsObject.status?.name ?? '',
    statusCategoryKey: normalizeStatusCategoryKey(fieldsObject.status?.statusCategory?.key),
    storyPoints: readStoryPoints(fieldsObject as Record<string, unknown>),
  };
}

async function fetchChildrenForEpic(epicKey: string): Promise<ChildIssue[]> {
  const parentResponse = await jiraGet<JiraSearchResponse>(buildChildSearchPath(epicKey, 'parent'));
  const parentIssues = parentResponse.issues ?? [];

  if (parentIssues.length > EMPTY_COUNT) {
    return parentIssues.map(mapJiraIssueToChildIssue);
  }

  const epicLinkResponse = await jiraGet<JiraSearchResponse>(buildChildSearchPath(epicKey, '"Epic Link"'));
  return (epicLinkResponse.issues ?? []).map(mapJiraIssueToChildIssue);
}

function rebuildEpicRollup(epicSummary: EpicSummary): EpicSummary {
  return {
    ...epicSummary,
    rolledUpStoryPoints: calculateStoryPointRollup(epicSummary.children, epicSummary.storyPoints),
    completionPercent: calculateCompletionPercent(epicSummary.children),
  };
}

function markEpicChildrenLoading(epicsToUpdate: EpicSummary[], epicKey: string, isLoadingChildren: boolean): EpicSummary[] {
  return epicsToUpdate.map((epicSummary) => {
    if (epicSummary.key !== epicKey) return epicSummary;
    return { ...epicSummary, isLoadingChildren };
  });
}

function updateEpicChildren(epicsToUpdate: EpicSummary[], epicKey: string, children: ChildIssue[]): EpicSummary[] {
  return epicsToUpdate.map((epicSummary) => {
    if (epicSummary.key !== epicKey) return epicSummary;
    return rebuildEpicRollup({ ...epicSummary, children, isLoadingChildren: false });
  });
}

// ── Filter persistence helpers. ────────────────────────────────────────────────

function buildDefaultPipelineFilters(): PersistedPipelineFilters {
  return {
    projectKey: '',
    statusCategoryFilter: DEFAULT_STATUS_CATEGORY_FILTER,
    assigneeFilter: '',
  };
}

function readPersistedPipelineFilters(): PersistedPipelineFilters {
  if (typeof window === 'undefined') return buildDefaultPipelineFilters();

  try {
    const storedJson = window.localStorage.getItem(PIPELINE_FILTERS_STORAGE_KEY);
    if (!storedJson) return buildDefaultPipelineFilters();
    return normalizePersistedPipelineFilters(JSON.parse(storedJson) as unknown);
  } catch {
    return buildDefaultPipelineFilters();
  }
}

function persistPipelineFilters(filtersToPersist: PersistedPipelineFilters): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PIPELINE_FILTERS_STORAGE_KEY, JSON.stringify(filtersToPersist));
}

function normalizePersistedPipelineFilters(candidateFilters: unknown): PersistedPipelineFilters {
  if (!isRecord(candidateFilters)) return buildDefaultPipelineFilters();

  return {
    projectKey: typeof candidateFilters.projectKey === 'string' ? candidateFilters.projectKey : '',
    statusCategoryFilter: normalizeStatusCategoryFilter(candidateFilters.statusCategoryFilter),
    assigneeFilter: typeof candidateFilters.assigneeFilter === 'string' ? candidateFilters.assigneeFilter : '',
  };
}

function normalizeStatusCategoryFilter(candidateFilter: unknown): StatusCategoryKey[] {
  if (!Array.isArray(candidateFilter)) return DEFAULT_STATUS_CATEGORY_FILTER;

  const selectedStatusCategories = candidateFilter.filter(isStatusCategoryKey);
  return selectedStatusCategories.length > EMPTY_COUNT ? selectedStatusCategories : DEFAULT_STATUS_CATEGORY_FILTER;
}

function isStatusCategoryKey(candidateValue: unknown): candidateValue is StatusCategoryKey {
  return candidateValue === 'new' || candidateValue === 'indeterminate' || candidateValue === 'done';
}

function matchesAssigneeFilter(assigneeName: string | null, assigneeFilter: string): boolean {
  const normalizedAssigneeFilter = assigneeFilter.trim().toLowerCase();
  if (!normalizedAssigneeFilter) return true;
  return (assigneeName ?? '').toLowerCase().includes(normalizedAssigneeFilter);
}

function isRecord(candidateValue: unknown): candidateValue is Record<string, unknown> {
  return typeof candidateValue === 'object' && candidateValue !== null;
}

function readErrorMessage(caughtError: unknown, fallbackMessage: string): string {
  return caughtError instanceof Error ? caughtError.message : fallbackMessage;
}
