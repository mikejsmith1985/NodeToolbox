// useReleaseMonitorState.ts — State, persistence, and Jira loading for the standalone Release Monitor.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import {
  classifyVersion,
  computeStats,
  isBlocker,
  isOverdue,
  type JiraVersion,
  type ReleaseIssue,
  type ReleaseStats,
  type ReleaseStatus,
  type ReleaseStatusCategoryKey,
} from '../utils/releaseStats.ts';

const RELEASE_FIELDS = 'summary,status,assignee,priority,issuetype,duedate,labels';
const RELEASE_MAX_RESULTS = 200;
const STORAGE_KEY = 'tbxReleaseMonitorState';
const DEFAULT_ERROR_MESSAGE = 'Failed to load release monitor data.';
const MISSING_INPUTS_MESSAGE = 'Enter both a Jira project key and fixVersion before loading release issues.';
const MISSING_PROJECT_MESSAGE = 'Enter a Jira project key before fetching fixVersions.';

export const RELEASE_MONITOR_STORAGE_KEY = STORAGE_KEY;

interface PersistedReleaseMonitorState {
  projectKey: string;
  fixVersion: string;
}

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
    priority?: { name?: string } | null;
    duedate?: string | null;
    labels?: string[] | null;
  };
}

export interface UseReleaseMonitorState {
  projectKey: string;
  setProjectKey: (key: string) => void;
  fixVersion: string;
  setFixVersion: (name: string) => void;
  isLoading: boolean;
  errorMessage: string | null;
  versions: JiraVersion[];
  selectedVersion: JiraVersion | null;
  releaseStatus: ReleaseStatus;
  issues: ReleaseIssue[];
  stats: ReleaseStats;
  loadVersions: () => Promise<void>;
  loadIssues: () => Promise<void>;
}

/** Builds the Jira versions endpoint for a project key entered by the release owner. */
export function buildVersionsPath(projectKey: string): string {
  return `/rest/api/2/project/${encodeURIComponent(projectKey)}/versions`;
}

/** Builds the Jira search endpoint for one fixVersion in one project. */
export function buildReleaseIssuesPath(projectKey: string, fixVersion: string): string {
  const releaseJql = `project=${projectKey} AND fixVersion="${fixVersion}"`;
  return `/rest/api/2/search?jql=${encodeURIComponent(releaseJql)}&fields=${RELEASE_FIELDS}&maxResults=${RELEASE_MAX_RESULTS}`;
}

/** Owns Release Monitor inputs, Jira calls, localStorage persistence, and derived status. */
export function useReleaseMonitorState(): UseReleaseMonitorState {
  const [persistedState] = useState<PersistedReleaseMonitorState>(() => readPersistedState());
  const [projectKey, setProjectKey] = useState<string>(persistedState.projectKey);
  const [fixVersion, setFixVersion] = useState<string>(persistedState.fixVersion);
  const [versions, setVersions] = useState<JiraVersion[]>([]);
  const [issues, setIssues] = useState<ReleaseIssue[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    persistState({ projectKey, fixVersion });
  }, [fixVersion, projectKey]);

  const selectedVersion = useMemo(() => {
    return versions.find((jiraVersion) => jiraVersion.name === fixVersion.trim()) ?? null;
  }, [fixVersion, versions]);

  const releaseStatus = useMemo(() => classifyVersion(selectedVersion), [selectedVersion]);
  const stats = useMemo(() => computeStats(issues), [issues]);

  const loadVersions = useCallback(async () => {
    const normalizedProjectKey = normalizeProjectKey(projectKey);
    if (!normalizedProjectKey) {
      setErrorMessage(MISSING_PROJECT_MESSAGE);
      setVersions([]);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const jiraVersions = await jiraGet<JiraVersion[]>(buildVersionsPath(normalizedProjectKey));
      setVersions(jiraVersions.filter((jiraVersion) => !jiraVersion.archived));
    } catch (caughtError: unknown) {
      setVersions([]);
      setErrorMessage(readErrorMessage(caughtError, DEFAULT_ERROR_MESSAGE));
    } finally {
      setIsLoading(false);
    }
  }, [projectKey]);

  const loadIssues = useCallback(async () => {
    const normalizedProjectKey = normalizeProjectKey(projectKey);
    const trimmedFixVersion = fixVersion.trim();
    if (!normalizedProjectKey || !trimmedFixVersion) {
      setErrorMessage(MISSING_INPUTS_MESSAGE);
      setIssues([]);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const jiraSearchResponse = await jiraGet<JiraSearchResponse>(buildReleaseIssuesPath(normalizedProjectKey, trimmedFixVersion));
      setIssues((jiraSearchResponse.issues ?? []).map((jiraIssue) => mapJiraIssueToReleaseIssue(jiraIssue)));
    } catch (caughtError: unknown) {
      setIssues([]);
      setErrorMessage(readErrorMessage(caughtError, DEFAULT_ERROR_MESSAGE));
    } finally {
      setIsLoading(false);
    }
  }, [fixVersion, projectKey]);

  return {
    projectKey,
    setProjectKey,
    fixVersion,
    setFixVersion,
    isLoading,
    errorMessage,
    versions,
    selectedVersion,
    releaseStatus,
    issues,
    stats,
    loadVersions,
    loadIssues,
  };
}

function mapJiraIssueToReleaseIssue(jiraIssue: JiraIssueResponse): ReleaseIssue {
  const fields = jiraIssue.fields ?? {};
  const statusCategoryKey = normalizeStatusCategory(fields.status?.statusCategory?.key);
  const priorityName = fields.priority?.name ?? 'None';
  const releaseIssue: ReleaseIssue = {
    key: jiraIssue.key,
    summary: fields.summary ?? 'Untitled Jira issue',
    statusName: fields.status?.name ?? 'Unknown',
    statusCategoryKey,
    assigneeName: fields.assignee?.displayName ?? null,
    priorityName,
    duedate: fields.duedate ?? null,
    isBlocker: false,
    isOverdue: false,
  };

  return {
    ...releaseIssue,
    isBlocker: isBlocker({ priorityName, labels: fields.labels ?? [] }),
    isOverdue: isOverdue(releaseIssue),
  };
}

function normalizeStatusCategory(categoryKey: string | undefined): ReleaseStatusCategoryKey {
  if (categoryKey === 'new' || categoryKey === 'indeterminate' || categoryKey === 'done') return categoryKey;
  return 'unknown';
}

function normalizeProjectKey(projectKey: string): string {
  return projectKey.trim().toUpperCase();
}

function readPersistedState(): PersistedReleaseMonitorState {
  if (typeof window === 'undefined') return buildDefaultState();

  try {
    const storedJson = window.localStorage.getItem(RELEASE_MONITOR_STORAGE_KEY);
    if (!storedJson) return buildDefaultState();
    return normalizePersistedState(JSON.parse(storedJson) as unknown);
  } catch {
    return buildDefaultState();
  }
}

function persistState(stateToPersist: PersistedReleaseMonitorState): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(RELEASE_MONITOR_STORAGE_KEY, JSON.stringify(stateToPersist));
}

function normalizePersistedState(candidateState: unknown): PersistedReleaseMonitorState {
  if (!isRecord(candidateState)) return buildDefaultState();
  return {
    projectKey: typeof candidateState.projectKey === 'string' ? candidateState.projectKey : '',
    fixVersion: typeof candidateState.fixVersion === 'string' ? candidateState.fixVersion : '',
  };
}

function buildDefaultState(): PersistedReleaseMonitorState {
  return { projectKey: '', fixVersion: '' };
}

function isRecord(candidateValue: unknown): candidateValue is Record<string, unknown> {
  return typeof candidateValue === 'object' && candidateValue !== null;
}

function readErrorMessage(caughtError: unknown, fallbackMessage: string): string {
  return caughtError instanceof Error ? caughtError.message : fallbackMessage;
}
