// CrgTab.tsx — Six-step Change Request Generator for building comprehensive SNow CHG records from Jira issues.
// Steps: 1-Fetch Issues → 2-Review Issues → 3-Change Details → 4-Planning & Content → 5-Environments → 6-Review & Create

import type { ChangeEvent, KeyboardEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  ChgBasicInfo,
  ChgPlanningAssessment,
  ChgPlanningContent,
  CrgTemplate,
  CtaskTemplate,
  CtaskTemplateData,
  SnowReference,
} from '../hooks/useCrgState.ts';
import type { CrgPinnedField, CrgPinnedFieldInput } from '../hooks/useCrgFieldPins.ts';
import { useCrgFieldPins } from '../hooks/useCrgFieldPins.ts';
import { useCrgState } from '../hooks/useCrgState.ts';
import { useCtaskTemplates } from '../hooks/useCtaskTemplates.ts';
import { useCrgTemplates } from '../hooks/useCrgTemplates.ts';
import { useRovoAssist } from '../hooks/useRovoAssist.ts';
import type { SnowChoiceOptionMap } from '../hooks/useSnowChoiceOptions.ts';
import { useSnowChoiceOptions } from '../hooks/useSnowChoiceOptions.ts';
import { SnowLookupField } from '../components/SnowLookupField.tsx';
import styles from './CrgTab.module.css';

const TAB_TITLE = 'Change Request Generator';
const TAB_SUBTITLE = 'Guide a release from Jira issue lookup through a complete ServiceNow Change Request.';
const CONFIGURATION_TAB_TITLE = 'CRG Configuration';
const CONFIGURATION_TAB_SUBTITLE = 'Load existing changes and CTASKs, save reusable defaults, and prepare templates before walking the CHG wizard.';
const CONFIGURATION_SUMMARY = 'Configuration mode';
const STEP_DEFINITIONS = [
  { step: 1, label: 'Fetch Issues' },
  { step: 2, label: 'Review Issues' },
  { step: 3, label: 'Change Details' },
  { step: 4, label: 'Planning' },
  { step: 5, label: 'Environments' },
  { step: 6, label: 'Review & Create' },
] as const;

const GENERATED_FIELD_DEFINITIONS = [
  { key: 'shortDescription', label: 'Short Description', valueKey: 'generatedShortDescription' },
  { key: 'description', label: 'Description', valueKey: 'generatedDescription' },
  { key: 'justification', label: 'Justification', valueKey: 'generatedJustification' },
  { key: 'riskImpact', label: 'Risk & Impact', valueKey: 'generatedRiskImpact' },
] as const;

// ── Planning assessment row schema ──
// Each row maps a form field (fieldKey in ChgPlanningAssessment) to its SNow choice field name.
// Options are resolved at runtime from SNow form metadata so they match the live SNow instance.
const PLANNING_ASSESSMENT_ROWS = [
  { label: 'Impact',                          fieldKey: 'impact',                        snowFieldName: 'impact' },
  { label: 'System Availability Implication',  fieldKey: 'systemAvailabilityImplication', snowFieldName: 'u_availability_impact' },
  { label: 'Has Been Tested',                 fieldKey: 'hasBeenTested',                 snowFieldName: 'u_change_tested' },
  { label: 'Impacted Persons Aware',          fieldKey: 'impactedPersonsAware',          snowFieldName: 'u_impacted_persons_aware' },
  { label: 'Performed Previously',            fieldKey: 'hasBeenPerformedPreviously',    snowFieldName: 'u_performed_previously' },
  { label: 'Success Probability',             fieldKey: 'successProbability',            snowFieldName: 'u_success_probability' },
  { label: 'Can Be Backed Out',               fieldKey: 'canBeBackedOut',                snowFieldName: 'u_can_be_backed_out' },
] as const;

const ENVIRONMENT_ROW_DEFINITIONS = [
  { key: 'rel', label: 'REL', stateKey: 'relEnvironment' },
  { key: 'prd', label: 'PRD', stateKey: 'prdEnvironment' },
  { key: 'pfix', label: 'PFIX', stateKey: 'pfixEnvironment' },
] as const;
const CONSOLIDATED_RESULT_LABEL = 'Consolidated Result';
const STEP_TITLE_PREFIX = 'Step';
const DEFAULT_RESULT_MESSAGE = 'Generated content will appear here after you complete the wizard.';
const EMPTY_ENVIRONMENT_DATES = 'Not scheduled';
const WORKSPACE_PANEL_TITLE = 'Clone, Templates & Defaults';
const WORKSPACE_PANEL_HINT = 'Clone a known-good CHG, save repeatable templates, and build reusable pinned field options without filling the wizard with static pin lists.';
const SHORT_MANUAL_VALUE_PLACEHOLDER = 'Type or paste the internal ServiceNow value';
const PIN_SECTION_CHANGE_DETAILS = 'Change Details';
const PIN_SECTION_PLANNING = 'Planning';
const PIN_SECTION_ENVIRONMENTS = 'Environments';
const CATEGORY_PIN_KEY = 'chgBasicInfo.category';
const CHANGE_TYPE_PIN_KEY = 'chgBasicInfo.changeType';
const REQUESTED_BY_PIN_KEY = 'chgBasicInfo.requestedBy';
const ASSIGNMENT_GROUP_PIN_KEY = 'chgBasicInfo.assignmentGroup';
const ASSIGNED_TO_PIN_KEY = 'chgBasicInfo.assignedTo';
const CHANGE_MANAGER_PIN_KEY = 'chgBasicInfo.changeManager';
const TESTER_PIN_KEY = 'chgBasicInfo.tester';
const SERVICE_MANAGER_PIN_KEY = 'chgBasicInfo.serviceManager';
const IS_EXPEDITED_PIN_KEY = 'chgBasicInfo.isExpedited';
const IMPACT_PIN_KEY = 'chgPlanningAssessment.impact';
const SYSTEM_AVAILABILITY_PIN_KEY = 'chgPlanningAssessment.systemAvailabilityImplication';
const HAS_BEEN_TESTED_PIN_KEY = 'chgPlanningAssessment.hasBeenTested';
const IMPACTED_PERSONS_AWARE_PIN_KEY = 'chgPlanningAssessment.impactedPersonsAware';
const PERFORMED_PREVIOUSLY_PIN_KEY = 'chgPlanningAssessment.hasBeenPerformedPreviously';
const SUCCESS_PROBABILITY_PIN_KEY = 'chgPlanningAssessment.successProbability';
const CAN_BE_BACKED_OUT_PIN_KEY = 'chgPlanningAssessment.canBeBackedOut';
const ENVIRONMENT_VALUE_PIN_KEY = 'chgBasicInfo.environment';
const REL_CONFIG_ITEM_PIN_KEY = 'relEnvironment.configItem';
const PRD_CONFIG_ITEM_PIN_KEY = 'prdEnvironment.configItem';
const PFIX_CONFIG_ITEM_PIN_KEY = 'pfixEnvironment.configItem';

function buildCurrentTemplateData(state: CrgStateData): Omit<CrgTemplate, 'id' | 'name' | 'createdAt'> {
  return {
    chgBasicInfo:          state.chgBasicInfo,
    chgPlanningAssessment: state.chgPlanningAssessment,
    chgPlanningContent:    state.chgPlanningContent,
    relEnvironment:        state.relEnvironment,
    prdEnvironment:        state.prdEnvironment,
    pfixEnvironment:       state.pfixEnvironment,
  };
}

function resolvePlanningAssessmentPinKey(fieldKey: keyof ChgPlanningAssessment): string {
  switch (fieldKey) {
    case 'impact':
      return IMPACT_PIN_KEY;
    case 'systemAvailabilityImplication':
      return SYSTEM_AVAILABILITY_PIN_KEY;
    case 'hasBeenTested':
      return HAS_BEEN_TESTED_PIN_KEY;
    case 'impactedPersonsAware':
      return IMPACTED_PERSONS_AWARE_PIN_KEY;
    case 'hasBeenPerformedPreviously':
      return PERFORMED_PREVIOUSLY_PIN_KEY;
    case 'successProbability':
      return SUCCESS_PROBABILITY_PIN_KEY;
    case 'canBeBackedOut':
      return CAN_BE_BACKED_OUT_PIN_KEY;
  }
}

function resolveEnvironmentConfigItemPinKey(environmentKey: EnvironmentKey): string {
  switch (environmentKey) {
    case 'rel':
      return REL_CONFIG_ITEM_PIN_KEY;
    case 'prd':
      return PRD_CONFIG_ITEM_PIN_KEY;
    case 'pfix':
      return PFIX_CONFIG_ITEM_PIN_KEY;
  }
}

function isSnowReferenceValue(value: CrgPinnedField['value']): value is SnowReference {
  return typeof value === 'object' && value !== null && 'displayName' in value && 'sysId' in value;
}

function canPinFieldValue(value: CrgPinnedField['value']): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (typeof value === 'boolean') {
    return true;
  }

  return value.displayName.trim().length > 0 || value.sysId.trim().length > 0;
}

function formatPinnedFieldValue(value: CrgPinnedField['value']): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  return value.displayName || value.sysId || 'No value';
}

function createEmptyCtaskTemplateData(): CtaskTemplateData {
  return {
    shortDescription: '',
    description:      '',
    assignmentGroup:  { sysId: '', displayName: '' },
    assignedTo:       { sysId: '', displayName: '' },
    plannedStartDate: '',
    plannedEndDate:   '',
    closeNotes:       '',
  };
}

function buildCtaskTemplateData(template: CtaskTemplate): CtaskTemplateData {
  return {
    shortDescription: template.shortDescription,
    description:      template.description,
    assignmentGroup:  template.assignmentGroup,
    assignedTo:       template.assignedTo,
    plannedStartDate: template.plannedStartDate,
    plannedEndDate:   template.plannedEndDate,
    closeNotes:       template.closeNotes,
  };
}

/**
 * Returns a plain-English action hint for well-known SNow relay fetch error patterns.
 * This helps users fix the root cause (e.g. expired session) without guessing.
 * Returns null for unrecognized errors so the raw message is shown without a misleading hint.
 */
function resolveSnowFetchErrorHint(errorMessage: string): string | null {
  if (errorMessage.includes('401')) {
    return 'Your ServiceNow session has expired. Go to your SNow tab, log back in, then click Retry.';
  }
  if (errorMessage.includes('403')) {
    return 'ServiceNow denied access to the live form metadata. Confirm you can open a new Change Request in SNow, then click Retry.';
  }
  if (errorMessage.includes('timed out') || errorMessage.includes('timeout')) {
    return 'The request to SNow timed out. Check that the relay bookmarklet tab is open and connected, then click Retry.';
  }
  return null;
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

interface ManualChoiceInputState {
  options: { value: string; label: string }[];
  isLoadingChoices: boolean;
  isFetchFailed: boolean;
  isRelayConnected: boolean;
  hasRelaySessionToken: boolean;
}

/**
 * Decides when a choice field should become editable instead of disabled.
 * This preserves cloned and pinned ServiceNow values when metadata ACLs block live dropdown options.
 */
function shouldRenderManualChoiceInput({
  options,
  isLoadingChoices,
  isFetchFailed,
  isRelayConnected,
  hasRelaySessionToken,
}: ManualChoiceInputState): boolean {
  if (isLoadingChoices) {
    return false;
  }

  return (
    isFetchFailed ||
    !isRelayConnected ||
    !hasRelaySessionToken ||
    !hasSelectableChoiceOptions(options)
  );
}

interface PinnedFieldSelectorProps {
  fieldKey: string;
  fieldLabel: string;
  getPinnedFields: (fieldKey: string) => CrgPinnedField[];
  onApplyPinnedField: (pinnedField: CrgPinnedField) => void;
}

function PinnedFieldSelector({
  fieldKey,
  fieldLabel,
  getPinnedFields,
  onApplyPinnedField,
}: PinnedFieldSelectorProps) {
  const pinnedOptions = getPinnedFields(fieldKey);

  if (pinnedOptions.length === 0) {
    return null;
  }

  return (
    <label className={styles.fieldGroup}>
      <span className={styles.fieldHelpText}>Pinned {fieldLabel} values</span>
      <select
        aria-label={`Pinned ${fieldLabel} values`}
        className={styles.input}
        defaultValue=""
        onChange={(event) => {
          const selectedPinnedField = pinnedOptions.find((pinnedField) => pinnedField.id === event.target.value);
          if (selectedPinnedField) {
            onApplyPinnedField(selectedPinnedField);
            event.target.value = '';
          }
        }}
      >
        <option value="">Use a saved value…</option>
        {pinnedOptions.map((pinnedField) => (
          <option key={pinnedField.id} value={pinnedField.id}>{formatPinnedFieldValue(pinnedField.value)}</option>
        ))}
      </select>
    </label>
  );
}

interface FieldControlsProps {
  fieldKey: string;
  fieldLabel: string;
  fieldSection: string;
  fieldValue: CrgPinnedField['value'];
  shouldShowSaveButton?: boolean;
  upsertPin: (pinnedField: CrgPinnedFieldInput) => void;
  removePin: (pinId: string) => void;
  getPinnedFields: (fieldKey: string) => CrgPinnedField[];
  findPinnedField: (fieldKey: string, fieldValue: CrgPinnedField['value']) => CrgPinnedField | undefined;
  onApplyPinnedField: (pinnedField: CrgPinnedField) => void;
}

function FieldControls({
  fieldKey,
  fieldLabel,
  fieldSection,
  fieldValue,
  shouldShowSaveButton = true,
  upsertPin,
  removePin,
  getPinnedFields,
  findPinnedField,
  onApplyPinnedField,
}: FieldControlsProps) {
  const pinnedOptions = getPinnedFields(fieldKey);
  const matchingPinnedField = findPinnedField(fieldKey, fieldValue);
  const canSaveCurrentValue = canPinFieldValue(fieldValue);

  if (!shouldShowSaveButton && pinnedOptions.length === 0) {
    return null;
  }

  function handlePinToggle(): void {
    if (matchingPinnedField) {
      removePin(matchingPinnedField.id);
      return;
    }

    upsertPin({
      key: fieldKey,
      label: fieldLabel,
      section: fieldSection,
      value: fieldValue,
    });
  }

  return (
    <div className={styles.fieldSupportRow}>
      <PinnedFieldSelector
        fieldKey={fieldKey}
        fieldLabel={fieldLabel}
        getPinnedFields={getPinnedFields}
        onApplyPinnedField={onApplyPinnedField}
      />
      {shouldShowSaveButton ? (
        <button
          aria-label={matchingPinnedField ? `Remove saved ${fieldLabel}` : `Save ${fieldLabel}`}
          className={matchingPinnedField ? `${styles.linkButton} ${styles.activePinButton}` : styles.linkButton}
          disabled={!matchingPinnedField && !canSaveCurrentValue}
          onClick={handlePinToggle}
          type="button"
        >
          {matchingPinnedField ? '📌 Saved' : '📌 Save option'}
        </button>
      ) : null}
    </div>
  );
}

type CrgHookResult = ReturnType<typeof useCrgState>;
type CrgStateData = CrgHookResult['state'];
type CrgActionSet = CrgHookResult['actions'];
type GeneratedFieldName = Parameters<CrgActionSet['updateGeneratedField']>[0];
type EnvironmentKey = Parameters<CrgActionSet['updateEnvironment']>[0];
type FetchMode = CrgStateData['fetchMode'];
type EnvironmentSelectionState = Record<EnvironmentKey, boolean>;

function resolveSuggestedEnvironmentValue(
  options: { value: string; label: string }[],
  selections: EnvironmentSelectionState,
): string | null {
  const selectedEnvironmentPriority: EnvironmentKey[] = ['pfix', 'prd', 'rel'];
  const selectedEnvironmentKey = selectedEnvironmentPriority.find((environmentKey) => selections[environmentKey]);
  if (!selectedEnvironmentKey) return '';

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

  return matchingChoice?.value ?? null;
}

interface StepIndicatorProps {
  currentStep: CrgStateData['currentStep'];
}

interface CrgStepProps {
  state: CrgStateData;
  actions: CrgActionSet;
}

/** Additional props passed to PlanningStep when Rovo assist is active. */
interface PlanningStepExtras {
  isRovoUnlocked: boolean;
  onEnhanceWithRovo: () => void;
  /** Dynamic choice options fetched from SNow form metadata for planning dropdowns. */
  choiceOptions: SnowChoiceOptionMap;
  /** True while the SNow metadata fetch is still in flight. */
  isLoadingChoices: boolean;
  /** True when the SNow metadata fetch failed — options are unavailable and user must connect SNow. */
  isFetchFailed: boolean;
  /** True when the SNow relay bridge is connected (drives whether dropdowns can load). */
  isRelayConnected: boolean;
  /** True when the relay has detected SNow's g_ck session token. */
  hasRelaySessionToken: boolean;
  /** Manually re-triggers the SNow metadata fetch after a transient error. */
  retryFetch: () => void;
  /**
   * Human-readable reason the last fetch failed (e.g. "SNow relay fetch … failed: 401").
   * null when no failure has occurred or a new fetch is in progress.
   */
  fetchErrorMessage: string | null;
  upsertPin: (pinnedField: CrgPinnedFieldInput) => void;
  removePin: (pinId: string) => void;
  getPinnedFields: (fieldKey: string) => CrgPinnedField[];
  findPinnedField: (fieldKey: string, fieldValue: CrgPinnedField['value']) => CrgPinnedField | undefined;
}

interface EnvironmentStepExtras {
  /** Dynamic choice options fetched from SNow form metadata for the final u_environment mapping. */
  choiceOptions: SnowChoiceOptionMap;
  /** True while SNow choice metadata is still loading. */
  isLoadingChoices: boolean;
  /** True when the live metadata fetch failed. */
  isFetchFailed: boolean;
  /** True when the relay bridge is connected. */
  isRelayConnected: boolean;
  /** True when the relay has detected SNow's g_ck session token. */
  hasRelaySessionToken: boolean;
  upsertPin: (pinnedField: CrgPinnedFieldInput) => void;
  removePin: (pinId: string) => void;
  getPinnedFields: (fieldKey: string) => CrgPinnedField[];
  findPinnedField: (fieldKey: string, fieldValue: CrgPinnedField['value']) => CrgPinnedField | undefined;
}

/** Additional props for the Change Details step — templates and dynamic choice options. */
interface ChangeDetailsExtras {
  /** Dynamic choice options fetched from SNow form metadata for basic info dropdowns. */
  choiceOptions: SnowChoiceOptionMap;
  /** True while the SNow metadata fetch is still in flight. */
  isLoadingChoices: boolean;
  /** True when the SNow metadata fetch failed — options are unavailable and user must connect SNow. */
  isFetchFailed: boolean;
  /** True when the SNow relay bridge is connected (drives whether dropdowns can load). */
  isRelayConnected: boolean;
  /** True when the relay has detected SNow's g_ck session token. */
  hasRelaySessionToken: boolean;
  /** Manually re-triggers the SNow metadata fetch after a transient error. */
  retryFetch: () => void;
  /**
   * Human-readable reason the last fetch failed (e.g. "SNow relay fetch … failed: 401").
   * null when no failure has occurred or a new fetch is in progress.
   */
  fetchErrorMessage: string | null;
  upsertPin: (pinnedField: CrgPinnedFieldInput) => void;
  removePin: (pinId: string) => void;
  getPinnedFields: (fieldKey: string) => CrgPinnedField[];
  findPinnedField: (fieldKey: string, fieldValue: CrgPinnedField['value']) => CrgPinnedField | undefined;
}

interface CtaskTemplateExtras {
  templates: CtaskTemplate[];
  saveTemplate: (name: string, data: CtaskTemplateData) => string;
  updateTemplate: (templateId: string, data: CtaskTemplateData) => void;
  deleteTemplate: (templateId: string) => void;
}

interface StepRenderOptions {
  headingStep?: CrgStateData['currentStep'];
  shouldShowNavigation?: boolean;
  shouldShowSaveButtons?: boolean;
}

interface CrgWorkspaceExtras {
  templates: CrgTemplate[];
  saveTemplate: (name: string, data: Omit<CrgTemplate, 'id' | 'name' | 'createdAt'>) => string;
  updateTemplate: (templateId: string, data: Omit<CrgTemplate, 'id' | 'name' | 'createdAt'>) => void;
  deleteTemplate: (templateId: string) => void;
  pinnedFields: CrgPinnedField[];
  upsertPin: (pinnedField: CrgPinnedFieldInput) => void;
  removePin: (pinId: string) => void;
  clearPins: () => void;
  getPinnedFields: (fieldKey: string) => CrgPinnedField[];
  findPinnedField: (fieldKey: string, fieldValue: CrgPinnedField['value']) => CrgPinnedField | undefined;
}

interface StepHeadingProps {
  currentStep: CrgStateData['currentStep'];
}

function StepIndicator({ currentStep }: StepIndicatorProps) {
  return (
    <ol className={styles.stepIndicator}>
      {STEP_DEFINITIONS.map((stepDefinition) => {
        const isActiveStep = stepDefinition.step === currentStep;
        const stepClassName = isActiveStep ? `${styles.stepBadge} ${styles.activeStep}` : styles.stepBadge;

        return (
          <li className={stepClassName} key={stepDefinition.step}>
            {stepDefinition.step}. {stepDefinition.label}
          </li>
        );
      })}
    </ol>
  );
}

function StepHeading({ currentStep }: StepHeadingProps) {
  const activeStepDefinition = STEP_DEFINITIONS.find((stepDefinition) => stepDefinition.step === currentStep);

  return (
    <div className={styles.stepHeading}>
      <p className={styles.stepMeta}>
        {STEP_TITLE_PREFIX} {currentStep} of {STEP_DEFINITIONS.length}
      </p>
      <h3 className={styles.sectionTitle}>{activeStepDefinition?.label}</h3>
    </div>
  );
}

function applyPinnedFieldValue(actions: CrgActionSet, pinnedField: CrgPinnedField): void {
  const pinnedValue = pinnedField.value;

  switch (pinnedField.key) {
    case CATEGORY_PIN_KEY:
      if (typeof pinnedValue === 'string') actions.setChgBasicInfo({ category: pinnedValue });
      return;
    case CHANGE_TYPE_PIN_KEY:
      if (typeof pinnedValue === 'string') actions.setChgBasicInfo({ changeType: pinnedValue });
      return;
    case REQUESTED_BY_PIN_KEY:
      if (isSnowReferenceValue(pinnedValue)) actions.setChgBasicInfo({ requestedBy: pinnedValue });
      return;
    case ASSIGNMENT_GROUP_PIN_KEY:
      if (isSnowReferenceValue(pinnedValue)) actions.setChgBasicInfo({ assignmentGroup: pinnedValue });
      return;
    case ASSIGNED_TO_PIN_KEY:
      if (isSnowReferenceValue(pinnedValue)) actions.setChgBasicInfo({ assignedTo: pinnedValue });
      return;
    case CHANGE_MANAGER_PIN_KEY:
      if (isSnowReferenceValue(pinnedValue)) actions.setChgBasicInfo({ changeManager: pinnedValue });
      return;
    case TESTER_PIN_KEY:
      if (isSnowReferenceValue(pinnedValue)) actions.setChgBasicInfo({ tester: pinnedValue });
      return;
    case SERVICE_MANAGER_PIN_KEY:
      if (isSnowReferenceValue(pinnedValue)) actions.setChgBasicInfo({ serviceManager: pinnedValue });
      return;
    case IS_EXPEDITED_PIN_KEY:
      if (typeof pinnedValue === 'boolean') actions.setChgBasicInfo({ isExpedited: pinnedValue });
      return;
    case IMPACT_PIN_KEY:
      if (typeof pinnedValue === 'string') actions.setChgPlanningAssessment({ impact: pinnedValue });
      return;
    case SYSTEM_AVAILABILITY_PIN_KEY:
      if (typeof pinnedValue === 'string') actions.setChgPlanningAssessment({ systemAvailabilityImplication: pinnedValue });
      return;
    case HAS_BEEN_TESTED_PIN_KEY:
      if (typeof pinnedValue === 'string') actions.setChgPlanningAssessment({ hasBeenTested: pinnedValue });
      return;
    case IMPACTED_PERSONS_AWARE_PIN_KEY:
      if (typeof pinnedValue === 'string') actions.setChgPlanningAssessment({ impactedPersonsAware: pinnedValue });
      return;
    case PERFORMED_PREVIOUSLY_PIN_KEY:
      if (typeof pinnedValue === 'string') actions.setChgPlanningAssessment({ hasBeenPerformedPreviously: pinnedValue });
      return;
    case SUCCESS_PROBABILITY_PIN_KEY:
      if (typeof pinnedValue === 'string') actions.setChgPlanningAssessment({ successProbability: pinnedValue });
      return;
    case CAN_BE_BACKED_OUT_PIN_KEY:
      if (typeof pinnedValue === 'string') actions.setChgPlanningAssessment({ canBeBackedOut: pinnedValue });
      return;
    case ENVIRONMENT_VALUE_PIN_KEY:
      if (typeof pinnedValue === 'string') actions.setChgBasicInfo({ environment: pinnedValue });
      return;
    case REL_CONFIG_ITEM_PIN_KEY:
      if (isSnowReferenceValue(pinnedValue)) actions.updateEnvironment('rel', { configItem: pinnedValue });
      return;
    case PRD_CONFIG_ITEM_PIN_KEY:
      if (isSnowReferenceValue(pinnedValue)) actions.updateEnvironment('prd', { configItem: pinnedValue });
      return;
    case PFIX_CONFIG_ITEM_PIN_KEY:
      if (isSnowReferenceValue(pinnedValue)) actions.updateEnvironment('pfix', { configItem: pinnedValue });
      return;
    default:
      return;
  }
}

function CrgWorkspacePanel({
  state,
  actions,
  templates,
  saveTemplate,
  updateTemplate,
  deleteTemplate,
  pinnedFields,
  clearPins,
}: CrgStepProps & CrgWorkspaceExtras) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [isSavePromptVisible, setIsSavePromptVisible] = useState<boolean>(false);
  const [newTemplateName, setNewTemplateName] = useState<string>('');

  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
  const pinnedFieldSummary = useMemo(() => {
    const pinnedFieldCountMap = new Map<string, { label: string; count: number }>();
    pinnedFields.forEach((pinnedField) => {
      const existingSummary = pinnedFieldCountMap.get(pinnedField.key);
      pinnedFieldCountMap.set(pinnedField.key, {
        label: pinnedField.label,
        count: (existingSummary?.count ?? 0) + 1,
      });
    });
    return [...pinnedFieldCountMap.values()].sort((leftSummary, rightSummary) => leftSummary.label.localeCompare(rightSummary.label));
  }, [pinnedFields]);

  function handleApplyTemplate(): void {
    if (selectedTemplate) {
      actions.applyTemplate(selectedTemplate);
    }
  }

  function handleCloneNumberChange(event: ChangeEvent<HTMLInputElement>): void {
    actions.setCloneChgNumber(event.target.value.toUpperCase());
  }

  function handleUpdateTemplate(): void {
    if (selectedTemplateId) {
      updateTemplate(selectedTemplateId, buildCurrentTemplateData(state));
    }
  }

  function handleSaveTemplate(): void {
    saveTemplate(newTemplateName, buildCurrentTemplateData(state));
    setNewTemplateName('');
    setIsSavePromptVisible(false);
  }

  function handleDeleteTemplate(): void {
    deleteTemplate(selectedTemplateId);
    setSelectedTemplateId('');
  }

  return (
    <section className={styles.workspacePanel}>
      <div className={styles.stepHeading}>
        <p className={styles.stepMeta}>Workspace tools</p>
        <h3 className={styles.sectionTitle}>{WORKSPACE_PANEL_TITLE}</h3>
      </div>
      <p className={styles.panelHint}>{WORKSPACE_PANEL_HINT}</p>
      <div className={styles.workspaceGrid}>
        <div className={styles.clonePanel}>
          <h4 className={styles.panelSectionTitle}>Clone from existing CHG</h4>
          <p className={styles.panelHint}>Load a known-good change first, then save repeatable templates or field options from what came back.</p>
          <div className={styles.cloneInputRow}>
            <input
              aria-label="Existing CHG number"
              className={styles.input}
              disabled={state.isCloning}
              onChange={handleCloneNumberChange}
              placeholder="e.g. CHG0001234"
              value={state.cloneChgNumber}
            />
            <button
              className={styles.secondaryButton}
              disabled={state.isCloning || !state.cloneChgNumber}
              onClick={() => void actions.cloneFromChg()}
              type="button"
            >
              {state.isCloning ? 'Loading…' : 'Load CHG'}
            </button>
          </div>
          {state.cloneError ? <p className={styles.errorText} role="alert">{state.cloneError}</p> : null}
        </div>

        <div className={styles.clonePanel}>
          <h4 className={styles.panelSectionTitle}>CHG Templates</h4>
          <p className={styles.panelHint}>Templates still cover Change Details, Planning, and Environments for the 90% path that follows the same release shape.</p>
          {templates.length > 0 ? (
            <div className={styles.cloneInputRow}>
              <select
                aria-label="Select CHG template"
                className={styles.input}
                onChange={(event) => setSelectedTemplateId(event.target.value)}
                value={selectedTemplateId}
              >
                <option value="">Select a template…</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
              <button className={styles.secondaryButton} disabled={!selectedTemplate} onClick={handleApplyTemplate} type="button">
                Apply to Steps 3-5
              </button>
              <button className={styles.secondaryButton} disabled={!selectedTemplateId} onClick={handleUpdateTemplate} type="button">
                Update selected
              </button>
              <button className={styles.linkButton} disabled={!selectedTemplateId} onClick={handleDeleteTemplate} type="button">
                Delete
              </button>
            </div>
          ) : (
            <p className={styles.panelHint}>No CHG templates saved yet.</p>
          )}
          {isSavePromptVisible ? (
            <div className={styles.cloneInputRow}>
              <input
                aria-label="CHG template name"
                className={styles.input}
                onChange={(event) => setNewTemplateName(event.target.value)}
                placeholder="Template name…"
                value={newTemplateName}
              />
              <button className={styles.secondaryButton} onClick={handleSaveTemplate} type="button">
                Save
              </button>
              <button className={styles.linkButton} onClick={() => setIsSavePromptVisible(false)} type="button">
                Cancel
              </button>
            </div>
          ) : (
            <button
              className={styles.linkButton}
              onClick={() => {
                setIsSavePromptVisible(true);
                setNewTemplateName('');
              }}
              type="button"
            >
              + Save current Steps 3-5 as template
            </button>
          )}
        </div>

        <div className={styles.clonePanel}>
          <h4 className={styles.panelSectionTitle}>Pinned field options</h4>
          <p className={styles.panelHint}>Saved values now appear inline on matching fields as reusable dropdown choices, so ad hoc changes do not depend on one giant pinned-values list.</p>
          {pinnedFields.length > 0 ? (
            <>
              <p className={styles.panelHint}>{pinnedFields.length} saved option(s) across {pinnedFieldSummary.length} field(s).</p>
              <div className={styles.pinnedFieldList}>
                {pinnedFieldSummary.map((fieldSummary) => (
                  <div className={styles.pinnedFieldCard} key={fieldSummary.label}>
                    <strong>{fieldSummary.label}</strong>
                    <span className={styles.pinnedFieldValue}>{fieldSummary.count} saved option(s)</span>
                  </div>
                ))}
              </div>
              <button className={styles.linkButton} onClick={clearPins} type="button">
                Clear all saved options
              </button>
            </>
          ) : (
            <p className={styles.panelHint}>No field options saved yet. Save values from Step 3, Step 4, or Step 5 and they will show up inline on those fields.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function FetchIssuesStep({ state, actions }: CrgStepProps) {
  function handleProjectKeyChange(event: ChangeEvent<HTMLInputElement>): void {
    actions.setProjectKey(event.target.value);
  }

  function handleFixVersionChange(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>): void {
    actions.setFixVersion(event.target.value);
  }

  function handleCustomJqlChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    actions.setCustomJql(event.target.value);
  }

  function handleFetchModeChange(event: ChangeEvent<HTMLInputElement>): void {
    actions.setFetchMode(event.target.value as FetchMode);
  }

  const isProjectMode = state.fetchMode === 'project';

  return (
    <section className={styles.section}>
      <StepHeading currentStep={state.currentStep} />

      {/* Fetch mode selector — choose between structured project+version lookup or a free-form JQL query */}
      <div aria-label="Fetch mode" className={styles.fetchModeSelector} role="radiogroup">
        <label className={styles.inlineCheckbox}>
          <input
            checked={isProjectMode}
            name="fetchMode"
            onChange={handleFetchModeChange}
            type="radio"
            value="project"
          />
          <span>By Project &amp; Version</span>
        </label>
        <label className={styles.inlineCheckbox}>
          <input
            checked={!isProjectMode}
            name="fetchMode"
            onChange={handleFetchModeChange}
            type="radio"
            value="jql"
          />
          <span>Custom JQL</span>
        </label>
      </div>

      {isProjectMode ? (
        <div className={styles.fieldGrid}>
          <label className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>Project Key</span>
            <input className={styles.input} onChange={handleProjectKeyChange} value={state.projectKey} />
          </label>
          <label className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>Fix Version</span>
            {state.availableFixVersions.length > 0 ? (
              <select className={styles.input} onChange={handleFixVersionChange} value={state.fixVersion}>
                <option value="">Select fix version…</option>
                {state.availableFixVersions.map((version) => (
                  <option key={version} value={version}>
                    {version}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={styles.input}
                onChange={handleFixVersionChange}
                placeholder="e.g. 1.2.3"
                value={state.fixVersion}
              />
            )}
          </label>
        </div>
      ) : (
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>JQL Query</span>
          <textarea
            className={styles.textArea}
            onChange={handleCustomJqlChange}
            placeholder='e.g. project = "TOOL" AND status = Done AND sprint in openSprints()'
            value={state.customJql}
          />
        </label>
      )}

      <div className={styles.buttonRow}>
        <button className={styles.primaryButton} onClick={() => void actions.fetchIssues()} type="button">
          Fetch Issues
        </button>
      </div>
      {state.isFetchingIssues ? <p className={styles.loadingText}>Loading issues...</p> : null}
      {state.fetchError ? <p className={styles.errorText} role="alert">{state.fetchError}</p> : null}
    </section>
  );
}

function ReviewIssuesStep({ state, actions }: CrgStepProps) {
  const isAllIssuesSelected = state.fetchedIssues.length > 0 && state.selectedIssueKeys.size === state.fetchedIssues.length;

  function handleSelectAllChange(event: ChangeEvent<HTMLInputElement>): void {
    actions.selectAllIssues(event.target.checked);
  }

  return (
    <section className={styles.section}>
      <StepHeading currentStep={state.currentStep} />
      <label className={styles.inlineCheckbox}>
        <input checked={isAllIssuesSelected} onChange={handleSelectAllChange} type="checkbox" />
        <span>Select All</span>
      </label>
      <table className={styles.issueTable}>
        <thead>
          <tr>
            <th scope="col">Select</th>
            <th scope="col">Issue Key</th>
            <th scope="col">Summary</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {state.fetchedIssues.map((jiraIssue) => (
            <tr key={jiraIssue.key}>
              <td>
                <input
                  checked={state.selectedIssueKeys.has(jiraIssue.key)}
                  onChange={() => actions.toggleIssueSelection(jiraIssue.key)}
                  type="checkbox"
                />
              </td>
              <td>{jiraIssue.key}</td>
              <td>{jiraIssue.fields.summary}</td>
              <td>{jiraIssue.fields.status.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.buttonRow}>
        <button className={styles.linkButton} onClick={() => actions.goToStep(1)} type="button">
          Back
        </button>
        <button className={styles.primaryButton} onClick={() => actions.generateDocs()} type="button">
          Generate Docs
        </button>
      </div>
    </section>
  );
}

function ChangeDetailsStep({
  state,
  actions,
  choiceOptions,
  isLoadingChoices,
  isFetchFailed,
  isRelayConnected,
  hasRelaySessionToken,
  retryFetch,
  fetchErrorMessage,
  upsertPin,
  removePin,
  getPinnedFields,
  findPinnedField,
  headingStep,
  shouldShowNavigation = true,
  shouldShowSaveButtons = true,
}: CrgStepProps & ChangeDetailsExtras & StepRenderOptions) {
  function handleBasicInfoChange<K extends keyof ChgBasicInfo>(
    fieldKey: K,
    value: ChgBasicInfo[K],
  ): void {
    actions.setChgBasicInfo({ [fieldKey]: value } as Partial<ChgBasicInfo>);
  }

  const { chgBasicInfo: basicInfo } = state;

  // Resolve dynamic choice options for the basic-info dropdowns.
  // These are empty until the SNow relay is connected and live form metadata loads.
  const categoryOptions    = choiceOptions['category']      ?? [];
  const changeTypeOptions  = choiceOptions['type']          ?? [];
  const shouldUseManualCategoryInput = shouldRenderManualChoiceInput({
    options: categoryOptions,
    isLoadingChoices,
    isFetchFailed,
    isRelayConnected,
    hasRelaySessionToken,
  });
  const shouldUseManualChangeTypeInput = shouldRenderManualChoiceInput({
    options: changeTypeOptions,
    isLoadingChoices,
    isFetchFailed,
    isRelayConnected,
    hasRelaySessionToken,
  });

  /**
   * Renders either live SNow choices or a manual value input.
   * Manual mode keeps cloned/template values usable when SNow hides form metadata.
   */
  function renderBasicChoiceField(
    label: string,
    pinKey: string,
    fieldName: 'category' | 'changeType',
    options: { value: string; label: string }[],
    currentValue: string,
    shouldUseManualInput: boolean,
  ) {
    if (shouldUseManualInput) {
      return (
        <div className={styles.fieldGroup}>
          <label className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>{label}</span>
            <input
              className={styles.input}
              onChange={(event) => handleBasicInfoChange(fieldName, event.target.value)}
              placeholder={SHORT_MANUAL_VALUE_PLACEHOLDER}
              value={currentValue}
            />
          </label>
          <FieldControls
            fieldKey={pinKey}
            fieldLabel={label}
            fieldSection={PIN_SECTION_CHANGE_DETAILS}
            fieldValue={currentValue}
            shouldShowSaveButton={shouldShowSaveButtons}
            upsertPin={upsertPin}
            removePin={removePin}
            getPinnedFields={getPinnedFields}
            findPinnedField={findPinnedField}
            onApplyPinnedField={(pinnedField) => applyPinnedFieldValue(actions, pinnedField)}
          />
        </div>
      );
    }

    if (isLoadingChoices) {
      return (
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>{label}</span>
          <select className={styles.input} disabled value="">
            <option disabled value="">Loading options…</option>
          </select>
        </label>
      );
    }

    const renderedOptions = buildRenderedChoiceOptions(options, currentValue);
    return (
      <div className={styles.fieldGroup}>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>{label}</span>
          <select
            className={styles.input}
            onChange={(event) => handleBasicInfoChange(fieldName, event.target.value)}
            value={resolveStoredChoiceValue(currentValue, renderedOptions)}
          >
            {renderedOptions.map((option) => (
              <option key={`${option.value}-${option.label}`} value={option.value}>{option.label || 'Select…'}</option>
            ))}
          </select>
        </label>
        <FieldControls fieldKey={pinKey} fieldLabel={label} fieldSection={PIN_SECTION_CHANGE_DETAILS} fieldValue={currentValue} shouldShowSaveButton={shouldShowSaveButtons} upsertPin={upsertPin} removePin={removePin} getPinnedFields={getPinnedFields} findPinnedField={findPinnedField} onApplyPinnedField={(pinnedField) => applyPinnedFieldValue(actions, pinnedField)} />
      </div>
    );
  }

  return (
    <section className={styles.section}>
      <StepHeading currentStep={headingStep ?? state.currentStep} />

      {/* Choice availability warning — shown when options haven't been loaded yet. */}
      {!isRelayConnected && !isFetchFailed ? (
        <p className={styles.choiceUnavailableWarning} role="alert">
          ⚠ SNow relay not connected — dropdown options will load automatically once connected.
        </p>
      ) : isRelayConnected && !hasRelaySessionToken && !isFetchFailed ? (
        <p className={styles.choiceUnavailableWarning} role="alert">
          ⚠ SNow relay is connected, but ServiceNow has not exposed the session token yet. Wait for the SNow page
          to fully load, then click the latest NodeToolbox SNow Relay bookmarklet again.
        </p>
      ) : isFetchFailed ? (
        <p className={styles.choiceUnavailableWarning} role="alert">
          ⚠ Failed to load dropdown options from SNow
          {fetchErrorMessage ? `: ${fetchErrorMessage}` : '.'}{' '}
          <button className={styles.linkButton} onClick={retryFetch} type="button">Retry</button>
          {fetchErrorMessage ? (
            <span className={styles.errorHint}>
              {resolveSnowFetchErrorHint(fetchErrorMessage)}
            </span>
          ) : null}
        </p>
      ) : null}

      {/* Basic Change Info — mirrors the top section of the SNow Change Request form */}
      {shouldUseManualCategoryInput || shouldUseManualChangeTypeInput ? (
        <p className={styles.panelHint}>
          Live basic-info choices are unavailable. Type the internal ServiceNow value or use one of the saved field options shown inline below.
        </p>
      ) : null}
      <div className={styles.detailsGrid}>
        {renderBasicChoiceField('Category', CATEGORY_PIN_KEY, 'category', categoryOptions, basicInfo.category, shouldUseManualCategoryInput)}
        {renderBasicChoiceField('Change Type', CHANGE_TYPE_PIN_KEY, 'changeType', changeTypeOptions, basicInfo.changeType, shouldUseManualChangeTypeInput)}

        <div className={styles.fieldGroup}>
          <SnowLookupField label="Requested By" tableName="sys_user" value={basicInfo.requestedBy} onChange={(ref) => handleBasicInfoChange('requestedBy', ref)} />
          <FieldControls fieldKey={REQUESTED_BY_PIN_KEY} fieldLabel="Requested By" fieldSection={PIN_SECTION_CHANGE_DETAILS} fieldValue={basicInfo.requestedBy} shouldShowSaveButton={shouldShowSaveButtons} upsertPin={upsertPin} removePin={removePin} getPinnedFields={getPinnedFields} findPinnedField={findPinnedField} onApplyPinnedField={(pinnedField) => applyPinnedFieldValue(actions, pinnedField)} />
        </div>
        <div className={styles.fieldGroup}>
          <SnowLookupField label="Assignment Group" tableName="sys_user_group" value={basicInfo.assignmentGroup} onChange={(ref) => handleBasicInfoChange('assignmentGroup', ref)} />
          <FieldControls fieldKey={ASSIGNMENT_GROUP_PIN_KEY} fieldLabel="Assignment Group" fieldSection={PIN_SECTION_CHANGE_DETAILS} fieldValue={basicInfo.assignmentGroup} shouldShowSaveButton={shouldShowSaveButtons} upsertPin={upsertPin} removePin={removePin} getPinnedFields={getPinnedFields} findPinnedField={findPinnedField} onApplyPinnedField={(pinnedField) => applyPinnedFieldValue(actions, pinnedField)} />
        </div>
        <div className={styles.fieldGroup}>
          <SnowLookupField label="Assigned To" tableName="sys_user" value={basicInfo.assignedTo} onChange={(ref) => handleBasicInfoChange('assignedTo', ref)} />
          <FieldControls fieldKey={ASSIGNED_TO_PIN_KEY} fieldLabel="Assigned To" fieldSection={PIN_SECTION_CHANGE_DETAILS} fieldValue={basicInfo.assignedTo} shouldShowSaveButton={shouldShowSaveButtons} upsertPin={upsertPin} removePin={removePin} getPinnedFields={getPinnedFields} findPinnedField={findPinnedField} onApplyPinnedField={(pinnedField) => applyPinnedFieldValue(actions, pinnedField)} />
        </div>
        <div className={styles.fieldGroup}>
          <SnowLookupField label="Change Manager" tableName="sys_user" value={basicInfo.changeManager} onChange={(ref) => handleBasicInfoChange('changeManager', ref)} />
          <FieldControls fieldKey={CHANGE_MANAGER_PIN_KEY} fieldLabel="Change Manager" fieldSection={PIN_SECTION_CHANGE_DETAILS} fieldValue={basicInfo.changeManager} shouldShowSaveButton={shouldShowSaveButtons} upsertPin={upsertPin} removePin={removePin} getPinnedFields={getPinnedFields} findPinnedField={findPinnedField} onApplyPinnedField={(pinnedField) => applyPinnedFieldValue(actions, pinnedField)} />
        </div>
        <div className={styles.fieldGroup}>
          <SnowLookupField label="Tester" tableName="sys_user" value={basicInfo.tester} onChange={(ref) => handleBasicInfoChange('tester', ref)} />
          <FieldControls fieldKey={TESTER_PIN_KEY} fieldLabel="Tester" fieldSection={PIN_SECTION_CHANGE_DETAILS} fieldValue={basicInfo.tester} shouldShowSaveButton={shouldShowSaveButtons} upsertPin={upsertPin} removePin={removePin} getPinnedFields={getPinnedFields} findPinnedField={findPinnedField} onApplyPinnedField={(pinnedField) => applyPinnedFieldValue(actions, pinnedField)} />
        </div>
        <div className={styles.fieldGroup}>
          <SnowLookupField label="Service Manager" tableName="sys_user" value={basicInfo.serviceManager} onChange={(ref) => handleBasicInfoChange('serviceManager', ref)} />
          <FieldControls fieldKey={SERVICE_MANAGER_PIN_KEY} fieldLabel="Service Manager" fieldSection={PIN_SECTION_CHANGE_DETAILS} fieldValue={basicInfo.serviceManager} shouldShowSaveButton={shouldShowSaveButtons} upsertPin={upsertPin} removePin={removePin} getPinnedFields={getPinnedFields} findPinnedField={findPinnedField} onApplyPinnedField={(pinnedField) => applyPinnedFieldValue(actions, pinnedField)} />
        </div>
      </div>

      <div className={styles.fieldGroup}>
        <label className={`${styles.fieldGroup} ${styles.inlineCheckbox}`}>
          <input
            checked={basicInfo.isExpedited}
            onChange={(event) => handleBasicInfoChange('isExpedited', event.target.checked)}
            type="checkbox"
          />
          <span>Expedited Change</span>
        </label>
        <FieldControls fieldKey={IS_EXPEDITED_PIN_KEY} fieldLabel="Expedited Change" fieldSection={PIN_SECTION_CHANGE_DETAILS} fieldValue={basicInfo.isExpedited} shouldShowSaveButton={shouldShowSaveButtons} upsertPin={upsertPin} removePin={removePin} getPinnedFields={getPinnedFields} findPinnedField={findPinnedField} onApplyPinnedField={(pinnedField) => applyPinnedFieldValue(actions, pinnedField)} />
      </div>

      {shouldShowNavigation ? (
        <div className={styles.buttonRow}>
          <button className={styles.linkButton} onClick={() => actions.goToStep(2)} type="button">
            Back
          </button>
          <button className={styles.primaryButton} onClick={() => actions.goToStep(4)} type="button">
            Next: Planning
          </button>
        </div>
      ) : null}
    </section>
  );
}

function PlanningStep({
  state,
  actions,
  isRovoUnlocked,
  onEnhanceWithRovo,
  choiceOptions,
  isLoadingChoices,
  isFetchFailed,
  isRelayConnected,
  hasRelaySessionToken,
  retryFetch,
  fetchErrorMessage,
  upsertPin,
  removePin,
  getPinnedFields,
  findPinnedField,
  headingStep,
  shouldShowNavigation = true,
  shouldShowSaveButtons = true,
}: CrgStepProps & PlanningStepExtras & StepRenderOptions) {
  function handleGeneratedFieldChange(fieldName: GeneratedFieldName, event: ChangeEvent<HTMLTextAreaElement>): void {
    actions.updateGeneratedField(fieldName, event.target.value);
  }

  function handleAssessmentChange(
    fieldKey: keyof ChgPlanningAssessment,
    value: string,
  ): void {
    actions.setChgPlanningAssessment({ [fieldKey]: value } as Partial<ChgPlanningAssessment>);
  }

  function handlePlanningContentChange(
    fieldKey: keyof ChgPlanningContent,
    event: ChangeEvent<HTMLTextAreaElement>,
  ): void {
    actions.setChgPlanningContent({ [fieldKey]: event.target.value } as Partial<ChgPlanningContent>);
  }

  const { chgPlanningAssessment: assessment, chgPlanningContent: planContent } = state;
  const shouldUseManualPlanningInputs = PLANNING_ASSESSMENT_ROWS.some((row) => (
    shouldRenderManualChoiceInput({
      options: choiceOptions[row.snowFieldName] ?? [],
      isLoadingChoices,
      isFetchFailed,
      isRelayConnected,
      hasRelaySessionToken,
    })
  ));

  return (
    <section className={styles.section}>
      <StepHeading currentStep={headingStep ?? state.currentStep} />

      {/* Choice availability warning — mirrors the logic in ChangeDetailsStep. */}
      {!isRelayConnected && !isFetchFailed ? (
        <p className={styles.choiceUnavailableWarning} role="alert">
          ⚠ SNow relay not connected — dropdown options will load automatically once connected.
        </p>
      ) : isRelayConnected && !hasRelaySessionToken && !isFetchFailed ? (
        <p className={styles.choiceUnavailableWarning} role="alert">
          ⚠ SNow relay is connected, but ServiceNow has not exposed the session token yet. Wait for the SNow page
          to fully load, then click the latest NodeToolbox SNow Relay bookmarklet again.
        </p>
      ) : isFetchFailed ? (
        <p className={styles.choiceUnavailableWarning} role="alert">
          ⚠ Failed to load dropdown options from SNow
          {fetchErrorMessage ? `: ${fetchErrorMessage}` : '.'}{' '}
          <button className={styles.linkButton} onClick={retryFetch} type="button">Retry</button>
          {fetchErrorMessage ? (
            <span className={styles.errorHint}>
              {resolveSnowFetchErrorHint(fetchErrorMessage)}
            </span>
          ) : null}
        </p>
      ) : null}

      {/* Planning assessment fields — use live SNow choices when available, otherwise preserve cloned values. */}
      {shouldUseManualPlanningInputs ? (
        <p className={styles.panelHint}>
          Live planning choices are unavailable. Type the internal ServiceNow values or choose one of the saved options shown inline on each field.
        </p>
      ) : null}
      <div className={styles.assessmentGrid}>
        {PLANNING_ASSESSMENT_ROWS.map((row) => {
          const rowOptions = choiceOptions[row.snowFieldName] ?? [];
          const currentAssessmentValue = assessment[row.fieldKey];
          const renderedRowOptions = buildRenderedChoiceOptions(rowOptions, currentAssessmentValue);
          const planningPinKey = resolvePlanningAssessmentPinKey(row.fieldKey);
          const shouldUseManualInput = shouldRenderManualChoiceInput({
            options: rowOptions,
            isLoadingChoices,
            isFetchFailed,
            isRelayConnected,
            hasRelaySessionToken,
          });

          return (
            <div className={styles.fieldGroup} key={row.fieldKey}>
              <label className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>{row.label}</span>
                {shouldUseManualInput ? (
                  <input
                    className={styles.input}
                    onChange={(event) => handleAssessmentChange(row.fieldKey, event.target.value)}
                    placeholder={SHORT_MANUAL_VALUE_PLACEHOLDER}
                    value={currentAssessmentValue}
                  />
                ) : (
                  <select
                    className={styles.input}
                    disabled={isLoadingChoices}
                    onChange={(event) => handleAssessmentChange(row.fieldKey, event.target.value)}
                    value={resolveStoredChoiceValue(currentAssessmentValue, renderedRowOptions)}
                  >
                    {isLoadingChoices ? (
                      <option disabled value="">Loading options…</option>
                    ) : (
                      renderedRowOptions.map((option) => (
                        <option key={`${option.value}-${option.label}`} value={option.value}>{option.label || 'Select…'}</option>
                      ))
                    )}
                  </select>
                )}
              </label>
              <FieldControls
                fieldKey={planningPinKey}
                fieldLabel={row.label}
                fieldSection={PIN_SECTION_PLANNING}
                fieldValue={currentAssessmentValue}
                upsertPin={upsertPin}
                removePin={removePin}
                getPinnedFields={getPinnedFields}
                findPinnedField={findPinnedField}
                shouldShowSaveButton={shouldShowSaveButtons}
                onApplyPinnedField={(pinnedField) => applyPinnedFieldValue(actions, pinnedField)}
              />
            </div>
          );
        })}
      </div>

      {/* Long-form planning text areas — standard SNow change_request fields */}
      <div className={styles.editorGrid}>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Implementation Plan</span>
          <textarea
            className={styles.textArea}
            onChange={(event) => handlePlanningContentChange('implementationPlan', event)}
            value={planContent.implementationPlan}
          />
        </label>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Backout Plan</span>
          <textarea
            className={styles.textArea}
            onChange={(event) => handlePlanningContentChange('backoutPlan', event)}
            value={planContent.backoutPlan}
          />
        </label>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Test Plan</span>
          <textarea
            className={styles.textArea}
            onChange={(event) => handlePlanningContentChange('testPlan', event)}
            value={planContent.testPlan}
          />
        </label>

        {/* Generated Jira-sourced content — editable before final submission */}
        {GENERATED_FIELD_DEFINITIONS.map((fieldDefinition) => (
          <label className={styles.fieldGroup} key={fieldDefinition.key}>
            <span className={styles.fieldLabel}>{fieldDefinition.label}</span>
            <textarea
              className={styles.textArea}
              onChange={(event) => handleGeneratedFieldChange(fieldDefinition.key, event)}
              value={state[fieldDefinition.valueKey]}
            />
          </label>
        ))}
      </div>

      {isRovoUnlocked ? (
        <div className={styles.rovoRow}>
          <button
            className={styles.rovoButton}
            onClick={onEnhanceWithRovo}
            title="Generate a prompt to enhance content with Rovo AI"
            type="button"
          >
            ✦ Enhance with AI
          </button>
        </div>
      ) : null}

      {shouldShowNavigation ? (
        <div className={styles.buttonRow}>
          <button className={styles.linkButton} onClick={() => actions.goToStep(3)} type="button">
            Back
          </button>
          <button className={styles.primaryButton} onClick={() => actions.goToStep(5)} type="button">
            Next: Environments
          </button>
        </div>
      ) : null}
    </section>
  );
}

function EnvironmentStep({
  state,
  actions,
  choiceOptions,
  isLoadingChoices,
  isFetchFailed,
  isRelayConnected,
  hasRelaySessionToken,
  upsertPin,
  removePin,
  getPinnedFields,
  findPinnedField,
  headingStep,
  shouldShowNavigation = true,
  shouldShowSaveButtons = true,
}: CrgStepProps & EnvironmentStepExtras & StepRenderOptions) {
  const environmentOptions = choiceOptions['u_environment'] ?? [];
  const shouldUseManualEnvironmentInput = shouldRenderManualChoiceInput({
    options: environmentOptions,
    isLoadingChoices,
    isFetchFailed,
    isRelayConnected,
    hasRelaySessionToken,
  });

  function handleEnvironmentToggle(environmentKey: EnvironmentKey, event: ChangeEvent<HTMLInputElement>): void {
    const nextSelections: EnvironmentSelectionState = {
      rel:  state.relEnvironment.isEnabled,
      prd:  state.prdEnvironment.isEnabled,
      pfix: state.pfixEnvironment.isEnabled,
    };
    nextSelections[environmentKey] = event.target.checked;
    const suggestedEnvironmentValue = resolveSuggestedEnvironmentValue(environmentOptions, nextSelections);

    actions.updateEnvironment(environmentKey, { isEnabled: event.target.checked });
    if (suggestedEnvironmentValue !== null && suggestedEnvironmentValue !== state.chgBasicInfo.environment) {
      actions.setChgBasicInfo({ environment: suggestedEnvironmentValue });
    }
  }

  function handleEnvironmentDateChange(
    environmentKey: EnvironmentKey,
    fieldName: 'plannedStartDate' | 'plannedEndDate',
    event: ChangeEvent<HTMLInputElement>,
  ): void {
    const environmentUpdate = fieldName === 'plannedStartDate'
      ? { plannedStartDate: event.target.value }
      : { plannedEndDate: event.target.value };

    actions.updateEnvironment(environmentKey, environmentUpdate);
  }

  function handleEnvironmentConfigItemChange(environmentKey: EnvironmentKey, configItem: SnowReference): void {
    actions.updateEnvironment(environmentKey, { configItem });
  }

  return (
    <section className={styles.section}>
      <StepHeading currentStep={headingStep ?? state.currentStep} />
      <div className={styles.environmentMappingPanel}>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>ServiceNow Environment</span>
            {shouldUseManualEnvironmentInput ? (
              <input
                aria-label="ServiceNow Environment"
                className={styles.input}
                onChange={(event) => actions.setChgBasicInfo({ environment: event.target.value })}
                placeholder={SHORT_MANUAL_VALUE_PLACEHOLDER}
                value={state.chgBasicInfo.environment}
              />
            ) : (
              <select
                aria-label="ServiceNow Environment"
                className={styles.input}
                disabled={isLoadingChoices}
                onChange={(event) => actions.setChgBasicInfo({ environment: event.target.value })}
                value={resolveStoredChoiceValue(
                  state.chgBasicInfo.environment,
                  buildRenderedChoiceOptions(environmentOptions, state.chgBasicInfo.environment),
                )}
              >
                {isLoadingChoices ? (
                  <option disabled value="">Loading options…</option>
                ) : (
                  buildRenderedChoiceOptions(environmentOptions, state.chgBasicInfo.environment).map((option) => (
                    <option key={`${option.value}-${option.label}`} value={option.value}>{option.label || 'Select…'}</option>
                  ))
                )}
              </select>
            )}
          </label>
          <FieldControls
            fieldKey={ENVIRONMENT_VALUE_PIN_KEY}
            fieldLabel="ServiceNow Environment"
            fieldSection={PIN_SECTION_ENVIRONMENTS}
            fieldValue={state.chgBasicInfo.environment}
            upsertPin={upsertPin}
            removePin={removePin}
            getPinnedFields={getPinnedFields}
            findPinnedField={findPinnedField}
            shouldShowSaveButton={shouldShowSaveButtons}
            onApplyPinnedField={(pinnedField) => applyPinnedFieldValue(actions, pinnedField)}
          />
        </div>
        <p className={styles.panelHint}>
          {shouldUseManualEnvironmentInput
            ? 'Live SNow environment choices are unavailable. Type the internal value or choose one of the saved options shown inline below.'
            : 'This maps the selected deployment environments below to the single SNow Environment field sent on create.'}
        </p>
      </div>
      <div className={styles.environmentCardGrid}>
        {ENVIRONMENT_ROW_DEFINITIONS.map((environmentRow) => {
          const environmentState = state[environmentRow.stateKey];
          const isDateInputDisabled = !environmentState.isEnabled;
          const configItemPinKey = resolveEnvironmentConfigItemPinKey(environmentRow.key);

          return (
            <section className={styles.environmentCard} key={environmentRow.key}>
              <div className={styles.environmentCardHeader}>
                <h4 className={styles.panelSectionTitle}>{environmentRow.label}</h4>
                <label className={styles.inlineCheckbox}>
                  <input
                    aria-label={`${environmentRow.label} enabled`}
                    checked={environmentState.isEnabled}
                    onChange={(event) => handleEnvironmentToggle(environmentRow.key, event)}
                    type="checkbox"
                  />
                  <span>Enabled</span>
                </label>
              </div>

              <div className={styles.fieldGroup}>
                <SnowLookupField
                  label={`${environmentRow.label} Config Item`}
                  tableName="cmdb_ci"
                  value={environmentState.configItem}
                  onChange={(configItem) => handleEnvironmentConfigItemChange(environmentRow.key, configItem)}
                />
                <FieldControls
                  fieldKey={configItemPinKey}
                  fieldLabel={`${environmentRow.label} Config Item`}
                  fieldSection={PIN_SECTION_ENVIRONMENTS}
                  fieldValue={environmentState.configItem}
                  upsertPin={upsertPin}
                  removePin={removePin}
                  getPinnedFields={getPinnedFields}
                  findPinnedField={findPinnedField}
                  shouldShowSaveButton={shouldShowSaveButtons}
                  onApplyPinnedField={(pinnedField) => applyPinnedFieldValue(actions, pinnedField)}
                />
              </div>

              <div className={styles.fieldGrid}>
                <label className={styles.fieldGroup}>
                  <span className={styles.fieldLabel}>Planned Start</span>
                  <input
                    className={styles.input}
                    disabled={isDateInputDisabled}
                    onChange={(event) => handleEnvironmentDateChange(environmentRow.key, 'plannedStartDate', event)}
                    type="datetime-local"
                    value={environmentState.plannedStartDate}
                  />
                </label>
                <label className={styles.fieldGroup}>
                  <span className={styles.fieldLabel}>Planned End</span>
                  <input
                    className={styles.input}
                    disabled={isDateInputDisabled}
                    onChange={(event) => handleEnvironmentDateChange(environmentRow.key, 'plannedEndDate', event)}
                    type="datetime-local"
                    value={environmentState.plannedEndDate}
                  />
                </label>
              </div>
            </section>
          );
        })}
      </div>
      {shouldShowNavigation ? (
        <div className={styles.buttonRow}>
          <button className={styles.linkButton} onClick={() => actions.goToStep(4)} type="button">
            Back
          </button>
          <button className={styles.primaryButton} onClick={() => actions.goToStep(6)} type="button">
            Preview Results
          </button>
        </div>
      ) : null}
    </section>
  );
}

function buildEnvironmentSummary(state: CrgStateData): string[] {
  return ENVIRONMENT_ROW_DEFINITIONS.map((environmentRow) => {
    const environmentState = state[environmentRow.stateKey];
    const scheduleSummary = environmentState.plannedStartDate && environmentState.plannedEndDate
      ? `${environmentState.plannedStartDate} → ${environmentState.plannedEndDate}`
      : EMPTY_ENVIRONMENT_DATES;
    const configItemSummary = environmentState.configItem.displayName || environmentState.configItem.sysId || 'No Config Item';

    return `${environmentRow.label}: ${environmentState.isEnabled ? 'Enabled' : 'Disabled'} — ${scheduleSummary} — Config Item: ${configItemSummary}`;
  });
}

function buildConsolidatedResult(state: CrgStateData): string {
  const environmentSummary = buildEnvironmentSummary(state).join('\n');

  return [
    `Short Description: ${state.generatedShortDescription}`,
    '',
    'Description:',
    state.generatedDescription,
    '',
    'Justification:',
    state.generatedJustification,
    '',
    'Risk & Impact:',
    state.generatedRiskImpact,
    '',
    'Environments:',
    environmentSummary,
  ].join('\n');
}

function CtaskTemplatePanel({ state, actions, templates, saveTemplate, updateTemplate, deleteTemplate }: CrgStepProps & CtaskTemplateExtras) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [isEditorVisible, setIsEditorVisible] = useState<boolean>(false);
  const [templateName, setTemplateName] = useState<string>('');
  const [ctaskDraft, setCtaskDraft] = useState<CtaskTemplateData>(() => createEmptyCtaskTemplateData());
  const [appendChgNumber, setAppendChgNumber] = useState<string>('');
  const [ctaskCloneNumber, setCtaskCloneNumber] = useState<string>('');
  const [isCloningCtask, setIsCloningCtask] = useState<boolean>(false);
  const [ctaskCloneError, setCtaskCloneError] = useState<string | null>(null);
  const [ctaskCloneStatus, setCtaskCloneStatus] = useState<string | null>(null);
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);

  useEffect(() => {
    if (!selectedTemplate) return;
    setTemplateName(selectedTemplate.name);
    setCtaskDraft(buildCtaskTemplateData(selectedTemplate));
  }, [selectedTemplate]);

  function handleStringFieldChange(
    fieldName: keyof Pick<
      CtaskTemplateData,
      'shortDescription' | 'description' | 'plannedStartDate' | 'plannedEndDate' | 'closeNotes'
    >,
    value: string,
  ): void {
    setCtaskDraft((previousDraft) => ({ ...previousDraft, [fieldName]: value }));
  }

  function handleSaveTemplate(): void {
    saveTemplate(templateName, ctaskDraft);
    setTemplateName('');
    setCtaskDraft(createEmptyCtaskTemplateData());
    setIsEditorVisible(false);
  }

  function handleUpdateTemplate(): void {
    if (selectedTemplateId) updateTemplate(selectedTemplateId, ctaskDraft);
  }

  function handleAppendTasks(): void {
    void actions.appendTasksToExistingChg(appendChgNumber.trim().toUpperCase());
  }

  async function handleCloneCtaskTemplate(): Promise<void> {
    const normalizedCtaskNumber = ctaskCloneNumber.trim().toUpperCase();
    if (!normalizedCtaskNumber) {
      setCtaskCloneError('Enter a CTASK number before cloning a template.');
      setCtaskCloneStatus(null);
      return;
    }

    setIsCloningCtask(true);
    setCtaskCloneError(null);
    setCtaskCloneStatus(null);

    try {
      const clonedTemplateData = await actions.cloneCtaskTemplate(normalizedCtaskNumber);
      setSelectedTemplateId('');
      setTemplateName(clonedTemplateData.shortDescription || normalizedCtaskNumber);
      setCtaskDraft(clonedTemplateData);
      setIsEditorVisible(true);
      setCtaskCloneNumber(normalizedCtaskNumber);
      setCtaskCloneStatus(`${normalizedCtaskNumber} loaded into the CTASK template editor.`);
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Failed to clone CTASK template.';
      setCtaskCloneError(errorMessage);
    } finally {
      setIsCloningCtask(false);
    }
  }

  return (
    <div className={styles.clonePanel}>
      <h4 className={styles.panelSectionTitle}>CTASK Templates</h4>
      <p className={styles.panelHint}>Add reusable Change Tasks to this CHG, or append the selected CTASKs to an existing CHG.</p>
      <div className={styles.cloneInputRow}>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Existing CTASK for template clone</span>
          <input
            aria-label="Existing CTASK for template clone"
            className={styles.input}
            disabled={isCloningCtask}
            onChange={(event) => setCtaskCloneNumber(event.target.value.toUpperCase())}
            placeholder="CTASK0001234"
            value={ctaskCloneNumber}
          />
        </label>
        <button
          className={styles.secondaryButton}
          disabled={isCloningCtask}
          onClick={() => void handleCloneCtaskTemplate()}
          type="button"
        >
          {isCloningCtask ? 'Loading CTASK…' : 'Load CTASK as Template'}
        </button>
      </div>
      {ctaskCloneError ? <p className={styles.errorText} role="alert">{ctaskCloneError}</p> : null}
      {ctaskCloneStatus ? <p className={styles.successText} role="status">{ctaskCloneStatus}</p> : null}
      <div className={styles.cloneInputRow}>
        <select
          aria-label="Select CTASK template"
          className={styles.input}
          onChange={(event) => setSelectedTemplateId(event.target.value)}
          value={selectedTemplateId}
        >
          <option value="">Select a CTASK template…</option>
          {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
        <button className={styles.secondaryButton} disabled={!selectedTemplate} onClick={() => selectedTemplate && actions.addChangeTask(selectedTemplate)} type="button">
          Add CTASK to Change
        </button>
        <button className={styles.secondaryButton} disabled={!selectedTemplateId} onClick={handleUpdateTemplate} type="button">
          Update selected
        </button>
        <button className={styles.linkButton} disabled={!selectedTemplateId} onClick={() => deleteTemplate(selectedTemplateId)} type="button">
          Delete
        </button>
      </div>

      <button className={styles.linkButton} onClick={() => setIsEditorVisible((wasVisible) => !wasVisible)} type="button">
        + Create CTASK template
      </button>
      {isEditorVisible ? (
        <div className={styles.ctaskEditorGrid}>
          <label className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>CTASK template name</span>
            <input aria-label="CTASK template name" className={styles.input} onChange={(event) => setTemplateName(event.target.value)} value={templateName} />
          </label>
          <label className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>CTASK short description</span>
            <input aria-label="CTASK short description" className={styles.input} onChange={(event) => handleStringFieldChange('shortDescription', event.target.value)} value={ctaskDraft.shortDescription} />
          </label>
          <label className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>CTASK description</span>
            <textarea className={styles.textArea} onChange={(event) => handleStringFieldChange('description', event.target.value)} value={ctaskDraft.description} />
          </label>
          <SnowLookupField label="CTASK Assignment Group" tableName="sys_user_group" value={ctaskDraft.assignmentGroup} onChange={(assignmentGroup) => setCtaskDraft((previousDraft) => ({ ...previousDraft, assignmentGroup }))} />
          <SnowLookupField label="CTASK Assigned To" tableName="sys_user" value={ctaskDraft.assignedTo} onChange={(assignedTo) => setCtaskDraft((previousDraft) => ({ ...previousDraft, assignedTo }))} />
          <label className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>CTASK planned start</span>
            <input className={styles.input} onChange={(event) => handleStringFieldChange('plannedStartDate', event.target.value)} type="datetime-local" value={ctaskDraft.plannedStartDate} />
          </label>
          <label className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>CTASK planned end</span>
            <input className={styles.input} onChange={(event) => handleStringFieldChange('plannedEndDate', event.target.value)} type="datetime-local" value={ctaskDraft.plannedEndDate} />
          </label>
          <label className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>CTASK close notes</span>
            <textarea className={styles.textArea} onChange={(event) => handleStringFieldChange('closeNotes', event.target.value)} value={ctaskDraft.closeNotes} />
          </label>
          <button className={styles.primaryButton} onClick={handleSaveTemplate} type="button">Save CTASK Template</button>
        </div>
      ) : null}

      <div className={styles.ctaskList}>
        {state.changeTasks.length === 0 ? (
          <p className={styles.panelHint}>No CTASKs selected for this change.</p>
        ) : state.changeTasks.map((task) => (
          <div className={styles.ctaskCard} key={task.id}>
            <strong>{task.shortDescription || task.name}</strong>
            <span>{task.assignmentGroup.displayName || 'No assignment group selected'}</span>
            <button className={styles.linkButton} onClick={() => actions.removeChangeTask(task.id)} type="button" aria-label={`Remove CTASK ${task.shortDescription || task.name}`}>
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className={styles.cloneInputRow}>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Existing CHG for CTASK append</span>
          <input aria-label="Existing CHG for CTASK append" className={styles.input} onChange={(event) => setAppendChgNumber(event.target.value.toUpperCase())} placeholder="CHG0001234" value={appendChgNumber} />
        </label>
        <button className={styles.secondaryButton} disabled={state.changeTasks.length === 0 || state.isSubmitting} onClick={handleAppendTasks} type="button">
          Append CTASKs to Existing CHG
        </button>
      </div>
    </div>
  );
}

function ResultsStep({ state, actions }: CrgStepProps) {
  const consolidatedResult = buildConsolidatedResult(state);
  const hasGeneratedContent = Boolean(state.generatedShortDescription || state.generatedDescription || state.generatedJustification || state.generatedRiskImpact);

  return (
    <section className={styles.section}>
      <StepHeading currentStep={state.currentStep} />
      <div className={styles.summaryCard}>
        <div>
          <h4 className={styles.summaryTitle}>Short Description</h4>
          <p className={styles.summaryText}>{state.generatedShortDescription}</p>
        </div>
        <div>
          <h4 className={styles.summaryTitle}>Description</h4>
          <p className={styles.summaryText}>{state.generatedDescription}</p>
        </div>
        <div>
          <h4 className={styles.summaryTitle}>Justification</h4>
          <p className={styles.summaryText}>{state.generatedJustification}</p>
        </div>
        <div>
          <h4 className={styles.summaryTitle}>Risk & Impact</h4>
          <p className={styles.summaryText}>{state.generatedRiskImpact}</p>
        </div>
        <div>
          <h4 className={styles.summaryTitle}>Environment Plan</h4>
          <ul className={styles.environmentList}>
            {buildEnvironmentSummary(state).map((environmentSummary) => <li key={environmentSummary}>{environmentSummary}</li>)}
          </ul>
        </div>
        <div>
          <h4 className={styles.summaryTitle}>Queued Change Tasks</h4>
          {state.changeTasks.length > 0 ? (
            <ul className={styles.environmentList}>
              {state.changeTasks.map((changeTask) => (
                <li key={changeTask.id}>
                  {changeTask.name}: {changeTask.shortDescription}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.summaryText}>Add CTASK templates from the Configuration tab when this change needs companion tasks.</p>
          )}
        </div>
      </div>
      <label className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>{CONSOLIDATED_RESULT_LABEL}</span>
        <textarea className={styles.textArea} readOnly value={hasGeneratedContent ? consolidatedResult : DEFAULT_RESULT_MESSAGE} />
      </label>
      {state.submitResult ? <p className={styles.successText}>{state.submitResult}</p> : null}
      {state.isSubmitting ? <p className={styles.loadingText}>Submitting change request...</p> : null}
      <div className={styles.buttonRow}>
        <button
          className={styles.primaryButton}
          disabled={state.isSubmitting || !hasGeneratedContent}
          onClick={() => void actions.createChg()}
          type="button"
        >
          {state.isSubmitting ? 'Creating CHG…' : 'Create CHG'}
        </button>
        <button className={styles.secondaryButton} onClick={() => actions.reset()} type="button">
          Start Over
        </button>
      </div>
    </section>
  );
}

function renderCurrentStepPanel(
  state: CrgStateData,
  actions: CrgActionSet,
  planningExtras: PlanningStepExtras,
  changeDetailsExtras: ChangeDetailsExtras,
  environmentExtras: EnvironmentStepExtras,
) {
  if (state.currentStep === 1) {
    return <FetchIssuesStep actions={actions} state={state} />;
  }

  if (state.currentStep === 2) {
    return <ReviewIssuesStep actions={actions} state={state} />;
  }

  if (state.currentStep === 3) {
    return <ChangeDetailsStep actions={actions} state={state} {...changeDetailsExtras} shouldShowSaveButtons={false} />;
  }

  if (state.currentStep === 4) {
    return <PlanningStep actions={actions} state={state} {...planningExtras} shouldShowSaveButtons={false} />;
  }

  if (state.currentStep === 5) {
    return <EnvironmentStep actions={actions} state={state} {...environmentExtras} shouldShowSaveButtons={false} />;
  }

  return <ResultsStep actions={actions} state={state} />;
}

export interface CrgTabProps {
  mode?: 'wizard' | 'configuration';
}

/**
 * Renders the Change Request Generator so release managers can turn Jira release scope into a
 * comprehensive six-step ServiceNow Change Request with all required fields.
 * A hidden AI assist mode is available via keyboard shortcut for enhanced content generation.
 */
export default function CrgTab({ mode = 'wizard' }: CrgTabProps) {
  const { state, actions } = useCrgState();
  const { isUnlocked, verifyPassphrase, buildPrompt } = useRovoAssist();
  const { templates, saveTemplate, updateTemplate, deleteTemplate } = useCrgTemplates();
  const { pinnedFields, upsertPin, removePin, clearPins, getPinnedFields, findPinnedField } = useCrgFieldPins();
  const ctaskTemplates = useCtaskTemplates();
  const {
    choiceOptions,
    isLoadingChoices,
    isFetchFailed,
    isRelayConnected,
    hasRelaySessionToken,
    retryFetch,
    fetchErrorMessage,
  } = useSnowChoiceOptions();

  // Modal visibility and passphrase input state for the hidden activation flow.
  const [isPassphraseModalVisible, setIsPassphraseModalVisible] = useState(false);
  const [passphraseInput, setPassphraseInput] = useState('');
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const passphraseInputRef = useRef<HTMLInputElement>(null);

  // Prompt modal state — holds the generated prompt text the user pastes into Rovo.
  const [rovoPrompt, setRovoPrompt] = useState<string | null>(null);

  const issueCountSummary = useMemo(() => {
    if (mode === 'configuration') {
      return CONFIGURATION_SUMMARY;
    }
    return `${state.fetchedIssues.length} issue(s) loaded`;
  }, [mode, state.fetchedIssues.length]);

  useEffect(() => {
    const categoryOptions = choiceOptions['category'] ?? [];
    const changeTypeOptions = choiceOptions['type'] ?? [];
    const environmentOptions = choiceOptions['u_environment'] ?? [];
    const normalizedBasicInfo: Partial<ChgBasicInfo> = {};

    const normalizedCategory = resolveStoredChoiceValue(state.chgBasicInfo.category, categoryOptions);
    const normalizedChangeType = resolveStoredChoiceValue(state.chgBasicInfo.changeType, changeTypeOptions);
    const normalizedEnvironment = resolveStoredChoiceValue(state.chgBasicInfo.environment, environmentOptions);

    if (normalizedCategory !== state.chgBasicInfo.category) normalizedBasicInfo.category = normalizedCategory;
    if (normalizedChangeType !== state.chgBasicInfo.changeType) normalizedBasicInfo.changeType = normalizedChangeType;
    if (normalizedEnvironment !== state.chgBasicInfo.environment) normalizedBasicInfo.environment = normalizedEnvironment;

    if (Object.keys(normalizedBasicInfo).length > 0) {
      actions.setChgBasicInfo(normalizedBasicInfo);
    }

    const normalizedPlanningAssessment: Partial<ChgPlanningAssessment> = {};
    for (const row of PLANNING_ASSESSMENT_ROWS) {
      const rowOptions = choiceOptions[row.snowFieldName] ?? [];
      const currentValue = state.chgPlanningAssessment[row.fieldKey];
      const normalizedValue = resolveStoredChoiceValue(currentValue, rowOptions);
      if (normalizedValue !== currentValue) {
        normalizedPlanningAssessment[row.fieldKey] = normalizedValue;
      }
    }

    if (Object.keys(normalizedPlanningAssessment).length > 0) {
      actions.setChgPlanningAssessment(normalizedPlanningAssessment);
    }
  }, [
    actions,
    choiceOptions,
    state.chgBasicInfo.category,
    state.chgBasicInfo.changeType,
    state.chgBasicInfo.environment,
    state.chgPlanningAssessment,
    state.chgPlanningAssessment.impact,
    state.chgPlanningAssessment.systemAvailabilityImplication,
    state.chgPlanningAssessment.hasBeenTested,
    state.chgPlanningAssessment.impactedPersonsAware,
    state.chgPlanningAssessment.hasBeenPerformedPreviously,
    state.chgPlanningAssessment.successProbability,
    state.chgPlanningAssessment.canBeBackedOut,
  ]);

  // Listen for the hidden activation key combination: Ctrl+Alt+Z.
  // Only shows the modal when Rovo is not already unlocked.
  useEffect(() => {
    function handleGlobalKeyDown(keyboardEvent: globalThis.KeyboardEvent): void {
      if (keyboardEvent.ctrlKey && keyboardEvent.altKey && keyboardEvent.key === 'z' && !isUnlocked) {
        keyboardEvent.preventDefault();
        setIsPassphraseModalVisible(true);
        setPassphraseInput('');
        setPassphraseError(null);
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [isUnlocked]);

  // Auto-focus the passphrase input each time the modal becomes visible.
  useEffect(() => {
    if (isPassphraseModalVisible) {
      passphraseInputRef.current?.focus();
    }
  }, [isPassphraseModalVisible]);

  const handlePassphraseSubmit = useCallback(async () => {
    const isAccepted = await verifyPassphrase(passphraseInput);

    if (isAccepted) {
      setIsPassphraseModalVisible(false);
      setPassphraseInput('');
    } else {
      setPassphraseError('Incorrect passphrase');
    }
  }, [passphraseInput, verifyPassphrase]);

  const handlePassphraseKeyDown = useCallback((keyboardEvent: KeyboardEvent<HTMLInputElement>) => {
    if (keyboardEvent.key === 'Enter') {
      void handlePassphraseSubmit();
    } else if (keyboardEvent.key === 'Escape') {
      setIsPassphraseModalVisible(false);
    }
  }, [handlePassphraseSubmit]);

  const handleEnhanceWithRovo = useCallback(() => {
    const selectedIssues = state.fetchedIssues.filter((issue) =>
      state.selectedIssueKeys.has(issue.key),
    );

    const currentFields = {
      shortDescription: state.generatedShortDescription,
      description:      state.generatedDescription,
      justification:    state.generatedJustification,
      riskImpact:       state.generatedRiskImpact,
    };

    const promptText = buildPrompt(selectedIssues, currentFields);
    setRovoPrompt(promptText);
  }, [state, buildPrompt]);

  const planningExtras: PlanningStepExtras = {
    isRovoUnlocked:    isUnlocked,
    onEnhanceWithRovo: handleEnhanceWithRovo,
    choiceOptions,
    isLoadingChoices,
    isFetchFailed,
    isRelayConnected,
    hasRelaySessionToken,
    retryFetch,
    fetchErrorMessage,
    upsertPin,
    removePin,
    getPinnedFields,
    findPinnedField,
  };

  const environmentExtras: EnvironmentStepExtras = {
    choiceOptions,
    isLoadingChoices,
    isFetchFailed,
    isRelayConnected,
    hasRelaySessionToken,
    upsertPin,
    removePin,
    getPinnedFields,
    findPinnedField,
  };

  const changeDetailsExtras: ChangeDetailsExtras = {
    choiceOptions,
    isLoadingChoices,
    isFetchFailed,
    isRelayConnected,
    hasRelaySessionToken,
    retryFetch,
    fetchErrorMessage,
    upsertPin,
    removePin,
    getPinnedFields,
    findPinnedField,
  };

  const workspaceExtras: CrgWorkspaceExtras = {
    templates,
    saveTemplate,
    updateTemplate,
    deleteTemplate,
    pinnedFields,
    upsertPin,
    removePin,
    clearPins,
    getPinnedFields,
    findPinnedField,
  };

  const ctaskTemplateExtras: CtaskTemplateExtras = {
    templates:      ctaskTemplates.templates,
    saveTemplate:   ctaskTemplates.saveTemplate,
    updateTemplate: ctaskTemplates.updateTemplate,
    deleteTemplate: ctaskTemplates.deleteTemplate,
  };

  const tabTitle = mode === 'configuration' ? CONFIGURATION_TAB_TITLE : TAB_TITLE;
  const tabSubtitle = mode === 'configuration' ? CONFIGURATION_TAB_SUBTITLE : TAB_SUBTITLE;
  const shouldShowWizardChrome = mode === 'wizard';

  return (
    <div className={styles.tabPanel}>
      <header className={styles.tabHeader}>
        <div>
          <h2 className={styles.tabTitle}>{tabTitle}</h2>
          <p className={styles.tabSubtitle}>{tabSubtitle}</p>
        </div>
        <p className={styles.summaryPill}>{issueCountSummary}</p>
      </header>
      {shouldShowWizardChrome ? <StepIndicator currentStep={state.currentStep} /> : null}
      {mode === 'configuration' ? (
        <>
          <CrgWorkspacePanel actions={actions} state={state} {...workspaceExtras} />
          <ChangeDetailsStep actions={actions} state={state} {...changeDetailsExtras} headingStep={3} shouldShowNavigation={false} />
          <PlanningStep actions={actions} state={state} {...planningExtras} headingStep={4} shouldShowNavigation={false} />
          <EnvironmentStep actions={actions} state={state} {...environmentExtras} headingStep={5} shouldShowNavigation={false} />
          <CtaskTemplatePanel actions={actions} state={state} {...ctaskTemplateExtras} />
        </>
      ) : (
        renderCurrentStepPanel(state, actions, planningExtras, changeDetailsExtras, environmentExtras)
      )}

      {/* Hidden passphrase modal — only visible after Ctrl+Alt+Z, never in documentation */}
      {isPassphraseModalVisible ? (
        <div className={styles.passphraseOverlay}>
          <div className={styles.passphraseModal}>
            <input
              className={styles.passphraseInput}
              onChange={(event) => setPassphraseInput(event.target.value)}
              onKeyDown={handlePassphraseKeyDown}
              placeholder="Enter passphrase"
              ref={passphraseInputRef}
              type="password"
              value={passphraseInput}
            />
            {passphraseError ? <p className={styles.passphraseError}>{passphraseError}</p> : null}
            <div className={styles.passphraseActions}>
              <button
                className={styles.primaryButton}
                onClick={() => void handlePassphraseSubmit()}
                type="button"
              >
                Unlock
              </button>
              <button
                className={styles.linkButton}
                onClick={() => setIsPassphraseModalVisible(false)}
                type="button"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Prompt modal — shows the generated Rovo prompt for copy/paste */}
      {rovoPrompt !== null ? (
        <div className={styles.passphraseOverlay}>
          <div className={styles.promptModal}>
            <p className={styles.promptInstructions}>
              Copy this prompt and paste it into Rovo to generate the four CHG field values.
            </p>
            <textarea
              className={styles.promptTextArea}
              readOnly
              value={rovoPrompt}
            />
            <div className={styles.promptActions}>
              <button
                className={styles.rovoButton}
                onClick={() => void navigator.clipboard.writeText(rovoPrompt)}
                type="button"
              >
                📋 Copy to Clipboard
              </button>
              <button
                className={styles.linkButton}
                onClick={() => setRovoPrompt(null)}
                type="button"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
