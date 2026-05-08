// useCrgState — State management for the five-step Change Request Generator workflow.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import type { JiraIssue } from '../../../types/jira.ts';

type CrgStep = 1 | 2 | 3 | 4 | 5;
type GeneratedFieldKey = 'shortDescription' | 'description' | 'justification' | 'riskImpact';
type EnvironmentKey = 'rel' | 'prd' | 'pfix';

interface EnvironmentConfig {
  isEnabled: boolean;
  plannedStartDate: string;
  plannedEndDate: string;
}

interface CrgState {
  currentStep: CrgStep;
  projectKey: string;
  fixVersion: string;
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
  setProjectKey: (projectKey: string) => void;
  setFixVersion: (fixVersion: string) => void;
  fetchIssues: () => Promise<void>;
  toggleIssueSelection: (issueKey: string) => void;
  selectAllIssues: (shouldSelectAllIssues: boolean) => void;
  generateDocs: () => void;
  updateGeneratedField: (fieldName: GeneratedFieldKey, value: string) => void;
  updateEnvironment: (environmentKey: EnvironmentKey, update: Partial<EnvironmentConfig>) => void;
  goToStep: (step: CrgStep) => void;
  reset: () => void;
}

const EMPTY_VALUE = '';
const EMPTY_FETCH_ERROR = null;
const REQUIRED_FIELDS_MESSAGE = 'Project key and fix version are required.';
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
    projectKey: EMPTY_VALUE,
    fixVersion: EMPTY_VALUE,
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

function buildSearchPath(projectKey: string, fixVersion: string): string {
  const jql = `project = "${projectKey}" AND fixVersion = "${fixVersion}" ORDER BY priority ASC`;
  const encodedJql = encodeURIComponent(jql);
  return `/rest/api/2/search?jql=${encodedJql}&maxResults=${DEFAULT_MAX_RESULTS}&fields=${ISSUE_FIELD_LIST}`;
}

function buildIssueList(selectedIssues: JiraIssue[]): string {
  return selectedIssues
    .map((jiraIssue) => `- [${jiraIssue.key}] ${jiraIssue.fields.summary}`)
    .join('\n');
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

  const setProjectKey = useCallback((projectKey: string) => {
    setState((previousState) => ({ ...previousState, projectKey: projectKey.toUpperCase() }));
  }, []);

  const setFixVersion = useCallback((fixVersion: string) => {
    setState((previousState) => ({ ...previousState, fixVersion }));
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
          availableFixVersions: versions
            .filter((version) => !version.released)
            .map((version) => version.name),
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
    if (!state.projectKey || !state.fixVersion) {
      setState((previousState) => ({ ...previousState, fetchError: REQUIRED_FIELDS_MESSAGE }));
      return;
    }

    setState((previousState) => ({ ...previousState, isFetchingIssues: true, fetchError: EMPTY_FETCH_ERROR }));

    try {
      const searchPath = buildSearchPath(state.projectKey, state.fixVersion);
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
  }, [state.fixVersion, state.projectKey]);

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

      return {
        ...previousState,
        generatedShortDescription: `Deploy ${previousState.projectKey} ${previousState.fixVersion}`,
        generatedDescription: `The following Jira issues are included in this release:\n\n${issueList}`,
        generatedJustification: `Planned release of ${previousState.projectKey} ${previousState.fixVersion} containing ${selectedIssues.length} issue(s).`,
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

  const actions = useMemo<CrgActions>(() => {
    return {
      setProjectKey,
      setFixVersion,
      fetchIssues,
      toggleIssueSelection,
      selectAllIssues,
      generateDocs,
      updateGeneratedField,
      updateEnvironment,
      goToStep,
      reset,
    };
  }, [fetchIssues, generateDocs, goToStep, reset, selectAllIssues, setFixVersion, setProjectKey, toggleIssueSelection, updateEnvironment, updateGeneratedField]);

  return { state, actions };
}
