// useCrgState — State management for the six-step Change Request Generator workflow.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import { snowFetch } from '../../../services/snowApi.ts';
import type { JiraIssue } from '../../../types/jira.ts';

// Step 3 was added (Change Details) so the wizard now runs 1 through 6.
type CrgStep = 1 | 2 | 3 | 4 | 5 | 6;
// How the user wants to pull issues in Step 1: by project key + fix version, or a raw JQL query.
type FetchMode = 'project' | 'jql';
type GeneratedFieldKey = 'shortDescription' | 'description' | 'justification' | 'riskImpact';
type EnvironmentKey = 'rel' | 'prd' | 'pfix';

interface EnvironmentConfig {
  isEnabled: boolean;
  plannedStartDate: string;
  plannedEndDate: string;
}

/**
 * A reference to a ServiceNow record (user, group, or CI) identified by its sys_id
 * and surfaced to the user via a human-readable display name.
 */
export interface SnowReference {
  sysId: string;
  displayName: string;
}

/**
 * All fields shown on the "Basic Change Info" section of a SNow Change Request (step 3).
 * Standard SNow field names are noted as comments for reference when submitting the form.
 */
export interface ChgBasicInfo {
  category: string;           // SNow field: category   (e.g. software/hardware)
  changeType: string;         // SNow field: type        (normal/standard/emergency)
  environment: string;        // SNow field: u_environment (instance-specific choice field)
  requestedBy: SnowReference; // SNow field: requested_by
  configItem: SnowReference;  // SNow field: cmdb_ci
  assignmentGroup: SnowReference; // SNow field: assignment_group
  assignedTo: SnowReference;      // SNow field: assigned_to
  changeManager: SnowReference;   // SNow field: change_manager
  tester: SnowReference;          // SNow field: u_tester
  serviceManager: SnowReference;  // SNow field: u_service_manager
  isExpedited: boolean;           // SNow field: u_expedited
}

/**
 * Assessment dropdown fields on the "Planning" tab of a SNow Change Request (step 4).
 * These are typically custom u_ fields; names here follow common enterprise conventions.
 */
export interface ChgPlanningAssessment {
  impact: string;                         // SNow field: impact (1/2/3)
  systemAvailabilityImplication: string;  // SNow field: u_availability_impact
  hasBeenTested: string;                  // SNow field: u_change_tested
  impactedPersonsAware: string;           // SNow field: u_impacted_persons_aware
  hasBeenPerformedPreviously: string;     // SNow field: u_performed_previously
  successProbability: string;             // SNow field: u_success_probability
  canBeBackedOut: string;                 // SNow field: u_can_be_backed_out
}

/**
 * Long-form text fields on the "Planning" tab of a SNow Change Request (step 4).
 * These are standard SNow change_request table fields.
 */
export interface ChgPlanningContent {
  implementationPlan: string; // SNow field: implementation_plan
  backoutPlan: string;        // SNow field: backout_plan
  testPlan: string;           // SNow field: test_plan
}

const EMPTY_VALUE = '';
const EMPTY_FETCH_ERROR = null;
const REQUIRED_FIELDS_MESSAGE = 'Project key and fix version are required.';
const REQUIRED_JQL_MESSAGE = 'A JQL query is required.';
const FETCH_FAILURE_MESSAGE = 'Failed to fetch issues';
const DEFAULT_MAX_RESULTS = 100;
const ISSUE_FIELD_LIST = 'summary,status,priority,issuetype,assignee';

// All reference field lookup fields requested when cloning a CHG from SNow.
const CHG_CLONE_FIELDS = [
  'number', 'short_description', 'description', 'justification', 'risk_impact_analysis',
  'category', 'type', 'cmdb_ci', 'requested_by', 'assignment_group', 'assigned_to',
  'change_manager', 'impact', 'implementation_plan', 'backout_plan', 'test_plan',
  'u_environment', 'u_tester', 'u_service_manager', 'u_expedited',
  'u_availability_impact', 'u_change_tested', 'u_impacted_persons_aware',
  'u_performed_previously', 'u_success_probability', 'u_can_be_backed_out',
].join(',');

// A blank SNow reference used as a default value for all reference fields.
const EMPTY_SNOW_REFERENCE: SnowReference = { sysId: '', displayName: '' };

function createDefaultEnvironmentConfig(): EnvironmentConfig {
  return {
    isEnabled: false,
    plannedStartDate: EMPTY_VALUE,
    plannedEndDate: EMPTY_VALUE,
  };
}

function createDefaultChgBasicInfo(): ChgBasicInfo {
  return {
    category:        EMPTY_VALUE,
    changeType:      EMPTY_VALUE,
    environment:     EMPTY_VALUE,
    requestedBy:     { ...EMPTY_SNOW_REFERENCE },
    configItem:      { ...EMPTY_SNOW_REFERENCE },
    assignmentGroup: { ...EMPTY_SNOW_REFERENCE },
    assignedTo:      { ...EMPTY_SNOW_REFERENCE },
    changeManager:   { ...EMPTY_SNOW_REFERENCE },
    tester:          { ...EMPTY_SNOW_REFERENCE },
    serviceManager:  { ...EMPTY_SNOW_REFERENCE },
    isExpedited:     false,
  };
}

function createDefaultChgPlanningAssessment(): ChgPlanningAssessment {
  return {
    impact:                        EMPTY_VALUE,
    systemAvailabilityImplication: EMPTY_VALUE,
    hasBeenTested:                 EMPTY_VALUE,
    impactedPersonsAware:          EMPTY_VALUE,
    hasBeenPerformedPreviously:    EMPTY_VALUE,
    successProbability:            EMPTY_VALUE,
    canBeBackedOut:                EMPTY_VALUE,
  };
}

function createDefaultChgPlanningContent(): ChgPlanningContent {
  return {
    implementationPlan: EMPTY_VALUE,
    backoutPlan:        EMPTY_VALUE,
    testPlan:           EMPTY_VALUE,
  };
}

/**
 * A saved set of CHG field values that can be applied with a single click.
 * Stores all dropdown selections and planning content so repeat changes
 * (e.g. the same team's recurring release) don't need to be re-entered each time.
 */
export interface CrgTemplate {
  id: string;
  name: string;
  createdAt: string;
  chgBasicInfo: ChgBasicInfo;
  chgPlanningAssessment: ChgPlanningAssessment;
  chgPlanningContent: ChgPlanningContent;
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
  /** CHG number the user wants to pre-fill from (e.g. "CHG0001234"). */
  cloneChgNumber: string;
  isCloning: boolean;
  cloneError: string | null;
  // Step 3: Basic Change Info
  chgBasicInfo: ChgBasicInfo;
  // Step 4: Generated / editable content
  generatedShortDescription: string;
  generatedDescription: string;
  generatedJustification: string;
  generatedRiskImpact: string;
  // Step 4: Planning assessment dropdowns
  chgPlanningAssessment: ChgPlanningAssessment;
  // Step 4: Planning long-form text areas
  chgPlanningContent: ChgPlanningContent;
  // Step 5: Environment schedule
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
  setChgBasicInfo: (update: Partial<ChgBasicInfo>) => void;
  setChgPlanningAssessment: (update: Partial<ChgPlanningAssessment>) => void;
  setChgPlanningContent: (update: Partial<ChgPlanningContent>) => void;
  setCloneChgNumber: (chgNumber: string) => void;
  /** Fetches a SNow CHG by number and pre-populates all form fields with its values. */
  cloneFromChg: () => Promise<void>;
  /** Applies a saved template's field values to the current form state. */
  applyTemplate: (template: CrgTemplate) => void;
  updateEnvironment: (environmentKey: EnvironmentKey, update: Partial<EnvironmentConfig>) => void;
  goToStep: (step: CrgStep) => void;
  reset: () => void;
  /** POSTs all CHG fields to ServiceNow and stores the resulting CHG number. */
  createChg: () => Promise<void>;
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
    cloneChgNumber: EMPTY_VALUE,
    isCloning: false,
    cloneError: null,
    chgBasicInfo: createDefaultChgBasicInfo(),
    generatedShortDescription: EMPTY_VALUE,
    generatedDescription: EMPTY_VALUE,
    generatedJustification: EMPTY_VALUE,
    generatedRiskImpact: EMPTY_VALUE,
    chgPlanningAssessment: createDefaultChgPlanningAssessment(),
    chgPlanningContent: createDefaultChgPlanningContent(),
    relEnvironment: { ...createDefaultEnvironmentConfig(), isEnabled: true },
    prdEnvironment: { ...createDefaultEnvironmentConfig(), isEnabled: true },
    pfixEnvironment: createDefaultEnvironmentConfig(),
    isSubmitting: false,
    submitResult: null,
  };
}

// ── SNow field extraction helpers (used when cloning from an existing CHG) ──

/**
 * Extracts a human-readable string from a SNow field.
 * With sysparm_display_value=all, SNow wraps all fields as { value, display_value }.
 * Text fields use display_value; choice fields also use display_value for the label.
 */
function extractStringValue(field: unknown): string {
  if (!field) return EMPTY_VALUE;
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field !== null) {
    const snowField = field as Record<string, unknown>;
    if ('display_value' in snowField) return String(snowField.display_value ?? EMPTY_VALUE);
    if ('value' in snowField) return String(snowField.value ?? EMPTY_VALUE);
  }
  return EMPTY_VALUE;
}

/**
 * Extracts a SnowReference (sys_id + display name) from a SNow reference field.
 * SNow returns { value: sys_id, display_value: displayName } for reference fields
 * when sysparm_display_value=all is included in the request.
 */
function extractSnowReference(field: unknown): SnowReference {
  if (!field || typeof field !== 'object') return { ...EMPTY_SNOW_REFERENCE };
  const snowField = field as Record<string, unknown>;
  const sysId = String(snowField.value ?? EMPTY_VALUE);
  const displayName = String(snowField.display_value ?? EMPTY_VALUE);
  if (!sysId) return { ...EMPTY_SNOW_REFERENCE };
  return { sysId, displayName };
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
    description:      'generatedDescription',
    justification:    'generatedJustification',
    riskImpact:       'generatedRiskImpact',
  } as const;
  return generatedFieldMap[fieldName];
}

function getEnvironmentStateKey(environmentKey: EnvironmentKey) {
  const environmentStateKeyMap = {
    rel:  'relEnvironment',
    prd:  'prdEnvironment',
    pfix: 'pfixEnvironment',
  } as const;
  return environmentStateKeyMap[environmentKey];
}

/**
 * Manages the Change Request Generator wizard state so the tab can guide users
 * from Jira issue lookup all the way through final ServiceNow submission.
 * The wizard follows a six-step flow:
 *  1. Fetch Issues → 2. Review Issues → 3. Change Details →
 *  4. Planning & Content → 5. Environments → 6. Review & Create
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
        if (isCancelled) return;
        setState((previousState) => ({
          ...previousState,
          // Only unreleased versions are relevant for a Change Request — a release
          // that has already shipped should not be deployed again via a new CHG.
          availableFixVersions: versions
            .filter((version) => !version.released)
            .map((version) => version.name),
        }));
      })
      .catch(() => {
        if (isCancelled) return;
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
      setState((previousState) => ({ ...previousState, isFetchingIssues: false, fetchError }));
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
      const selectedIssues = previousState.fetchedIssues.filter((jiraIssue) =>
        previousState.selectedIssueKeys.has(jiraIssue.key),
      );
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
        generatedDescription:      `The following Jira issues are included in this release:\n\n${issueList}`,
        generatedJustification:    `Planned release of ${releaseLabel} containing ${selectedIssues.length} issue(s).`,
        generatedRiskImpact:       `Standard deployment risk. ${selectedIssues.length} issue(s) included. Follow standard runbook.`,
        // Advance to Change Details (step 3) so the user can fill in basic info before editing docs.
        currentStep: 3,
      };
    });
  }, []);

  const updateGeneratedField = useCallback((fieldName: GeneratedFieldKey, value: string) => {
    const generatedStateKey = getGeneratedStateKey(fieldName);
    setState((previousState) => ({ ...previousState, [generatedStateKey]: value }));
  }, []);

  const setChgBasicInfo = useCallback((update: Partial<ChgBasicInfo>) => {
    setState((previousState) => ({
      ...previousState,
      chgBasicInfo: { ...previousState.chgBasicInfo, ...update },
    }));
  }, []);

  const setChgPlanningAssessment = useCallback((update: Partial<ChgPlanningAssessment>) => {
    setState((previousState) => ({
      ...previousState,
      chgPlanningAssessment: { ...previousState.chgPlanningAssessment, ...update },
    }));
  }, []);

  const setChgPlanningContent = useCallback((update: Partial<ChgPlanningContent>) => {
    setState((previousState) => ({
      ...previousState,
      chgPlanningContent: { ...previousState.chgPlanningContent, ...update },
    }));
  }, []);

  const setCloneChgNumber = useCallback((chgNumber: string) => {
    setState((previousState) => ({ ...previousState, cloneChgNumber: chgNumber }));
  }, []);

  /**
   * Fetches an existing SNow CHG by number and pre-populates all form fields so
   * the user can use it as a template.  Uses sysparm_display_value=all to get both
   * sys_id (needed for submission) and display name (shown in the UI) in one request.
   */
  const cloneFromChg = useCallback(async () => {
    const chgNumber = state.cloneChgNumber.trim();
    if (!chgNumber) return;

    setState((previousState) => ({ ...previousState, isCloning: true, cloneError: null }));

    try {
      const encodedNumber = encodeURIComponent(chgNumber);
      const response = await snowFetch<{ result: Record<string, unknown>[] }>(
        `/api/now/table/change_request?sysparm_query=number%3D${encodedNumber}&sysparm_limit=1&sysparm_fields=${CHG_CLONE_FIELDS}&sysparm_display_value=all`,
      );

      if (!response.result?.length) {
        setState((previousState) => ({
          ...previousState,
          isCloning: false,
          cloneError: `No CHG found with number: ${chgNumber}`,
        }));
        return;
      }

      const chg = response.result[0];

      setState((previousState) => ({
        ...previousState,
        isCloning: false,
        cloneError: null,
        generatedShortDescription: extractStringValue(chg.short_description),
        generatedDescription:      extractStringValue(chg.description),
        generatedJustification:    extractStringValue(chg.justification),
        generatedRiskImpact:       extractStringValue(chg.risk_impact_analysis),
        chgBasicInfo: {
          category:        extractStringValue(chg.category),
          changeType:      extractStringValue(chg.type),
          environment:     extractStringValue(chg.u_environment),
          requestedBy:     extractSnowReference(chg.requested_by),
          configItem:      extractSnowReference(chg.cmdb_ci),
          assignmentGroup: extractSnowReference(chg.assignment_group),
          assignedTo:      extractSnowReference(chg.assigned_to),
          changeManager:   extractSnowReference(chg.change_manager),
          tester:          extractSnowReference(chg.u_tester),
          serviceManager:  extractSnowReference(chg.u_service_manager),
          isExpedited:     extractStringValue(chg.u_expedited) === 'true',
        },
        chgPlanningAssessment: {
          impact:                        extractStringValue(chg.impact),
          systemAvailabilityImplication: extractStringValue(chg.u_availability_impact),
          hasBeenTested:                 extractStringValue(chg.u_change_tested),
          impactedPersonsAware:          extractStringValue(chg.u_impacted_persons_aware),
          hasBeenPerformedPreviously:    extractStringValue(chg.u_performed_previously),
          successProbability:            extractStringValue(chg.u_success_probability),
          canBeBackedOut:                extractStringValue(chg.u_can_be_backed_out),
        },
        chgPlanningContent: {
          implementationPlan: extractStringValue(chg.implementation_plan),
          backoutPlan:        extractStringValue(chg.backout_plan),
          testPlan:           extractStringValue(chg.test_plan),
        },
      }));
    } catch (unknownError) {
      let errorMessage = unknownError instanceof Error ? unknownError.message : 'Failed to load CHG';
      // A 401 from SNow means the relay tab's session has expired.
      // The relay may still show as "connected" (still polling) while the SNow session is stale.
      if (errorMessage.includes('401')) {
        errorMessage = 'SNow returned 401 — your session may have expired. Refresh the SNow relay tab, re-click the bookmarklet, then try again.';
      }
      setState((previousState) => ({ ...previousState, isCloning: false, cloneError: errorMessage }));
    }
  }, [state.cloneChgNumber]);

  /**
   * Applies a saved CRG template to the current form state, filling all dropdowns
   * and planning content fields so the user only needs to adjust what's different.
   */
  const applyTemplate = useCallback((template: CrgTemplate) => {
    setState((previousState) => ({
      ...previousState,
      chgBasicInfo:          { ...template.chgBasicInfo },
      chgPlanningAssessment: { ...template.chgPlanningAssessment },
      chgPlanningContent:    { ...template.chgPlanningContent },
    }));
  }, []);

  const updateEnvironment = useCallback((environmentKey: EnvironmentKey, update: Partial<EnvironmentConfig>) => {
    const environmentStateKey = getEnvironmentStateKey(environmentKey);
    setState((previousState) => ({
      ...previousState,
      [environmentStateKey]: { ...previousState[environmentStateKey], ...update },
    }));
  }, []);

  const goToStep = useCallback((step: CrgStep) => {
    setState((previousState) => ({ ...previousState, currentStep: step }));
  }, []);

  const reset = useCallback(() => {
    setState(createInitialCrgState());
  }, []);

  /**
   * Creates a ServiceNow Change Request using all collected CHG fields.
   * Uses the browser relay (bookmarklet must be active on the SNow tab).
   * Optional fields (empty strings, unselected refs) are omitted from the
   * payload to avoid SNow validation errors on non-required fields.
   */
  const createChg = useCallback(async () => {
    setState((previousState) => ({ ...previousState, isSubmitting: true, submitResult: null }));

    // Build the payload — core text fields are always included.
    const chgPayload: Record<string, unknown> = {
      short_description:    state.generatedShortDescription,
      description:          state.generatedDescription,
      justification:        state.generatedJustification,
      risk_impact_analysis: state.generatedRiskImpact,
    };

    // Basic Info — add only fields the user filled in.
    if (state.chgBasicInfo.category)     chgPayload.category      = state.chgBasicInfo.category;
    if (state.chgBasicInfo.changeType)   chgPayload.type          = state.chgBasicInfo.changeType;
    if (state.chgBasicInfo.environment)  chgPayload.u_environment = state.chgBasicInfo.environment;
    if (state.chgBasicInfo.isExpedited)  chgPayload.u_expedited   = true;

    // Reference fields — only include when the user selected a real record (has a sys_id).
    if (state.chgBasicInfo.requestedBy.sysId)     chgPayload.requested_by      = state.chgBasicInfo.requestedBy.sysId;
    if (state.chgBasicInfo.configItem.sysId)      chgPayload.cmdb_ci           = state.chgBasicInfo.configItem.sysId;
    if (state.chgBasicInfo.assignmentGroup.sysId) chgPayload.assignment_group  = state.chgBasicInfo.assignmentGroup.sysId;
    if (state.chgBasicInfo.assignedTo.sysId)      chgPayload.assigned_to       = state.chgBasicInfo.assignedTo.sysId;
    if (state.chgBasicInfo.changeManager.sysId)   chgPayload.change_manager    = state.chgBasicInfo.changeManager.sysId;
    if (state.chgBasicInfo.tester.sysId)          chgPayload.u_tester          = state.chgBasicInfo.tester.sysId;
    if (state.chgBasicInfo.serviceManager.sysId)  chgPayload.u_service_manager = state.chgBasicInfo.serviceManager.sysId;

    // Planning assessment dropdowns.
    if (state.chgPlanningAssessment.impact)                        chgPayload.impact                   = state.chgPlanningAssessment.impact;
    if (state.chgPlanningAssessment.systemAvailabilityImplication) chgPayload.u_availability_impact     = state.chgPlanningAssessment.systemAvailabilityImplication;
    if (state.chgPlanningAssessment.hasBeenTested)                 chgPayload.u_change_tested           = state.chgPlanningAssessment.hasBeenTested;
    if (state.chgPlanningAssessment.impactedPersonsAware)          chgPayload.u_impacted_persons_aware  = state.chgPlanningAssessment.impactedPersonsAware;
    if (state.chgPlanningAssessment.hasBeenPerformedPreviously)    chgPayload.u_performed_previously    = state.chgPlanningAssessment.hasBeenPerformedPreviously;
    if (state.chgPlanningAssessment.successProbability)            chgPayload.u_success_probability     = state.chgPlanningAssessment.successProbability;
    if (state.chgPlanningAssessment.canBeBackedOut)                chgPayload.u_can_be_backed_out       = state.chgPlanningAssessment.canBeBackedOut;

    // Planning content text areas.
    if (state.chgPlanningContent.implementationPlan) chgPayload.implementation_plan = state.chgPlanningContent.implementationPlan;
    if (state.chgPlanningContent.backoutPlan)        chgPayload.backout_plan        = state.chgPlanningContent.backoutPlan;
    if (state.chgPlanningContent.testPlan)           chgPayload.test_plan           = state.chgPlanningContent.testPlan;

    try {
      const responseData = await snowFetch<{ result: { number: string } }>(
        '/api/now/table/change_request',
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(chgPayload),
        },
      );

      const changeNumber = responseData.result.number;
      setState((previousState) => ({
        ...previousState,
        isSubmitting: false,
        submitResult: `${changeNumber} created`,
        currentStep:  6 as CrgStep,
      }));
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'CHG creation failed';
      setState((previousState) => ({
        ...previousState,
        isSubmitting: false,
        submitResult: 'Error: ' + errorMessage,
      }));
    }
  }, [
    state.generatedShortDescription, state.generatedDescription,
    state.generatedJustification, state.generatedRiskImpact,
    state.chgBasicInfo, state.chgPlanningAssessment, state.chgPlanningContent,
  ]);

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
      setChgBasicInfo,
      setChgPlanningAssessment,
      setChgPlanningContent,
      setCloneChgNumber,
      cloneFromChg,
      applyTemplate,
      updateEnvironment,
      goToStep,
      reset,
      createChg,
    };
  }, [
    setFetchMode, setProjectKey, setFixVersion, setCustomJql, fetchIssues,
    toggleIssueSelection, selectAllIssues, generateDocs, updateGeneratedField,
    setChgBasicInfo, setChgPlanningAssessment, setChgPlanningContent,
    setCloneChgNumber, cloneFromChg, applyTemplate, updateEnvironment, goToStep, reset, createChg,
  ]);

  return { state, actions };
}
