// usePrbState — State management for the PRB-to-Jira issue generator workflow.

import { useCallback, useMemo, useState } from 'react';

import { jiraPost } from '../../../services/jiraApi.ts';
import { snowFetch } from '../../../services/snowApi.ts';
import type { SnowUser } from '../../../types/snow.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';
import {
  areTransitionSelectionsComplete,
  buildTransitionFieldsPayload,
  isTransitionFieldSupported,
  type TransitionFieldSelection,
  type TransitionRequiredField,
} from '../../SprintDashboard/featureReviewFixes.ts';
import {
  describeRequiredFieldNeeds,
  discoverRequiredFieldsByIssueType,
  MissingIssueTypeError,
  readRefusedRequiredFieldIds,
  readRememberedRefusedFieldIds,
  rememberRefusedFieldIds,
} from '../prb/prbRequiredFields.ts';

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
  /** The `[QE]` companion issue's summary: the work Quality Engineering does to prove the fix. */
  qeIssueSummaryTemplate: string;
  /** When true, a third `[QE]` issue is created beside the SL issue. Persisted per browser. */
  shouldCreateQeIssue: boolean;
  /** When true, the SL and QE issues are created as sub-tasks of the primary issue rather than standalone Stories. */
  createSlAsSubtask: boolean;
  /** The Jira issue-type name used for the SL sub-task; configurable because instances name it differently. */
  slSubtaskIssueTypeName: string;
  isCreatingIssues: boolean;
  createError: string | null;
  createdIssueKeys: string[];
  /**
   * What each issue type's create screen requires beyond the generator's own payload, keyed by the
   * issue type name. Filled by the pre-create check so the tab can ask for the answers (GH #384).
   */
  requiredFieldsByIssueType: Record<string, TransitionRequiredField[]>;
  /** The operator's answers, keyed by field id and shared across issue types that need the same field. */
  requiredFieldSelectionByFieldId: Record<string, TransitionFieldSelection>;
}

interface PrbActions {
  setPrbNumber: (prbNumber: string) => void;
  fetchPrb: () => Promise<void>;
  setJiraProjectKey: (jiraProjectKey: string) => void;
  setIsPrimaryIssueDefect: (isPrimaryIssueDefect: boolean) => void;
  setPrimaryIssueSummary: (summary: string) => void;
  setSlStorySummary: (summary: string) => void;
  setQeIssueSummary: (summary: string) => void;
  setShouldCreateQeIssue: (shouldCreateQeIssue: boolean) => void;
  setCreateSlAsSubtask: (createSlAsSubtask: boolean) => void;
  setSlSubtaskIssueTypeName: (slSubtaskIssueTypeName: string) => void;
  createJiraIssues: () => Promise<void>;
  setRequiredFieldSelection: (fieldId: string, selection: TransitionFieldSelection) => void;
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
const HIGHEST_PRIORITY_NAME = 'Highest';
const HIGH_PRIORITY_NAME = 'High';
const MEDIUM_PRIORITY_NAME = 'Medium';
const LOW_PRIORITY_NAME = 'Low';
const LOWEST_PRIORITY_NAME = 'Lowest';

// The SL sub-task preferences persist so a team's chosen behaviour sticks across sessions.
const CREATE_SL_AS_SUBTASK_STORAGE_KEY = 'tbxPrbCreateSlAsSubtask';
const CREATE_QE_ISSUE_STORAGE_KEY = 'tbxPrbCreateQeIssue';
const SL_SUBTASK_ISSUE_TYPE_STORAGE_KEY = 'tbxPrbSlSubtaskIssueTypeName';
const DEFAULT_SL_SUBTASK_ISSUE_TYPE_NAME = 'Sub-task';

/** Reads a persisted boolean preference, falling back when it is absent or storage is unavailable. */
function readBooleanPreference(storageKey: string, fallbackValue: boolean): boolean {
  try {
    const storedValue = localStorage.getItem(storageKey);
    return storedValue === null ? fallbackValue : storedValue === 'true';
  } catch {
    return fallbackValue;
  }
}

/** Reads a persisted non-empty string preference, falling back when it is absent or storage is unavailable. */
function readStringPreference(storageKey: string, fallbackValue: string): string {
  try {
    return localStorage.getItem(storageKey)?.trim() || fallbackValue;
  } catch {
    return fallbackValue;
  }
}

/** Persists a preference; a storage failure must never break issue creation, so it is swallowed. */
function writePreference(storageKey: string, value: string): void {
  try {
    localStorage.setItem(storageKey, value);
  } catch {
    // Ignore storage failures (private mode, quota) — the in-memory state still applies for this session.
  }
}

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
    qeIssueSummaryTemplate: EMPTY_VALUE,
    shouldCreateQeIssue: readBooleanPreference(CREATE_QE_ISSUE_STORAGE_KEY, true),
    // Default to a sub-task of the primary — the behaviour teams asked for — but keep it configurable.
    createSlAsSubtask: readBooleanPreference(CREATE_SL_AS_SUBTASK_STORAGE_KEY, true),
    slSubtaskIssueTypeName: readStringPreference(SL_SUBTASK_ISSUE_TYPE_STORAGE_KEY, DEFAULT_SL_SUBTASK_ISSUE_TYPE_NAME),
    isCreatingIssues: false,
    createError: null,
    createdIssueKeys: [],
    requiredFieldsByIssueType: {},
    requiredFieldSelectionByFieldId: {},
  };
}

const SL_SUMMARY_PREFIX = '[SL]';
const QE_SUMMARY_PREFIX = '[QE]';

/** `INC…: PRB…: "statement"`, led by a team tag (`[SL]`, `[QE]`) when one is given. */
function buildFormattedIssueSummary(
  problemRecord: SnowPrbRecord,
  teamPrefix?: string,
): string {
  const summarySegments = [problemRecord.incidentNumber, problemRecord.number].filter(
    (segmentValue) => segmentValue.length > 0,
  );
  const summaryPrefix = summarySegments.join(': ');
  const quotedProblemStatement = `"${problemRecord.shortDescription}"`;
  const summaryBody = summaryPrefix.length > 0
    ? `${summaryPrefix}: ${quotedProblemStatement}`
    : quotedProblemStatement;

  return teamPrefix ? `${teamPrefix} ${summaryBody}` : summaryBody;
}

const PARTIAL_CREATE_SEPARATOR = ' | ';
const PRIMARY_ISSUE_LABEL = 'Primary issue';
const SL_STORY_LABEL = 'SL Story';
const SL_SUBTASK_LABEL = 'SL sub-task';
const QE_STORY_LABEL = 'QE Story';
const QE_SUBTASK_LABEL = 'QE sub-task';
const FOLLOW_UP_SKIPPED_MESSAGE = 'skipped because the primary issue was not created';
/** The type the SL and QE issues take when they are not sub-tasks of the primary. */
const FOLLOW_UP_STANDALONE_ISSUE_TYPE_NAME = 'Story';
const REQUIRED_FIELDS_PREFIX = 'Jira will not create these issues without more —';
const REQUIRED_FIELDS_SUFFIX = 'Fill them in below and create again.';

/**
 * Builds a Jira create payload. When `parentIssueKey` is supplied the issue is created as a child of
 * that issue (a sub-task), which is what links the SL sub-task to its primary Story or Defect.
 * `requiredFieldValues` carries whatever the create screen demanded beyond the fixed payload.
 */
function buildIssuePayload(
  jiraProjectKey: string,
  summary: string,
  issueTypeName: string,
  problemRecord: SnowPrbRecord,
  requiredFieldValues: Record<string, unknown>,
  parentIssueKey?: string,
) {
  const fields: Record<string, unknown> = {
    ...requiredFieldValues,
    project: { key: jiraProjectKey },
    summary,
    issuetype: { name: issueTypeName },
    description: `${problemRecord.number}\n\n${problemRecord.description}`,
    priority: { name: mapServiceNowSeverityToJiraPriorityName(problemRecord.severity) },
  };
  if (parentIssueKey) {
    fields.parent = { key: parentIssueKey };
  }
  return { fields };
}

/** What the pre-create check found: the screens' demands, and the message that stops the run if any is unanswered. */
interface CreateScreenCheck {
  requiredFieldsByIssueType: Record<string, TransitionRequiredField[]>;
  blockingMessage: string | null;
}

/**
 * Asks Jira what each create screen requires and whether the operator has answered it.
 *
 * Only a field the inline picker can honestly collect blocks the run. One it cannot render (a user
 * picker, a date) is left to the POST, whose refusal now names the field — blocking on it here would
 * stop the generator forever with no way through. Fields Jira refused this project and type over
 * before are asked for too, even where the screen calls them optional (GH #439). A createmeta failure (older Jira, no permission)
 * is a courtesy lost, not a gate closed: creation proceeds as it always did. A type the project does
 * not offer, though, is refused here, before the other issue exists.
 */
async function checkCreateScreens(
  jiraProjectKey: string,
  issueTypeNames: readonly string[],
  selectionByFieldId: Record<string, TransitionFieldSelection>,
): Promise<CreateScreenCheck> {
  let requiredFieldsByIssueType: Record<string, TransitionRequiredField[]>;
  try {
    requiredFieldsByIssueType = await discoverRequiredFieldsByIssueType(
      jiraProjectKey,
      issueTypeNames,
      readRememberedRefusedFieldIds(jiraProjectKey),
    );
  } catch (discoveryError) {
    const blockingMessage = discoveryError instanceof MissingIssueTypeError ? discoveryError.message : null;
    return { requiredFieldsByIssueType: {}, blockingMessage };
  }

  const unansweredByIssueType = Object.fromEntries(
    Object.entries(requiredFieldsByIssueType)
      .map(([issueTypeName, requiredFields]) => [
        issueTypeName,
        requiredFields.filter((requiredField) =>
          isTransitionFieldSupported(requiredField)
          && !areTransitionSelectionsComplete([requiredField], selectionByFieldId)),
      ] as const)
      .filter(([, unansweredFields]) => unansweredFields.length > 0),
  );
  const needsDescription = describeRequiredFieldNeeds(unansweredByIssueType);
  return {
    requiredFieldsByIssueType,
    blockingMessage: needsDescription === '' ? null : `${REQUIRED_FIELDS_PREFIX} ${needsDescription} ${REQUIRED_FIELDS_SUFFIX}`,
  };
}

/** One issue the generator will create: what to call it, what type it is, and what its screen demanded. */
interface PlannedIssue {
  summary: string;
  issueTypeName: string;
  requiredFieldValues: Record<string, unknown>;
}

/** An issue created only beside the primary (SL, QE): how messages name it, and whether it is the primary's child. */
interface PlannedFollowUpIssue extends PlannedIssue {
  label: string;
  isSubtaskOfPrimary: boolean;
}

/** The state while the run is in flight: nothing created yet, no stale error or keys on screen. */
function markCreationStarted(previousState: PrbState): PrbState {
  return { ...previousState, isCreatingIssues: true, createError: null, createdIssueKeys: [] };
}

/** The state when the pre-create check stops the run: what each screen needs is now on screen. */
function markCreationBlocked(previousState: PrbState, screenCheck: CreateScreenCheck): PrbState {
  return {
    ...previousState,
    isCreatingIssues: false,
    createError: screenCheck.blockingMessage,
    requiredFieldsByIssueType: screenCheck.requiredFieldsByIssueType,
  };
}

/** The state after the run: the keys that exist, and every labelled reason for one that does not. */
function markCreationFinished(previousState: PrbState, outcome: IssueCreationOutcome, screenCheck: CreateScreenCheck): PrbState {
  return {
    ...previousState,
    isCreatingIssues: false,
    createError: outcome.failureMessages.length > 0 ? outcome.failureMessages.join(PARTIAL_CREATE_SEPARATOR) : null,
    createdIssueKeys: outcome.successfulKeys,
    requiredFieldsByIssueType: screenCheck.requiredFieldsByIssueType,
  };
}

/** The reason nothing can be created yet, or null when a PRB is loaded and a project is named. */
function readCreatePrerequisiteError(state: PrbState): string | null {
  if (state.prbData === null) return PRB_REQUIRED_FOR_CREATION_MESSAGE;
  if (!state.jiraProjectKey) return PROJECT_REQUIRED_MESSAGE;
  return null;
}

/**
 * Pairs each issue with whatever its create screen demanded, from the operator's shared answers.
 *
 * Answers are keyed by field id and shared, but each payload carries only the fields ITS screen
 * listed — a Defect root cause is not sent to a sub-task whose screen never asked for it.
 */
function planIssues(
  state: PrbState,
  primaryIssueTypeName: string,
  followUpIssueTypeName: string,
  requiredFieldsByIssueType: Record<string, TransitionRequiredField[]>,
): { primaryIssue: PlannedIssue; followUpIssues: PlannedFollowUpIssue[] } {
  const readRequiredFieldValues = (issueTypeName: string): Record<string, unknown> => buildTransitionFieldsPayload(
    requiredFieldsByIssueType[issueTypeName] ?? [],
    state.requiredFieldSelectionByFieldId,
  );
  const planFollowUp = (summary: string, subtaskLabel: string, storyLabel: string): PlannedFollowUpIssue => ({
    summary,
    issueTypeName: followUpIssueTypeName,
    requiredFieldValues: readRequiredFieldValues(followUpIssueTypeName),
    label: state.createSlAsSubtask ? subtaskLabel : storyLabel,
    isSubtaskOfPrimary: state.createSlAsSubtask,
  });
  const followUpIssues = [planFollowUp(state.slStorySummaryTemplate, SL_SUBTASK_LABEL, SL_STORY_LABEL)];
  if (state.shouldCreateQeIssue) {
    followUpIssues.push(planFollowUp(state.qeIssueSummaryTemplate, QE_SUBTASK_LABEL, QE_STORY_LABEL));
  }
  return {
    primaryIssue: {
      summary: state.primaryIssueSummaryTemplate,
      issueTypeName: primaryIssueTypeName,
      requiredFieldValues: readRequiredFieldValues(primaryIssueTypeName),
    },
    followUpIssues,
  };
}

/** What a creation run produced: the keys that exist, a labelled reason for each that does not, and what Jira refused. */
interface IssueCreationOutcome {
  successfulKeys: string[];
  failureMessages: string[];
  /** The fields Jira said each refused issue type required, keyed by issue type name. */
  refusedFieldIdsByIssueType: Record<string, string[]>;
}

/** Reads a rejection reason as a human message, falling back to the generic create-failure text. */
function readCreateFailureMessage(rejectionReason: unknown): string {
  return rejectionReason instanceof Error ? rejectionReason.message : ISSUE_CREATE_FAILURE_MESSAGE;
}

/** Posts one planned issue and returns its new key; `parentIssueKey` makes it a sub-task of that issue. */
async function createOneIssue(
  jiraProjectKey: string,
  problemRecord: SnowPrbRecord,
  plannedIssue: PlannedIssue,
  parentIssueKey?: string,
): Promise<string> {
  const createdIssue = await jiraPost<{ key: string }>(
    JIRA_ISSUE_CREATE_PATH,
    buildIssuePayload(
      jiraProjectKey,
      plannedIssue.summary,
      plannedIssue.issueTypeName,
      problemRecord,
      plannedIssue.requiredFieldValues,
      parentIssueKey,
    ),
  );
  return createdIssue.key;
}

/** Records one refused create: its labelled message, and any required fields the refusal names. */
function recordCreateFailure(outcome: IssueCreationOutcome, label: string, issueTypeName: string, rejectionReason: unknown): void {
  const failureMessage = readCreateFailureMessage(rejectionReason);
  outcome.failureMessages.push(`${label}: ${failureMessage}`);
  const refusedFieldIds = readRefusedRequiredFieldIds(failureMessage);
  if (refusedFieldIds.length > 0) {
    outcome.refusedFieldIdsByIssueType[issueTypeName] = refusedFieldIds;
  }
}

/**
 * Creates the primary issue, then each follow-up issue (SL, then QE) — in order, never at once.
 *
 * The SL issue used to go out in parallel when it was a standalone Story, so a refused Defect left an
 * SL Story behind that the next attempt would duplicate (GH #384). A follow-up is only meaningful
 * beside its primary, so when the primary fails every follow-up is skipped and said to be skipped.
 */
async function createPrimaryThenFollowUpIssues(
  jiraProjectKey: string,
  problemRecord: SnowPrbRecord,
  primaryIssue: PlannedIssue,
  followUpIssues: readonly PlannedFollowUpIssue[],
): Promise<IssueCreationOutcome> {
  const outcome: IssueCreationOutcome = { successfulKeys: [], failureMessages: [], refusedFieldIdsByIssueType: {} };

  let primaryIssueKey: string;
  try {
    primaryIssueKey = await createOneIssue(jiraProjectKey, problemRecord, primaryIssue);
    outcome.successfulKeys.push(primaryIssueKey);
  } catch (primaryError) {
    recordCreateFailure(outcome, PRIMARY_ISSUE_LABEL, primaryIssue.issueTypeName, primaryError);
    outcome.failureMessages.push(...followUpIssues.map((followUpIssue) => `${followUpIssue.label}: ${FOLLOW_UP_SKIPPED_MESSAGE}`));
    return outcome;
  }

  for (const followUpIssue of followUpIssues) {
    try {
      const parentIssueKey = followUpIssue.isSubtaskOfPrimary ? primaryIssueKey : undefined;
      outcome.successfulKeys.push(await createOneIssue(jiraProjectKey, problemRecord, followUpIssue, parentIssueKey));
    } catch (followUpError) {
      recordCreateFailure(outcome, followUpIssue.label, followUpIssue.issueTypeName, followUpError);
    }
  }
  return outcome;
}

/**
 * Remembers every field Jira refused a type over, then asks the screens again so those fields show
 * as pickers straight away — the operator answers and clicks once more, instead of decoding an id.
 */
async function learnFromRefusals(
  jiraProjectKey: string,
  issueTypeNames: readonly string[],
  outcome: IssueCreationOutcome,
  previousScreenCheck: CreateScreenCheck,
  selectionByFieldId: Record<string, TransitionFieldSelection>,
): Promise<CreateScreenCheck> {
  const refusedEntries = Object.entries(outcome.refusedFieldIdsByIssueType);
  if (refusedEntries.length === 0) return previousScreenCheck;
  for (const [issueTypeName, refusedFieldIds] of refusedEntries) {
    rememberRefusedFieldIds(jiraProjectKey, issueTypeName, refusedFieldIds);
  }
  return checkCreateScreens(jiraProjectKey, issueTypeNames, selectionByFieldId);
}

/**
 * Converts the ServiceNow PRB severity into a Jira priority so generated issues
 * carry the same urgency signal teams already use to triage the underlying problem.
 */
function mapServiceNowSeverityToJiraPriorityName(serviceNowSeverity: string): string {
  const normalizedSeverity = serviceNowSeverity.trim().toLowerCase();
  if (normalizedSeverity.startsWith('1')) {
    return HIGHEST_PRIORITY_NAME;
  }
  if (normalizedSeverity.startsWith('2')) {
    return HIGH_PRIORITY_NAME;
  }
  if (normalizedSeverity.startsWith('3')) {
    return MEDIUM_PRIORITY_NAME;
  }
  if (normalizedSeverity.startsWith('4')) {
    return LOW_PRIORITY_NAME;
  }
  if (normalizedSeverity.startsWith('5')) {
    return LOWEST_PRIORITY_NAME;
  }
  return MEDIUM_PRIORITY_NAME;
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
        primaryIssueSummaryTemplate: buildFormattedIssueSummary(problemRecord),
        slStorySummaryTemplate: buildFormattedIssueSummary(problemRecord, SL_SUMMARY_PREFIX),
        qeIssueSummaryTemplate: buildFormattedIssueSummary(problemRecord, QE_SUMMARY_PREFIX),
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

  const setQeIssueSummary = useCallback((summary: string) => {
    setState((previousState) => ({ ...previousState, qeIssueSummaryTemplate: summary }));
  }, []);

  const setShouldCreateQeIssue = useCallback((shouldCreateQeIssue: boolean) => {
    writePreference(CREATE_QE_ISSUE_STORAGE_KEY, String(shouldCreateQeIssue));
    setState((previousState) => ({ ...previousState, shouldCreateQeIssue }));
  }, []);

  const setRequiredFieldSelection = useCallback((fieldId: string, selection: TransitionFieldSelection) => {
    setState((previousState) => ({
      ...previousState,
      requiredFieldSelectionByFieldId: { ...previousState.requiredFieldSelectionByFieldId, [fieldId]: selection },
    }));
  }, []);

  const createJiraIssues = useCallback(async () => {
    const prerequisiteError = readCreatePrerequisiteError(state);
    if (prerequisiteError !== null || state.prbData === null) {
      setState((previousState) => ({ ...previousState, createError: prerequisiteError }));
      return;
    }
    const problemRecord = state.prbData;

    setState(markCreationStarted);

    const primaryIssueTypeName: 'Defect' | 'Story' = state.isPrimaryIssueDefect ? 'Defect' : 'Story';
    const followUpIssueTypeName = state.createSlAsSubtask ? state.slSubtaskIssueTypeName : FOLLOW_UP_STANDALONE_ISSUE_TYPE_NAME;
    const issueTypeNames = [primaryIssueTypeName, followUpIssueTypeName];

    // Before a single POST: what does each screen want, and has the operator supplied it?
    const screenCheck = await checkCreateScreens(state.jiraProjectKey, issueTypeNames, state.requiredFieldSelectionByFieldId);
    if (screenCheck.blockingMessage !== null) {
      setState((previousState) => markCreationBlocked(previousState, screenCheck));
      return;
    }

    const { primaryIssue, followUpIssues } = planIssues(state, primaryIssueTypeName, followUpIssueTypeName, screenCheck.requiredFieldsByIssueType);
    const outcome = await createPrimaryThenFollowUpIssues(state.jiraProjectKey, problemRecord, primaryIssue, followUpIssues);
    const learnedScreenCheck = await learnFromRefusals(
      state.jiraProjectKey, issueTypeNames, outcome, screenCheck, state.requiredFieldSelectionByFieldId,
    );

    setState((previousState) => markCreationFinished(previousState, outcome, learnedScreenCheck));
  }, [state]);

  const setCreateSlAsSubtask = useCallback((createSlAsSubtask: boolean) => {
    writePreference(CREATE_SL_AS_SUBTASK_STORAGE_KEY, String(createSlAsSubtask));
    setState((previousState) => ({ ...previousState, createSlAsSubtask }));
  }, []);

  const setSlSubtaskIssueTypeName = useCallback((slSubtaskIssueTypeName: string) => {
    // Persist the trimmed value, but keep exactly what the user typed in the field for editing.
    writePreference(SL_SUBTASK_ISSUE_TYPE_STORAGE_KEY, slSubtaskIssueTypeName.trim() || DEFAULT_SL_SUBTASK_ISSUE_TYPE_NAME);
    setState((previousState) => ({ ...previousState, slSubtaskIssueTypeName }));
  }, []);

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
      setQeIssueSummary,
      setShouldCreateQeIssue,
      setCreateSlAsSubtask,
      setSlSubtaskIssueTypeName,
      createJiraIssues,
      setRequiredFieldSelection,
      reset,
    };
  }, [
    createJiraIssues,
    fetchPrb,
    reset,
    setCreateSlAsSubtask,
    setIsPrimaryIssueDefect,
    setJiraProjectKey,
    setPrbNumber,
    setPrimaryIssueSummary,
    setQeIssueSummary,
    setRequiredFieldSelection,
    setShouldCreateQeIssue,
    setSlStorySummary,
    setSlSubtaskIssueTypeName,
  ]);

  return { state, actions };
}
