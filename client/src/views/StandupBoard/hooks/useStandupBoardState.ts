// useStandupBoardState.ts — State, persistence, and Jira loading for the standalone Standup Board.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import {
  ageInDays,
  computeFlowStats,
  isBlocked,
  type FlowStats,
  type StandupIssue,
  type StatusCategoryKey,
} from '../utils/boardStats.ts';

const STANDUP_FIELDS = 'summary,status,assignee,priority,issuetype,issuelinks,created,updated';
const STANDUP_MAX_RESULTS = 100;
const DEFAULT_ERROR_MESSAGE = 'Failed to load Standup Board issues';
const DEFAULT_ASSIGNEE_JQL = 'assignee in (currentUser()) AND statusCategory != Done ORDER BY updated DESC';
const STATUS_CATEGORY_ORDER: Record<StatusCategoryKey, number> = { done: 0, indeterminate: 1, new: 2 };
const FIRST_NAME_INDEX = 0;

export const STANDUP_STORAGE_KEY = 'tbxStandupJql';
export const DEFAULT_STANDUP_JQL = DEFAULT_ASSIGNEE_JQL;

interface StoredStandupSettings {
  jql?: string;
  hideDone?: boolean;
}

interface JiraStatusCategory {
  key?: string;
}

interface JiraStatus {
  name?: string;
  statusCategory?: JiraStatusCategory;
}

interface JiraUser {
  displayName?: string;
}

interface JiraIssueLinkType {
  name?: string;
}

interface JiraIssueLink {
  type?: JiraIssueLinkType;
  inwardIssue?: unknown;
  outwardIssue?: unknown;
}

export interface JiraStandupIssue {
  key: string;
  fields?: {
    summary?: string;
    status?: JiraStatus;
    assignee?: JiraUser | null;
    issuelinks?: JiraIssueLink[];
    created?: string;
    updated?: string;
  };
}

export interface JiraStandupSearchResponse {
  issues?: JiraStandupIssue[];
}

export interface UseStandupBoardState {
  jql: string;
  setJql: (jql: string) => void;
  hideDone: boolean;
  setHideDone: (hideDone: boolean) => void;
  isLoading: boolean;
  errorMessage: string | null;
  issues: StandupIssue[];
  flowStats: FlowStats;
  reload: () => Promise<void>;
}

/** Builds the Jira search path used by the standalone Standup Board. */
export function buildStandupSearchPath(jql: string): string {
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${STANDUP_FIELDS}&maxResults=${STANDUP_MAX_RESULTS}`;
}

/** Converts Jira's search shape into the compact card model rendered by the board. */
export function mapJiraIssueToStandupIssue(issue: JiraStandupIssue, now: Date = new Date()): StandupIssue {
  const fields = issue.fields ?? {};
  const statusCategoryKey = normalizeStatusCategory(fields.status?.statusCategory?.key);

  return {
    key: issue.key,
    summary: fields.summary ?? 'Untitled Jira issue',
    status: fields.status?.name ?? 'Unknown',
    statusCategoryKey,
    assignee: readFirstName(fields.assignee?.displayName),
    ageDays: ageInDays(fields.created, now),
    isBlocked: isBlocked(issue),
  };
}

/** Owns Standup Board settings, Jira search state, and derived flow statistics. */
export function useStandupBoardState(): UseStandupBoardState {
  const storedSettings = readStoredSettings();
  const [jql, setJql] = useState<string>(storedSettings.jql ?? DEFAULT_STANDUP_JQL);
  const [hideDone, setHideDone] = useState<boolean>(storedSettings.hideDone ?? true);
  const [allIssues, setAllIssues] = useState<StandupIssue[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    persistSettings({ jql, hideDone });
  }, [hideDone, jql]);

  const loadIssues = useCallback(async (requestedJql: string) => {
    const trimmedJql = requestedJql.trim();
    if (!trimmedJql) {
      setAllIssues([]);
      setErrorMessage(null);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const jiraSearchResponse = await jiraGet<JiraStandupSearchResponse>(buildStandupSearchPath(trimmedJql));
      setAllIssues((jiraSearchResponse.issues ?? []).map((issue) => mapJiraIssueToStandupIssue(issue)));
    } catch (caughtError: unknown) {
      setAllIssues([]);
      setErrorMessage(caughtError instanceof Error ? caughtError.message : DEFAULT_ERROR_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadTimerId = window.setTimeout(() => {
      void loadIssues(jql);
    }, 0);

    return () => window.clearTimeout(loadTimerId);
  }, [jql, loadIssues]);

  const issues = useMemo(() => sortIssuesForBoard(filterIssuesByDone(allIssues, hideDone)), [allIssues, hideDone]);
  const flowStats = useMemo(() => computeFlowStats(issues), [issues]);

  const reload = useCallback(async () => {
    await loadIssues(jql);
  }, [jql, loadIssues]);

  return { jql, setJql, hideDone, setHideDone, isLoading, errorMessage, issues, flowStats, reload };
}

function filterIssuesByDone(issues: StandupIssue[], hideDone: boolean): StandupIssue[] {
  if (!hideDone) return issues;
  return issues.filter((issue) => issue.statusCategoryKey !== 'done');
}

function sortIssuesForBoard(issues: StandupIssue[]): StandupIssue[] {
  return [...issues].sort((firstIssue, secondIssue) => {
    const categoryDifference = STATUS_CATEGORY_ORDER[firstIssue.statusCategoryKey] - STATUS_CATEGORY_ORDER[secondIssue.statusCategoryKey];
    if (categoryDifference !== 0) return categoryDifference;
    return secondIssue.ageDays - firstIssue.ageDays;
  });
}

function normalizeStatusCategory(categoryKey: string | undefined): StatusCategoryKey {
  if (categoryKey === 'done' || categoryKey === 'indeterminate' || categoryKey === 'new') return categoryKey;
  return 'new';
}

function readFirstName(displayName: string | undefined): string | null {
  const trimmedDisplayName = displayName?.trim();
  if (!trimmedDisplayName) return null;
  return trimmedDisplayName.split(/\s+/)[FIRST_NAME_INDEX] ?? trimmedDisplayName;
}

function readStoredSettings(): StoredStandupSettings {
  const storedSettingsText = window.localStorage.getItem(STANDUP_STORAGE_KEY);
  if (!storedSettingsText) return {};

  try {
    const storedSettings = JSON.parse(storedSettingsText) as StoredStandupSettings;
    return {
      jql: typeof storedSettings.jql === 'string' ? storedSettings.jql : undefined,
      hideDone: typeof storedSettings.hideDone === 'boolean' ? storedSettings.hideDone : undefined,
    };
  } catch {
    return {};
  }
}

function persistSettings(settings: Required<StoredStandupSettings>): void {
  window.localStorage.setItem(STANDUP_STORAGE_KEY, JSON.stringify(settings));
}
