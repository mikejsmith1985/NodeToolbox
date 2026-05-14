// usePrbState — State management for the PRB-to-Jira issue generator workflow.

import { useCallback, useMemo, useState } from 'react';

import { jiraPost } from '../../../services/jiraApi.ts';
import { snowFetch } from '../../../services/snowApi.ts';
import type { SnowUser } from '../../../types/snow.ts';

interface SnowPrbRecord {
  sysId: string;
  number: string;
  shortDescription: string;
  description: string;
  state: string;
  severity: string;
  assignedTo: SnowUser | null;
}

type ServiceNowFieldValue = string | { value?: unknown; display_value?: unknown };
type ServiceNowProblemRecord = Record<string, ServiceNowFieldValue | undefined>;

interface ServiceNowProblemQueryResponse {
  result: ServiceNowProblemRecord[];
}

interface PrbState {
  prbNumber: string;
  prbData: SnowPrbRecord | null;
  isFetchingPrb: boolean;
  fetchError: string | null;
  jiraProjectKey: string;
  defectSummaryTemplate: string;
  storySummaryTemplate: string;
  isCreatingIssues: boolean;
  createError: string | null;
  createdIssueKeys: string[];
}

interface PrbActions {
  setPrbNumber: (prbNumber: string) => void;
  fetchPrb: () => Promise<void>;
  setJiraProjectKey: (jiraProjectKey: string) => void;
  setDefectSummary: (summary: string) => void;
  setStorySummary: (summary: string) => void;
  createJiraIssues: () => Promise<void>;
  reset: () => void;
}

const EMPTY_VALUE = '';
const PROBLEM_TABLE_PATH = '/api/now/table/problem';
const PROBLEM_LOOKUP_FIELDS = 'sys_id,number,short_description,description,state,severity,assigned_to';
const SINGLE_RECORD_LIMIT = 1;
const JIRA_ISSUE_CREATE_PATH = '/rest/api/2/issue';
const PRB_REQUIRED_MESSAGE = 'PRB number is required.';
const PROJECT_REQUIRED_MESSAGE = 'Jira project key is required before creating issues.';
const PRB_REQUIRED_FOR_CREATION_MESSAGE = 'Load a PRB before creating Jira issues.';
const PRB_FETCH_FAILURE_MESSAGE = 'Failed to fetch PRB details';
const ISSUE_CREATE_FAILURE_MESSAGE = 'Failed to create Jira issues';
const PRB_NOT_FOUND_PREFIX = 'No PRB found with number:';

function createInitialPrbState(): PrbState {
  return {
    prbNumber: EMPTY_VALUE,
    prbData: null,
    isFetchingPrb: false,
    fetchError: null,
    jiraProjectKey: EMPTY_VALUE,
    defectSummaryTemplate: EMPTY_VALUE,
    storySummaryTemplate: EMPTY_VALUE,
    isCreatingIssues: false,
    createError: null,
    createdIssueKeys: [],
  };
}

function createDefectSummary(problemRecord: SnowPrbRecord): string {
  return `Defect for ${problemRecord.number}: ${problemRecord.shortDescription}`;
}

function createStorySummary(problemRecord: SnowPrbRecord): string {
  return `Story for ${problemRecord.number}: ${problemRecord.shortDescription}`;
}

function buildIssuePayload(
  jiraProjectKey: string,
  summary: string,
  issueTypeName: 'Bug' | 'Story',
  problemRecord: SnowPrbRecord,
) {
  return {
    fields: {
      project: { key: jiraProjectKey },
      summary,
      issuetype: { name: issueTypeName },
      description: `${problemRecord.number}\n\n${problemRecord.description}`,
    },
  };
}

function buildProblemLookupPath(prbNumber: string): string {
  const encodedQuery = encodeURIComponent(`number=${prbNumber}`);
  return `${PROBLEM_TABLE_PATH}?sysparm_query=${encodedQuery}&sysparm_limit=${SINGLE_RECORD_LIMIT}&sysparm_fields=${PROBLEM_LOOKUP_FIELDS}&sysparm_display_value=all`;
}

function extractServiceNowFieldValue(fieldValue: ServiceNowFieldValue | undefined): string {
  if (fieldValue === undefined) {
    return EMPTY_VALUE;
  }
  if (typeof fieldValue === 'string') {
    return fieldValue;
  }
  return String(fieldValue.display_value ?? fieldValue.value ?? EMPTY_VALUE);
}

function extractServiceNowReference(fieldValue: ServiceNowFieldValue | undefined): SnowUser | null {
  if (fieldValue === undefined || typeof fieldValue === 'string') {
    return null;
  }

  const sysId = String(fieldValue.value ?? EMPTY_VALUE);
  const name = String(fieldValue.display_value ?? EMPTY_VALUE);
  if (!sysId && !name) {
    return null;
  }
  return { sysId, name, email: EMPTY_VALUE };
}

function mapProblemRecord(problemRecord: ServiceNowProblemRecord): SnowPrbRecord {
  return {
    sysId:            extractServiceNowFieldValue(problemRecord.sys_id),
    number:           extractServiceNowFieldValue(problemRecord.number),
    shortDescription: extractServiceNowFieldValue(problemRecord.short_description),
    description:      extractServiceNowFieldValue(problemRecord.description),
    state:            extractServiceNowFieldValue(problemRecord.state),
    severity:         extractServiceNowFieldValue(problemRecord.severity),
    assignedTo:       extractServiceNowReference(problemRecord.assigned_to),
  };
}

/**
 * Manages the PRB generator so a loaded ServiceNow problem can be turned into paired Jira issues with editable summaries.
 */
export function usePrbState(): { state: PrbState; actions: PrbActions } {
  const [state, setState] = useState<PrbState>(() => createInitialPrbState());

  const setPrbNumber = useCallback((prbNumber: string) => {
    setState((previousState) => ({ ...previousState, prbNumber }));
  }, []);

  const fetchPrb = useCallback(async () => {
    if (!state.prbNumber) {
      setState((previousState) => ({ ...previousState, fetchError: PRB_REQUIRED_MESSAGE }));
      return;
    }

    setState((previousState) => ({ ...previousState, isFetchingPrb: true, fetchError: null }));

    try {
      const normalizedPrbNumber = state.prbNumber.trim().toUpperCase();
      const problemResponse = await snowFetch<ServiceNowProblemQueryResponse>(
        buildProblemLookupPath(normalizedPrbNumber),
      );

      const rawProblemRecord = problemResponse.result[0];
      if (!rawProblemRecord) {
        throw new Error(`${PRB_NOT_FOUND_PREFIX} ${normalizedPrbNumber}`);
      }

      const problemRecord = mapProblemRecord(rawProblemRecord);
      setState((previousState) => ({
        ...previousState,
        prbData: problemRecord,
        defectSummaryTemplate: createDefectSummary(problemRecord),
        storySummaryTemplate: createStorySummary(problemRecord),
        isFetchingPrb: false,
        fetchError: null,
      }));
    } catch (unknownError) {
      const fetchError = unknownError instanceof Error ? unknownError.message : PRB_FETCH_FAILURE_MESSAGE;
      setState((previousState) => ({ ...previousState, isFetchingPrb: false, fetchError }));
    }
  }, [state.prbNumber]);

  const setJiraProjectKey = useCallback((jiraProjectKey: string) => {
    setState((previousState) => ({ ...previousState, jiraProjectKey: jiraProjectKey.toUpperCase() }));
  }, []);

  const setDefectSummary = useCallback((summary: string) => {
    setState((previousState) => ({ ...previousState, defectSummaryTemplate: summary }));
  }, []);

  const setStorySummary = useCallback((summary: string) => {
    setState((previousState) => ({ ...previousState, storySummaryTemplate: summary }));
  }, []);

  const createJiraIssues = useCallback(async () => {
    if (!state.prbData) {
      setState((previousState) => ({ ...previousState, createError: PRB_REQUIRED_FOR_CREATION_MESSAGE }));
      return;
    }

    if (!state.jiraProjectKey) {
      setState((previousState) => ({ ...previousState, createError: PROJECT_REQUIRED_MESSAGE }));
      return;
    }

    setState((previousState) => ({
      ...previousState,
      isCreatingIssues: true,
      createError: null,
      createdIssueKeys: [],
    }));

    try {
      const [defectIssue, storyIssue] = await Promise.all([
        jiraPost<{ key: string }>(
          JIRA_ISSUE_CREATE_PATH,
          buildIssuePayload(state.jiraProjectKey, state.defectSummaryTemplate, 'Bug', state.prbData),
        ),
        jiraPost<{ key: string }>(
          JIRA_ISSUE_CREATE_PATH,
          buildIssuePayload(state.jiraProjectKey, state.storySummaryTemplate, 'Story', state.prbData),
        ),
      ]);

      setState((previousState) => ({
        ...previousState,
        isCreatingIssues: false,
        createError: null,
        createdIssueKeys: [defectIssue.key, storyIssue.key],
      }));
    } catch (unknownError) {
      const createError = unknownError instanceof Error ? unknownError.message : ISSUE_CREATE_FAILURE_MESSAGE;
      setState((previousState) => ({ ...previousState, isCreatingIssues: false, createError }));
    }
  }, [state.defectSummaryTemplate, state.jiraProjectKey, state.prbData, state.storySummaryTemplate]);

  const reset = useCallback(() => {
    setState(createInitialPrbState());
  }, []);

  const actions = useMemo<PrbActions>(() => {
    return {
      setPrbNumber,
      fetchPrb,
      setJiraProjectKey,
      setDefectSummary,
      setStorySummary,
      createJiraIssues,
      reset,
    };
  }, [createJiraIssues, fetchPrb, reset, setDefectSummary, setJiraProjectKey, setPrbNumber, setStorySummary]);

  return { state, actions };
}
