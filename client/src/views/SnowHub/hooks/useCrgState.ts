// useCrgState — State management for the five-step Change Request Generator workflow.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import { snowFetch } from '../../../services/snowApi.ts';
import type { JiraIssue } from '../../../types/jira.ts';

type CrgStep = 1 | 2 | 3 | 4 | 5;
// How the user wants to pull issues in Step 1: by project key + fix version, or a raw JQL query.
type FetchMode = 'project' | 'jql';
type GeneratedFieldKey = 'shortDescription' | 'description' | 'justification' | 'riskImpact';
type EnvironmentKey = 'rel' | 'prd' | 'pfix';

interface EnvironmentConfig {
  isEnabled: boolean;
  plannedStartDate: string;
  plannedEndDate: string;
}

interface CrgState {
  currentStep: CrgStep;
  fetchMode: FetchMode;
  projectKey: string;
  fixVersion: string;
  /** Raw JQL entered by the user when fetchMode is 'jql'. */
  customJql: string;
  availableFixVersions: string[];
  fetchedIssues: JiraIssue[];
  selectedIssueKeys: Set<string>;
  isFetchingIssues: boolean;
  fetchError: string | null;
  generatedShortDescription: string;
  generatedDescription: string;
  generatedJustification: string;
  generatedRiskImpact: string;
  relEnvironment: EnvironmentConfig;
  prdEnvironment: EnvironmentConfig;
  pfixEnvironment: EnvironmentConfig;
  isSubmitting: boolean;
  submitResult: string | null;
}

interface CrgActions {
  setFetchMode: (fetchMode: FetchMode) => void;
  setProjectKey: (projectKey: string) => void;
  setFixVersion: (fixVersion: string) => void;
  setCustomJql: (customJql: string) => void;
  fetchIssues: () => Promise<void>;
  toggleIssueSelection: (issueKey: string) => void;
  selectAllIssues: (shouldSelectAllIssues: boolean) => void;
  generateDocs: () => void;
  updateGeneratedField: (fieldName: GeneratedFieldKey, value: string) => void;
  updateEnvironment: (environmentKey: EnvironmentKey, update: Partial<EnvironmentConfig>) => void;
  goToStep: (step: CrgStep) => void;
  reset: () => void;
  /** POSTs the generated CHG fields to ServiceNow and stores the resulting CHG number. */
  createChg: () => Promise<void>;
}

const EMPTY_VALUE = '';
const EMPTY_FETCH_ERROR = null;
const REQUIRED_FIELDS_MESSAGE = 'Project key and fix version are required.';
const REQUIRED_JQL_MESSAGE = 'A JQL query is required.';
const FETCH_FAILURE_MESSAGE = 'Failed to fetch issues';
const DEFAULT_MAX_RESULTS = 100;
const ISSUE_FIELD_LIST = 'summary,status,priority,issuetype,assignee';

function createDefaultEnvironmentConfig(): EnvironmentConfig {
  return {
    isEnabled: false,
    plannedStartDate: EMPTY_VALUE,
    plannedEndDate: EMPTY_VALUE,
  };
}

function createInitialCrgState(): CrgState {
  return {
    currentStep: 1,
    fetchMode: 'project',
    projectKey: EMPTY_VALUE,
    fixVersion: EMPTY_VALUE,
    customJql: EMPTY_VALUE,
    availableFixVersions: [],
    fetchedIssues: [],
    selectedIssueKeys: new Set<string>(),
    isFetchingIssues: false,
    fetchError: EMPTY_FETCH_ERROR,
    generatedShortDescription: EMPTY_VALUE,
    generatedDescription: EMPTY_VALUE,
    generatedJustification: EMPTY_VALUE,
    generatedRiskImpact: EMPTY_VALUE,
    relEnvironment: { ...createDefaultEnvironmentConfig(), isEnabled: true },
    prdEnvironment: { ...createDefaultEnvironmentConfig(), isEnabled: true },
    pfixEnvironment: createDefaultEnvironmentConfig(),
    isSubmitting: false,
    submitResult: null,
  };
}

function buildProjectSearchPath(projectKey: string, fixVersion: string): string {
  const jql = `project = "${projectKey}" AND fixVersion = "${fixVersion}" ORDER BY priority ASC`;
  const encodedJql = encodeURIComponent(jql);
  return `/rest/api/2/search?jql=${encodedJql}&maxResults=${DEFAULT_MAX_RESULTS}&fields=${ISSUE_FIELD_LIST}`;
}

/**
 * Builds the Jira search API path for a raw JQL query string provided by the user.
 */
function buildJqlSearchPath(customJql: string): string {
  const encodedJql = encodeURIComponent(customJql);
  return `/rest/api/2/search?jql=${encodedJql}&maxResults=${DEFAULT_MAX_RESULTS}&fields=${ISSUE_FIELD_LIST}`;
}

function buildIssueList(selectedIssues: JiraIssue[]): string {
  return selectedIssues
    .map((jiraIssue) => `- [${jiraIssue.key}] ${jiraIssue.fields.summary}`)
    .join('\n');
}

/**
 * Returns a human-readable release label used in generated doc fields.
 * In project mode this is "PROJECT VERSION"; in JQL mode it describes the query result count
 * since there is no canonical version string to reference.
 */
function buildReleaseLabel(fetchMode: FetchMode, projectKey: string, fixVersion: string, issueCount: number): string {
  if (fetchMode === 'jql') {
    return `custom JQL query (${issueCount} issue(s))`;
  }

  return `${projectKey} ${fixVersion}`;
}

function getGeneratedStateKey(fieldName: GeneratedFieldKey) {
  const generatedFieldMap = {
    shortDescription: 'generatedShortDescription',
    description: 'generatedDescription',
    justification: 'generatedJustification',
    riskImpact: 'generatedRiskImpact',
  } as const;

  return generatedFieldMap[fieldName];
}

function getEnvironmentStateKey(environmentKey: EnvironmentKey) {
  const environmentStateKeyMap = {
    rel: 'relEnvironment',
    prd: 'prdEnvironment',
    pfix: 'pfixEnvironment',
  } as const;

  return environmentStateKeyMap[environmentKey];
}

/**
 * Manages the Change Request Generator wizard state so the tab can guide users from Jira issue lookup to final submission preview.
 */
export function useCrgState(): { state: CrgState; actions: CrgActions } {
  const [state, setState] = useState<CrgState>(() => createInitialCrgState());

  const setFetchMode = useCallback((fetchMode: FetchMode) => {
    // Switching modes clears any previous fetch error so the user starts fresh with the new input method.
    setState((previousState) => ({ ...previousState, fetchMode, fetchError: EMPTY_FETCH_ERROR }));
  }, []);

  const setProjectKey = useCallback((projectKey: string) => {
    setState((previousState) => ({ ...previousState, projectKey: projectKey.toUpperCase() }));
  }, []);

  const setFixVersion = useCallback((fixVersion: string) => {
    setState((previousState) => ({ ...previousState, fixVersion }));
  }, []);

  const setCustomJql = useCallback((customJql: string) => {
    setState((previousState) => ({ ...previousState, customJql }));
  }, []);

  useEffect(() => {
    let isCancelled = false;

    if (!state.projectKey) {
      setState((previousState) => ({ ...previousState, availableFixVersions: [] }));
      return () => {
        isCancelled = true;
      };
    }

    void jiraGet<{ id: string; name: string; released: boolean }[]>(
      `/rest/api/2/project/${state.projectKey}/versions`,
    )
      .then((versions) => {
        if (isCancelled) {
          return;
        }

        setState((previousState) => ({
          ...previousState,
          // Include all versions (released and unreleased) — users may need to
          // create change requests against already-released versions (e.g. hotfixes).
          availableFixVersions: versions.map((version) => version.name),
        }));
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }

        setState((previousState) => ({ ...previousState, availableFixVersions: [] }));
      });

    return () => {
      isCancelled = true;
    };
  }, [state.projectKey]);

  const fetchIssues = useCallback(async () => {
    // Validate required inputs based on which fetch mode is active.
    if (state.fetchMode === 'project' && (!state.projectKey || !state.fixVersion)) {
      setState((previousState) => ({ ...previousState, fetchError: REQUIRED_FIELDS_MESSAGE }));
      return;
    }

    if (state.fetchMode === 'jql' && !state.customJql.trim()) {
      setState((previousState) => ({ ...previousState, fetchError: REQUIRED_JQL_MESSAGE }));
      return;
    }

    setState((previousState) => ({ ...previousState, isFetchingIssues: true, fetchError: EMPTY_FETCH_ERROR }));

    try {
      const searchPath = state.fetchMode === 'jql'
        ? buildJqlSearchPath(state.customJql)
        : buildProjectSearchPath(state.projectKey, state.fixVersion);
      const searchResponse = await jiraGet<{ issues: JiraIssue[] }>(searchPath);
      const selectedIssueKeys = new Set(searchResponse.issues.map((jiraIssue) => jiraIssue.key));
      setState((previousState) => ({
        ...previousState,
        fetchedIssues: searchResponse.issues,
        selectedIssueKeys,
        isFetchingIssues: false,
        currentStep: 2,
      }));
    } catch (unknownError) {
      const fetchError = unknownError instanceof Error ? unknownError.message : FETCH_FAILURE_MESSAGE;
      setState((previousState) => ({
        ...previousState,
        isFetchingIssues: false,
        fetchError,
      }));
    }
  }, [state.customJql, state.fetchMode, state.fixVersion, state.projectKey]);

  const toggleIssueSelection = useCallback((issueKey: string) => {
    setState((previousState) => {
      const nextSelectedIssueKeys = new Set(previousState.selectedIssueKeys);

      if (nextSelectedIssueKeys.has(issueKey)) {
        nextSelectedIssueKeys.delete(issueKey);
      } else {
        nextSelectedIssueKeys.add(issueKey);
      }

      return { ...previousState, selectedIssueKeys: nextSelectedIssueKeys };
    });
  }, []);

  const selectAllIssues = useCallback((shouldSelectAllIssues: boolean) => {
    setState((previousState) => ({
      ...previousState,
      selectedIssueKeys: shouldSelectAllIssues
        ? new Set(previousState.fetchedIssues.map((jiraIssue) => jiraIssue.key))
        : new Set<string>(),
    }));
  }, []);

  const generateDocs = useCallback(() => {
    setState((previousState) => {
      const selectedIssues = previousState.fetchedIssues.filter((jiraIssue) => {
        return previousState.selectedIssueKeys.has(jiraIssue.key);
      });
      const issueList = buildIssueList(selectedIssues);
      const releaseLabel = buildReleaseLabel(
        previousState.fetchMode,
        previousState.projectKey,
        previousState.fixVersion,
        selectedIssues.length,
      );

      return {
        ...previousState,
        generatedShortDescription: `Deploy ${releaseLabel}`,
        generatedDescription: `The following Jira issues are included in this release:\n\n${issueList}`,
        generatedJustification: `Planned release of ${releaseLabel} containing ${selectedIssues.length} issue(s).`,
        generatedRiskImpact: `Standard deployment risk. ${selectedIssues.length} issue(s) included. Follow standard runbook.`,
        currentStep: 3,
      };
    });
  }, []);

  const updateGeneratedField = useCallback((fieldName: GeneratedFieldKey, value: string) => {
    const generatedStateKey = getGeneratedStateKey(fieldName);
    setState((previousState) => ({ ...previousState, [generatedStateKey]: value }));
  }, []);

  const updateEnvironment = useCallback((environmentKey: EnvironmentKey, update: Partial<EnvironmentConfig>) => {
    const environmentStateKey = getEnvironmentStateKey(environmentKey);
    setState((previousState) => ({
      ...previousState,
      [environmentStateKey]: {
        ...previousState[environmentStateKey],
        ...update,
      },
    }));
  }, []);

  const goToStep = useCallback((step: CrgStep) => {
    setState((previousState) => ({ ...previousState, currentStep: step }));
  }, []);

  const reset = useCallback(() => {
    setState(createInitialCrgState());
  }, []);

  /**
   * Creates a ServiceNow Change Request using the generated CHG content.
   * Uses the browser relay (bookmarklet must be active on the SNow tab).
   * Sets isSubmitting while the request is in-flight, then stores the CHG
   * number in submitResult on success or an error message on failure.
   */
  const createChg = useCallback(async () => {
    setState((previousState) => ({ ...previousState, isSubmitting: true, submitResult: null }));

    try {
      const responseData = await snowFetch<{ result: { number: string } }>(
        '/api/now/table/change_request',
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            short_description:    state.generatedShortDescription,
            description:          state.generatedDescription,
            justification:        state.generatedJustification,
            risk_impact_analysis: state.generatedRiskImpact,
          }),
        },
      );

      const changeNumber = responseData.result.number;
      setState((previousState) => ({
        ...previousState,
        isSubmitting: false,
        submitResult: `${changeNumber} created`,
        currentStep:  4 as CrgStep,
      }));
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'CHG creation failed';
      setState((previousState) => ({
        ...previousState,
        isSubmitting: false,
        submitResult: 'Error: ' + errorMessage,
      }));
    }
  }, [state.generatedShortDescription, state.generatedDescription, state.generatedJustification, state.generatedRiskImpact]);

  const actions = useMemo<CrgActions>(() => {
    return {
      setFetchMode,
      setProjectKey,
      setFixVersion,
      setCustomJql,
      fetchIssues,
      toggleIssueSelection,
      selectAllIssues,
      generateDocs,
      updateGeneratedField,
      updateEnvironment,
      goToStep,
      reset,
      createChg,
    };
  }, [fetchIssues, generateDocs, goToStep, reset, selectAllIssues, setCustomJql, setFetchMode, setFixVersion, setProjectKey, toggleIssueSelection, updateEnvironment, updateGeneratedField, createChg]);

  return { state, actions };
}
