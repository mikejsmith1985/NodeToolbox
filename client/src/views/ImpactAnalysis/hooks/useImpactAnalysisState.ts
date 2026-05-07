// useImpactAnalysisState.ts — State, persistence, and Jira loading for the Impact Analysis view.
//
// The hook keeps the render layer focused while it performs the two Jira lookups needed
// for blast-radius analysis: the root issue with links, and Epic children when applicable.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import {
  computeBlastStats,
  mapJiraIssueToRelatedIssue,
  parseIssueLinks,
  type BlastChild,
  type BlastLink,
  type BlastStats,
  type JiraIssueLink,
} from '../utils/blastRadius.ts';

const IMPACT_FIELDS = 'summary,status,assignee,issuetype,priority,issuelinks';
const CHILD_FIELDS = 'summary,status';
const CHILD_MAX_RESULTS = 100;
const DEFAULT_ERROR_MESSAGE = 'Failed to load Impact Analysis';
const EPIC_ISSUE_TYPE = 'epic';
const JIRA_BAD_REQUEST_STATUS = '400';

export const IMPACT_ANALYSIS_STORAGE_KEY = 'tbxImpactAnalysisKey';

interface JiraNamedField {
  name?: string;
}

interface JiraUserField {
  displayName?: string;
}

interface JiraRootIssueFields {
  summary?: string;
  status?: JiraNamedField;
  assignee?: JiraUserField | null;
  issuetype?: JiraNamedField;
  priority?: JiraNamedField;
  issuelinks?: JiraIssueLink[];
}

export interface JiraRootIssue {
  key: string;
  fields?: JiraRootIssueFields;
}

export interface JiraChildrenSearchResponse {
  issues?: Array<{ key?: string; fields?: { summary?: string; status?: { name?: string; statusCategory?: { key?: string } } } }>;
}

export interface RootIssue {
  key: string;
  summary: string;
  statusName: string;
  typeName: string;
  priorityName: string;
  assigneeName: string | null;
  isEpic: boolean;
}

export interface UseImpactAnalysisState {
  issueKey: string;
  setIssueKey: (key: string) => void;
  isLoading: boolean;
  errorMessage: string | null;
  root: RootIssue | null;
  inward: BlastLink[];
  outward: BlastLink[];
  children: BlastChild[];
  stats: BlastStats;
  search: () => Promise<void>;
}

/** Builds the Jira issue URL for the requested root issue key. */
export function buildImpactIssuePath(issueKey: string): string {
  return `/rest/api/2/issue/${encodeURIComponent(issueKey.trim().toUpperCase())}?fields=${IMPACT_FIELDS}`;
}

/** Builds the Jira child-search URL, supporting both parent and legacy Epic Link clauses. */
export function buildChildSearchPath(issueKey: string, fieldName: 'parent' | 'Epic Link'): string {
  const normalizedIssueKey = issueKey.trim().toUpperCase();
  const jqlText = fieldName === 'parent' ? `parent=${normalizedIssueKey}` : `"Epic Link" = ${normalizedIssueKey}`;
  return `/rest/api/2/search?jql=${encodeURIComponent(jqlText)}&fields=${CHILD_FIELDS}&maxResults=${CHILD_MAX_RESULTS}`;
}

/** Converts the root Jira issue into the card model displayed at the top of Impact Analysis. */
export function mapJiraIssueToRootIssue(issue: JiraRootIssue): RootIssue {
  const fields = issue.fields ?? {};
  const typeName = fields.issuetype?.name?.trim() || 'Unknown';

  return {
    key: issue.key,
    summary: fields.summary?.trim() || 'Untitled Jira issue',
    statusName: fields.status?.name?.trim() || 'Unknown',
    typeName,
    priorityName: fields.priority?.name?.trim() || 'None',
    assigneeName: fields.assignee?.displayName?.trim() || null,
    isEpic: typeName.toLowerCase() === EPIC_ISSUE_TYPE,
  };
}

/** Owns Impact Analysis search state so the view can render simple loading, error, and result states. */
export function useImpactAnalysisState(): UseImpactAnalysisState {
  const [issueKey, setIssueKey] = useState<string>(() => readStoredIssueKey());
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [root, setRoot] = useState<RootIssue | null>(null);
  const [inward, setInward] = useState<BlastLink[]>([]);
  const [outward, setOutward] = useState<BlastLink[]>([]);
  const [children, setChildren] = useState<BlastChild[]>([]);

  useEffect(() => {
    if (!issueKey.trim()) window.localStorage.removeItem(IMPACT_ANALYSIS_STORAGE_KEY);
  }, [issueKey]);

  const stats = useMemo(() => computeBlastStats(inward, outward, children), [children, inward, outward]);

  const search = useCallback(async () => {
    const normalizedIssueKey = issueKey.trim().toUpperCase();
    if (!normalizedIssueKey) {
      clearResults(setRoot, setInward, setOutward, setChildren);
      setErrorMessage('Enter an issue key before searching.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const jiraIssue = await jiraGet<JiraRootIssue>(buildImpactIssuePath(normalizedIssueKey));
      const rootIssue = mapJiraIssueToRootIssue(jiraIssue);
      const parsedLinks = parseIssueLinks(jiraIssue.fields?.issuelinks);
      const childIssues = rootIssue.isEpic ? await fetchEpicChildren(normalizedIssueKey) : [];

      window.localStorage.setItem(IMPACT_ANALYSIS_STORAGE_KEY, normalizedIssueKey);
      setIssueKey(normalizedIssueKey);
      setRoot(rootIssue);
      setInward(parsedLinks.inward);
      setOutward(parsedLinks.outward);
      setChildren(childIssues);
    } catch (caughtError: unknown) {
      clearResults(setRoot, setInward, setOutward, setChildren);
      setErrorMessage(caughtError instanceof Error ? caughtError.message : DEFAULT_ERROR_MESSAGE);
    } finally {
      setIsLoading(false);
    }
  }, [issueKey]);

  return { issueKey, setIssueKey, isLoading, errorMessage, root, inward, outward, children, stats, search };
}

async function fetchEpicChildren(issueKey: string): Promise<BlastChild[]> {
  try {
    return await fetchChildrenWithField(issueKey, 'parent');
  } catch (caughtError: unknown) {
    if (!isBadRequestError(caughtError)) throw caughtError;
    // Some Jira projects still store Epic membership in the legacy Epic Link field.
    return fetchChildrenWithField(issueKey, 'Epic Link');
  }
}

async function fetchChildrenWithField(issueKey: string, fieldName: 'parent' | 'Epic Link'): Promise<BlastChild[]> {
  const childSearchResponse = await jiraGet<JiraChildrenSearchResponse>(buildChildSearchPath(issueKey, fieldName));
  return (childSearchResponse.issues ?? []).map((issue) => mapJiraIssueToRelatedIssue(issue));
}

function clearResults(
  setRoot: (rootIssue: RootIssue | null) => void,
  setInward: (links: BlastLink[]) => void,
  setOutward: (links: BlastLink[]) => void,
  setChildren: (childIssues: BlastChild[]) => void,
): void {
  setRoot(null);
  setInward([]);
  setOutward([]);
  setChildren([]);
}

function isBadRequestError(caughtError: unknown): boolean {
  return caughtError instanceof Error && caughtError.message.includes(JIRA_BAD_REQUEST_STATUS);
}

function readStoredIssueKey(): string {
  return window.localStorage.getItem(IMPACT_ANALYSIS_STORAGE_KEY) ?? '';
}
