// useHygieneState.ts — State, persistence, and Jira loading for the Hygiene view.
//
// The hook owns the standalone Hygiene workflow: keep the user's project/filter
// choices across refreshes, run one Jira search through the existing proxy helper,
// and compose the pure health checks into summary and drill-down state for the view.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import {
  HYGIENE_CHECK_IDS,
  evaluateHygieneIssue,
  summarizeHygieneFindings,
  type HygieneCheckId,
  type HygieneFinding,
  type HygieneSummary,
  type JiraIssue,
} from '../checks/hygieneChecks.ts';

const HYGIENE_FIELDS = [
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
].join(',');
const HYGIENE_MAX_RESULTS = 200;
const EMPTY_FILTER: HygieneCheckId | null = null;

export const HYGIENE_PROJECT_KEY_STORAGE_KEY = 'tbxHygieneProjectKey';
export const HYGIENE_FILTER_STORAGE_KEY = 'tbxHygieneFilter';

export interface JiraSearchResponse {
  issues?: JiraIssue[];
}

export interface HygieneState {
  projectKey: string;
  extraJql: string;
  findings: HygieneFinding[];
  filteredFindings: HygieneFinding[];
  summary: HygieneSummary;
  selectedFilter: HygieneCheckId | null;
  isLoading: boolean;
  loadError: string | null;
}

export interface HygieneActions {
  setProjectKey: (projectKey: string) => void;
  setExtraJql: (extraJql: string) => void;
  selectFilter: (checkId: HygieneCheckId | null) => void;
  loadHygiene: () => Promise<void>;
}

/** Builds the single Jira search URL required by the standalone Hygiene view. */
export function buildHygieneSearchPath(projectKey: string, extraJql: string): string {
  const normalizedProjectKey = projectKey.trim().toUpperCase();
  const extraJqlClause = extraJql.trim();
  const jqlText = `project=${normalizedProjectKey} AND statusCategory != Done${extraJqlClause ? ` ${extraJqlClause}` : ''}`;
  return `/rest/api/2/search?jql=${encodeURIComponent(jqlText)}&fields=${HYGIENE_FIELDS}&maxResults=${HYGIENE_MAX_RESULTS}`;
}

/** Converts a Jira issue into a finding, returning only issues that violate at least one Hygiene check. */
export function mapJiraIssueToHygieneFinding(issue: JiraIssue): HygieneFinding | null {
  const flags = evaluateHygieneIssue(issue);
  return flags.length > 0 ? { issue, flags } : null;
}

/** Owns Hygiene view state and actions so the render layer can stay declarative. */
export function useHygieneState(): HygieneState & HygieneActions {
  const [projectKey, setProjectKey] = useState<string>(() => readStoredProjectKey());
  const [extraJql, setExtraJql] = useState<string>('');
  const [findings, setFindings] = useState<HygieneFinding[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<HygieneCheckId | null>(() => readStoredFilter());
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    window.localStorage.setItem(HYGIENE_PROJECT_KEY_STORAGE_KEY, projectKey);
  }, [projectKey]);

  useEffect(() => {
    if (selectedFilter === null) {
      window.localStorage.removeItem(HYGIENE_FILTER_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(HYGIENE_FILTER_STORAGE_KEY, selectedFilter);
  }, [selectedFilter]);

  const summary = useMemo(() => summarizeHygieneFindings(findings), [findings]);
  const filteredFindings = useMemo(
    () => filterFindingsByCheck(findings, selectedFilter),
    [findings, selectedFilter],
  );

  const selectFilter = useCallback((checkId: HygieneCheckId | null) => {
    setSelectedFilter((currentFilter) => (currentFilter === checkId ? EMPTY_FILTER : checkId));
  }, []);

  const loadHygiene = useCallback(async () => {
    const normalizedProjectKey = projectKey.trim();
    if (!normalizedProjectKey) {
      setFindings([]);
      setLoadError(null);
      return;
    }

    setIsLoading(true);
    setLoadError(null);
    try {
      const jiraSearchResponse = await jiraGet<JiraSearchResponse>(buildHygieneSearchPath(normalizedProjectKey, extraJql));
      setFindings(mapIssuesToFindings(jiraSearchResponse.issues ?? []));
    } catch (caughtError: unknown) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : 'Failed to load Hygiene results';
      setLoadError(errorMessage);
      setFindings([]);
    } finally {
      setIsLoading(false);
    }
  }, [extraJql, projectKey]);

  return {
    projectKey,
    extraJql,
    findings,
    filteredFindings,
    summary,
    selectedFilter,
    isLoading,
    loadError,
    setProjectKey,
    setExtraJql,
    selectFilter,
    loadHygiene,
  };
}

function mapIssuesToFindings(issues: JiraIssue[]): HygieneFinding[] {
  return issues.map(mapJiraIssueToHygieneFinding).filter((finding): finding is HygieneFinding => finding !== null);
}

function filterFindingsByCheck(findings: HygieneFinding[], selectedFilter: HygieneCheckId | null): HygieneFinding[] {
  if (selectedFilter === null) return findings;
  return findings.filter((finding) => finding.flags.some((flag) => flag.checkId === selectedFilter));
}

function readStoredProjectKey(): string {
  return window.localStorage.getItem(HYGIENE_PROJECT_KEY_STORAGE_KEY) ?? '';
}

function readStoredFilter(): HygieneCheckId | null {
  const storedFilter = window.localStorage.getItem(HYGIENE_FILTER_STORAGE_KEY);
  return HYGIENE_CHECK_IDS.some((checkId) => checkId === storedFilter) ? (storedFilter as HygieneCheckId) : null;
}
