// useCrgState — State management for the six-step Change Request Generator workflow.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import { snowFetch } from '../../../services/snowApi.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import { useCrgSubmissionDebugStore } from '../../../hooks/useCrgSubmissionDebugStore.ts';

// Step 3 was added (Change Details) so the wizard now runs 1 through 6.
type CrgStep = 1 | 2 | 3 | 4 | 5 | 6;
// How the user wants to pull issues in Step 1: by project key + fix version, or a raw JQL query.
type FetchMode = 'project' | 'jql';
type GeneratedFieldKey = 'shortDescription' | 'description' | 'justification' | 'riskImpact';
type EnvironmentKey = 'rel' | 'prd' | 'pfix';
export type EnvironmentValueByKey = Partial<Record<EnvironmentKey, string>>;

interface EnvironmentConfig {
  isEnabled: boolean;
  plannedStartDate: string;
  plannedEndDate: string;
  configItem: SnowReference;
  impactedPersonsAware: string;
  /** The SNow u_environment value specific to this environment card. Replaces the old global selector. */
  snowEnvironmentValue: string;
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
  impactedPersonsAware: string;           // Legacy fallback for SNow field: u_impacted_persons_aware
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
 * User-configurable pieces for the generated CHG short description.
 * Final format: "Application - Team - Change Details".
 */
export interface ShortDescriptionConfig {
  application: string;
  team: string;
  changeDetailsOverride: string;
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
const ISSUE_FIELD_LIST = 'summary,status,priority,issuetype,assignee,description,customfield_10200';
const CTASK_DEFAULT_SHORT_DESCRIPTION = 'Change task';
const AUTO_IMPLEMENTATION_CTASK_PREFIX = 'Enrollment - AWS';
const AUTO_TECHNICAL_CHECKOUT_CTASK_SHORT_DESCRIPTION = 'Technical Checkout';
const ENVIRONMENT_SUBMISSION_ORDER: EnvironmentKey[] = ['rel', 'prd', 'pfix'];
const AUTO_TECHNICAL_CHECKOUT_CTASK_DESCRIPTION = [
  'Objective:',
  'Validate the technical integrity and health of the live environment following a code promotion using CLI tools and GitHub deployment history.',
  '',
  'Tasks:',
  '',
  'Version Verification: Confirm the active environment is running the correct build by checking GitHub deployment tags or querying a /version endpoint.',
  '',
  'Service Health Checks: Use console tools or cURL to probe production endpoints and verify core services return 200 OK.',
  '',
  'Database Write Validation: Verify migration scripts executed successfully and that new records are being written correctly.',
  '',
  'Log & Error Monitoring: Review real-time application logs for anomalies, exceptions, or connection timeouts immediately following traffic shift.',
  '',
  'Success Criteria:',
  'Deployment is technically verified when the system version is confirmed, database connectivity is stable, and logs show zero critical errors post-launch.',
].join('\n');
const CTASK_CLONE_FIELDS = [
  'number', 'short_description', 'description', 'assignment_group', 'assigned_to',
  'planned_start_date', 'planned_end_date', 'close_notes',
].join(',');
// Upper bound on how many of a cloned CHG's change tasks to copy. A single change never
// realistically has more tasks than this, so it doubles as a safety cap on the query.
const CLONED_CTASK_FETCH_LIMIT = 100;
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
const SHORT_DESCRIPTION_CONFIG_STORAGE_KEY = 'ntbx-crg-short-description-config';
const CHANGE_MANAGER_ALIAS_FIELD_NAMES = ['change_manager', 'u_change_manager'] as const;
const USER_LOOKUP_RESULT_FIELDS = 'sys_id';
const PLANNING_ASSESSMENT_ALIAS_FIELD_NAMES_BY_STATE_KEY: Record<keyof ChgPlanningAssessment, readonly string[]> = {
  impact: ['u_impact', 'impact'],
  systemAvailabilityImplication: ['u_implications_of_system_availability', 'u_availability_impact'],
  hasBeenTested: ['u_has_this_change_been_tested', 'u_change_tested'],
  impactedPersonsAware: ['u_are_impacted_persons_aware_prepared_for_test_checkout', 'u_impacted_persons_aware'],
  hasBeenPerformedPreviously: ['u_has_change_been_performed_previously', 'u_performed_previously'],
  successProbability: ['u_assessment_of_success_probability', 'u_success_probability'],
  canBeBackedOut: ['u_can_change_be_backed_out', 'u_can_be_backed_out'],
};
const PLANNING_CONTENT_ALIAS_FIELD_NAMES_BY_STATE_KEY: Record<keyof ChgPlanningContent, readonly string[]> = {
  implementationPlan: ['implementation_plan'],
  backoutPlan: ['backout_plan'],
  testPlan: ['test_plan'],
};

// All reference field lookup fields requested when cloning a CHG from SNow.
// A blank SNow reference used as a default value for all reference fields.
const EMPTY_SNOW_REFERENCE: SnowReference = { sysId: '', displayName: '' };

function createDefaultEnvironmentConfig(): EnvironmentConfig {
  return {
    isEnabled: false,
    plannedStartDate: EMPTY_VALUE,
    plannedEndDate: EMPTY_VALUE,
    configItem: { ...EMPTY_SNOW_REFERENCE },
    impactedPersonsAware: EMPTY_VALUE,
    snowEnvironmentValue: EMPTY_VALUE,
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

function createDefaultShortDescriptionConfig(): ShortDescriptionConfig {
  return {
    application: EMPTY_VALUE,
    team: EMPTY_VALUE,
    changeDetailsOverride: EMPTY_VALUE,
  };
}

function loadShortDescriptionConfigFromStorage(): ShortDescriptionConfig {
  try {
    const storedJson = localStorage.getItem(SHORT_DESCRIPTION_CONFIG_STORAGE_KEY);
    if (!storedJson) {
      return createDefaultShortDescriptionConfig();
    }
    const parsedConfig = JSON.parse(storedJson) as Partial<ShortDescriptionConfig>;
    return mergeShortDescriptionConfig(createDefaultShortDescriptionConfig(), parsedConfig as ShortDescriptionConfig);
  } catch {
    return createDefaultShortDescriptionConfig();
  }
}

function saveShortDescriptionConfigToStorage(shortDescriptionConfig: ShortDescriptionConfig): void {
  try {
    localStorage.setItem(SHORT_DESCRIPTION_CONFIG_STORAGE_KEY, JSON.stringify(shortDescriptionConfig));
  } catch {
    // Best-effort persistence only — CHG generation still works when storage is unavailable.
  }
}

function resolveTemplateShortDescriptionValue(
  templateValue: string | undefined,
  fallbackValue: string,
): string {
  if (typeof templateValue !== 'string') {
    return fallbackValue;
  }
  return templateValue.trim() ? templateValue : fallbackValue;
}

function mergeShortDescriptionConfig(
  currentConfig: ShortDescriptionConfig,
  templateConfig: ShortDescriptionConfig | undefined,
): ShortDescriptionConfig {
  if (!templateConfig) {
    return currentConfig;
  }

  return {
    application: resolveTemplateShortDescriptionValue(templateConfig.application, currentConfig.application),
    team: resolveTemplateShortDescriptionValue(templateConfig.team, currentConfig.team),
    changeDetailsOverride: resolveTemplateShortDescriptionValue(
      templateConfig.changeDetailsOverride,
      currentConfig.changeDetailsOverride,
    ),
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
  /** Optional for backward compatibility with templates saved before short-description config was added. */
  shortDescriptionConfig?: ShortDescriptionConfig;
  chgBasicInfo: ChgBasicInfo;
  chgPlanningAssessment: ChgPlanningAssessment;
  chgPlanningContent: ChgPlanningContent;
  /** Optional for backward compatibility with templates saved before custom SNow field pins. */
  customSnowFields?: Record<string, string>;
  /** Optional for backward compatibility with templates saved before environment scheduling was added. */
  relEnvironment?: EnvironmentConfig;
  prdEnvironment?: EnvironmentConfig;
  pfixEnvironment?: EnvironmentConfig;
  /**
   * IDs of the CTASK templates linked to this CHG template. Applying the CHG
   * template auto-stages these CTASKs so they are created with the change.
   * Optional for backward compatibility with templates saved before linking existed.
   */
  ctaskTemplateIds?: string[];
  /**
   * When true, creating the CHG updates the CTASKs ServiceNow auto-generated (one per
   * staged CTASK, paired by list order) and only creates new records for the staged
   * CTASKs beyond the auto-generated count — instead of always creating new ones.
   * Used for teams whose change process auto-spawns CTASKs. Optional/false by default.
   */
  reconcileAutoCtasks?: boolean;
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
  /**
   * When a queued CTASK was auto-staged from a CHG template's link, this records
   * the source CTASK-template id so re-applying the same template does not stack
   * duplicate copies. Absent on saved templates and manually added CTASKs.
   */
  sourceTemplateId?: string;
}

/** Editable CTASK fields stored in a reusable template before ids and metadata are assigned. */
export type CtaskTemplateData = Omit<CtaskTemplate, 'id' | 'name' | 'createdAt'>;

export interface ChgSubmissionDebug {
  operation: 'create' | 'update';
  targetChgNumber: string;
  requestPayloadJson: string;
  operationResponseJson: string;
  verificationRecordJson: string;
  mismatchMessages: string[];
}

/**
 * Shape stored in localStorage — identical to CrgState minus transient/computed fields.
 * `selectedIssueKeys` is stored as a plain array because Set is not JSON-serialisable.
 */
type PersistedCrgState = Omit<
  CrgState,
  'availableFixVersions' | 'isFetchingIssues' | 'fetchError' |
  'isCloning' | 'cloneError' | 'isSubmitting' | 'submitResult' | 'submissionDebug' | 'selectedIssueKeys'
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
  shortDescriptionConfig: ShortDescriptionConfig;
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
  /** IDs of CTASK templates linked to the current CHG template (the editable link set). */
  ctaskTemplateIds: string[];
  /** When true, reconcile staged CTASKs with ServiceNow's auto-created ones on CHG create. */
  reconcileAutoCtasks: boolean;
  isSubmitting: boolean;
  submitResult: string | null;
  submissionDebug: ChgSubmissionDebug | null;
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
  setShortDescriptionConfig: (update: Partial<ShortDescriptionConfig>) => void;
  setChgBasicInfo: (update: Partial<ChgBasicInfo>) => void;
  setChgPlanningAssessment: (update: Partial<ChgPlanningAssessment>) => void;
  setChgPlanningContent: (update: Partial<ChgPlanningContent>) => void;
  pinCustomSnowField: (fieldName: string, fieldValue: string) => void;
  removeCustomSnowField: (fieldName: string) => void;
  setCloneChgNumber: (chgNumber: string) => void;
  /** Fetches a SNow CHG by number and pre-populates all form fields with its values. */
  cloneFromChg: () => Promise<void>;
  /**
   * Applies a saved template's field values to the current form state. When the
   * template links CTASK templates, the matching entries from availableCtaskTemplates
   * are auto-staged into the change-task list (pre-filled, still editable).
   */
  applyTemplate: (template: CrgTemplate, availableCtaskTemplates?: CtaskTemplate[]) => void;
  addChangeTask: (template: CtaskTemplate) => void;
  removeChangeTask: (taskId: string) => void;
  /** Sets which CTASK templates are linked to the CHG template currently being edited. */
  setLinkedCtaskTemplateIds: (ctaskTemplateIds: string[]) => void;
  /** Toggles whether CHG creation reconciles staged CTASKs with auto-created ones. */
  setReconcileAutoCtasks: (reconcileAutoCtasks: boolean) => void;
  appendTasksToExistingChg: (chgNumber: string) => Promise<void>;
  updateExistingChg: (chgNumber: string) => Promise<void>;
  cloneCtaskTemplate: (ctaskNumber: string) => Promise<CtaskTemplateData>;
  updateEnvironment: (environmentKey: EnvironmentKey, update: Partial<EnvironmentConfig>) => void;
  goToStep: (step: CrgStep) => void;
  reset: () => void;
  /** POSTs all CHG fields to ServiceNow and stores the resulting CHG number. */
  createChg: (environmentValueByKey?: EnvironmentValueByKey) => Promise<void>;
}

interface AutoCreatedChangeTaskRecord {
  sys_id: unknown;
  number?: unknown;
}

interface ChangeSubmissionTarget {
  environmentKey: EnvironmentKey | null;
  environmentLabel: string | null;
  environmentValue: string;
  configItem: SnowReference;
  impactedPersonsAware: string;
  plannedStartDate: string;
  plannedEndDate: string;
}

interface CreatedChangeRecord {
  environmentLabel: string | null;
  changeNumber: string;
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
    shortDescriptionConfig: loadShortDescriptionConfigFromStorage(),
    chgPlanningAssessment: createDefaultChgPlanningAssessment(),
    chgPlanningContent: createDefaultChgPlanningContent(),
    customSnowFields: {},
    inspectedSnowFields: [],
    relEnvironment: createDefaultEnvironmentConfig(),
    prdEnvironment: createDefaultEnvironmentConfig(),
    pfixEnvironment: createDefaultEnvironmentConfig(),
    changeTasks: [],
    ctaskTemplateIds: [],
    reconcileAutoCtasks: false,
    isSubmitting: false,
    submitResult: null,
    submissionDebug: null,
  };
}

/**
 * Stages the CTASK templates linked to a CHG template into the change-task queue.
 *
 * Each linked template is appended as a fresh queued CTASK (its own runtime id) tagged
 * with `sourceTemplateId` so the same link is not staged twice. Already-staged links and
 * unresolved ids (a linked template the user has since deleted) are skipped, so the result
 * is the existing queue plus any newly linked CTASKs — pre-filled but fully editable.
 *
 * @param existingTasks          - CTASKs already queued in the form.
 * @param linkedCtaskTemplateIds - IDs the CHG template links to.
 * @param availableCtaskTemplates - The user's current CTASK templates to resolve ids against.
 * @returns The new change-task queue.
 */
function stageLinkedCtasks(
  existingTasks: CtaskTemplate[],
  linkedCtaskTemplateIds: string[],
  availableCtaskTemplates: CtaskTemplate[],
): CtaskTemplate[] {
  const alreadyStagedSourceIds = new Set(
    existingTasks.map((task) => task.sourceTemplateId).filter(Boolean) as string[],
  );

  const newlyStaged: CtaskTemplate[] = [];
  for (const ctaskTemplateId of linkedCtaskTemplateIds) {
    if (alreadyStagedSourceIds.has(ctaskTemplateId)) {
      continue; // this link is already in the queue — don't duplicate it
    }
    const sourceTemplate = availableCtaskTemplates.find((template) => template.id === ctaskTemplateId);
    if (!sourceTemplate) {
      continue; // linked template was deleted — nothing to stage
    }
    newlyStaged.push({ ...sourceTemplate, id: crypto.randomUUID(), sourceTemplateId: ctaskTemplateId });
  }

  return [...existingTasks, ...newlyStaged];
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
  const persistedShortDescriptionConfig = loadShortDescriptionConfigFromStorage();
  return {
    ...createDefaultCrgState(),
    ...persisted,
    shortDescriptionConfig: mergeShortDescriptionConfig(
      persistedShortDescriptionConfig,
      persisted.shortDescriptionConfig,
    ),
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

function extractSnowReferenceFromFieldAliases(
  record: Record<string, unknown>,
  fieldAliases: readonly string[],
): SnowReference {
  for (const fieldAlias of fieldAliases) {
    const extractedReference = extractSnowReference(record[fieldAlias]);
    if (extractedReference.sysId || extractedReference.displayName) {
      return extractedReference;
    }
  }
  return { ...EMPTY_SNOW_REFERENCE };
}

function extractInspectableFieldValue(field: unknown): { displayValue: string; storedValue: string } {
  if (field && typeof field === 'object') {
    const snowField = field as Record<string, unknown>;
    const displayValue = String(snowField.display_value || snowField.value || EMPTY_VALUE).trim();
    const storedValue = String(snowField.value ?? EMPTY_VALUE).trim();
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

/**
 * Converts a ServiceNow change_task record into a staged CTASK ready for creation.
 * Used when cloning a CHG so the source change's tasks are reproduced and can overwrite
 * ServiceNow's auto-created CTASKs. The source CTASK number becomes the staged name so the
 * user recognizes each task on the review step.
 */
function buildStagedChangeTaskFromRecord(ctaskRecord: Record<string, unknown>): CtaskTemplate {
  const ctaskData = buildCtaskTemplateDataFromRecord(ctaskRecord);
  const sourceCtaskNumber = extractStringValue(ctaskRecord.number);
  return {
    ...ctaskData,
    id:        crypto.randomUUID(),
    name:      sourceCtaskNumber || ctaskData.shortDescription || CTASK_DEFAULT_SHORT_DESCRIPTION,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Fetches every change task belonging to the source CHG so a clone reproduces the change in full.
 * Copies all tasks regardless of state (a verbatim clone), ordered by creation time so the staged
 * list matches the original. Returns an empty list when the source CHG has no resolvable sys_id.
 *
 * @param sourceChgSysId - sys_id of the CHG being cloned.
 */
async function fetchClonedChangeTasks(sourceChgSysId: string): Promise<CtaskTemplate[]> {
  if (!sourceChgSysId) return [];

  const encodedQuery = encodeURIComponent(`change_request=${sourceChgSysId}^ORDERBYsys_created_on`);
  const responseData = await snowFetch<{ result: Record<string, unknown>[] }>(
    `/api/now/table/change_task?sysparm_query=${encodedQuery}&sysparm_fields=${CTASK_CLONE_FIELDS}&sysparm_display_value=all&sysparm_limit=${CLONED_CTASK_FETCH_LIMIT}`,
  );

  return (responseData?.result ?? []).map(buildStagedChangeTaskFromRecord);
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

function buildChangeRequestPayload(
  state: CrgState,
  changeSubmissionTarget: ChangeSubmissionTarget,
): Record<string, unknown> {
  const changeRequestPayload: Record<string, unknown> = {
    ...state.customSnowFields,
    short_description:    state.generatedShortDescription,
    description:          state.generatedDescription,
    justification:        state.generatedJustification,
    risk_impact_analysis: state.generatedRiskImpact,
  };

  if (state.chgBasicInfo.category)     changeRequestPayload.category      = state.chgBasicInfo.category;
  if (state.chgBasicInfo.changeType)   changeRequestPayload.type          = state.chgBasicInfo.changeType;
  if (changeSubmissionTarget.environmentValue)  changeRequestPayload.u_environment = changeSubmissionTarget.environmentValue;
  if (state.chgBasicInfo.isExpedited)  changeRequestPayload.u_expedited   = true;

  if (state.chgBasicInfo.requestedBy.sysId)     changeRequestPayload.requested_by      = state.chgBasicInfo.requestedBy.sysId;
  if (changeSubmissionTarget.configItem.sysId)  changeRequestPayload.cmdb_ci           = changeSubmissionTarget.configItem.sysId;
  if (state.chgBasicInfo.assignmentGroup.sysId) changeRequestPayload.assignment_group  = state.chgBasicInfo.assignmentGroup.sysId;
  if (state.chgBasicInfo.assignedTo.sysId)      changeRequestPayload.assigned_to       = state.chgBasicInfo.assignedTo.sysId;
  if (state.chgBasicInfo.tester.sysId)          changeRequestPayload.u_tester          = state.chgBasicInfo.tester.sysId;
  if (state.chgBasicInfo.serviceManager.sysId)  changeRequestPayload.u_service_manager = state.chgBasicInfo.serviceManager.sysId;
  if (changeSubmissionTarget.plannedStartDate)  changeRequestPayload.planned_start_date = changeSubmissionTarget.plannedStartDate;
  if (changeSubmissionTarget.plannedEndDate)    changeRequestPayload.planned_end_date   = changeSubmissionTarget.plannedEndDate;

  if (state.chgPlanningAssessment.impact)                        changeRequestPayload.impact                  = state.chgPlanningAssessment.impact;
  if (state.chgPlanningAssessment.systemAvailabilityImplication) changeRequestPayload.u_availability_impact   = state.chgPlanningAssessment.systemAvailabilityImplication;
  if (state.chgPlanningAssessment.hasBeenTested)                 changeRequestPayload.u_change_tested         = state.chgPlanningAssessment.hasBeenTested;
  if (changeSubmissionTarget.impactedPersonsAware)               changeRequestPayload.u_impacted_persons_aware = changeSubmissionTarget.impactedPersonsAware;
  if (state.chgPlanningAssessment.hasBeenPerformedPreviously)    changeRequestPayload.u_performed_previously  = state.chgPlanningAssessment.hasBeenPerformedPreviously;
  if (state.chgPlanningAssessment.successProbability)            changeRequestPayload.u_success_probability    = state.chgPlanningAssessment.successProbability;
  if (state.chgPlanningAssessment.canBeBackedOut)                changeRequestPayload.u_can_be_backed_out     = state.chgPlanningAssessment.canBeBackedOut;

  if (state.chgPlanningContent.implementationPlan) changeRequestPayload.implementation_plan = state.chgPlanningContent.implementationPlan;
  if (state.chgPlanningContent.backoutPlan)        changeRequestPayload.backout_plan        = state.chgPlanningContent.backoutPlan;
  if (state.chgPlanningContent.testPlan)           changeRequestPayload.test_plan           = state.chgPlanningContent.testPlan;
  applyDynamicPlanningAliasValues(changeRequestPayload, state, changeSubmissionTarget.impactedPersonsAware);

  return changeRequestPayload;
}

function serializeDebugValue(debugValue: unknown): string {
  try {
    return JSON.stringify(debugValue, null, 2);
  } catch {
    return String(debugValue);
  }
}

async function fetchChangeRecordByNumber(changeNumber: string): Promise<Record<string, unknown> | null> {
  const normalizedChangeNumber = changeNumber.trim().toUpperCase();
  const encodedQuery = encodeURIComponent(`number=${normalizedChangeNumber}`);
  const responseData = await snowFetch<{ result?: unknown }>(
    `/api/now/table/change_request?sysparm_query=${encodedQuery}&sysparm_limit=1&sysparm_display_value=all`,
  );

  if (!Array.isArray(responseData.result)) {
    return null;
  }
  const matchedChangeRecord = responseData.result[0];
  return matchedChangeRecord && typeof matchedChangeRecord === 'object'
    ? matchedChangeRecord as Record<string, unknown>
    : null;
}

function areNormalizedValuesEqual(leftValue: string, rightValue: string): boolean {
  return leftValue.trim().toLowerCase() === rightValue.trim().toLowerCase();
}

function resolveRecordFieldValue(record: Record<string, unknown>, fieldAliases: readonly string[]): string {
  for (const fieldAlias of fieldAliases) {
    const resolvedChoiceValue = extractChoiceValue(record[fieldAlias]);
    if (resolvedChoiceValue.trim()) {
      return resolvedChoiceValue.trim();
    }
  }
  return EMPTY_VALUE;
}

/** Resolves a cloned long-text planning field by trying each alias and taking the first populated one. */
function resolveRecordTextFieldValue(record: Record<string, unknown>, fieldAliases: readonly string[]): string {
  for (const fieldAlias of fieldAliases) {
    const resolvedTextValue = extractStringValue(record[fieldAlias]);
    if (resolvedTextValue.trim()) {
      return resolvedTextValue;
    }
  }
  return EMPTY_VALUE;
}

/**
 * Reads every planning-assessment choice from a cloned CHG using each field's known aliases.
 * The submit side writes the value to all aliases, but instances differ on which column actually
 * exists, so the clone must try each alias and take the first populated one — otherwise a value
 * stored under the non-default alias silently drops on clone.
 */
function buildClonedPlanningAssessment(chgRecord: Record<string, unknown>): ChgPlanningAssessment {
  const clonedAssessment = {} as ChgPlanningAssessment;
  for (const [assessmentKey, fieldAliases] of Object.entries(PLANNING_ASSESSMENT_ALIAS_FIELD_NAMES_BY_STATE_KEY)) {
    clonedAssessment[assessmentKey as keyof ChgPlanningAssessment] = resolveRecordFieldValue(chgRecord, fieldAliases);
  }
  return clonedAssessment;
}

/** Reads every planning-content text area from a cloned CHG using each field's known aliases. */
function buildClonedPlanningContent(chgRecord: Record<string, unknown>): ChgPlanningContent {
  const clonedContent = {} as ChgPlanningContent;
  for (const [contentKey, fieldAliases] of Object.entries(PLANNING_CONTENT_ALIAS_FIELD_NAMES_BY_STATE_KEY)) {
    clonedContent[contentKey as keyof ChgPlanningContent] = resolveRecordTextFieldValue(chgRecord, fieldAliases);
  }
  return clonedContent;
}

function buildSubmissionMismatchMessages(state: CrgState, verifiedChangeRecord: Record<string, unknown>): string[] {
  const mismatchMessages: string[] = [];
  const expectedPlanningAssessmentValues: Record<keyof ChgPlanningAssessment, string> = {
    impact: state.chgPlanningAssessment.impact,
    systemAvailabilityImplication: state.chgPlanningAssessment.systemAvailabilityImplication,
    hasBeenTested: state.chgPlanningAssessment.hasBeenTested,
    impactedPersonsAware: readPrimaryChangeSubmissionTarget(state).impactedPersonsAware,
    hasBeenPerformedPreviously: state.chgPlanningAssessment.hasBeenPerformedPreviously,
    successProbability: state.chgPlanningAssessment.successProbability,
    canBeBackedOut: state.chgPlanningAssessment.canBeBackedOut,
  };

  for (const [planningAssessmentKey, fieldAliases] of Object.entries(PLANNING_ASSESSMENT_ALIAS_FIELD_NAMES_BY_STATE_KEY)) {
    const expectedValue = expectedPlanningAssessmentValues[planningAssessmentKey as keyof ChgPlanningAssessment].trim();
    if (!expectedValue) {
      continue;
    }
    const actualValue = resolveRecordFieldValue(verifiedChangeRecord, fieldAliases);
    if (!actualValue) {
      mismatchMessages.push(`${planningAssessmentKey}: expected "${expectedValue}" but no value was returned from SNow.`);
      continue;
    }
    if (!areNormalizedValuesEqual(expectedValue, actualValue)) {
      mismatchMessages.push(`${planningAssessmentKey}: expected "${expectedValue}" but SNow returned "${actualValue}".`);
    }
  }

  const expectedChangeManager = state.chgBasicInfo.changeManager;
  if (expectedChangeManager.sysId.trim() || expectedChangeManager.displayName.trim()) {
    const actualChangeManager = extractSnowReferenceFromFieldAliases(verifiedChangeRecord, CHANGE_MANAGER_ALIAS_FIELD_NAMES);
    if (expectedChangeManager.sysId.trim() && !areNormalizedValuesEqual(expectedChangeManager.sysId, actualChangeManager.sysId)) {
      mismatchMessages.push(`changeManager sys_id: expected "${expectedChangeManager.sysId}" but SNow returned "${actualChangeManager.sysId || 'empty'}".`);
    }
    if (expectedChangeManager.displayName.trim() && !areNormalizedValuesEqual(expectedChangeManager.displayName, actualChangeManager.displayName)) {
      mismatchMessages.push(`changeManager display: expected "${expectedChangeManager.displayName}" but SNow returned "${actualChangeManager.displayName || 'empty'}".`);
    }
  }

  return mismatchMessages;
}

function buildSubmissionDebugData(
  operation: 'create' | 'update',
  targetChgNumber: string,
  requestPayload: Record<string, unknown>,
  operationResponse: unknown,
  verificationRecord: Record<string, unknown> | null,
  mismatchMessages: string[],
): ChgSubmissionDebug {
  return {
    operation,
    targetChgNumber,
    requestPayloadJson: serializeDebugValue(requestPayload),
    operationResponseJson: serializeDebugValue(operationResponse),
    verificationRecordJson: serializeDebugValue(verificationRecord),
    mismatchMessages,
  };
}

async function resolveUserSysIdByDisplayName(userDisplayName: string): Promise<string> {
  const normalizedUserDisplayName = userDisplayName.trim();
  if (!normalizedUserDisplayName) {
    return EMPTY_VALUE;
  }

  const encodedLookupQuery = encodeURIComponent(`name=${normalizedUserDisplayName}`);
  const userLookupResponse = await snowFetch<{ result: Array<{ sys_id: unknown }> }>(
    `/api/now/table/sys_user?sysparm_query=${encodedLookupQuery}&sysparm_fields=${USER_LOOKUP_RESULT_FIELDS}&sysparm_limit=1`,
  );
  const matchedUserSysId = extractReferenceSysId(userLookupResponse.result[0]?.sys_id);
  return matchedUserSysId;
}

async function resolveChangeManagerSubmissionValue(changeManager: SnowReference): Promise<string> {
  if (changeManager.sysId.trim()) {
    return changeManager.sysId.trim();
  }
  if (!changeManager.displayName.trim()) {
    return EMPTY_VALUE;
  }

  return resolveUserSysIdByDisplayName(changeManager.displayName);
}

/**
 * Writes every known alias for each planning field into the payload.
 * SNow silently ignores field names it doesn't recognise, so sending all
 * aliases is safe and guarantees the correct field is populated regardless
 * of which non-standard column name the target instance happens to use.
 */
function applyDynamicPlanningAliasValues(
  changeRequestPayload: Record<string, unknown>,
  state: CrgState,
  impactedPersonsAwareOverride?: string,
): void {
  const mappedImpactedPersonsAware = (impactedPersonsAwareOverride ?? readPrimaryChangeSubmissionTarget(state).impactedPersonsAware).trim();
  const planningAssessmentValueByKey: Record<keyof ChgPlanningAssessment, string> = {
    impact: state.chgPlanningAssessment.impact,
    systemAvailabilityImplication: state.chgPlanningAssessment.systemAvailabilityImplication,
    hasBeenTested: state.chgPlanningAssessment.hasBeenTested,
    impactedPersonsAware: mappedImpactedPersonsAware,
    hasBeenPerformedPreviously: state.chgPlanningAssessment.hasBeenPerformedPreviously,
    successProbability: state.chgPlanningAssessment.successProbability,
    canBeBackedOut: state.chgPlanningAssessment.canBeBackedOut,
  };

  for (const [assessmentKey, apiFieldNames] of Object.entries(PLANNING_ASSESSMENT_ALIAS_FIELD_NAMES_BY_STATE_KEY)) {
    const planningAssessmentValue = planningAssessmentValueByKey[assessmentKey as keyof ChgPlanningAssessment].trim();
    if (!planningAssessmentValue) continue;
    // Write to every known alias — SNow ignores fields it doesn't recognise
    for (const apiFieldName of apiFieldNames) {
      changeRequestPayload[apiFieldName] = planningAssessmentValue;
    }
  }

  for (const [contentKey, apiFieldNames] of Object.entries(PLANNING_CONTENT_ALIAS_FIELD_NAMES_BY_STATE_KEY)) {
    const planningContentValue = state.chgPlanningContent[contentKey as keyof ChgPlanningContent].trim();
    if (!planningContentValue) continue;
    // Write to every known alias — SNow ignores fields it doesn't recognise
    for (const apiFieldName of apiFieldNames) {
      changeRequestPayload[apiFieldName] = planningContentValue;
    }
  }
}

function formatCtaskCount(count: number): string {
  return count === 1 ? '1 CTASK' : `${count} CTASKs`;
}

function formatCreatedChangeSummary(
  createdChangeRecords: CreatedChangeRecord[],
  queuedTaskCount: number,
): string {
  if (createdChangeRecords.length === 1) {
    const onlyCreatedChange = createdChangeRecords[0];
    if (!onlyCreatedChange) {
      return 'CHG created';
    }
    return queuedTaskCount > 0
      ? `${onlyCreatedChange.changeNumber} created with ${formatCtaskCount(queuedTaskCount)}`
      : `${onlyCreatedChange.changeNumber} created`;
  }

  const createdChangeList = createdChangeRecords
    .map((createdChangeRecord) =>
      createdChangeRecord.environmentLabel
        ? `${createdChangeRecord.environmentLabel} ${createdChangeRecord.changeNumber}`
        : createdChangeRecord.changeNumber)
    .join(', ');

  return queuedTaskCount > 0
    ? `${createdChangeRecords.length} CHGs created with ${formatCtaskCount(queuedTaskCount)} each: ${createdChangeList}`
    : `${createdChangeRecords.length} CHGs created: ${createdChangeList}`;
}

function resolveAutoCreatedCtaskEnvironmentLabel(state: CrgState, environmentKey: EnvironmentKey | null): string {
  if (environmentKey) {
    return readEnvironmentLabel(environmentKey);
  }

  const normalizedEnvironmentValue = state.chgBasicInfo.environment.trim().toUpperCase();
  if (normalizedEnvironmentValue.includes('PFIX')) return 'PFIX';
  if (normalizedEnvironmentValue.includes('PRD') || normalizedEnvironmentValue.includes('PROD')) return 'PRD';
  if (normalizedEnvironmentValue.includes('REL') || normalizedEnvironmentValue.includes('RELEASE')) return 'REL';
  return 'ENV';
}

function resolveImplementationCtaskPrefix(state: CrgState): string {
  const configuredApplicationName = state.shortDescriptionConfig.application.trim();
  if (!configuredApplicationName) return AUTO_IMPLEMENTATION_CTASK_PREFIX;
  return `${configuredApplicationName} - AWS`;
}

async function fetchAutoCreatedChangeTasks(changeSysId: string): Promise<AutoCreatedChangeTaskRecord[]> {
  const encodedQuery = encodeURIComponent(`change_request=${changeSysId}`);
  const responseData = await snowFetch<{ result?: unknown }>(
    `/api/now/table/change_task?sysparm_query=${encodedQuery}&sysparm_orderby=sys_created_on&sysparm_fields=sys_id,number,short_description&sysparm_limit=10`,
    { method: 'GET' },
  );
  return Array.isArray(responseData.result) ? responseData.result as AutoCreatedChangeTaskRecord[] : [];
}

async function patchChangeTaskBySysId(changeTaskSysId: string, patchBody: Record<string, unknown>): Promise<void> {
  await snowFetch(
    `/api/now/table/change_task/${changeTaskSysId}`,
    {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(patchBody),
    },
  );
}

/** How many times to re-check for auto-created CTASKs before reconciling. */
const AUTO_CTASK_POLL_ATTEMPTS = 6;
/** Delay between auto-created CTASK polls (ms) — long enough for an async SNow workflow. */
const AUTO_CTASK_POLL_DELAY_MS = 1500;

/** Resolves after the given delay. Extracted so reconcile polling is injectable in tests. */
function delayMs(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Re-reads the auto-created CTASKs until their count holds steady across two polls
 * (or attempts run out). ServiceNow may spawn them via an async workflow a moment
 * after the CHG is inserted, so a single read can miss some or catch a partial set.
 *
 * @param changeSysId - The new CHG's sys_id.
 * @param sleep       - Delay function (overridable in tests to avoid real waits).
 * @returns The auto-created CTASK records, ordered by creation time.
 */
async function fetchAutoCreatedChangeTasksStable(
  changeSysId: string,
  sleep: (milliseconds: number) => Promise<void> = delayMs,
): Promise<AutoCreatedChangeTaskRecord[]> {
  let latestTasks: AutoCreatedChangeTaskRecord[] = [];
  let previousCount = -1;

  for (let attempt = 0; attempt < AUTO_CTASK_POLL_ATTEMPTS; attempt += 1) {
    latestTasks = await fetchAutoCreatedChangeTasks(changeSysId);
    // A non-zero count that matched the previous poll means creation has settled.
    if (latestTasks.length > 0 && latestTasks.length === previousCount) {
      return latestTasks;
    }
    previousCount = latestTasks.length;
    if (attempt < AUTO_CTASK_POLL_ATTEMPTS - 1) {
      await sleep(AUTO_CTASK_POLL_DELAY_MS);
    }
  }

  return latestTasks;
}

/**
 * Reconciles staged CTASKs with the ones ServiceNow auto-created for a new CHG:
 * updates the auto-created records in place (paired by list order) and creates new
 * records only for staged CTASKs beyond the auto-created count. Any auto-created
 * CTASKs beyond the staged count are left untouched.
 *
 * @param changeSysId - The new CHG's sys_id.
 * @param stagedTasks - The CTASKs queued from the linked templates, in order.
 * @param sleep       - Delay function for the poll (overridable in tests).
 * @returns The number of staged CTASKs processed (updated + created).
 */
export async function reconcileStagedChangeTasks(
  changeSysId: string,
  stagedTasks: CtaskTemplate[],
  sleep: (milliseconds: number) => Promise<void> = delayMs,
): Promise<number> {
  if (stagedTasks.length === 0) {
    return 0;
  }

  const autoCreatedTasks = await fetchAutoCreatedChangeTasksStable(changeSysId, sleep);
  const updateCount = Math.min(autoCreatedTasks.length, stagedTasks.length);

  // Update the auto-created CTASKs in place to match the first staged templates.
  for (let index = 0; index < updateCount; index += 1) {
    const autoCreatedSysId = extractReferenceSysId(autoCreatedTasks[index]?.sys_id);
    if (autoCreatedSysId) {
      await patchChangeTaskBySysId(autoCreatedSysId, buildChangeTaskPayload(changeSysId, stagedTasks[index]));
    }
  }

  // Create new CTASKs for any staged templates beyond the auto-created count.
  const remainingTasks = stagedTasks.slice(updateCount);
  if (remainingTasks.length > 0) {
    await createChangeTasks(changeSysId, remainingTasks);
  }

  return stagedTasks.length;
}

async function updateAutoCreatedChangeTasks(
  changeSysId: string,
  state: CrgState,
  environmentKey: EnvironmentKey | null,
): Promise<void> {
  const autoCreatedTasks = await fetchAutoCreatedChangeTasks(changeSysId);
  if (autoCreatedTasks.length === 0) {
    return;
  }

  const implementationTaskSysId = extractReferenceSysId(autoCreatedTasks[0]?.sys_id);
  if (implementationTaskSysId) {
    const environmentLabel = resolveAutoCreatedCtaskEnvironmentLabel(state, environmentKey);
    const implementationTaskPrefix = resolveImplementationCtaskPrefix(state);
    await patchChangeTaskBySysId(implementationTaskSysId, {
      short_description: `${implementationTaskPrefix} - ${environmentLabel}`,
    });
  }

  const technicalCheckoutTaskSysId = extractReferenceSysId(autoCreatedTasks[1]?.sys_id);
  if (technicalCheckoutTaskSysId) {
    await patchChangeTaskBySysId(technicalCheckoutTaskSysId, {
      short_description: AUTO_TECHNICAL_CHECKOUT_CTASK_SHORT_DESCRIPTION,
      description:       AUTO_TECHNICAL_CHECKOUT_CTASK_DESCRIPTION,
    });
  }
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

function buildIssueTypeLabel(issueTypeName: string, issueTypeCount: number): string {
  if (issueTypeCount === 1) {
    return issueTypeName;
  }
  if (issueTypeName.endsWith('y')) {
    return `${issueTypeName.slice(0, -1)}ies`;
  }
  if (issueTypeName.endsWith('s')) {
    return issueTypeName;
  }
  return `${issueTypeName}s`;
}

function buildIssueTypeSummary(selectedIssues: JiraIssue[]): string {
  if (selectedIssues.length === 0) {
    return '0 Issues';
  }

  const issueTypeCountByName = new Map<string, number>();
  for (const selectedIssue of selectedIssues) {
    const issueTypeName = selectedIssue.fields.issuetype?.name?.trim() || 'Issue';
    issueTypeCountByName.set(issueTypeName, (issueTypeCountByName.get(issueTypeName) ?? 0) + 1);
  }

  return [...issueTypeCountByName.entries()]
    .sort((leftEntry, rightEntry) => rightEntry[1] - leftEntry[1] || leftEntry[0].localeCompare(rightEntry[0]))
    .map(([issueTypeName, issueTypeCount]) => `${issueTypeCount} ${buildIssueTypeLabel(issueTypeName, issueTypeCount)}`)
    .join(' ');
}

function buildAutoChangeDetails(fetchMode: FetchMode, fixVersion: string, selectedIssues: JiraIssue[]): string {
  const normalizedFixVersion = fixVersion.trim();
  if (fetchMode === 'project' && normalizedFixVersion) {
    return normalizedFixVersion;
  }
  return buildIssueTypeSummary(selectedIssues);
}

function buildGeneratedShortDescription(
  shortDescriptionConfig: ShortDescriptionConfig,
  fetchMode: FetchMode,
  projectKey: string,
  fixVersion: string,
  selectedIssues: JiraIssue[],
): string {
  const shortDescriptionApplication = shortDescriptionConfig.application.trim() || projectKey.trim() || 'Application';
  const shortDescriptionTeam = shortDescriptionConfig.team.trim() || 'Team';
  const shortDescriptionDetails = shortDescriptionConfig.changeDetailsOverride.trim()
    || buildAutoChangeDetails(fetchMode, fixVersion, selectedIssues);

  return `${shortDescriptionApplication} - ${shortDescriptionTeam} - ${shortDescriptionDetails}`;
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

function readEnabledEnvironmentKeys(state: CrgState): EnvironmentKey[] {
  return ENVIRONMENT_SUBMISSION_ORDER.filter((environmentKey) => state[getEnvironmentStateKey(environmentKey)].isEnabled);
}

function readEnvironmentLabel(environmentKey: EnvironmentKey): string {
  return environmentKey.toUpperCase();
}

function buildChangeSubmissionTargets(
  state: CrgState,
  environmentValueByKey: EnvironmentValueByKey = {},
): ChangeSubmissionTarget[] {
  const enabledEnvironmentKeys = readEnabledEnvironmentKeys(state);
  if (enabledEnvironmentKeys.length === 0) {
    return [{
      environmentKey: null,
      environmentLabel: null,
      environmentValue: state.chgBasicInfo.environment,
      configItem: state.chgBasicInfo.configItem,
      impactedPersonsAware: state.chgPlanningAssessment.impactedPersonsAware,
      plannedStartDate: EMPTY_VALUE,
      plannedEndDate: EMPTY_VALUE,
    }];
  }

  return enabledEnvironmentKeys.map((environmentKey) => {
    const environmentState = state[getEnvironmentStateKey(environmentKey)];
    return {
      environmentKey,
      environmentLabel: readEnvironmentLabel(environmentKey),
      environmentValue: environmentState.snowEnvironmentValue.trim() || environmentValueByKey[environmentKey]?.trim() || state.chgBasicInfo.environment,
      configItem: environmentState.configItem.sysId ? environmentState.configItem : state.chgBasicInfo.configItem,
      impactedPersonsAware: environmentState.impactedPersonsAware.trim() || state.chgPlanningAssessment.impactedPersonsAware,
      plannedStartDate: environmentState.plannedStartDate,
      plannedEndDate: environmentState.plannedEndDate,
    };
  });
}

function readPrimaryChangeSubmissionTarget(state: CrgState): ChangeSubmissionTarget {
  const primaryChangeSubmissionTarget = buildChangeSubmissionTargets(state)[0];
  if (!primaryChangeSubmissionTarget) {
    return {
      environmentKey: null,
      environmentLabel: null,
      environmentValue: state.chgBasicInfo.environment,
      configItem: state.chgBasicInfo.configItem,
      impactedPersonsAware: state.chgPlanningAssessment.impactedPersonsAware,
      plannedStartDate: EMPTY_VALUE,
      plannedEndDate: EMPTY_VALUE,
    };
  }

  return primaryChangeSubmissionTarget;
}

function buildClonedEnvironmentState(
  previousState: CrgState,
  clonedEnvironmentValue: string,
  clonedConfigItem: SnowReference,
  clonedImpactedPersonsAware: string,
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
    impactedPersonsAware: clonedImpactedPersonsAware,
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
      shortDescriptionConfig:    state.shortDescriptionConfig,
      chgPlanningAssessment:     state.chgPlanningAssessment,
      chgPlanningContent:        state.chgPlanningContent,
      customSnowFields:          state.customSnowFields,
      inspectedSnowFields:       state.inspectedSnowFields,
      relEnvironment:            state.relEnvironment,
      prdEnvironment:            state.prdEnvironment,
      pfixEnvironment:           state.pfixEnvironment,
      changeTasks:               state.changeTasks,
      ctaskTemplateIds:          state.ctaskTemplateIds,
      reconcileAutoCtasks:       state.reconcileAutoCtasks,
    };

    try {
      localStorage.setItem(CRG_STATE_STORAGE_KEY, JSON.stringify(persistedState));
    } catch {
      // Non-fatal — persistence fails gracefully (private mode, storage quota, etc.).
    }
  }, [state]);

  useEffect(() => {
    saveShortDescriptionConfigToStorage(state.shortDescriptionConfig);
  }, [state.shortDescriptionConfig]);

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
    let resetFixVersionsTimeoutId: number | null = null;

    if (!state.projectKey) {
      resetFixVersionsTimeoutId = window.setTimeout(() => {
        setState((previousState) => ({ ...previousState, availableFixVersions: [] }));
      }, 0);
      return () => {
        if (resetFixVersionsTimeoutId !== null) {
          window.clearTimeout(resetFixVersionsTimeoutId);
        }
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
      if (resetFixVersionsTimeoutId !== null) {
        window.clearTimeout(resetFixVersionsTimeoutId);
      }
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
      const generatedShortDescription = buildGeneratedShortDescription(
        previousState.shortDescriptionConfig,
        previousState.fetchMode,
        previousState.projectKey,
        previousState.fixVersion,
        selectedIssues,
      );

      return {
        ...previousState,
        generatedShortDescription,
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

  const setShortDescriptionConfig = useCallback((update: Partial<ShortDescriptionConfig>) => {
    setState((previousState) => ({
      ...previousState,
      shortDescriptionConfig: { ...previousState.shortDescriptionConfig, ...update },
    }));
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
      // Read planning fields through their alias lists so values stored under this instance's
      // column names carry over — the same resolution the submit and verify paths already use.
      const clonedPlanningAssessment = buildClonedPlanningAssessment(chg);
      const clonedPlanningContent = buildClonedPlanningContent(chg);
      const clonedImpactedPersonsAware = clonedPlanningAssessment.impactedPersonsAware;
      const clonedChangeManager = extractSnowReferenceFromFieldAliases(chg, CHANGE_MANAGER_ALIAS_FIELD_NAMES);
      const inspectedSnowFields = buildInspectedSnowFields(chg);

      // A clone reproduces the whole change, so copy its CTASKs too and overwrite ServiceNow's
      // auto-created ones on create — this is what makes cloning better than the native SNow copy.
      const sourceChgSysId = extractReferenceSysId(chg.sys_id);
      const clonedChangeTasks = await fetchClonedChangeTasks(sourceChgSysId);

      setState((previousState) => ({
        ...previousState,
        isCloning: false,
        cloneError: null,
        // Cloning is not templating: land on Review & Create with the change fully reproduced.
        currentStep: 6,
        changeTasks: clonedChangeTasks,
        reconcileAutoCtasks: true,
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
          changeManager:   clonedChangeManager,
          tester:          extractSnowReference(chg.u_tester),
          serviceManager:  extractSnowReference(chg.u_service_manager),
          isExpedited:     extractChoiceValue(chg.u_expedited) === 'true',
        },
        ...buildClonedEnvironmentState(previousState, clonedEnvironmentValue, clonedConfigItem, clonedImpactedPersonsAware),
        chgPlanningAssessment: clonedPlanningAssessment,
        chgPlanningContent: clonedPlanningContent,
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
  const applyTemplate = useCallback((template: CrgTemplate, availableCtaskTemplates: CtaskTemplate[] = []) => {
    const linkedCtaskTemplateIds = template.ctaskTemplateIds ?? [];

    setState((previousState) => ({
      ...previousState,
      chgBasicInfo:          { ...template.chgBasicInfo },
      shortDescriptionConfig: mergeShortDescriptionConfig(
        previousState.shortDescriptionConfig,
        template.shortDescriptionConfig,
      ),
      chgPlanningAssessment: { ...template.chgPlanningAssessment },
      chgPlanningContent:    { ...template.chgPlanningContent },
      customSnowFields:      { ...(template.customSnowFields ?? previousState.customSnowFields) },
      relEnvironment:        template.relEnvironment ? mergeEnvironmentConfig(template.relEnvironment) : previousState.relEnvironment,
      prdEnvironment:        template.prdEnvironment ? mergeEnvironmentConfig(template.prdEnvironment) : previousState.prdEnvironment,
      pfixEnvironment:       template.pfixEnvironment ? mergeEnvironmentConfig(template.pfixEnvironment) : previousState.pfixEnvironment,
      // Remember the link set so it round-trips when the user re-saves this CHG template.
      ctaskTemplateIds:      linkedCtaskTemplateIds,
      // Carry the template's reconcile preference into the working form.
      reconcileAutoCtasks:   template.reconcileAutoCtasks ?? false,
      // Pre-fill the linked CTASKs (still editable). Skip any already staged from the
      // same source template so re-applying the CHG template doesn't stack duplicates.
      changeTasks:           stageLinkedCtasks(previousState.changeTasks, linkedCtaskTemplateIds, availableCtaskTemplates),
    }));
  }, []);

  const setLinkedCtaskTemplateIds = useCallback((ctaskTemplateIds: string[]) => {
    setState((previousState) => ({ ...previousState, ctaskTemplateIds }));
  }, []);

  const setReconcileAutoCtasks = useCallback((reconcileAutoCtasks: boolean) => {
    setState((previousState) => ({ ...previousState, reconcileAutoCtasks }));
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

    setState((previousState) => ({
      ...previousState,
      isSubmitting: true,
      submitResult: null,
      submissionDebug: null,
    }));
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

  const updateExistingChg = useCallback(async (chgNumber: string) => {
    const normalizedChangeNumber = chgNumber.trim().toUpperCase();
    if (!normalizedChangeNumber) {
      setState((previousState) => ({ ...previousState, submitResult: 'Error: Enter a CHG number before updating.' }));
      return;
    }

    setState((previousState) => ({ ...previousState, isSubmitting: true, submitResult: null }));

    try {
      const changeSysId = await fetchChangeSysIdByNumber(normalizedChangeNumber);
      const changeRequestPayload = buildChangeRequestPayload(state, readPrimaryChangeSubmissionTarget(state));
      const resolvedChangeManagerSysId = await resolveChangeManagerSubmissionValue(state.chgBasicInfo.changeManager);
      if (resolvedChangeManagerSysId) {
        // Write to both canonical and instance-specific alias so either field name is populated
        changeRequestPayload.change_manager   = resolvedChangeManagerSysId;
        changeRequestPayload.u_change_manager = resolvedChangeManagerSysId;
      }
      const patchResponse = await snowFetch(
        `/api/now/table/change_request/${changeSysId}`,
        {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(changeRequestPayload),
        },
      );
      const verifiedChangeRecord = await fetchChangeRecordByNumber(normalizedChangeNumber);
      const mismatchMessages = verifiedChangeRecord
        ? buildSubmissionMismatchMessages(state, verifiedChangeRecord)
        : ['Unable to verify updated CHG record after PATCH.'];
      const submissionDebug = buildSubmissionDebugData(
        'update',
        normalizedChangeNumber,
        changeRequestPayload,
        patchResponse,
        verifiedChangeRecord,
        mismatchMessages,
      );
      const updateResultMessage = mismatchMessages.length === 0
        ? `${normalizedChangeNumber} updated`
        : `${normalizedChangeNumber} updated with verification warnings (${mismatchMessages.length})`;

      useCrgSubmissionDebugStore.getState().updateLastSubmissionDebug(submissionDebug);
      setState((previousState) => ({
        ...previousState,
        isSubmitting: false,
        currentStep: 6,
        submitResult: updateResultMessage,
        submissionDebug,
      }));
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'CHG update failed';
      useCrgSubmissionDebugStore.getState().updateLastSubmissionDebug(null);
      setState((previousState) => ({
        ...previousState,
        isSubmitting: false,
        currentStep: 6,
        submitResult: 'Error: ' + errorMessage,
        submissionDebug: null,
      }));
    }
  }, [state]);

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
        throw new Error('SNow returned 401 while cloning the CTASK. Refresh a full ServiceNow form or list page, click the latest NodeToolbox SNow Relay bookmarklet, then try again.', {
          cause: unknownError,
        });
      }
      throw new Error(errorMessage, { cause: unknownError });
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
  const createChg = useCallback(async (environmentValueByKey: EnvironmentValueByKey = {}) => {
    setState((previousState) => ({
      ...previousState,
      isSubmitting: true,
      submitResult: null,
      submissionDebug: null,
    }));
    const changeSubmissionTargets = buildChangeSubmissionTargets(state, environmentValueByKey);
    const createdChangeRecords: CreatedChangeRecord[] = [];
    let latestSubmissionDebug: ChgSubmissionDebug | null = null;

    try {
      const resolvedChangeManagerSysId = await resolveChangeManagerSubmissionValue(state.chgBasicInfo.changeManager);
      for (const changeSubmissionTarget of changeSubmissionTargets) {
        const chgPayload = buildChangeRequestPayload(state, changeSubmissionTarget);
        if (resolvedChangeManagerSysId) {
          // Write to both canonical and instance-specific alias so either field name is populated
          chgPayload.change_manager   = resolvedChangeManagerSysId;
          chgPayload.u_change_manager = resolvedChangeManagerSysId;
        }

        const responseData = await snowFetch<{ result: { number: string; sys_id?: unknown } }>(
          '/api/now/table/change_request',
          {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(chgPayload),
          },
        );

        const changeNumber = responseData.result.number;
        const changeSysId = extractReferenceSysId(responseData.result.sys_id) || await fetchChangeSysIdByNumber(changeNumber);
        createdChangeRecords.push({
          environmentLabel: changeSubmissionTarget.environmentLabel,
          changeNumber,
        });

        // Reconcile mode (per-template): update the CTASKs ServiceNow auto-created to
        // match the staged ones by order, then create the remainder — for teams whose
        // change process auto-spawns CTASKs.
        if (state.reconcileAutoCtasks) {
          try {
            await reconcileStagedChangeTasks(changeSysId, state.changeTasks);
          } catch (unknownError) {
            const errorMessage = unknownError instanceof Error ? unknownError.message : 'CTASK reconcile failed';
            throw new Error(`${changeNumber} created, but reconciling CTASKs did not fully complete. Check ServiceNow before retrying: ${errorMessage}`, {
              cause: unknownError,
            });
          }
        } else {
          // Default mode: the team-specific auto-CTASK rename, then create all staged as new.
          try {
            await updateAutoCreatedChangeTasks(changeSysId, state, changeSubmissionTarget.environmentKey);
          } catch (unknownError) {
            const errorMessage = unknownError instanceof Error ? unknownError.message : 'Auto-created CTASK updates failed';
            throw new Error(`${changeNumber} created, but auto-created CTASK updates failed. Check ServiceNow before retrying: ${errorMessage}`, {
              cause: unknownError,
            });
          }

          if (state.changeTasks.length > 0) {
            try {
              await createChangeTasks(changeSysId, state.changeTasks);
            } catch (unknownError) {
              const errorMessage = unknownError instanceof Error ? unknownError.message : 'CTASK creation failed';
              const taskLabel = formatCtaskCount(state.changeTasks.length);
              throw new Error(`${changeNumber} created, but ${taskLabel} did not fully complete. Check ServiceNow before retrying: ${errorMessage}`, {
                cause: unknownError,
              });
            }
          }
        }

        latestSubmissionDebug = buildSubmissionDebugData(
          'create',
          changeNumber,
          chgPayload,
          responseData,
          null,
          [],
        );
      }

      const creationSummary = formatCreatedChangeSummary(createdChangeRecords, state.changeTasks.length);
      // Clear persisted progress after a successful submission — the next change starts fresh.
      justResetRef.current = true;
      try { localStorage.removeItem(CRG_STATE_STORAGE_KEY); } catch { /* non-fatal */ }
      useCrgSubmissionDebugStore.getState().updateLastSubmissionDebug(latestSubmissionDebug);
      setState(() => ({
        ...createDefaultCrgState(),
        isSubmitting: false,
        submitResult: creationSummary,
        currentStep:  6 as CrgStep,
        submissionDebug: latestSubmissionDebug,
      }));
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'CHG creation failed';
      useCrgSubmissionDebugStore.getState().updateLastSubmissionDebug(latestSubmissionDebug);
      const partialFailureSummary = createdChangeRecords.length === 1 && changeSubmissionTargets.length === 1
        ? errorMessage
        : `${formatCreatedChangeSummary(createdChangeRecords, state.changeTasks.length)}; then a later submission failed: ${errorMessage}`;
      setState((previousState) => ({
        ...previousState,
        isSubmitting: false,
        submitResult: createdChangeRecords.length > 0 ? partialFailureSummary : 'Error: ' + errorMessage,
        submissionDebug: latestSubmissionDebug,
      }));
    }
  }, [state]);

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
      setShortDescriptionConfig,
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
      setLinkedCtaskTemplateIds,
      setReconcileAutoCtasks,
      appendTasksToExistingChg,
      updateExistingChg,
      cloneCtaskTemplate,
      updateEnvironment,
      goToStep,
      reset,
      createChg,
    };
  }, [
    setFetchMode, setProjectKey, setFixVersion, setCustomJql, fetchIssues,
    toggleIssueSelection, selectAllIssues, generateDocs, updateGeneratedField,
    setShortDescriptionConfig,
    setChgBasicInfo, setChgPlanningAssessment, setChgPlanningContent,
    pinCustomSnowField, removeCustomSnowField,
    setCloneChgNumber, cloneFromChg, applyTemplate, addChangeTask, removeChangeTask,
    setLinkedCtaskTemplateIds, setReconcileAutoCtasks,
    appendTasksToExistingChg, cloneCtaskTemplate, updateEnvironment, goToStep, reset, createChg,
    updateExistingChg,
  ]);

  return { state, actions };
}
