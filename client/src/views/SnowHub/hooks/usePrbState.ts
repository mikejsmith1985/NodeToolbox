// usePrbState — State management for the PRB-to-Jira issue generator workflow.

import { useCallback, useMemo, useState } from 'react';

import { jiraPost } from '../../../services/jiraApi.ts';
import { snowFetch } from '../../../services/snowApi.ts';
import type { SnowUser } from '../../../types/snow.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';

interface SnowPrbRecord {
  sysId: string;
  number: string;
  incidentNumber: string;
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

interface ServiceNowIncidentRecord {
  number?: ServiceNowFieldValue;
}

interface ServiceNowIncidentQueryResponse {
  result: ServiceNowIncidentRecord[];
}

interface PrbState {
  prbNumber: string;
  prbData: SnowPrbRecord | null;
  isFetchingPrb: boolean;
  fetchError: string | null;
  fetchWarning: string | null;
  jiraProjectKey: string;
  isPrimaryIssueDefect: boolean;
  primaryIssueSummaryTemplate: string;
  slStorySummaryTemplate: string;
  isCreatingIssues: boolean;
  createError: string | null;
  createdIssueKeys: string[];
}

interface PrbActions {
  setPrbNumber: (prbNumber: string) => void;
  fetchPrb: () => Promise<void>;
  setJiraProjectKey: (jiraProjectKey: string) => void;
  setIsPrimaryIssueDefect: (isPrimaryIssueDefect: boolean) => void;
  setPrimaryIssueSummary: (summary: string) => void;
  setSlStorySummary: (summary: string) => void;
  createJiraIssues: () => Promise<void>;
  reset: () => void;
}

const EMPTY_VALUE = '';
const PROBLEM_TABLE_PATH = '/api/now/table/problem';
const PROBLEM_LOOKUP_FIELDS = 'sys_id,number,short_description,description,state,severity,assigned_to';
const INCIDENT_TABLE_PATH = '/api/now/table/incident';
const INCIDENT_LOOKUP_FIELDS = 'number';
const SINGLE_RECORD_LIMIT = 1;
const JIRA_ISSUE_CREATE_PATH = '/rest/api/2/issue';
const PRB_REQUIRED_MESSAGE = 'PRB number is required.';
const PROJECT_REQUIRED_MESSAGE = 'Jira project key is required before creating issues.';
const PRB_REQUIRED_FOR_CREATION_MESSAGE = 'Load a PRB before creating Jira issues.';
const PRB_FETCH_FAILURE_MESSAGE = 'Failed to fetch PRB details';
const ISSUE_CREATE_FAILURE_MESSAGE = 'Failed to create Jira issues';
const PRB_NOT_FOUND_PREFIX = 'No PRB found with number:';
const INCIDENT_FETCH_WARNING_PREFIX = 'PRB loaded, but the related incident number could not be read';

function createInitialPrbState(): PrbState {
  return {
    prbNumber: EMPTY_VALUE,
    prbData: null,
    isFetchingPrb: false,
    fetchError: null,
    fetchWarning: null,
    jiraProjectKey: EMPTY_VALUE,
    isPrimaryIssueDefect: true,
    primaryIssueSummaryTemplate: EMPTY_VALUE,
    slStorySummaryTemplate: EMPTY_VALUE,
    isCreatingIssues: false,
    createError: null,
    createdIssueKeys: [],
  };
}

function buildFormattedIssueSummary(
  problemRecord: SnowPrbRecord,
  shouldIncludeSlPrefix: boolean,
): string {
  const summarySegments = [problemRecord.incidentNumber, problemRecord.number].filter(
    (segmentValue) => segmentValue.length > 0,
  );
  const summaryPrefix = summarySegments.join(': ');
  const quotedProblemStatement = `"${problemRecord.shortDescription}"`;
  const summaryBody = summaryPrefix.length > 0
    ? `${summaryPrefix}: ${quotedProblemStatement}`
    : quotedProblemStatement;

  return shouldIncludeSlPrefix ? `[SL] ${summaryBody}` : summaryBody;
}

function createPrimaryIssueSummary(problemRecord: SnowPrbRecord): string {
  return buildFormattedIssueSummary(problemRecord, false);
}

function createSlStorySummary(problemRecord: SnowPrbRecord): string {
  return buildFormattedIssueSummary(problemRecord, true);
}

const PARTIAL_CREATE_SEPARATOR = ' | ';
const PRIMARY_ISSUE_LABEL = 'Primary issue';
const SL_STORY_LABEL = 'SL Story';

function buildIssuePayload(
  jiraProjectKey: string,
  summary: string,
  issueTypeName: 'Defect' | 'Story',
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

function buildIncidentLookupPath(problemSysId: string): string {
  const encodedQuery = encodeURIComponent(`problem_id=${problemSysId}`);
  return `${INCIDENT_TABLE_PATH}?sysparm_query=${encodedQuery}&sysparm_limit=${SINGLE_RECORD_LIMIT}&sysparm_fields=${INCIDENT_LOOKUP_FIELDS}&sysparm_display_value=all`;
}

function extractServiceNowFieldValue(fieldValue: ServiceNowFieldValue | undefined): string {
  if (fieldValue === undefined) {
    return EMPTY_VALUE;
  }
  if (typeof fieldValue === 'string') {
    return normalizeRichTextToPlainText(fieldValue);
  }
  return normalizeRichTextToPlainText(fieldValue.display_value ?? fieldValue.value ?? EMPTY_VALUE);
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

function mapProblemRecord(problemRecord: ServiceNowProblemRecord, incidentNumber: string): SnowPrbRecord {
  return {
    sysId:            extractServiceNowFieldValue(problemRecord.sys_id),
    number:           extractServiceNowFieldValue(problemRecord.number),
    incidentNumber,
    shortDescription: extractServiceNowFieldValue(problemRecord.short_description),
    description:      extractServiceNowFieldValue(problemRecord.description),
    state:            extractServiceNowFieldValue(problemRecord.state),
    severity:         extractServiceNowFieldValue(problemRecord.severity),
    assignedTo:       extractServiceNowReference(problemRecord.assigned_to),
  };
}

/**
 * Reads the first incident linked to the PRB so generated Jira summaries carry the
 * incident context users see on the ServiceNow Incidents related list.
 */
async function fetchRelatedIncidentNumber(problemSysId: string): Promise<string> {
  if (problemSysId.length === 0) {
    return EMPTY_VALUE;
  }

  const incidentResponse = await snowFetch<ServiceNowIncidentQueryResponse>(
    buildIncidentLookupPath(problemSysId),
  );
  const incidentRecord = incidentResponse.result[0];

  return extractServiceNowFieldValue(incidentRecord?.number);
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
      setState((previousState) => ({
        ...previousState,
        fetchError: PRB_REQUIRED_MESSAGE,
        fetchWarning: null,
      }));
      return;
    }

    setState((previousState) => ({
      ...previousState,
      isFetchingPrb: true,
      fetchError: null,
      fetchWarning: null,
    }));

    try {
      const normalizedPrbNumber = state.prbNumber.trim().toUpperCase();
      const problemResponse = await snowFetch<ServiceNowProblemQueryResponse>(
        buildProblemLookupPath(normalizedPrbNumber),
      );

      const rawProblemRecord = problemResponse.result[0];
      if (!rawProblemRecord) {
        throw new Error(`${PRB_NOT_FOUND_PREFIX} ${normalizedPrbNumber}`);
      }

      let relatedIncidentNumber = EMPTY_VALUE;
      let incidentFetchWarning: string | null = null;
      try {
        relatedIncidentNumber = await fetchRelatedIncidentNumber(
          extractServiceNowFieldValue(rawProblemRecord.sys_id),
        );
      } catch (unknownError) {
        const incidentFetchMessage = unknownError instanceof Error
          ? unknownError.message
          : EMPTY_VALUE;
        incidentFetchWarning = incidentFetchMessage.length > 0
          ? `${INCIDENT_FETCH_WARNING_PREFIX}: ${incidentFetchMessage}`
          : INCIDENT_FETCH_WARNING_PREFIX;
      }

      const problemRecord = mapProblemRecord(rawProblemRecord, relatedIncidentNumber);
      setState((previousState) => ({
        ...previousState,
        prbData: problemRecord,
        fetchWarning: incidentFetchWarning,
        primaryIssueSummaryTemplate: createPrimaryIssueSummary(problemRecord),
        slStorySummaryTemplate: createSlStorySummary(problemRecord),
        isFetchingPrb: false,
        fetchError: null,
      }));
    } catch (unknownError) {
      const fetchError = unknownError instanceof Error ? unknownError.message : PRB_FETCH_FAILURE_MESSAGE;
      setState((previousState) => ({
        ...previousState,
        isFetchingPrb: false,
        fetchError,
        fetchWarning: null,
      }));
    }
  }, [state.prbNumber]);

  const setJiraProjectKey = useCallback((jiraProjectKey: string) => {
    setState((previousState) => ({ ...previousState, jiraProjectKey: jiraProjectKey.toUpperCase() }));
  }, []);

  const setIsPrimaryIssueDefect = useCallback((isPrimaryIssueDefect: boolean) => {
    setState((previousState) => ({ ...previousState, isPrimaryIssueDefect }));
  }, []);

  const setPrimaryIssueSummary = useCallback((summary: string) => {
    setState((previousState) => ({ ...previousState, primaryIssueSummaryTemplate: summary }));
  }, []);

  const setSlStorySummary = useCallback((summary: string) => {
    setState((previousState) => ({ ...previousState, slStorySummaryTemplate: summary }));
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

    const primaryIssueTypeName: 'Defect' | 'Story' = state.isPrimaryIssueDefect ? 'Defect' : 'Story';
    const [primaryResult, storyResult] = await Promise.allSettled([
      jiraPost<{ key: string }>(
        JIRA_ISSUE_CREATE_PATH,
        buildIssuePayload(
          state.jiraProjectKey,
          state.primaryIssueSummaryTemplate,
          primaryIssueTypeName,
          state.prbData,
        ),
      ),
      jiraPost<{ key: string }>(
        JIRA_ISSUE_CREATE_PATH,
        buildIssuePayload(
          state.jiraProjectKey,
          state.slStorySummaryTemplate,
          'Story',
          state.prbData,
        ),
      ),
    ]);

    // Collect successful keys and per-issue error messages separately so a
    // partial success (one issue created, one failed) surfaces both outcomes.
    const successfulKeys: string[] = [];
    const failureMessages: string[] = [];

    if (primaryResult.status === 'fulfilled') {
      successfulKeys.push(primaryResult.value.key);
    } else {
      const errorMessage =
        primaryResult.reason instanceof Error ? primaryResult.reason.message : ISSUE_CREATE_FAILURE_MESSAGE;
      failureMessages.push(`${PRIMARY_ISSUE_LABEL}: ${errorMessage}`);
    }

    if (storyResult.status === 'fulfilled') {
      successfulKeys.push(storyResult.value.key);
    } else {
      const errorMessage =
        storyResult.reason instanceof Error ? storyResult.reason.message : ISSUE_CREATE_FAILURE_MESSAGE;
      failureMessages.push(`${SL_STORY_LABEL}: ${errorMessage}`);
    }

    setState((previousState) => ({
      ...previousState,
      isCreatingIssues: false,
      createError: failureMessages.length > 0 ? failureMessages.join(PARTIAL_CREATE_SEPARATOR) : null,
      createdIssueKeys: successfulKeys,
    }));
  }, [
    state.isPrimaryIssueDefect,
    state.jiraProjectKey,
    state.prbData,
    state.primaryIssueSummaryTemplate,
    state.slStorySummaryTemplate,
  ]);

  const reset = useCallback(() => {
    setState(createInitialPrbState());
  }, []);

  const actions = useMemo<PrbActions>(() => {
    return {
      setPrbNumber,
      fetchPrb,
      setJiraProjectKey,
      setIsPrimaryIssueDefect,
      setPrimaryIssueSummary,
      setSlStorySummary,
      createJiraIssues,
      reset,
    };
  }, [
    createJiraIssues,
    fetchPrb,
    reset,
    setIsPrimaryIssueDefect,
    setJiraProjectKey,
    setPrbNumber,
    setPrimaryIssueSummary,
    setSlStorySummary,
  ]);

  return { state, actions };
}
