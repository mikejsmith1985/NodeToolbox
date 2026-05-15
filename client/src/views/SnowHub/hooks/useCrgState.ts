// useCrgState — State management for the six-step Change Request Generator workflow.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
  configItem: SnowReference;
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
  environment: string;        // SNow field: u_environment, mapped on the Environments step.
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

/**
 * A field discovered from a real ServiceNow CHG. The Configuration tab can pin
 * these exact API-name/value pairs when a ServiceNow instance uses custom fields
 * that are not part of the standard wizard.
 */
export interface InspectedSnowField {
  fieldName: string;
  displayValue: string;
  storedValue: string;
}

const EMPTY_VALUE = '';
const EMPTY_FETCH_ERROR = null;
const REQUIRED_FIELDS_MESSAGE = 'Project key and fix version are required.';
const REQUIRED_JQL_MESSAGE = 'A JQL query is required.';
const FETCH_FAILURE_MESSAGE = 'Failed to fetch issues';
const DEFAULT_MAX_RESULTS = 100;
const ISSUE_FIELD_LIST = 'summary,status,priority,issuetype,assignee';
const CTASK_DEFAULT_SHORT_DESCRIPTION = 'Change task';
const CTASK_CLONE_FIELDS = [
  'number', 'short_description', 'description', 'assignment_group', 'assigned_to',
  'planned_start_date', 'planned_end_date', 'close_notes',
].join(',');
const SNOW_DATE_TIME_INPUT_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?/;
const INSPECTED_FIELD_SKIP_LIST = new Set([
  'sys_id', 'sys_created_by', 'sys_created_on', 'sys_updated_by', 'sys_updated_on',
  'sys_class_name', 'sys_domain', 'sys_mod_count', 'sys_tags', 'watch_list', 'work_notes_list',
  'number', 'short_description', 'description', 'justification', 'risk_impact_analysis',
  'category', 'type', 'u_environment', 'requested_by', 'cmdb_ci', 'assignment_group',
  'assigned_to', 'change_manager', 'u_tester', 'u_service_manager', 'u_expedited',
  'impact', 'u_availability_impact', 'u_change_tested', 'u_impacted_persons_aware',
  'u_performed_previously', 'u_success_probability', 'u_can_be_backed_out',
  'implementation_plan', 'backout_plan', 'test_plan', 'planned_start_date', 'planned_end_date',
]);

// localStorage key used to persist CRG wizard progress across relay reconnects and page navigations.
const CRG_STATE_STORAGE_KEY = 'ntbx-crg-state';

// All reference field lookup fields requested when cloning a CHG from SNow.
// A blank SNow reference used as a default value for all reference fields.
const EMPTY_SNOW_REFERENCE: SnowReference = { sysId: '', displayName: '' };

function createDefaultEnvironmentConfig(): EnvironmentConfig {
  return {
    isEnabled: false,
    plannedStartDate: EMPTY_VALUE,
    plannedEndDate: EMPTY_VALUE,
    configItem: { ...EMPTY_SNOW_REFERENCE },
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
  /** Optional for backward compatibility with templates saved before custom SNow field pins. */
  customSnowFields?: Record<string, string>;
  /** Optional for backward compatibility with templates saved before environment scheduling was added. */
  relEnvironment?: EnvironmentConfig;
  prdEnvironment?: EnvironmentConfig;
  pfixEnvironment?: EnvironmentConfig;
}

/**
 * Reusable ServiceNow Change Task template.
 * These templates become CTASK records linked to a CHG during creation or append flows.
 */
export interface CtaskTemplate {
  id: string;
  name: string;
  createdAt: string;
  shortDescription: string;
  description: string;
  assignmentGroup: SnowReference;
  assignedTo: SnowReference;
  plannedStartDate: string;
  plannedEndDate: string;
  closeNotes: string;
}

/** Editable CTASK fields stored in a reusable template before ids and metadata are assigned. */
export type CtaskTemplateData = Omit<CtaskTemplate, 'id' | 'name' | 'createdAt'>;

/**
 * Shape stored in localStorage — identical to CrgState minus transient/computed fields.
 * `selectedIssueKeys` is stored as a plain array because Set is not JSON-serialisable.
 */
type PersistedCrgState = Omit<
  CrgState,
  'availableFixVersions' | 'isFetchingIssues' | 'fetchError' |
  'isCloning' | 'cloneError' | 'isSubmitting' | 'submitResult' | 'selectedIssueKeys'
> & {
  selectedIssueKeys: string[];
};

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
  /** Exact SNow API fields pinned from Configuration for instance-specific payload parity. */
  customSnowFields: Record<string, string>;
  /** Full readable field list from the most recently loaded CHG. */
  inspectedSnowFields: InspectedSnowField[];
  // Step 5: Environment schedule
  relEnvironment: EnvironmentConfig;
  prdEnvironment: EnvironmentConfig;
  pfixEnvironment: EnvironmentConfig;
  /** CTASKs selected from templates and queued for CHG creation or append. */
  changeTasks: CtaskTemplate[];
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
  pinCustomSnowField: (fieldName: string, fieldValue: string) => void;
  removeCustomSnowField: (fieldName: string) => void;
  setCloneChgNumber: (chgNumber: string) => void;
  /** Fetches a SNow CHG by number and pre-populates all form fields with its values. */
  cloneFromChg: () => Promise<void>;
  /** Applies a saved template's field values to the current form state. */
  applyTemplate: (template: CrgTemplate) => void;
  addChangeTask: (template: CtaskTemplate) => void;
  removeChangeTask: (taskId: string) => void;
  appendTasksToExistingChg: (chgNumber: string) => Promise<void>;
  cloneCtaskTemplate: (ctaskNumber: string) => Promise<CtaskTemplateData>;
  updateEnvironment: (environmentKey: EnvironmentKey, update: Partial<EnvironmentConfig>) => void;
  goToStep: (step: CrgStep) => void;
  reset: () => void;
  /** POSTs all CHG fields to ServiceNow and stores the resulting CHG number. */
  createChg: () => Promise<void>;
}

/**
 * Returns a clean default state — no data carried over from any previous session.
 * Used when the user explicitly resets the wizard.
 */
function createDefaultCrgState(): CrgState {
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
    customSnowFields: {},
    inspectedSnowFields: [],
    relEnvironment: createDefaultEnvironmentConfig(),
    prdEnvironment: createDefaultEnvironmentConfig(),
    pfixEnvironment: createDefaultEnvironmentConfig(),
    changeTasks: [],
    isSubmitting: false,
    submitResult: null,
  };
}

function mergeEnvironmentConfig(
  environmentConfig: Partial<EnvironmentConfig> | undefined,
): EnvironmentConfig {
  return {
    ...createDefaultEnvironmentConfig(),
    ...environmentConfig,
    configItem: {
      ...EMPTY_SNOW_REFERENCE,
      ...(environmentConfig?.configItem ?? {}),
    },
  };
}

/**
 * Reads persisted CRG progress from localStorage and converts stored arrays back to Sets.
 * Returns an empty object when nothing is stored or if the stored data is invalid.
 */
function loadPersistedCrgState(): Partial<CrgState> {
  try {
    const stored = localStorage.getItem(CRG_STATE_STORAGE_KEY);
    if (!stored) return {};

    const parsed = JSON.parse(stored) as Partial<PersistedCrgState>;
    return {
      ...parsed,
      // Set is not JSON-serialisable — it is stored as a plain array and restored here.
      selectedIssueKeys: new Set<string>(parsed.selectedIssueKeys ?? []),
    };
  } catch {
    // Corrupted data or JSON.parse failure — start fresh rather than crashing.
    return {};
  }
}

/**
 * Creates the initial wizard state, merging clean defaults with any persisted progress.
 * Transient loading/error/result flags are always reset regardless of what was stored.
 */
function createInitialCrgState(): CrgState {
  const persisted = loadPersistedCrgState();
  return {
    ...createDefaultCrgState(),
    ...persisted,
    relEnvironment: mergeEnvironmentConfig(persisted.relEnvironment),
    prdEnvironment: mergeEnvironmentConfig(persisted.prdEnvironment),
    pfixEnvironment: mergeEnvironmentConfig(persisted.pfixEnvironment),
    // Always reset transient flags — these should not survive a page reload.
    availableFixVersions: [],
    isFetchingIssues: false,
    fetchError: EMPTY_FETCH_ERROR,
    isCloning: false,
    cloneError: null,
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
 * Extracts the stored SNow value for choice fields. Choice dropdowns submit the internal
 * value (not the display label), so cloned CHGs must populate state with the same value.
 */
function extractChoiceValue(field: unknown): string {
  if (!field) return EMPTY_VALUE;
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field !== null) {
    const snowField = field as Record<string, unknown>;
    const internalValue = String(snowField.value ?? EMPTY_VALUE).trim();
    if (internalValue) return internalValue;

    const displayValue = String(snowField.display_value ?? EMPTY_VALUE).trim();
    if (displayValue) return displayValue;
  }
  return EMPTY_VALUE;
}

/**
 * Extracts a SnowReference (sys_id + display name) from a SNow reference field.
 * SNow returns { value: sys_id, display_value: displayName } for reference fields
 * when sysparm_display_value=all is included in the request.
 */
function extractSnowReference(field: unknown): SnowReference {
  if (typeof field === 'string') {
    return { sysId: EMPTY_VALUE, displayName: field };
  }
  if (!field || typeof field !== 'object') return { ...EMPTY_SNOW_REFERENCE };
  const snowField = field as Record<string, unknown>;
  const sysId = String(snowField.value ?? EMPTY_VALUE);
  const displayName = String(snowField.display_value ?? EMPTY_VALUE);
  if (!sysId && !displayName) return { ...EMPTY_SNOW_REFERENCE };
  return { sysId, displayName };
}

function extractInspectableFieldValue(field: unknown): { displayValue: string; storedValue: string } {
  if (field && typeof field === 'object') {
    const snowField = field as Record<string, unknown>;
    const displayValue = String(snowField.display_value || snowField.value || EMPTY_VALUE).trim();
    const storedValue = String(snowField.value || snowField.display_value || EMPTY_VALUE).trim();
    return { displayValue, storedValue };
  }

  const fieldValue = field === null || field === undefined ? EMPTY_VALUE : String(field).trim();
  return { displayValue: fieldValue, storedValue: fieldValue };
}

function buildInspectedSnowFields(chgRecord: Record<string, unknown>): InspectedSnowField[] {
  return Object.entries(chgRecord)
    .filter(([fieldName, fieldValue]) => !INSPECTED_FIELD_SKIP_LIST.has(fieldName) && fieldValue !== null && fieldValue !== EMPTY_VALUE)
    .map(([fieldName, fieldValue]) => ({
      fieldName,
      ...extractInspectableFieldValue(fieldValue),
    }))
    .filter((inspectedField) => inspectedField.storedValue.length > 0 || inspectedField.displayValue.length > 0)
    .sort((leftField, rightField) => leftField.fieldName.localeCompare(rightField.fieldName));
}

function extractReferenceSysId(field: unknown): string {
  if (typeof field === 'string') return field;
  if (field && typeof field === 'object') {
    const snowField = field as Record<string, unknown>;
    return String(snowField.value ?? EMPTY_VALUE);
  }
  return EMPTY_VALUE;
}

function buildChangeTaskPayload(changeSysId: string, template: CtaskTemplate): Record<string, unknown> {
  const ctaskPayload: Record<string, unknown> = {
    change_request:     changeSysId,
    short_description:  template.shortDescription || template.name || CTASK_DEFAULT_SHORT_DESCRIPTION,
  };

  if (template.description) ctaskPayload.description = template.description;
  if (template.assignmentGroup.sysId) ctaskPayload.assignment_group = template.assignmentGroup.sysId;
  if (template.assignedTo.sysId) ctaskPayload.assigned_to = template.assignedTo.sysId;
  if (template.plannedStartDate) ctaskPayload.planned_start_date = template.plannedStartDate;
  if (template.plannedEndDate) ctaskPayload.planned_end_date = template.plannedEndDate;
  if (template.closeNotes) ctaskPayload.close_notes = template.closeNotes;

  return ctaskPayload;
}

function normalizeSnowDateTimeForInput(field: unknown): string {
  const snowDateTime = extractChoiceValue(field) || extractStringValue(field);
  if (!snowDateTime) return EMPTY_VALUE;

  const dateTimeMatch = SNOW_DATE_TIME_INPUT_PATTERN.exec(snowDateTime);
  return dateTimeMatch ? `${dateTimeMatch[1]}T${dateTimeMatch[2]}` : snowDateTime;
}

function buildCtaskTemplateDataFromRecord(ctaskRecord: Record<string, unknown>): CtaskTemplateData {
  return {
    shortDescription: extractStringValue(ctaskRecord.short_description),
    description:      extractStringValue(ctaskRecord.description),
    assignmentGroup:  extractSnowReference(ctaskRecord.assignment_group),
    assignedTo:       extractSnowReference(ctaskRecord.assigned_to),
    plannedStartDate: normalizeSnowDateTimeForInput(ctaskRecord.planned_start_date),
    plannedEndDate:   normalizeSnowDateTimeForInput(ctaskRecord.planned_end_date),
    closeNotes:       extractStringValue(ctaskRecord.close_notes),
  };
}

async function createChangeTasks(changeSysId: string, templates: CtaskTemplate[]): Promise<number> {
  for (const template of templates) {
    await snowFetch(
      '/api/now/table/change_task',
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(buildChangeTaskPayload(changeSysId, template)),
      },
    );
  }

  return templates.length;
}

async function fetchChangeSysIdByNumber(changeNumber: string): Promise<string> {
  const normalizedChangeNumber = changeNumber.trim().toUpperCase();
  const encodedQuery = encodeURIComponent(`number=${normalizedChangeNumber}`);
  const responseData = await snowFetch<{ result: Array<{ sys_id: unknown }> }>(
    `/api/now/table/change_request?sysparm_query=${encodedQuery}&sysparm_fields=sys_id&sysparm_limit=1`,
  );
  const changeSysId = extractReferenceSysId(responseData.result[0]?.sys_id);
  if (!changeSysId) {
    throw new Error(`${normalizedChangeNumber} was not found in ServiceNow.`);
  }
  return changeSysId;
}

function formatCtaskCount(count: number): string {
  return count === 1 ? '1 CTASK' : `${count} CTASKs`;
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

function inferEnvironmentKeyFromValue(environmentValue: string): EnvironmentKey | null {
  const normalizedEnvironmentValue = environmentValue.trim().toLowerCase();
  if (!normalizedEnvironmentValue) {
    return null;
  }

  if (normalizedEnvironmentValue.includes('pfix') || normalizedEnvironmentValue.includes('fix')) {
    return 'pfix';
  }

  if (normalizedEnvironmentValue.includes('prd') || normalizedEnvironmentValue.includes('prod')) {
    return 'prd';
  }

  if (normalizedEnvironmentValue.includes('rel') || normalizedEnvironmentValue.includes('release')) {
    return 'rel';
  }

  return null;
}

function resolveMappedConfigItem(state: CrgState): SnowReference {
  const environmentPriority: EnvironmentKey[] = ['pfix', 'prd', 'rel'];

  for (const environmentKey of environmentPriority) {
    const environmentState = state[getEnvironmentStateKey(environmentKey)];
    if (environmentState.isEnabled && environmentState.configItem.sysId) {
      return environmentState.configItem;
    }
  }

  return state.chgBasicInfo.configItem;
}

function buildClonedEnvironmentState(
  previousState: CrgState,
  clonedEnvironmentValue: string,
  clonedConfigItem: SnowReference,
): Pick<CrgState, 'relEnvironment' | 'prdEnvironment' | 'pfixEnvironment'> {
  const nextEnvironmentState = {
    relEnvironment:  { ...previousState.relEnvironment },
    prdEnvironment:  { ...previousState.prdEnvironment },
    pfixEnvironment: { ...previousState.pfixEnvironment },
  };
  const matchedEnvironmentKey = inferEnvironmentKeyFromValue(clonedEnvironmentValue);

  if (!matchedEnvironmentKey) {
    return nextEnvironmentState;
  }

  const matchedEnvironmentStateKey = getEnvironmentStateKey(matchedEnvironmentKey);
  nextEnvironmentState[matchedEnvironmentStateKey] = {
    ...nextEnvironmentState[matchedEnvironmentStateKey],
    isEnabled: true,
    configItem: clonedConfigItem,
  };

  return nextEnvironmentState;
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

  // Tracks when reset() was just called so the persistence effect doesn't immediately
  // re-write the cleared localStorage entry with default values.
  const justResetRef = useRef(false);

  // ── Persistence — sync non-ephemeral wizard progress to localStorage ──
  // This ensures users can reconnect the SNow relay (which navigates away and back)
  // without losing any data they had already entered.
  useEffect(() => {
    // Skip writing defaults back to localStorage right after an explicit reset.
    if (justResetRef.current) {
      justResetRef.current = false;
      return;
    }

    if (state.submitResult?.endsWith(' created')) {
      try { localStorage.removeItem(CRG_STATE_STORAGE_KEY); } catch { /* non-fatal */ }
      return;
    }

    const persistedState: PersistedCrgState = {
      currentStep:               state.currentStep,
      fetchMode:                 state.fetchMode,
      projectKey:                state.projectKey,
      fixVersion:                state.fixVersion,
      customJql:                 state.customJql,
      fetchedIssues:             state.fetchedIssues,
      selectedIssueKeys:         [...state.selectedIssueKeys],
      cloneChgNumber:            state.cloneChgNumber,
      chgBasicInfo:              state.chgBasicInfo,
      generatedShortDescription: state.generatedShortDescription,
      generatedDescription:      state.generatedDescription,
      generatedJustification:    state.generatedJustification,
      generatedRiskImpact:       state.generatedRiskImpact,
      chgPlanningAssessment:     state.chgPlanningAssessment,
      chgPlanningContent:        state.chgPlanningContent,
      customSnowFields:          state.customSnowFields,
      inspectedSnowFields:       state.inspectedSnowFields,
      relEnvironment:            state.relEnvironment,
      prdEnvironment:            state.prdEnvironment,
      pfixEnvironment:           state.pfixEnvironment,
      changeTasks:               state.changeTasks,
    };

    try {
      localStorage.setItem(CRG_STATE_STORAGE_KEY, JSON.stringify(persistedState));
    } catch {
      // Non-fatal — persistence fails gracefully (private mode, storage quota, etc.).
    }
  }, [state]);

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

  const pinCustomSnowField = useCallback((fieldName: string, fieldValue: string) => {
    const normalizedFieldName = fieldName.trim();
    const normalizedFieldValue = fieldValue.trim();
    if (!normalizedFieldName || !normalizedFieldValue) {
      return;
    }

    setState((previousState) => ({
      ...previousState,
      customSnowFields: {
        ...previousState.customSnowFields,
        [normalizedFieldName]: normalizedFieldValue,
      },
    }));
  }, []);

  const removeCustomSnowField = useCallback((fieldName: string) => {
    setState((previousState) => {
      const remainingCustomSnowFields = { ...previousState.customSnowFields };
      delete remainingCustomSnowFields[fieldName];
      return {
        ...previousState,
        customSnowFields: remainingCustomSnowFields,
      };
    });
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
        `/api/now/table/change_request?sysparm_query=number%3D${encodedNumber}&sysparm_limit=1&sysparm_display_value=all`,
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
      const clonedEnvironmentValue = extractChoiceValue(chg.u_environment);
      const clonedConfigItem = extractSnowReference(chg.cmdb_ci);
      const inspectedSnowFields = buildInspectedSnowFields(chg);

      setState((previousState) => ({
        ...previousState,
        isCloning: false,
        cloneError: null,
        inspectedSnowFields,
        generatedShortDescription: extractStringValue(chg.short_description),
        generatedDescription:      extractStringValue(chg.description),
        generatedJustification:    extractStringValue(chg.justification),
        generatedRiskImpact:       extractStringValue(chg.risk_impact_analysis),
        chgBasicInfo: {
          category:        extractChoiceValue(chg.category),
          changeType:      extractChoiceValue(chg.type),
          environment:     clonedEnvironmentValue,
          requestedBy:     extractSnowReference(chg.requested_by),
          configItem:      clonedConfigItem,
          assignmentGroup: extractSnowReference(chg.assignment_group),
          assignedTo:      extractSnowReference(chg.assigned_to),
          changeManager:   extractSnowReference(chg.change_manager),
          tester:          extractSnowReference(chg.u_tester),
          serviceManager:  extractSnowReference(chg.u_service_manager),
          isExpedited:     extractChoiceValue(chg.u_expedited) === 'true',
        },
        ...buildClonedEnvironmentState(previousState, clonedEnvironmentValue, clonedConfigItem),
        chgPlanningAssessment: {
          impact:                        extractChoiceValue(chg.impact),
          systemAvailabilityImplication: extractChoiceValue(chg.u_availability_impact),
          hasBeenTested:                 extractChoiceValue(chg.u_change_tested),
          impactedPersonsAware:          extractChoiceValue(chg.u_impacted_persons_aware),
          hasBeenPerformedPreviously:    extractChoiceValue(chg.u_performed_previously),
          successProbability:            extractChoiceValue(chg.u_success_probability),
          canBeBackedOut:                extractChoiceValue(chg.u_can_be_backed_out),
        },
        chgPlanningContent: {
          implementationPlan: extractStringValue(chg.implementation_plan),
          backoutPlan:        extractStringValue(chg.backout_plan),
          testPlan:           extractStringValue(chg.test_plan),
        },
      }));
    } catch (unknownError) {
      let errorMessage = unknownError instanceof Error ? unknownError.message : 'Failed to load CHG';
      if (errorMessage.includes('401')) {
        errorMessage = 'SNow returned 401 — the relay is connected, but ServiceNow rejected the relayed API call. Refresh a full ServiceNow form or list page, click the latest NodeToolbox SNow Relay bookmarklet, then try again.';
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
      customSnowFields:      { ...(template.customSnowFields ?? previousState.customSnowFields) },
      relEnvironment:        template.relEnvironment ? mergeEnvironmentConfig(template.relEnvironment) : previousState.relEnvironment,
      prdEnvironment:        template.prdEnvironment ? mergeEnvironmentConfig(template.prdEnvironment) : previousState.prdEnvironment,
      pfixEnvironment:       template.pfixEnvironment ? mergeEnvironmentConfig(template.pfixEnvironment) : previousState.pfixEnvironment,
    }));
  }, []);

  const addChangeTask = useCallback((template: CtaskTemplate) => {
    const queuedTask: CtaskTemplate = {
      ...template,
      id: crypto.randomUUID(),
    };

    setState((previousState) => ({
      ...previousState,
      changeTasks: [...previousState.changeTasks, queuedTask],
    }));
  }, []);

  const removeChangeTask = useCallback((taskId: string) => {
    setState((previousState) => ({
      ...previousState,
      changeTasks: previousState.changeTasks.filter((task) => task.id !== taskId),
    }));
  }, []);

  const appendTasksToExistingChg = useCallback(async (chgNumber: string) => {
    const normalizedChangeNumber = chgNumber.trim().toUpperCase();
    if (!normalizedChangeNumber) {
      setState((previousState) => ({ ...previousState, submitResult: 'Error: Enter a CHG number before appending CTASKs.' }));
      return;
    }
    if (state.changeTasks.length === 0) {
      setState((previousState) => ({ ...previousState, submitResult: 'Error: Add at least one CTASK before appending.' }));
      return;
    }

    setState((previousState) => ({ ...previousState, isSubmitting: true, submitResult: null }));
    try {
      const changeSysId = await fetchChangeSysIdByNumber(normalizedChangeNumber);
      await createChangeTasks(changeSysId, state.changeTasks);
      setState((previousState) => ({
        ...previousState,
        isSubmitting: false,
        submitResult: `${formatCtaskCount(state.changeTasks.length)} appended to ${normalizedChangeNumber}`,
      }));
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'CTASK append failed';
      setState((previousState) => ({
        ...previousState,
        isSubmitting: false,
        submitResult: 'Error: ' + errorMessage,
      }));
    }
  }, [state.changeTasks]);

  const cloneCtaskTemplate = useCallback(async (ctaskNumber: string): Promise<CtaskTemplateData> => {
    const normalizedCtaskNumber = ctaskNumber.trim().toUpperCase();
    if (!normalizedCtaskNumber) {
      throw new Error('Enter a CTASK number before cloning a template.');
    }

    let ctaskRecord: Record<string, unknown> | undefined;
    try {
      const encodedQuery = encodeURIComponent(`number=${normalizedCtaskNumber}`);
      const responseData = await snowFetch<{ result: Record<string, unknown>[] }>(
        `/api/now/table/change_task?sysparm_query=${encodedQuery}&sysparm_limit=1&sysparm_fields=${CTASK_CLONE_FIELDS}&sysparm_display_value=all`,
      );
      ctaskRecord = responseData.result?.[0];
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'CTASK clone failed';
      if (errorMessage.includes('401')) {
        throw new Error('SNow returned 401 while cloning the CTASK. Refresh a full ServiceNow form or list page, click the latest NodeToolbox SNow Relay bookmarklet, then try again.');
      }
      throw new Error(errorMessage);
    }

    if (!ctaskRecord) {
      throw new Error(`${normalizedCtaskNumber} was not found in ServiceNow.`);
    }

    return buildCtaskTemplateDataFromRecord(ctaskRecord);
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
    // Signal the persistence effect to skip its next run — we don't want default values
    // immediately written back to localStorage after an explicit reset.
    justResetRef.current = true;
    try { localStorage.removeItem(CRG_STATE_STORAGE_KEY); } catch { /* non-fatal */ }
    setState(createDefaultCrgState());
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
      ...state.customSnowFields,
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

     const mappedConfigItem = resolveMappedConfigItem(state);

     // Reference fields — only include when the user selected a real record (has a sys_id).
     if (state.chgBasicInfo.requestedBy.sysId)     chgPayload.requested_by      = state.chgBasicInfo.requestedBy.sysId;
     if (mappedConfigItem.sysId)                   chgPayload.cmdb_ci           = mappedConfigItem.sysId;
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
      const responseData = await snowFetch<{ result: { number: string; sys_id?: unknown } }>(
        '/api/now/table/change_request',
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(chgPayload),
        },
      );

      const changeNumber = responseData.result.number;
      if (state.changeTasks.length > 0) {
        const changeSysId = extractReferenceSysId(responseData.result.sys_id) || await fetchChangeSysIdByNumber(changeNumber);
        try {
          await createChangeTasks(changeSysId, state.changeTasks);
        } catch (unknownError) {
          const errorMessage = unknownError instanceof Error ? unknownError.message : 'CTASK creation failed';
          const taskLabel = formatCtaskCount(state.changeTasks.length);
          setState((previousState) => ({
            ...previousState,
            isSubmitting: false,
            currentStep:  6,
            submitResult: `${changeNumber} created, but ${taskLabel} did not fully complete. Check ServiceNow before retrying: ${errorMessage}`,
          }));
          return;
        }
      }

      const creationSummary = state.changeTasks.length > 0
        ? `${changeNumber} created with ${formatCtaskCount(state.changeTasks.length)}`
        : `${changeNumber} created`;
      // Clear persisted progress after a successful submission — the next change starts fresh.
      justResetRef.current = true;
      try { localStorage.removeItem(CRG_STATE_STORAGE_KEY); } catch { /* non-fatal */ }
      setState(() => ({
        ...createDefaultCrgState(),
        isSubmitting: false,
        submitResult: creationSummary,
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
    state.chgBasicInfo, state.chgPlanningAssessment, state.chgPlanningContent, state.customSnowFields, state.changeTasks,
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
      pinCustomSnowField,
      removeCustomSnowField,
      setCloneChgNumber,
      cloneFromChg,
      applyTemplate,
      addChangeTask,
      removeChangeTask,
      appendTasksToExistingChg,
      cloneCtaskTemplate,
      updateEnvironment,
      goToStep,
      reset,
      createChg,
    };
  }, [
    setFetchMode, setProjectKey, setFixVersion, setCustomJql, fetchIssues,
    toggleIssueSelection, selectAllIssues, generateDocs, updateGeneratedField,
    setChgBasicInfo, setChgPlanningAssessment, setChgPlanningContent,
    pinCustomSnowField, removeCustomSnowField,
    setCloneChgNumber, cloneFromChg, applyTemplate, addChangeTask, removeChangeTask,
    appendTasksToExistingChg, cloneCtaskTemplate, updateEnvironment, goToStep, reset, createChg,
  ]);

  return { state, actions };
}
