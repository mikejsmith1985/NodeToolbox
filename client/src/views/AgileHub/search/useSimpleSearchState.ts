// useSimpleSearchState.ts — Hidden-query Jira search state for the Agile Hub Simple Search space.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import type { JiraIssue, JiraIssueLink } from '../../../types/jira.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';

// Deliberately keeps the pre-consolidation key name so existing saved searches survive the move.
const SIMPLE_SEARCH_STORAGE_KEY = 'tbxBusinessHelperSimpleSearch';
const SIMPLE_SEARCH_MAX_RESULTS = 100;
const SIMPLE_SEARCH_FIELDS = [
  'summary',
  'status',
  'assignee',
  'issuetype',
  'created',
  'updated',
  'description',
].join(',');
const DETAIL_FIELDS = ['summary', 'status', 'assignee', 'issuetype', 'description', 'issuelinks', 'subtasks'].join(
  ',',
);
const CHILD_FIELDS = ['summary', 'status', 'issuetype'].join(',');
const CHILD_MAX_RESULTS = 100;
const EMPTY_RESULT_COUNT = 0;
const EMPTY_KEYWORD_ERROR = 'Enter a keyword before running the Jira search.';
const DEFAULT_DETAIL_ERROR = 'Failed to load issue detail';
const DEFAULT_CHILD_LABEL = 'Child';
const DEFAULT_LINK_LABEL = 'Linked';
const FEATURE_LINK_JQL = 'cf[10108]';
const PARENT_LINK_JQL = 'cf[10100]';
const JIRA_BAD_REQUEST_STATUS = '400';

const HIERARCHY_ISSUE_TYPE_MAP = {
  portfolio: ['Program Epic'],
  art: ['Feature'],
  team: ['Story', 'Bug', 'Defect', 'Task', 'Sub-task', 'Subtask'],
} as const;

const ALL_SUPPORTED_ISSUE_TYPES = [
  ...HIERARCHY_ISSUE_TYPE_MAP.portfolio,
  ...HIERARCHY_ISSUE_TYPE_MAP.art,
  ...HIERARCHY_ISSUE_TYPE_MAP.team,
] as const;

const MATCH_PRIORITY_BY_SORT = {
  'summary-first': ['summary-description', 'summary', 'description', 'jira'],
  'description-first': ['summary-description', 'description', 'summary', 'jira'],
} as const;

export type SimpleSearchHierarchyLevel = 'portfolio' | 'art' | 'team';
export type SimpleSearchSortOption =
  | 'summary-first'
  | 'description-first'
  | 'updated-desc'
  | 'created-desc'
  | 'key-asc';
export type SimpleSearchMatchLocation = 'summary' | 'description' | 'summary-description' | 'jira';
export type SimpleSearchRelationshipKind = 'child' | 'linked';

export interface SimpleSearchRelationshipIssue {
  key: string;
  summary: string;
  issueType: string;
  status: string;
  relationshipLabel: string;
  relationshipKind: SimpleSearchRelationshipKind;
}

export interface SimpleSearchIssueDetail {
  description: string;
  childIssues: SimpleSearchRelationshipIssue[];
  linkedIssues: SimpleSearchRelationshipIssue[];
}

export interface SimpleSearchResult {
  key: string;
  summary: string;
  issueType: string;
  status: string;
  assigneeName: string;
  created: string;
  updated: string;
  hierarchyLevel: SimpleSearchHierarchyLevel;
  matchLocation: SimpleSearchMatchLocation;
  projectKey: string;
}

export interface UseSimpleSearchStateResult {
  keyword: string;
  setKeyword: (keyword: string) => void;
  sortOption: SimpleSearchSortOption;
  setSortOption: (sortOption: SimpleSearchSortOption) => void;
  isLoading: boolean;
  errorMessage: string | null;
  results: SimpleSearchResult[];
  rawResultCount: number;
  hasSearched: boolean;
  runSearch: () => Promise<void>;
  detailByIssueKey: Record<string, SimpleSearchIssueDetail | undefined>;
  detailErrorByIssueKey: Record<string, string | undefined>;
  loadingDetailKeys: string[];
  loadIssueDetail: (issueKey: string) => Promise<void>;
}

interface PersistedSimpleSearchState {
  keyword: string;
  sortOption: SimpleSearchSortOption;
}

interface JiraSearchResponse {
  issues?: JiraIssue[];
  total?: number;
}

interface JiraSearchIssueFields {
  summary?: string;
  status?: { name?: string; statusCategory?: { key?: string } };
  issuetype?: { name?: string };
}

interface JiraSearchIssueRecord {
  key?: string;
  fields?: JiraSearchIssueFields;
}

interface JiraChildrenSearchResponse {
  issues?: JiraSearchIssueRecord[];
}

interface JiraIssueDetailResponse {
  key?: string;
  fields?: {
    description?: unknown;
    issuetype?: { name?: string };
    issuelinks?: JiraIssueLink[];
    subtasks?: JiraSearchIssueRecord[];
  };
}

function readPersistedSimpleSearchState(): PersistedSimpleSearchState {
  if (typeof window === 'undefined') {
    return createDefaultPersistedState();
  }

  try {
    const storedValue = window.localStorage.getItem(SIMPLE_SEARCH_STORAGE_KEY);
    if (!storedValue) {
      return createDefaultPersistedState();
    }

    const parsedValue = JSON.parse(storedValue) as Partial<PersistedSimpleSearchState>;
    return {
      keyword: typeof parsedValue.keyword === 'string' ? parsedValue.keyword : '',
      sortOption: isSortOption(parsedValue.sortOption) ? parsedValue.sortOption : 'summary-first',
    };
  } catch {
    return createDefaultPersistedState();
  }
}

function createDefaultPersistedState(): PersistedSimpleSearchState {
  return {
    keyword: '',
    sortOption: 'summary-first',
  };
}

function isSortOption(candidateValue: unknown): candidateValue is SimpleSearchSortOption {
  return candidateValue === 'summary-first'
    || candidateValue === 'description-first'
    || candidateValue === 'updated-desc'
    || candidateValue === 'created-desc'
    || candidateValue === 'key-asc';
}

function writePersistedSimpleSearchState(persistedState: PersistedSimpleSearchState): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(SIMPLE_SEARCH_STORAGE_KEY, JSON.stringify(persistedState));
  } catch {
    // Browser storage can be blocked, so the live in-memory state remains authoritative.
  }
}

function normalizeKeyword(keyword: string): string {
  return keyword.trim().replace(/\s+/g, ' ');
}

function buildQuotedJqlText(keyword: string): string {
  const escapedKeyword = keyword.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escapedKeyword}"`;
}

/** Builds the hidden Jira search path so business users only provide a plain keyword. */
export function buildSimpleSearchPath(keyword: string): string {
  const normalizedKeyword = normalizeKeyword(keyword);
  const quotedKeyword = buildQuotedJqlText(normalizedKeyword);
  const searchCriteria = `(summary ~ ${quotedKeyword} OR description ~ ${quotedKeyword})`;
  const searchJql = `${searchCriteria} ORDER BY updated DESC`;

  return `/rest/api/2/search?jql=${encodeURIComponent(searchJql)}&fields=${SIMPLE_SEARCH_FIELDS}&maxResults=${SIMPLE_SEARCH_MAX_RESULTS}`;
}

function buildIssueDetailPath(issueKey: string): string {
  return `/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=${DETAIL_FIELDS}`;
}

function buildChildSearchPath(jqlText: string): string {
  return `/rest/api/2/search?jql=${encodeURIComponent(jqlText)}&fields=${CHILD_FIELDS}&maxResults=${CHILD_MAX_RESULTS}`;
}

function detectHierarchyLevel(issueTypeName: string): SimpleSearchHierarchyLevel {
  if (hasIssueTypeMatch(HIERARCHY_ISSUE_TYPE_MAP.portfolio, issueTypeName)) {
    return 'portfolio';
  }

  if (hasIssueTypeMatch(HIERARCHY_ISSUE_TYPE_MAP.art, issueTypeName)) {
    return 'art';
  }

  return 'team';
}

function hasIssueTypeMatch(issueTypes: readonly string[], issueTypeName: string): boolean {
  return issueTypes.includes(issueTypeName);
}

function isSupportedBusinessIssueType(issueTypeName: string): boolean {
  return hasIssueTypeMatch(ALL_SUPPORTED_ISSUE_TYPES, issueTypeName);
}

/** Detects where the keyword appears so the result list can sort business-friendly matches first. */
export function detectKeywordMatchLocation(
  keyword: string,
  summaryText: string,
  descriptionText: string,
): SimpleSearchMatchLocation {
  const normalizedKeyword = normalizeKeyword(keyword).toLowerCase();
  const hasSummaryMatch = summaryText.toLowerCase().includes(normalizedKeyword);
  const hasDescriptionMatch = descriptionText.toLowerCase().includes(normalizedKeyword);

  if (hasSummaryMatch && hasDescriptionMatch) {
    return 'summary-description';
  }

  if (hasSummaryMatch) {
    return 'summary';
  }

  if (hasDescriptionMatch) {
    return 'description';
  }

  return 'jira';
}

function createSearchResult(rawIssue: JiraIssue, keyword: string): SimpleSearchResult {
  const normalizedDescription = normalizeRichTextToPlainText(rawIssue.fields.description);
  const issueType = rawIssue.fields.issuetype?.name ?? '';

  return {
    key: rawIssue.key,
    summary: rawIssue.fields.summary ?? '',
    issueType,
    status: rawIssue.fields.status?.name ?? '',
    assigneeName: rawIssue.fields.assignee?.displayName ?? '',
    created: rawIssue.fields.created ?? '',
    updated: rawIssue.fields.updated ?? '',
    hierarchyLevel: detectHierarchyLevel(issueType),
    matchLocation: detectKeywordMatchLocation(keyword, rawIssue.fields.summary ?? '', normalizedDescription),
    projectKey: rawIssue.key.split('-')[0] ?? rawIssue.key,
  };
}

function mapSupportedSearchResults(rawIssues: JiraIssue[], keyword: string): SimpleSearchResult[] {
  return rawIssues.flatMap((rawIssue) => {
    const issueTypeName = rawIssue.fields.issuetype?.name ?? '';
    if (!isSupportedBusinessIssueType(issueTypeName)) {
      return [];
    }

    return [createSearchResult(rawIssue, keyword)];
  });
}

function compareIsoDateDesc(firstDateText: string, secondDateText: string): number {
  return secondDateText.localeCompare(firstDateText);
}

function compareMatchPriority(
  firstResult: SimpleSearchResult,
  secondResult: SimpleSearchResult,
  sortOption: 'summary-first' | 'description-first',
): number {
  const matchPriority = MATCH_PRIORITY_BY_SORT[sortOption];
  const firstRank = matchPriority.indexOf(firstResult.matchLocation);
  const secondRank = matchPriority.indexOf(secondResult.matchLocation);

  if (firstRank !== secondRank) {
    return firstRank - secondRank;
  }

  return compareIsoDateDesc(firstResult.updated, secondResult.updated);
}

function sortSimpleSearchResults(
  rawResults: SimpleSearchResult[],
  sortOption: SimpleSearchSortOption,
): SimpleSearchResult[] {
  const sortedResults = [...rawResults];
  sortedResults.sort((firstResult, secondResult) => {
    if (sortOption === 'summary-first' || sortOption === 'description-first') {
      return compareMatchPriority(firstResult, secondResult, sortOption);
    }

    if (sortOption === 'updated-desc') {
      return compareIsoDateDesc(firstResult.updated, secondResult.updated);
    }

    if (sortOption === 'created-desc') {
      return compareIsoDateDesc(firstResult.created, secondResult.created);
    }

    return firstResult.key.localeCompare(secondResult.key);
  });
  return sortedResults;
}

function createRelationshipIssue(
  issueKey: string,
  fields: JiraSearchIssueFields | undefined,
  relationshipLabel: string,
  relationshipKind: SimpleSearchRelationshipKind,
): SimpleSearchRelationshipIssue {
  return {
    key: issueKey,
    summary: fields?.summary ?? '',
    issueType: fields?.issuetype?.name ?? '',
    status: fields?.status?.name ?? '',
    relationshipLabel,
    relationshipKind,
  };
}

function mapLinkedIssues(issueLinks: JiraIssueLink[] | undefined): SimpleSearchRelationshipIssue[] {
  return (issueLinks ?? [])
    .flatMap((issueLink) => {
      if (issueLink.outwardIssue) {
        return [
          createRelationshipIssue(
            issueLink.outwardIssue.key,
            issueLink.outwardIssue.fields,
            issueLink.type?.outward ?? issueLink.type?.name ?? DEFAULT_LINK_LABEL,
            'linked',
          ),
        ];
      }

      if (issueLink.inwardIssue) {
        return [
          createRelationshipIssue(
            issueLink.inwardIssue.key,
            issueLink.inwardIssue.fields,
            issueLink.type?.inward ?? issueLink.type?.name ?? DEFAULT_LINK_LABEL,
            'linked',
          ),
        ];
      }

      return [];
    });
}

function mapChildIssues(childRecords: JiraSearchIssueRecord[]): SimpleSearchRelationshipIssue[] {
  return childRecords.flatMap((childRecord) => {
    if (!childRecord.key) {
      return [];
    }

    return [createRelationshipIssue(childRecord.key, childRecord.fields, DEFAULT_CHILD_LABEL, 'child')];
  });
}

function mergeUniqueRelationshipIssues(
  currentIssues: SimpleSearchRelationshipIssue[],
  nextIssues: SimpleSearchRelationshipIssue[],
): SimpleSearchRelationshipIssue[] {
  const relationshipIssueMap = new Map(currentIssues.map((relationshipIssue) => [relationshipIssue.key, relationshipIssue]));

  nextIssues.forEach((relationshipIssue) => {
    relationshipIssueMap.set(relationshipIssue.key, relationshipIssue);
  });

  return [...relationshipIssueMap.values()];
}

function readChildQueryCandidates(issueKey: string, issueTypeName: string): string[] {
  const normalizedIssueTypeName = issueTypeName.toLowerCase();
  const normalizedIssueKey = issueKey.trim().toUpperCase();

  if (normalizedIssueTypeName === 'program epic') {
    return [`parent = ${normalizedIssueKey}`, `${PARENT_LINK_JQL} = ${normalizedIssueKey}`];
  }

  if (normalizedIssueTypeName === 'feature') {
    return [
      `parent = ${normalizedIssueKey}`,
      `"Epic Link" = ${normalizedIssueKey}`,
      `${FEATURE_LINK_JQL} = ${normalizedIssueKey}`,
    ];
  }

  return [`parent = ${normalizedIssueKey}`];
}

function isBadRequestError(caughtError: unknown): boolean {
  return caughtError instanceof Error && caughtError.message.includes(JIRA_BAD_REQUEST_STATUS);
}

async function fetchChildIssues(
  issueKey: string,
  issueTypeName: string,
  subtasks: JiraSearchIssueRecord[],
): Promise<SimpleSearchRelationshipIssue[]> {
  let childIssues = mapChildIssues(subtasks);

  for (const childQueryCandidate of readChildQueryCandidates(issueKey, issueTypeName)) {
    try {
      const childSearchResponse = await jiraGet<JiraChildrenSearchResponse>(buildChildSearchPath(childQueryCandidate));
      const queriedChildIssues = mapChildIssues(childSearchResponse.issues ?? []);
      childIssues = mergeUniqueRelationshipIssues(childIssues, queriedChildIssues);
      if (queriedChildIssues.length > 0) {
        return childIssues;
      }
    } catch (caughtError) {
      if (!isBadRequestError(caughtError)) {
        return childIssues;
      }
    }
  }

  return childIssues;
}

/** Owns the Simple Search state, persistence, and hidden Jira query execution. */
export function useSimpleSearchState(): UseSimpleSearchStateResult {
  const [persistedState, setPersistedState] = useState<PersistedSimpleSearchState>(
    readPersistedSimpleSearchState,
  );
  const [rawResults, setRawResults] = useState<SimpleSearchResult[]>([]);
  const [rawResultCount, setRawResultCount] = useState(EMPTY_RESULT_COUNT);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [detailByIssueKey, setDetailByIssueKey] = useState<Record<string, SimpleSearchIssueDetail | undefined>>({});
  const [detailErrorByIssueKey, setDetailErrorByIssueKey] = useState<Record<string, string | undefined>>({});
  const [loadingDetailKeys, setLoadingDetailKeys] = useState<string[]>([]);

  useEffect(() => {
    writePersistedSimpleSearchState(persistedState);
  }, [persistedState]);

  const setKeyword = useCallback((keyword: string) => {
    setPersistedState((currentState) => ({ ...currentState, keyword }));
  }, []);

  const setSortOption = useCallback((sortOption: SimpleSearchSortOption) => {
    setPersistedState((currentState) => ({ ...currentState, sortOption }));
  }, []);

  const runSearch = useCallback(async () => {
    const normalizedKeyword = normalizeKeyword(persistedState.keyword);
    if (!normalizedKeyword) {
      setHasSearched(false);
      setRawResults([]);
      setRawResultCount(EMPTY_RESULT_COUNT);
      setErrorMessage(EMPTY_KEYWORD_ERROR);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const searchPath = buildSimpleSearchPath(normalizedKeyword);
      const searchResponse = await jiraGet<JiraSearchResponse>(searchPath);
      const mappedResults = mapSupportedSearchResults(searchResponse.issues ?? [], normalizedKeyword);
      setRawResults(mappedResults);
      setRawResultCount(mappedResults.length);
      setDetailByIssueKey({});
      setDetailErrorByIssueKey({});
      setLoadingDetailKeys([]);
      setHasSearched(true);
    } catch (searchError) {
      setRawResults([]);
      setRawResultCount(EMPTY_RESULT_COUNT);
      setHasSearched(false);
      setErrorMessage(searchError instanceof Error ? searchError.message : 'Simple Search failed');
    } finally {
      setIsLoading(false);
    }
  }, [persistedState.keyword]);

  const loadIssueDetail = useCallback(async (issueKey: string) => {
    if (detailByIssueKey[issueKey] || loadingDetailKeys.includes(issueKey)) {
      return;
    }

    setLoadingDetailKeys((currentKeys) => [...currentKeys, issueKey]);
    setDetailErrorByIssueKey((currentErrors) => ({ ...currentErrors, [issueKey]: undefined }));

    try {
      const issueDetailResponse = await jiraGet<JiraIssueDetailResponse>(buildIssueDetailPath(issueKey));
      const issueFields = issueDetailResponse.fields ?? {};
      const description = normalizeRichTextToPlainText(issueFields.description);
      const issueTypeName = issueFields.issuetype?.name ?? '';
      const childIssues = await fetchChildIssues(issueKey, issueTypeName, issueFields.subtasks ?? []);
      const linkedIssues = mapLinkedIssues(issueFields.issuelinks);

      setDetailByIssueKey((currentDetails) => ({
        ...currentDetails,
        [issueKey]: {
          description,
          childIssues,
          linkedIssues,
        },
      }));
    } catch (detailError) {
      setDetailErrorByIssueKey((currentErrors) => ({
        ...currentErrors,
        [issueKey]: detailError instanceof Error ? detailError.message : DEFAULT_DETAIL_ERROR,
      }));
    } finally {
      setLoadingDetailKeys((currentKeys) => currentKeys.filter((loadingIssueKey) => loadingIssueKey !== issueKey));
    }
  }, [detailByIssueKey, loadingDetailKeys]);

  const results = useMemo(
    () => sortSimpleSearchResults(rawResults, persistedState.sortOption),
    [persistedState.sortOption, rawResults],
  );

  return useMemo(
    () => ({
      keyword: persistedState.keyword,
      setKeyword,
      sortOption: persistedState.sortOption,
      setSortOption,
      isLoading,
      errorMessage,
      results,
      rawResultCount,
      hasSearched,
      runSearch,
      detailByIssueKey,
      detailErrorByIssueKey,
      loadingDetailKeys,
      loadIssueDetail,
    }),
    [
      detailByIssueKey,
      detailErrorByIssueKey,
      errorMessage,
      hasSearched,
      isLoading,
      loadIssueDetail,
      loadingDetailKeys,
      persistedState.keyword,
      persistedState.sortOption,
      rawResultCount,
      results,
      runSearch,
      setKeyword,
      setSortOption,
    ],
  );
}
