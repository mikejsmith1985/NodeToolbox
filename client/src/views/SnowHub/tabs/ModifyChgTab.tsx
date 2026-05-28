// ModifyChgTab.tsx — Modify existing ServiceNow Changes using a 5-step wizard UI.
// Step 1: Fetch CHG by key
// Steps 2-4: Edit change details, planning, and environments
// Step 5: Review, add CTASKs via templates, and save

import { useState, useCallback } from 'react';

import { snowFetch } from '../../../services/snowApi.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';
import { SnowLookupField } from '../components/SnowLookupField.tsx';
import type {
  ChgBasicInfo,
  ChgPlanningAssessment,
  ChgPlanningContent,
  CtaskTemplate,
  SnowReference,
} from '../hooks/useCrgState.ts';
import { useCtaskTemplates } from '../hooks/useCtaskTemplates.ts';
import type { SnowChoiceOptionMap } from '../hooks/useSnowChoiceOptions.ts';
import { useSnowChoiceOptions } from '../hooks/useSnowChoiceOptions.ts';

import styles from './CreateChgTab.module.css';

const TAB_TITLE = 'Modify Change';
const TAB_SUBTITLE = 'Fetch an existing ServiceNow CHG, edit all fields with full CTASK template support, save changes.';
const CHANGE_TABLE_PATH = '/api/now/table/change_request';
const MY_ACTIVE_CHANGE_QUERY = 'assigned_to=javascript:gs.getUserID()^active=true';
const MY_ACTIVE_CHANGE_FIELDS = 'number,short_description';
const MY_ACTIVE_CHANGE_LIMIT = 100;
const MODIFY_CHG_LOG_PREFIX = '[CRG Modify CHG]';
const EMPTY_SNOW_REFERENCE: SnowReference = { sysId: '', displayName: '' };
const SNOW_DATE_TIME_INPUT_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?/;

type EnvironmentKey = 'rel' | 'prd' | 'pfix';

interface EnvironmentConfig {
  isEnabled: boolean;
  plannedStartDate: string;
  plannedEndDate: string;
  configItem: SnowReference;
  impactedPersonsAware: string;
}

const PLANNING_ASSESSMENT_ROWS = [
  { label: 'Impact', fieldKey: 'impact', snowFieldName: 'impact' },
  { label: 'System Availability Implication', fieldKey: 'systemAvailabilityImplication', snowFieldName: 'u_availability_impact' },
  { label: 'Has Been Tested', fieldKey: 'hasBeenTested', snowFieldName: 'u_change_tested' },
  { label: 'Has Been Performed Previously', fieldKey: 'hasBeenPerformedPreviously', snowFieldName: 'u_performed_previously' },
  { label: 'Success Probability', fieldKey: 'successProbability', snowFieldName: 'u_success_probability' },
  { label: 'Can Be Backed Out', fieldKey: 'canBeBackedOut', snowFieldName: 'u_can_be_backed_out' },
] as const;
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
const ENVIRONMENT_ROW_DEFINITIONS = [
  { key: 'rel', label: 'REL', stateKey: 'relEnvironment' },
  { key: 'prd', label: 'PRD', stateKey: 'prdEnvironment' },
  { key: 'pfix', label: 'PFIX', stateKey: 'pfixEnvironment' },
] as const;
const CHANGE_LOOKUP_FIELDS = Array.from(new Set([
  'sys_id',
  'number',
  'short_description',
  'description',
  'justification',
  'risk_impact_analysis',
  'category',
  'type',
  'requested_by',
  'assignment_group',
  'u_environment',
  'cmdb_ci',
  'start_date',
  'end_date',
  ...Object.values(PLANNING_ASSESSMENT_ALIAS_FIELD_NAMES_BY_STATE_KEY).flat(),
  ...Object.values(PLANNING_CONTENT_ALIAS_FIELD_NAMES_BY_STATE_KEY).flat(),
])).join(',');

const STEP_DEFINITIONS = [
  { step: 1, label: 'Fetch Change' },
  { step: 2, label: 'Change Details' },
  { step: 3, label: 'Planning' },
  { step: 4, label: 'Environments' },
  { step: 5, label: 'Review & Save' },
] as const;

interface MyOpenChange {
  key: string;
  summary: string;
}

type ServiceNowFieldValue = string | number | boolean | { value?: unknown; display_value?: unknown };
type ServiceNowChangeRecord = Record<string, ServiceNowFieldValue | undefined>;

interface EditableChange {
  sysId: string;
  number: string;
  shortDescription: string;
  description: string;
  justification: string;
  riskImpactAnalysis: string;
  chgBasicInfo: ChgBasicInfo;
  chgPlanningAssessment: ChgPlanningAssessment;
  chgPlanningContent: ChgPlanningContent;
  relEnvironment: EnvironmentConfig;
  prdEnvironment: EnvironmentConfig;
  pfixEnvironment: EnvironmentConfig;
}

interface ModifyChgState {
  currentStep: 1 | 2 | 3 | 4 | 5;
  changeKey: string;
  isFetching: boolean;
  fetchError: string | null;
  change: EditableChange | null;
  changeTasks: CtaskTemplate[];
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: string | null;
  myOpenChanges: MyOpenChange[];
  isLoadingMyChanges: boolean;
  myChangesError: string | null;
}

interface ServiceNowChangeQueryResponse {
  result: ServiceNowChangeRecord[];
}

function createEmptyChgBasicInfo(): ChgBasicInfo {
  return {
    category: '',
    changeType: '',
    environment: '',
    requestedBy: { ...EMPTY_SNOW_REFERENCE },
    configItem: { ...EMPTY_SNOW_REFERENCE },
    assignmentGroup: { ...EMPTY_SNOW_REFERENCE },
    assignedTo: { ...EMPTY_SNOW_REFERENCE },
    changeManager: { ...EMPTY_SNOW_REFERENCE },
    tester: { ...EMPTY_SNOW_REFERENCE },
    serviceManager: { ...EMPTY_SNOW_REFERENCE },
    isExpedited: false,
  };
}

function createEmptyChgPlanningAssessment(): ChgPlanningAssessment {
  return {
    impact: '',
    systemAvailabilityImplication: '',
    hasBeenTested: '',
    impactedPersonsAware: '',
    hasBeenPerformedPreviously: '',
    successProbability: '',
    canBeBackedOut: '',
  };
}

function createEmptyChgPlanningContent(): ChgPlanningContent {
  return {
    implementationPlan: '',
    backoutPlan: '',
    testPlan: '',
  };
}

function createEmptyEnvironmentConfig(): EnvironmentConfig {
  return {
    isEnabled: false,
    plannedStartDate: '',
    plannedEndDate: '',
    configItem: { ...EMPTY_SNOW_REFERENCE },
    impactedPersonsAware: '',
  };
}

function extractServiceNowTextValue(fieldValue: ServiceNowFieldValue | undefined): string {
  if (fieldValue === undefined) {
    return '';
  }

  if (typeof fieldValue === 'object') {
    return normalizeRichTextToPlainText(fieldValue.display_value ?? fieldValue.value ?? '');
  }

  return normalizeRichTextToPlainText(String(fieldValue));
}

function extractServiceNowChoiceValue(fieldValue: ServiceNowFieldValue | undefined): string {
  if (fieldValue === undefined) {
    return '';
  }

  if (typeof fieldValue === 'object') {
    const storedValue = normalizeRichTextToPlainText(fieldValue.value ?? '');
    if (storedValue !== '') {
      return storedValue;
    }
    return normalizeRichTextToPlainText(fieldValue.display_value ?? '');
  }

  return normalizeRichTextToPlainText(String(fieldValue));
}

function extractServiceNowReference(fieldValue: ServiceNowFieldValue | undefined): SnowReference {
  if (fieldValue === undefined) {
    return { ...EMPTY_SNOW_REFERENCE };
  }

  if (typeof fieldValue !== 'object') {
    const displayName = normalizeRichTextToPlainText(String(fieldValue));
    return displayName ? { sysId: '', displayName } : { ...EMPTY_SNOW_REFERENCE };
  }

  return {
    sysId: fieldValue.value === undefined ? '' : String(fieldValue.value),
    displayName: normalizeRichTextToPlainText(fieldValue.display_value ?? fieldValue.value ?? ''),
  };
}

function extractServiceNowTextValueFromAliases(
  changeRecord: ServiceNowChangeRecord,
  fieldNames: readonly string[],
): string {
  for (const fieldName of fieldNames) {
    const extractedValue = extractServiceNowTextValue(changeRecord[fieldName]);
    if (extractedValue !== '') {
      return extractedValue;
    }
  }
  return '';
}

function extractServiceNowChoiceValueFromAliases(
  changeRecord: ServiceNowChangeRecord,
  fieldNames: readonly string[],
): string {
  for (const fieldName of fieldNames) {
    const extractedValue = extractServiceNowChoiceValue(changeRecord[fieldName]);
    if (extractedValue !== '') {
      return extractedValue;
    }
  }
  return '';
}

function normalizeSnowDateTimeForInput(fieldValue: ServiceNowFieldValue | undefined): string {
  const snowDateTime = extractServiceNowChoiceValue(fieldValue) || extractServiceNowTextValue(fieldValue);
  if (!snowDateTime) {
    return '';
  }

  const dateTimeMatch = SNOW_DATE_TIME_INPUT_PATTERN.exec(snowDateTime);
  return dateTimeMatch ? `${dateTimeMatch[1]}T${dateTimeMatch[2]}` : snowDateTime;
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

function getEnvironmentStateKey(environmentKey: EnvironmentKey): keyof Pick<EditableChange, 'relEnvironment' | 'prdEnvironment' | 'pfixEnvironment'> {
  return environmentKey === 'rel'
    ? 'relEnvironment'
    : environmentKey === 'prd'
      ? 'prdEnvironment'
      : 'pfixEnvironment';
}

function buildLoadedEnvironmentState(
  environmentValue: string,
  configItem: SnowReference,
  impactedPersonsAware: string,
  plannedStartDate: string,
  plannedEndDate: string,
): Pick<EditableChange, 'relEnvironment' | 'prdEnvironment' | 'pfixEnvironment'> {
  const nextEnvironmentState = {
    relEnvironment: createEmptyEnvironmentConfig(),
    prdEnvironment: createEmptyEnvironmentConfig(),
    pfixEnvironment: createEmptyEnvironmentConfig(),
  };
  const matchedEnvironmentKey = inferEnvironmentKeyFromValue(environmentValue);

  if (!matchedEnvironmentKey) {
    return nextEnvironmentState;
  }

  nextEnvironmentState[getEnvironmentStateKey(matchedEnvironmentKey)] = {
    isEnabled: true,
    plannedStartDate,
    plannedEndDate,
    configItem,
    impactedPersonsAware,
  };
  return nextEnvironmentState;
}

function hasSelectableChoiceOptions(options: { value: string; label: string }[]): boolean {
  return options.some((option) => option.value !== '');
}

function buildRenderedChoiceOptions(
  options: { value: string; label: string }[],
  currentValue: string,
): { value: string; label: string }[] {
  const hasCurrentValue = currentValue !== '' && options.every((option) => option.value !== currentValue);
  return hasCurrentValue
    ? [{ value: currentValue, label: currentValue }, ...options.filter((option) => option.value !== '')]
    : options;
}

function resolveStoredChoiceValue(currentValue: string, options: { value: string; label: string }[]): string {
  if (!currentValue) {
    return currentValue;
  }

  const valueMatch = options.find((option) => option.value === currentValue);
  if (valueMatch) {
    return currentValue;
  }

  const labelMatch = options.find((option) => option.label === currentValue);
  return labelMatch?.value ?? currentValue;
}

function shouldRenderManualChoiceInput({
  options,
  isLoadingChoices,
}: {
  options: { value: string; label: string }[];
  isLoadingChoices: boolean;
}): boolean {
  if (isLoadingChoices) {
    return false;
  }

  return !hasSelectableChoiceOptions(options);
}

function resolveSuggestedEnvironmentValue(
  options: { value: string; label: string }[],
  selectedEnvironmentKey: EnvironmentKey,
): string {
  const matchingChoice = options.find((option) => {
    const normalizedChoiceText = `${option.value} ${option.label}`.toLowerCase();
    const isFixOption = normalizedChoiceText.includes('fix') || normalizedChoiceText.includes('pfix');
    const isProductionOption = normalizedChoiceText.includes('prd') || normalizedChoiceText.includes('prod');

    if (selectedEnvironmentKey === 'pfix') {
      return normalizedChoiceText.includes('pfix') || (isProductionOption && isFixOption);
    }
    if (selectedEnvironmentKey === 'prd') {
      return isProductionOption && !isFixOption;
    }
    return normalizedChoiceText.includes('rel') || normalizedChoiceText.includes('release');
  });

  return matchingChoice?.value ?? '';
}

function isRecord(candidateValue: unknown): candidateValue is Record<string, unknown> {
  return typeof candidateValue === 'object' && candidateValue !== null;
}

function buildChangeLookupPath(changeKey: string): string {
  const encodedQuery = encodeURIComponent(`number=${changeKey}`);
  return (
    `${CHANGE_TABLE_PATH}?sysparm_query=${encodedQuery}` +
    '&sysparm_limit=1' +
    `&sysparm_fields=${CHANGE_LOOKUP_FIELDS}` +
    '&sysparm_display_value=all'
  );
}

function buildMyActiveChangesPath(): string {
  const encodedQuery = encodeURIComponent(MY_ACTIVE_CHANGE_QUERY);
  return (
    `${CHANGE_TABLE_PATH}?sysparm_query=${encodedQuery}` +
    `&sysparm_limit=${MY_ACTIVE_CHANGE_LIMIT}` +
    `&sysparm_fields=${MY_ACTIVE_CHANGE_FIELDS}` +
    '&sysparm_display_value=all'
  );
}

function mapServiceNowChangeRecord(changeRecord: ServiceNowChangeRecord): EditableChange {
  const loadedEnvironmentValue = extractServiceNowChoiceValue(changeRecord.u_environment);
  const loadedConfigItem = extractServiceNowReference(changeRecord.cmdb_ci);
  const loadedImpactedPersonsAware = extractServiceNowChoiceValueFromAliases(
    changeRecord,
    PLANNING_ASSESSMENT_ALIAS_FIELD_NAMES_BY_STATE_KEY.impactedPersonsAware,
  );
  // SNow change_request table stores schedule dates as start_date and end_date (not planned_*)
  const loadedPlannedStartDate = normalizeSnowDateTimeForInput(changeRecord.start_date);
  const loadedPlannedEndDate = normalizeSnowDateTimeForInput(changeRecord.end_date);

  return {
    sysId: extractServiceNowTextValue(changeRecord.sys_id),
    number: extractServiceNowTextValue(changeRecord.number),
    shortDescription: extractServiceNowTextValue(changeRecord.short_description),
    description: extractServiceNowTextValue(changeRecord.description),
    justification: extractServiceNowTextValue(changeRecord.justification),
    riskImpactAnalysis: extractServiceNowTextValue(changeRecord.risk_impact_analysis),
    chgBasicInfo: {
      ...createEmptyChgBasicInfo(),
      category: extractServiceNowChoiceValue(changeRecord.category),
      changeType: extractServiceNowChoiceValue(changeRecord.type),
      environment: loadedEnvironmentValue,
      requestedBy: extractServiceNowReference(changeRecord.requested_by),
      configItem: loadedConfigItem,
      assignmentGroup: extractServiceNowReference(changeRecord.assignment_group),
    },
    chgPlanningAssessment: {
      ...createEmptyChgPlanningAssessment(),
      impact: extractServiceNowChoiceValueFromAliases(
        changeRecord,
        PLANNING_ASSESSMENT_ALIAS_FIELD_NAMES_BY_STATE_KEY.impact,
      ),
      systemAvailabilityImplication: extractServiceNowChoiceValueFromAliases(
        changeRecord,
        PLANNING_ASSESSMENT_ALIAS_FIELD_NAMES_BY_STATE_KEY.systemAvailabilityImplication,
      ),
      hasBeenTested: extractServiceNowChoiceValueFromAliases(
        changeRecord,
        PLANNING_ASSESSMENT_ALIAS_FIELD_NAMES_BY_STATE_KEY.hasBeenTested,
      ),
      impactedPersonsAware: loadedImpactedPersonsAware,
      hasBeenPerformedPreviously: extractServiceNowChoiceValueFromAliases(
        changeRecord,
        PLANNING_ASSESSMENT_ALIAS_FIELD_NAMES_BY_STATE_KEY.hasBeenPerformedPreviously,
      ),
      successProbability: extractServiceNowChoiceValueFromAliases(
        changeRecord,
        PLANNING_ASSESSMENT_ALIAS_FIELD_NAMES_BY_STATE_KEY.successProbability,
      ),
      canBeBackedOut: extractServiceNowChoiceValueFromAliases(
        changeRecord,
        PLANNING_ASSESSMENT_ALIAS_FIELD_NAMES_BY_STATE_KEY.canBeBackedOut,
      ),
    },
    chgPlanningContent: {
      ...createEmptyChgPlanningContent(),
      implementationPlan: extractServiceNowTextValueFromAliases(
        changeRecord,
        PLANNING_CONTENT_ALIAS_FIELD_NAMES_BY_STATE_KEY.implementationPlan,
      ),
      backoutPlan: extractServiceNowTextValueFromAliases(
        changeRecord,
        PLANNING_CONTENT_ALIAS_FIELD_NAMES_BY_STATE_KEY.backoutPlan,
      ),
      testPlan: extractServiceNowTextValueFromAliases(
        changeRecord,
        PLANNING_CONTENT_ALIAS_FIELD_NAMES_BY_STATE_KEY.testPlan,
      ),
    },
    ...buildLoadedEnvironmentState(
      loadedEnvironmentValue,
      loadedConfigItem,
      loadedImpactedPersonsAware,
      loadedPlannedStartDate,
      loadedPlannedEndDate,
    ),
  };
}

/**
 * Fetches a CHG from ServiceNow relay by change key.
 * Logs diagnostics to browser console for debugging.
 */
async function fetchChangeFromSnow(changeKey: string): Promise<EditableChange> {
  const normalizedChangeKey = changeKey.trim().toUpperCase();
  const path = buildChangeLookupPath(normalizedChangeKey);
  console.log(`${MODIFY_CHG_LOG_PREFIX} Fetching change from ServiceNow`, { changeKey: normalizedChangeKey, path });

  try {
    const response = await snowFetch<ServiceNowChangeQueryResponse>(path);
    const matchedChangeRecord = response.result?.[0];

    if (!matchedChangeRecord) {
      throw new Error(`${normalizedChangeKey} was not found in ServiceNow.`);
    }

    console.log(`${MODIFY_CHG_LOG_PREFIX} Successfully fetched change`, {
      changeKey: normalizedChangeKey,
      fieldCount: Object.keys(matchedChangeRecord).length,
    });
    return mapServiceNowChangeRecord(matchedChangeRecord);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`${MODIFY_CHG_LOG_PREFIX} Failed to fetch change`, {
      changeKey: normalizedChangeKey,
      path,
      error: errorMessage,
      cause: error,
    });
    throw error instanceof Error ? error : new Error(errorMessage);
  }
}

/**
 * Saves a modified CHG back to ServiceNow.
 * Logs diagnostics to browser console for debugging.
 */
async function saveChangeToSnow(changeKey: string, changeData: EditableChange): Promise<void> {
  const apiUrl = `/api/snow-relay/change/${encodeURIComponent(changeKey.toUpperCase())}`;
  console.log(`${MODIFY_CHG_LOG_PREFIX} Saving change to ServiceNow`, { changeKey, apiUrl });

  try {
    const response = await fetch(apiUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changeData),
    });

    if (!response.ok) {
      let errorBody = '(unable to read response body)';
      try {
        if (response.text && typeof response.text === 'function') {
          errorBody = await response.text();
        }
      } catch {
        // Preserve the main response error even when the body cannot be read.
      }

      console.error(`${MODIFY_CHG_LOG_PREFIX} API error saving change`, {
        status: response.status,
        statusText: response.statusText,
        changeKey,
        responseBody: errorBody.substring ? errorBody.substring(0, 200) : String(errorBody),
      });
      throw new Error(`Failed to save change: ${response.statusText} (${response.status})`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to save change';
    console.error(`${MODIFY_CHG_LOG_PREFIX} Save request failed`, {
      changeKey,
      apiUrl,
      error: errorMessage,
      cause: error,
    });
    throw error instanceof Error ? error : new Error(errorMessage);
  }

  console.log(`${MODIFY_CHG_LOG_PREFIX} Successfully saved change`, { changeKey });
}

/**
 * Fetches user's open changes from ServiceNow using the relay bridge.
 * Returns array of changes with key and summary.
 * Reuses the same proven snowFetch pattern as the PRB loader.
 */
async function fetchMyOpenChanges(): Promise<MyOpenChange[]> {
  const path = buildMyActiveChangesPath();
  console.log(`${MODIFY_CHG_LOG_PREFIX} Loading my active changes`, {
    path,
    filter: MY_ACTIVE_CHANGE_QUERY,
  });

  try {
    const response = await snowFetch<ServiceNowChangeQueryResponse>(path);
    const changes = (response.result || [])
      .map((changeRecord) => ({
        key: extractServiceNowTextValue(changeRecord.number),
        summary: extractServiceNowTextValue(changeRecord.short_description),
      }))
      .filter((change) => change.key && change.summary);

    console.log(`${MODIFY_CHG_LOG_PREFIX} Successfully loaded my active changes`, { count: changes.length });
    return changes;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to load my changes';
    console.error(`${MODIFY_CHG_LOG_PREFIX} Failed to load my active changes`, {
      error: errorMessage,
      path,
      cause: error,
    });
    throw error instanceof Error ? error : new Error(errorMessage);
  }
}

/**
 * Validates that all required fields are present before saving.
 * Returns error message if validation fails, null if valid.
 */
function validateChangeBeforeSave(state: ModifyChgState): string | null {
  if (!state.change) {
    return 'Change data not loaded';
  }

  // Check required change fields
  const requiredChangeFields = {
    shortDescription: 'Summary is required',
    'chgBasicInfo.assignmentGroup': 'Assignment Group is required',
  };

  if (!state.change.shortDescription?.trim()) {
    return requiredChangeFields.shortDescription;
  }

  if (!state.change.chgBasicInfo?.assignmentGroup) {
    return requiredChangeFields['chgBasicInfo.assignmentGroup'];
  }

  // Check CTASKs are valid if present
  if (state.changeTasks && state.changeTasks.length > 0) {
    for (let i = 0; i < state.changeTasks.length; i += 1) {
      const ctask = state.changeTasks[i];
      if (!ctask.shortDescription?.trim()) {
        return `CTASK ${i + 1}: Short Description is required`;
      }
    }
  }

  return null;
}


function StepIndicator({ currentStep, onStepSelect }: { currentStep: number; onStepSelect: (step: 1 | 2 | 3 | 4 | 5) => void }) {
  return (
    <ol className={styles.stepIndicator}>
      {STEP_DEFINITIONS.map((stepDefinition) => {
        const isActiveStep = stepDefinition.step === currentStep;
        const stepClassName = isActiveStep ? `${styles.stepBadge} ${styles.activeStep}` : styles.stepBadge;
        const isStepAccessible = stepDefinition.step === 1 || currentStep > 1;

        return (
          <li key={stepDefinition.step}>
            <button
              aria-current={isActiveStep ? 'step' : undefined}
              className={stepClassName}
              disabled={!isStepAccessible}
              onClick={() => isStepAccessible && onStepSelect(stepDefinition.step as 1 | 2 | 3 | 4 | 5)}
              type="button"
            >
              {stepDefinition.step}. {stepDefinition.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function StepHeading({ currentStep }: { currentStep: number }) {
  const activeStepDefinition = STEP_DEFINITIONS.find((stepDefinition) => stepDefinition.step === currentStep);
  return (
    <div className={styles.stepHeading}>
      <p className={styles.stepMeta}>Step {currentStep} of {STEP_DEFINITIONS.length}</p>
      <h3 className={styles.sectionTitle}>{activeStepDefinition?.label}</h3>
    </div>
  );
}

/**
 * Step 1: Fetch Change — User enters CHG key and fetches from ServiceNow
 */
function FetchChangeStep({ state, onChangeKeyChange, onFetchClick, onLoadMyChangesClick, onMyChangeSelect }: {
  state: ModifyChgState;
  onChangeKeyChange: (key: string) => void;
  onFetchClick: () => void;
  onLoadMyChangesClick: () => void;
  onMyChangeSelect: (key: string) => Promise<void> | void;
}) {
  return (
    <section className={styles.section}>
      <StepHeading currentStep={1} />
      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel}>CHG Number</label>
        <div className={styles.cloneInputRow}>
          <input
            aria-label="Change Request number"
            className={styles.input}
            disabled={state.isFetching}
            onChange={(event) => onChangeKeyChange(event.target.value.toUpperCase())}
            placeholder="e.g. CHG0001234"
            value={state.changeKey}
          />
          <button
            className={styles.primaryButton}
            disabled={state.isFetching || !state.changeKey.trim()}
            onClick={onFetchClick}
            type="button"
          >
            {state.isFetching ? 'Fetching…' : 'Fetch Change'}
          </button>
        </div>
      </div>
      {state.fetchError && <p className={styles.errorText} role="alert">{state.fetchError}</p>}

      {/* My Open Changes section */}
      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel}>📋 Load My Changes</label>
        <div className={styles.cloneInputRow}>
          <button
            className={styles.secondaryButton}
            disabled={state.isLoadingMyChanges}
            onClick={onLoadMyChangesClick}
            type="button"
          >
            {state.isLoadingMyChanges ? 'Loading…' : 'Load My Open Changes'}
          </button>
        </div>
        {state.myChangesError && <p className={styles.errorText} role="alert">{state.myChangesError}</p>}

        {state.myOpenChanges.length > 0 && (
          <select
            aria-label="Select from my open changes"
            className={styles.select}
            disabled={state.isFetching}
            onChange={(event) => {
              if (event.target.value) {
                void onMyChangeSelect(event.target.value);
              }
            }}
            value=""
          >
            <option value="">Select a change…</option>
            {state.myOpenChanges.map((change) => (
              <option key={change.key} value={change.key}>
                {change.key} - {change.summary}
              </option>
            ))}
          </select>
        )}

        {state.isLoadingMyChanges === false && state.myOpenChanges.length === 0 && !state.myChangesError && (
          <p className={styles.loadingText}>No open changes found.</p>
        )}
      </div>
    </section>
  );
}

/**
 * Step 2: Change Details — Edit summary, description, justification, risk/impact
 */
function ChangeDetailsStep({ state, onFieldChange }: {
  state: ModifyChgState;
  onFieldChange: (field: string, value: string) => void;
}) {
  if (!state.change) return null;

  return (
    <section className={styles.section}>
      <StepHeading currentStep={2} />
      <div className={styles.editorGrid}>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Short Description</span>
          <input
            className={styles.input}
            onChange={(event) => onFieldChange('shortDescription', event.target.value)}
            value={state.change.shortDescription}
          />
        </label>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Description</span>
          <textarea
            className={styles.textArea}
            onChange={(event) => onFieldChange('description', event.target.value)}
            value={state.change.description}
          />
        </label>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Justification</span>
          <textarea
            className={styles.textArea}
            onChange={(event) => onFieldChange('justification', event.target.value)}
            value={state.change.justification}
          />
        </label>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Risk & Impact Analysis</span>
          <textarea
            className={styles.textArea}
            onChange={(event) => onFieldChange('riskImpactAnalysis', event.target.value)}
            value={state.change.riskImpactAnalysis}
          />
        </label>
      </div>
    </section>
  );
}

/**
 * Step 3: Planning Assessment — Edit planning fields
 */
function PlanningStep({ state, onFieldChange, choiceOptions, isLoadingChoices }: {
  state: ModifyChgState;
  onFieldChange: (field: string, value: string) => void;
  choiceOptions: SnowChoiceOptionMap;
  isLoadingChoices: boolean;
}) {
  if (!state.change) return null;

  const assessment = state.change.chgPlanningAssessment;
  const shouldUseManualPlanningInputs = PLANNING_ASSESSMENT_ROWS.some((row) => (
    shouldRenderManualChoiceInput({
      options: choiceOptions[row.snowFieldName] ?? [],
      isLoadingChoices,
    })
  ));

  return (
    <section className={styles.section}>
      <StepHeading currentStep={3} />
      <div className={styles.assessmentGrid}>
        {shouldUseManualPlanningInputs ? (
          <p className={styles.panelHint}>
            Live planning choices are unavailable. Type the internal ServiceNow values for this change.
          </p>
        ) : null}
        {PLANNING_ASSESSMENT_ROWS.map((planningAssessmentRow) => {
          const rowOptions = choiceOptions[planningAssessmentRow.snowFieldName] ?? [];
          const currentAssessmentValue = assessment[planningAssessmentRow.fieldKey];
          const renderedRowOptions = buildRenderedChoiceOptions(rowOptions, currentAssessmentValue);
          const shouldUseManualInput = shouldRenderManualChoiceInput({
            options: rowOptions,
            isLoadingChoices,
          });

          return (
            <label className={styles.fieldGroup} key={planningAssessmentRow.fieldKey}>
              <span className={styles.fieldLabel}>{planningAssessmentRow.label}</span>
              {shouldUseManualInput ? (
                <input
                  aria-label={planningAssessmentRow.label}
                  className={styles.input}
                  onChange={(event) => onFieldChange(`chgPlanningAssessment.${planningAssessmentRow.fieldKey}`, event.target.value)}
                  value={currentAssessmentValue}
                />
              ) : (
                <select
                  aria-label={planningAssessmentRow.label}
                  className={styles.input}
                  disabled={isLoadingChoices}
                  onChange={(event) => onFieldChange(`chgPlanningAssessment.${planningAssessmentRow.fieldKey}`, event.target.value)}
                  value={resolveStoredChoiceValue(currentAssessmentValue, renderedRowOptions)}
                >
                  {isLoadingChoices ? (
                    <option disabled value="">Loading options…</option>
                  ) : (
                    renderedRowOptions.map((option) => (
                      <option key={`${planningAssessmentRow.fieldKey}-${option.value}-${option.label}`} value={option.value}>
                        {option.label || 'Select…'}
                      </option>
                    ))
                  )}
                </select>
              )}
            </label>
          );
        })}
      </div>
      <div className={styles.editorGrid}>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Implementation Plan</span>
          <textarea
            className={styles.textArea}
            onChange={(event) => onFieldChange('chgPlanningContent.implementationPlan', event.target.value)}
            value={state.change.chgPlanningContent.implementationPlan}
          />
        </label>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Backout Plan</span>
          <textarea
            className={styles.textArea}
            onChange={(event) => onFieldChange('chgPlanningContent.backoutPlan', event.target.value)}
            value={state.change.chgPlanningContent.backoutPlan}
          />
        </label>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Test Plan</span>
          <textarea
            className={styles.textArea}
            onChange={(event) => onFieldChange('chgPlanningContent.testPlan', event.target.value)}
            value={state.change.chgPlanningContent.testPlan}
          />
        </label>
      </div>
    </section>
  );
}

/**
 * Step 4: Environments — Edit environment-specific fields for the selected CHG.
 */
function EnvironmentsStep({ state, onFieldChange, onEnvironmentToggle, onEnvironmentConfigItemChange, choiceOptions, isLoadingChoices }: {
  state: ModifyChgState;
  onFieldChange: (field: string, value: string) => void;
  onEnvironmentToggle: (environmentKey: EnvironmentKey, isEnabled: boolean) => void;
  onEnvironmentConfigItemChange: (environmentKey: EnvironmentKey, configItem: SnowReference) => void;
  choiceOptions: SnowChoiceOptionMap;
  isLoadingChoices: boolean;
}) {
  if (!state.change) return null;

  const loadedChange = state.change;
  const environmentOptions = choiceOptions.u_environment ?? [];
  const impactedPersonsAwareOptions = choiceOptions.u_impacted_persons_aware ?? [];
  const shouldUseManualEnvironmentInput = shouldRenderManualChoiceInput({
    options: environmentOptions,
    isLoadingChoices,
  });
  const shouldUseManualImpactedPersonsAwareInput = shouldRenderManualChoiceInput({
    options: impactedPersonsAwareOptions,
    isLoadingChoices,
  });

  return (
    <section className={styles.section}>
      <StepHeading currentStep={4} />
      <p className={styles.panelHint}>Edit environment-specific details for REL, PRD, and PFIX.</p>
      <div className={styles.environmentMappingPanel}>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>ServiceNow Environment</span>
          {shouldUseManualEnvironmentInput ? (
            <input
              aria-label="ServiceNow Environment"
              className={styles.input}
              onChange={(event) => onFieldChange('chgBasicInfo.environment', event.target.value)}
              value={loadedChange.chgBasicInfo.environment}
            />
          ) : (
            <select
              aria-label="ServiceNow Environment"
              className={styles.input}
              disabled={isLoadingChoices}
              onChange={(event) => onFieldChange('chgBasicInfo.environment', event.target.value)}
              value={resolveStoredChoiceValue(
                loadedChange.chgBasicInfo.environment,
                buildRenderedChoiceOptions(environmentOptions, loadedChange.chgBasicInfo.environment),
              )}
            >
              {isLoadingChoices ? (
                <option disabled value="">Loading options…</option>
              ) : (
                buildRenderedChoiceOptions(environmentOptions, loadedChange.chgBasicInfo.environment).map((option) => (
                  <option key={`environment-${option.value}-${option.label}`} value={option.value}>{option.label || 'Select…'}</option>
                ))
              )}
            </select>
          )}
        </label>
      </div>
      <div className={styles.environmentCardGrid}>
        {ENVIRONMENT_ROW_DEFINITIONS.map((environmentRow) => {
          const environmentState = loadedChange[environmentRow.stateKey];

          return (
            <section className={styles.environmentCard} key={environmentRow.key}>
              <div className={styles.environmentCardHeader}>
                <h4 className={styles.panelSectionTitle}>{environmentRow.label}</h4>
                <label className={styles.inlineCheckbox}>
                  <input
                    aria-label={`${environmentRow.label} enabled`}
                    checked={environmentState.isEnabled}
                    disabled={isLoadingChoices}
                    onChange={(event) => onEnvironmentToggle(environmentRow.key, event.target.checked)}
                    type="checkbox"
                  />
                  <span>Enabled</span>
                </label>
              </div>

              <SnowLookupField
                label={`${environmentRow.label} Config Item`}
                tableName="cmdb_ci"
                value={environmentState.configItem}
                onChange={(configItem) => onEnvironmentConfigItemChange(environmentRow.key, configItem)}
                isDisabled={!environmentState.isEnabled}
              />

              <label className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>{environmentRow.label} Impacted Persons Aware</span>
                {shouldUseManualImpactedPersonsAwareInput ? (
                  <input
                    aria-label={`${environmentRow.label} Impacted Persons Aware`}
                    className={styles.input}
                    disabled={!environmentState.isEnabled}
                    onChange={(event) => onFieldChange(`${environmentRow.stateKey}.impactedPersonsAware`, event.target.value)}
                    value={environmentState.impactedPersonsAware}
                  />
                ) : (
                  <select
                    aria-label={`${environmentRow.label} Impacted Persons Aware`}
                    className={styles.input}
                    disabled={!environmentState.isEnabled || isLoadingChoices}
                    onChange={(event) => onFieldChange(`${environmentRow.stateKey}.impactedPersonsAware`, event.target.value)}
                    value={resolveStoredChoiceValue(
                      environmentState.impactedPersonsAware,
                      buildRenderedChoiceOptions(impactedPersonsAwareOptions, environmentState.impactedPersonsAware),
                    )}
                  >
                    {isLoadingChoices ? (
                      <option disabled value="">Loading options…</option>
                    ) : (
                      buildRenderedChoiceOptions(impactedPersonsAwareOptions, environmentState.impactedPersonsAware).map((option) => (
                        <option key={`${environmentRow.key}-${option.value}-${option.label}`} value={option.value}>{option.label || 'Select…'}</option>
                      ))
                    )}
                  </select>
                )}
              </label>

              <div className={styles.fieldGrid}>
                <label className={styles.fieldGroup}>
                  <span className={styles.fieldLabel}>Planned Start</span>
                  <input
                    aria-label={`${environmentRow.label} Planned Start`}
                    className={styles.input}
                    disabled={!environmentState.isEnabled}
                    onChange={(event) => onFieldChange(`${environmentRow.stateKey}.plannedStartDate`, event.target.value)}
                    type="datetime-local"
                    value={environmentState.plannedStartDate}
                  />
                </label>
                <label className={styles.fieldGroup}>
                  <span className={styles.fieldLabel}>Planned End</span>
                  <input
                    aria-label={`${environmentRow.label} Planned End`}
                    className={styles.input}
                    disabled={!environmentState.isEnabled}
                    onChange={(event) => onFieldChange(`${environmentRow.stateKey}.plannedEndDate`, event.target.value)}
                    type="datetime-local"
                    value={environmentState.plannedEndDate}
                  />
                </label>
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Step 5: Review & Save — Show summary and CTASK template picker
 */
function ReviewSaveStep({ state, ctaskTemplates, onAddCtask, onRemoveCtask, onSaveClick, onCtaskFieldChange }: {
  state: ModifyChgState;
  ctaskTemplates: CtaskTemplate[];
  onAddCtask: (template: CtaskTemplate) => void;
  onRemoveCtask: (id: string) => void;
  onSaveClick: () => void;
  onCtaskFieldChange: (ctaskId: string, field: string, value: string) => void;
}) {
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [editingCtaskId, setEditingCtaskId] = useState<string | null>(null);
  const selectedTemplate = ctaskTemplates.find((t) => t.id === selectedTemplateId);

  if (!state.change) return null;

  return (
    <section className={styles.section}>
      <StepHeading currentStep={5} />
      
      <div className={styles.clonePanel}>
        <h4 className={styles.panelSectionTitle}>Add Change Tasks (CTASKs)</h4>
        <p className={styles.panelHint}>Add reusable CTASK templates to this change.</p>
        {ctaskTemplates.length > 0 ? (
          <div className={styles.cloneInputRow}>
            <select
              aria-label="Select CTASK template"
              className={styles.input}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
              value={selectedTemplateId}
            >
              <option value="">Select a CTASK template…</option>
              {ctaskTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
            <button
              className={styles.secondaryButton}
              disabled={!selectedTemplate}
              onClick={() => {
                if (selectedTemplate) {
                  onAddCtask(selectedTemplate);
                }
                setSelectedTemplateId('');
              }}
              type="button"
            >
              Add CTASK
            </button>
          </div>
        ) : (
          <p className={styles.panelHint}>No CTASK templates saved yet. Create one in Configuration mode.</p>
        )}
      </div>

      {state.changeTasks.length > 0 && (
        <div className={styles.clonePanel}>
          <h4 className={styles.panelSectionTitle}>Change Tasks ({state.changeTasks.length})</h4>
          <div>
            {state.changeTasks.map((ctask) => (
              <div key={ctask.id} className={styles.environmentCard}>
                <div className={styles.environmentCardHeader}>
                  <h5 className={styles.panelSectionTitle}>{ctask.name}</h5>
                  <div>
                    <button
                      className={styles.linkButton}
                      onClick={() => setEditingCtaskId(editingCtaskId === ctask.id ? null : ctask.id)}
                      type="button"
                      title={editingCtaskId === ctask.id ? 'Collapse' : 'Edit'}
                    >
                      {editingCtaskId === ctask.id ? '▼ Collapse' : '▶ Edit'}
                    </button>
                    <button
                      className={styles.linkButton}
                      onClick={() => onRemoveCtask(ctask.id)}
                      type="button"
                      aria-label={`Remove CTASK ${ctask.shortDescription || ctask.name}`}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {editingCtaskId === ctask.id ? (
                  <div className={styles.fieldGrid}>
                    <label className={styles.fieldGroup}>
                      <span className={styles.fieldLabel}>Short Description</span>
                      <input
                        className={styles.input}
                        onChange={(event) => onCtaskFieldChange(ctask.id, 'shortDescription', event.target.value)}
                        value={ctask.shortDescription || ''}
                      />
                    </label>
                    <label className={styles.fieldGroup}>
                      <span className={styles.fieldLabel}>Description</span>
                      <textarea
                        className={styles.textArea}
                        onChange={(event) => onCtaskFieldChange(ctask.id, 'description', event.target.value)}
                        value={ctask.description || ''}
                        rows={3}
                      />
                    </label>
                    <label className={styles.fieldGroup}>
                      <span className={styles.fieldLabel}>Assignment Group</span>
                      <input
                        className={styles.input}
                        onChange={(event) => onCtaskFieldChange(ctask.id, 'assignmentGroup', event.target.value)}
                        value={typeof ctask.assignmentGroup === 'string' ? ctask.assignmentGroup : (ctask.assignmentGroup?.displayName || '')}
                      />
                    </label>
                    <label className={styles.fieldGroup}>
                      <span className={styles.fieldLabel}>Assigned To</span>
                      <input
                        className={styles.input}
                        onChange={(event) => onCtaskFieldChange(ctask.id, 'assignedTo', event.target.value)}
                        value={typeof ctask.assignedTo === 'string' ? ctask.assignedTo : (ctask.assignedTo?.displayName || '')}
                      />
                    </label>
                    <label className={styles.fieldGroup}>
                      <span className={styles.fieldLabel}>Planned Start Date</span>
                      <input
                        className={styles.input}
                        type="date"
                        onChange={(event) => onCtaskFieldChange(ctask.id, 'plannedStartDate', event.target.value)}
                        value={ctask.plannedStartDate || ''}
                      />
                    </label>
                    <label className={styles.fieldGroup}>
                      <span className={styles.fieldLabel}>Planned End Date</span>
                      <input
                        className={styles.input}
                        type="date"
                        onChange={(event) => onCtaskFieldChange(ctask.id, 'plannedEndDate', event.target.value)}
                        value={ctask.plannedEndDate || ''}
                      />
                    </label>
                  </div>
                ) : (
                  <div className={styles.summaryText}>
                    <p><strong>Short Description:</strong> {ctask.shortDescription || '(none)'}</p>
                    {ctask.description && <p><strong>Description:</strong> {ctask.description}</p>}
                    {ctask.assignmentGroup && <p><strong>Assignment Group:</strong> {typeof ctask.assignmentGroup === 'string' ? ctask.assignmentGroup : ctask.assignmentGroup.displayName}</p>}
                    {ctask.assignedTo && <p><strong>Assigned To:</strong> {typeof ctask.assignedTo === 'string' ? ctask.assignedTo : ctask.assignedTo.displayName}</p>}
                    {ctask.plannedStartDate && <p><strong>Planned Start:</strong> {ctask.plannedStartDate}</p>}
                    {ctask.plannedEndDate && <p><strong>Planned End:</strong> {ctask.plannedEndDate}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.buttonRow}>
        <button
          className={styles.primaryButton}
          disabled={state.isSaving}
          onClick={onSaveClick}
          type="button"
        >
          {state.isSaving ? 'Saving…' : 'Save Changes to ServiceNow'}
        </button>
      </div>

      {state.saveError && <p className={styles.errorText} role="alert">{state.saveError}</p>}
      {state.saveSuccess && <p className={styles.successText} role="status">{state.saveSuccess}</p>}
    </section>
  );
}

/**
 * ModifyChgTab — Modify existing ServiceNow Changes using a 5-step wizard.
 */
export default function ModifyChgTab(): React.ReactElement {
  const ctaskTemplates = useCtaskTemplates();
  const { choiceOptions, isLoadingChoices } = useSnowChoiceOptions();

  const [modifyState, setModifyState] = useState<ModifyChgState>({
    currentStep: 1,
    changeKey: '',
    isFetching: false,
    fetchError: null,
    change: null,
    changeTasks: [],
    isSaving: false,
    saveError: null,
    saveSuccess: null,
    myOpenChanges: [],
    isLoadingMyChanges: false,
    myChangesError: null,
  });

  const handleChangeKeyChange = useCallback((key: string) => {
    setModifyState((prev) => ({ ...prev, changeKey: key, fetchError: null }));
  }, []);

  const handleFetchChange = useCallback(async () => {
    setModifyState((prev) => ({ ...prev, isFetching: true, fetchError: null }));
    try {
      const data = await fetchChangeFromSnow(modifyState.changeKey);
      setModifyState((prev) => ({
        ...prev,
        isFetching: false,
        change: data,
        currentStep: 2,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`${MODIFY_CHG_LOG_PREFIX} Fetch Change action failed`, {
        changeKey: modifyState.changeKey.trim().toUpperCase(),
        error: errorMessage,
        cause: error,
      });
      setModifyState((prev) => ({ ...prev, isFetching: false, fetchError: errorMessage }));
    }
  }, [modifyState.changeKey]);

  const handleFieldChange = useCallback((field: string, value: string | SnowReference) => {
    setModifyState((prev) => {
      if (!prev.change) return prev;

      const updateNestedField = <T extends object>(
        currentValue: T,
        path: string,
        nextValue: string | SnowReference,
      ): T => {
        const currentRecord = currentValue as Record<string, unknown>;
        const keys = path.split('.');
        if (keys.length === 1) {
          return { ...currentRecord, [path]: nextValue } as T;
        }
        const [firstKey, ...remainingKeys] = keys;
        const nestedValue = isRecord(currentRecord[firstKey]) ? currentRecord[firstKey] : {};
        return {
          ...currentRecord,
          [firstKey]: updateNestedField(nestedValue, remainingKeys.join('.'), nextValue),
        } as T;
      };

      return {
        ...prev,
        change: updateNestedField(prev.change, field, value),
      };
    });
  }, []);

  const handleEnvironmentToggle = useCallback((environmentKey: EnvironmentKey, isEnabled: boolean) => {
    setModifyState((previousState) => {
      if (!previousState.change) {
        return previousState;
      }

      const nextEnvironmentState = {
        relEnvironment: { ...previousState.change.relEnvironment, isEnabled: environmentKey === 'rel' ? isEnabled : false },
        prdEnvironment: { ...previousState.change.prdEnvironment, isEnabled: environmentKey === 'prd' ? isEnabled : false },
        pfixEnvironment: { ...previousState.change.pfixEnvironment, isEnabled: environmentKey === 'pfix' ? isEnabled : false },
      };
      const nextEnvironmentValue = isEnabled
        ? resolveSuggestedEnvironmentValue(choiceOptions.u_environment ?? [], environmentKey)
        : inferEnvironmentKeyFromValue(previousState.change.chgBasicInfo.environment) === environmentKey
          ? ''
          : previousState.change.chgBasicInfo.environment;

      return {
        ...previousState,
        change: {
          ...previousState.change,
          ...nextEnvironmentState,
          chgBasicInfo: {
            ...previousState.change.chgBasicInfo,
            environment: nextEnvironmentValue,
          },
        },
      };
    });
  }, [choiceOptions]);

  const handleEnvironmentConfigItemChange = useCallback((environmentKey: EnvironmentKey, configItem: SnowReference) => {
    handleFieldChange(`${getEnvironmentStateKey(environmentKey)}.configItem`, configItem);
  }, [handleFieldChange]);

  const handleAddCtask = useCallback((template: CtaskTemplate) => {
    setModifyState((prev) => ({
      ...prev,
      changeTasks: [...prev.changeTasks, { ...template, id: `${template.id}-${Date.now()}` }],
    }));
  }, []);

  const handleRemoveCtask = useCallback((id: string) => {
    setModifyState((prev) => ({
      ...prev,
      changeTasks: prev.changeTasks.filter((t) => t.id !== id),
    }));
  }, []);

  const handleCtaskFieldChange = useCallback((ctaskId: string, field: string, value: string) => {
    setModifyState((prev) => ({
      ...prev,
      changeTasks: prev.changeTasks.map((ctask) =>
        ctask.id === ctaskId ? { ...ctask, [field]: value } : ctask,
      ),
    }));
  }, []);

  const handleSaveChange = useCallback(async () => {
    // Validate before attempting save
    const validationError = validateChangeBeforeSave(modifyState);
    if (validationError) {
      setModifyState((prev) => ({ ...prev, saveError: validationError }));
      return;
    }

    setModifyState((prev) => ({ ...prev, isSaving: true, saveError: null, saveSuccess: null }));
    try {
      if (!modifyState.change) throw new Error('No change data to save');
      await saveChangeToSnow(modifyState.changeKey, modifyState.change);
      setModifyState((prev) => ({
        ...prev,
        isSaving: false,
        saveSuccess: `Change ${modifyState.changeKey} saved successfully!`,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to save change';
      console.error(`${MODIFY_CHG_LOG_PREFIX} Save Change action failed`, {
        changeKey: modifyState.changeKey.trim().toUpperCase(),
        error: errorMessage,
        cause: error,
      });
      setModifyState((prev) => ({ ...prev, isSaving: false, saveError: errorMessage }));
    }
  }, [modifyState]);

  const handleStepSelect = useCallback((step: 1 | 2 | 3 | 4 | 5) => {
    if (step === 1 || modifyState.change) {
      setModifyState((prev) => ({ ...prev, currentStep: step }));
    }
  }, [modifyState.change]);

  const handleLoadMyChanges = useCallback(async () => {
    setModifyState((prev) => ({ ...prev, isLoadingMyChanges: true, myChangesError: null }));
    try {
      const changes = await fetchMyOpenChanges();
      setModifyState((prev) => ({
        ...prev,
        isLoadingMyChanges: false,
        myOpenChanges: changes,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load my changes';
      console.error(`${MODIFY_CHG_LOG_PREFIX} Load My Open Changes action failed`, {
        message: errorMessage,
        error,
      });
      setModifyState((prev) => ({ ...prev, isLoadingMyChanges: false, myChangesError: errorMessage }));
    }
  }, []);

  const handleMyChangeSelect = useCallback(async (changeKey: string) => {
    // Populate the change key field
    setModifyState((prev) => ({ ...prev, changeKey, fetchError: null }));
    // Auto-trigger the fetch
    setModifyState((prev) => ({ ...prev, isFetching: true, fetchError: null }));

    try {
      const data = await fetchChangeFromSnow(changeKey);
      setModifyState((prev) => ({
        ...prev,
        isFetching: false,
        change: data,
        currentStep: 2,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`${MODIFY_CHG_LOG_PREFIX} Dropdown change selection failed`, {
        changeKey: changeKey.trim().toUpperCase(),
        error: errorMessage,
        cause: error,
      });
      setModifyState((prev) => ({ ...prev, isFetching: false, fetchError: errorMessage }));
    }
  }, []);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h2 className={styles.title}>{TAB_TITLE}</h2>
        <p className={styles.subtitle}>{TAB_SUBTITLE}</p>
      </header>

      <StepIndicator currentStep={modifyState.currentStep} onStepSelect={handleStepSelect} />

      {modifyState.currentStep === 1 && (
        <FetchChangeStep
          state={modifyState}
          onChangeKeyChange={handleChangeKeyChange}
          onFetchClick={handleFetchChange}
          onLoadMyChangesClick={handleLoadMyChanges}
          onMyChangeSelect={handleMyChangeSelect}
        />
      )}

      {modifyState.currentStep === 2 && (
        <>
          <ChangeDetailsStep state={modifyState} onFieldChange={handleFieldChange} />
          <div className={styles.buttonRow}>
            <button className={styles.linkButton} onClick={() => handleStepSelect(1)} type="button">
              Back
            </button>
            <button className={styles.primaryButton} onClick={() => handleStepSelect(3)} type="button">
              Next: Planning
            </button>
          </div>
        </>
      )}

      {modifyState.currentStep === 3 && (
        <>
          <PlanningStep
            state={modifyState}
            onFieldChange={handleFieldChange}
            choiceOptions={choiceOptions}
            isLoadingChoices={isLoadingChoices}
          />
          <div className={styles.buttonRow}>
            <button className={styles.linkButton} onClick={() => handleStepSelect(2)} type="button">
              Back
            </button>
            <button className={styles.primaryButton} onClick={() => handleStepSelect(4)} type="button">
              Next: Environments
            </button>
          </div>
        </>
      )}

      {modifyState.currentStep === 4 && (
        <>
          <EnvironmentsStep
            state={modifyState}
            onFieldChange={handleFieldChange}
            onEnvironmentToggle={handleEnvironmentToggle}
            onEnvironmentConfigItemChange={handleEnvironmentConfigItemChange}
            choiceOptions={choiceOptions}
            isLoadingChoices={isLoadingChoices}
          />
          <div className={styles.buttonRow}>
            <button className={styles.linkButton} onClick={() => handleStepSelect(3)} type="button">
              Back
            </button>
            <button className={styles.primaryButton} onClick={() => handleStepSelect(5)} type="button">
              Next: Review & Save
            </button>
          </div>
        </>
      )}

      {modifyState.currentStep === 5 && (
        <>
          <ReviewSaveStep
            state={modifyState}
            ctaskTemplates={ctaskTemplates.templates}
            onAddCtask={handleAddCtask}
            onRemoveCtask={handleRemoveCtask}
            onSaveClick={handleSaveChange}
            onCtaskFieldChange={handleCtaskFieldChange}
          />
          <div className={styles.buttonRow}>
            <button className={styles.linkButton} onClick={() => handleStepSelect(4)} type="button">
              Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}
