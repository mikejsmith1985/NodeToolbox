// CrgTab.tsx — Six-step Change Request Generator for building comprehensive SNow CHG records from Jira issues.
// Steps: 1-Fetch Issues → 2-Review Issues → 3-Change Details → 4-Planning & Content → 5-Environments → 6-Review & Create

import type { ChangeEvent, KeyboardEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ChgBasicInfo, ChgPlanningAssessment, ChgPlanningContent, CrgTemplate, CtaskTemplate } from '../hooks/useCrgState.ts';
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

type CtaskTemplateData = Omit<CtaskTemplate, 'id' | 'name' | 'createdAt'>;

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
  /** True while the sys_choice fetch is still in flight. */
  isLoadingChoices: boolean;
  /** True when the SNow metadata fetch failed — options are unavailable and user must connect SNow. */
  isFetchFailed: boolean;
  /** True when the SNow relay bridge is connected (drives whether dropdowns can load). */
  isRelayConnected: boolean;
  /** True when the relay has detected SNow's g_ck session token. */
  hasRelaySessionToken: boolean;
  /** Manually re-triggers the sys_choice fetch after a transient error. */
  retryFetch: () => void;
  /**
   * Human-readable reason the last fetch failed (e.g. "SNow relay fetch … failed: 401").
   * null when no failure has occurred or a new fetch is in progress.
   */
  fetchErrorMessage: string | null;
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
}

/** Additional props for the Change Details step — templates and dynamic choice options. */
interface ChangeDetailsExtras {
  /** Dynamic choice options fetched from SNow form metadata for basic info dropdowns. */
  choiceOptions: SnowChoiceOptionMap;
  /** True while the sys_choice fetch is still in flight. */
  isLoadingChoices: boolean;
  /** True when the SNow metadata fetch failed — options are unavailable and user must connect SNow. */
  isFetchFailed: boolean;
  /** True when the SNow relay bridge is connected (drives whether dropdowns can load). */
  isRelayConnected: boolean;
  /** True when the relay has detected SNow's g_ck session token. */
  hasRelaySessionToken: boolean;
  /** Manually re-triggers the sys_choice fetch after a transient error. */
  retryFetch: () => void;
  /**
   * Human-readable reason the last fetch failed (e.g. "SNow relay fetch … failed: 401").
   * null when no failure has occurred or a new fetch is in progress.
   */
  fetchErrorMessage: string | null;
  templates: CrgTemplate[];
  saveTemplate: (name: string, data: Omit<CrgTemplate, 'id' | 'name' | 'createdAt'>) => string;
  updateTemplate: (templateId: string, data: Omit<CrgTemplate, 'id' | 'name' | 'createdAt'>) => void;
  deleteTemplate: (templateId: string) => void;
}

interface CtaskTemplateExtras {
  templates: CtaskTemplate[];
  saveTemplate: (name: string, data: CtaskTemplateData) => string;
  updateTemplate: (templateId: string, data: CtaskTemplateData) => void;
  deleteTemplate: (templateId: string) => void;
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
  templates,
  saveTemplate,
  updateTemplate,
  deleteTemplate,
}: CrgStepProps & ChangeDetailsExtras) {
  // Local state for the template picker and save-as-template flow.
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [isSavePromptVisible, setIsSavePromptVisible] = useState<boolean>(false);
  const [newTemplateName, setNewTemplateName]         = useState<string>('');

  function handleBasicInfoChange<K extends keyof ChgBasicInfo>(
    fieldKey: K,
    value: ChgBasicInfo[K],
  ): void {
    actions.setChgBasicInfo({ [fieldKey]: value } as Partial<ChgBasicInfo>);
  }

  function handleCloneNumberChange(event: ChangeEvent<HTMLInputElement>): void {
    actions.setCloneChgNumber(event.target.value.toUpperCase());
  }

  function handleApplyTemplate(): void {
    const chosenTemplate = templates.find((template) => template.id === selectedTemplateId);
    if (chosenTemplate) {
      actions.applyTemplate(chosenTemplate);
    }
  }

  function handleDeleteTemplate(): void {
    deleteTemplate(selectedTemplateId);
    setSelectedTemplateId('');
  }

  function buildCurrentTemplateData(): Omit<CrgTemplate, 'id' | 'name' | 'createdAt'> {
    return {
      chgBasicInfo:          state.chgBasicInfo,
      chgPlanningAssessment: state.chgPlanningAssessment,
      chgPlanningContent:    state.chgPlanningContent,
      relEnvironment:        state.relEnvironment,
      prdEnvironment:        state.prdEnvironment,
      pfixEnvironment:       state.pfixEnvironment,
    };
  }

  function handleSaveTemplate(): void {
    saveTemplate(newTemplateName, buildCurrentTemplateData());
    setNewTemplateName('');
    setIsSavePromptVisible(false);
  }

  function handleUpdateTemplate(): void {
    if (selectedTemplateId) {
      updateTemplate(selectedTemplateId, buildCurrentTemplateData());
    }
  }

  const { chgBasicInfo: basicInfo } = state;
  const isCloneInputDisabled = state.isCloning;

  // Resolve dynamic choice options for the basic-info dropdowns.
  // These are empty until the SNow relay is connected and live form metadata loads.
  const categoryOptions    = choiceOptions['category']      ?? [];
  const changeTypeOptions  = choiceOptions['type']          ?? [];
  const canLoadChoiceOptions = isRelayConnected && hasRelaySessionToken;

  /**
   * Renders the options for a single dropdown. Shows a loading placeholder while in-flight,
   * a "waiting for relay" message when not yet connected, or a "load failed" indicator when
   * the SNow fetch errored — prevents any hardcoded guesses from appearing.
   */
  function renderDropdownOptions(options: { value: string; label: string }[], currentValue: string) {
    if (isLoadingChoices) {
      return <option disabled value="">Loading options…</option>;
    }
    if (!isRelayConnected) {
      return <option disabled value="">Connect SNow relay to load options</option>;
    }
    if (!hasRelaySessionToken) {
      return <option disabled value="">Waiting for SNow session token…</option>;
    }
    if (isFetchFailed) {
      return <option disabled value="">Load failed — click Retry above</option>;
    }

    const renderedOptions = buildRenderedChoiceOptions(options, currentValue);
    if (!hasSelectableChoiceOptions(renderedOptions)) {
      return <option disabled value="">No live SNow options returned</option>;
    }

    return renderedOptions.map((option) => (
      <option key={`${option.value}-${option.label}`} value={option.value}>{option.label || 'Select…'}</option>
    ));
  }

  return (
    <section className={styles.section}>
      <StepHeading currentStep={state.currentStep} />

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

      {/* Saved Templates panel — apply a previously saved set of field values in one click */}
      <div className={styles.clonePanel}>
        <h4 className={styles.panelSectionTitle}>Saved Templates</h4>
        {templates.length > 0 ? (
          <div className={styles.cloneInputRow}>
            <select
              aria-label="Select template"
              className={styles.input}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
              value={selectedTemplateId}
            >
              <option value="">Select a template…</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
            <button
              className={styles.secondaryButton}
              disabled={!selectedTemplateId}
              onClick={handleApplyTemplate}
              type="button"
            >
              Apply
            </button>
            <button
              className={styles.secondaryButton}
              disabled={!selectedTemplateId}
              onClick={handleUpdateTemplate}
              type="button"
            >
              Update selected
            </button>
            <button
              className={styles.linkButton}
              disabled={!selectedTemplateId}
              onClick={handleDeleteTemplate}
              type="button"
            >
              Delete
            </button>
          </div>
        ) : (
          <p className={styles.panelHint}>No templates saved yet.</p>
        )}

        {/* Inline save-as-template flow — shows a name input on demand */}
        {isSavePromptVisible ? (
          <div className={styles.cloneInputRow}>
            <input
              aria-label="Template name"
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
          <div>
            <button
              className={styles.linkButton}
              onClick={() => { setIsSavePromptVisible(true); setNewTemplateName(''); }}
              type="button"
            >
              + Save current fields as template
            </button>
          </div>
        )}
      </div>

      {/* Clone-from-CHG panel — pre-fill all fields by looking up an existing change record */}
      <div className={styles.clonePanel}>
        <h4 className={styles.panelSectionTitle}>Clone from existing CHG (optional)</h4>
        <p className={styles.panelHint}>
          Enter a CHG number to pre-populate all fields below from a previous change.
        </p>
        <div className={styles.cloneInputRow}>
          <input
            aria-label="Existing CHG number"
            className={styles.input}
            disabled={isCloneInputDisabled}
            onChange={handleCloneNumberChange}
            placeholder="e.g. CHG0001234"
            value={state.cloneChgNumber}
          />
          <button
            className={styles.secondaryButton}
            disabled={isCloneInputDisabled || !state.cloneChgNumber}
            onClick={() => void actions.cloneFromChg()}
            type="button"
          >
            {state.isCloning ? 'Loading…' : 'Load CHG'}
          </button>
        </div>
        {state.cloneError ? <p className={styles.errorText} role="alert">{state.cloneError}</p> : null}
      </div>

      {/* Basic Change Info — mirrors the top section of the SNow Change Request form */}
      <div className={styles.detailsGrid}>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Category</span>
            <select
              className={styles.input}
              disabled={isFetchFailed || !canLoadChoiceOptions || isLoadingChoices}
            onChange={(event) => handleBasicInfoChange('category', event.target.value)}
            value={basicInfo.category}
          >
            {renderDropdownOptions(categoryOptions, basicInfo.category)}
          </select>
        </label>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Change Type</span>
          <select
            className={styles.input}
            disabled={isFetchFailed || !canLoadChoiceOptions || isLoadingChoices}
            onChange={(event) => handleBasicInfoChange('changeType', event.target.value)}
            value={basicInfo.changeType}
          >
            {renderDropdownOptions(changeTypeOptions, basicInfo.changeType)}
          </select>
        </label>

        <SnowLookupField
          label="Requested By"
          tableName="sys_user"
          value={basicInfo.requestedBy}
          onChange={(ref) => handleBasicInfoChange('requestedBy', ref)}
        />
        <SnowLookupField
          label="Config Item"
          tableName="cmdb_ci"
          value={basicInfo.configItem}
          onChange={(ref) => handleBasicInfoChange('configItem', ref)}
        />
        <SnowLookupField
          label="Assignment Group"
          tableName="sys_user_group"
          value={basicInfo.assignmentGroup}
          onChange={(ref) => handleBasicInfoChange('assignmentGroup', ref)}
        />
        <SnowLookupField
          label="Assigned To"
          tableName="sys_user"
          value={basicInfo.assignedTo}
          onChange={(ref) => handleBasicInfoChange('assignedTo', ref)}
        />
        <SnowLookupField
          label="Change Manager"
          tableName="sys_user"
          value={basicInfo.changeManager}
          onChange={(ref) => handleBasicInfoChange('changeManager', ref)}
        />
        <SnowLookupField
          label="Tester"
          tableName="sys_user"
          value={basicInfo.tester}
          onChange={(ref) => handleBasicInfoChange('tester', ref)}
        />
        <SnowLookupField
          label="Service Manager"
          tableName="sys_user"
          value={basicInfo.serviceManager}
          onChange={(ref) => handleBasicInfoChange('serviceManager', ref)}
        />
      </div>

      <label className={`${styles.fieldGroup} ${styles.inlineCheckbox}`}>
        <input
          checked={basicInfo.isExpedited}
          onChange={(event) => handleBasicInfoChange('isExpedited', event.target.checked)}
          type="checkbox"
        />
        <span>Expedited Change</span>
      </label>

      <div className={styles.buttonRow}>
        <button className={styles.linkButton} onClick={() => actions.goToStep(2)} type="button">
          Back
        </button>
        <button className={styles.primaryButton} onClick={() => actions.goToStep(4)} type="button">
          Next: Planning
        </button>
      </div>
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
}: CrgStepProps & PlanningStepExtras) {
  function handleGeneratedFieldChange(fieldName: GeneratedFieldName, event: ChangeEvent<HTMLTextAreaElement>): void {
    actions.updateGeneratedField(fieldName, event.target.value);
  }

  function handleAssessmentChange(
    fieldKey: keyof ChgPlanningAssessment,
    event: ChangeEvent<HTMLSelectElement>,
  ): void {
    actions.setChgPlanningAssessment({ [fieldKey]: event.target.value } as Partial<ChgPlanningAssessment>);
  }

  function handlePlanningContentChange(
    fieldKey: keyof ChgPlanningContent,
    event: ChangeEvent<HTMLTextAreaElement>,
  ): void {
    actions.setChgPlanningContent({ [fieldKey]: event.target.value } as Partial<ChgPlanningContent>);
  }

  const { chgPlanningAssessment: assessment, chgPlanningContent: planContent } = state;
  const canLoadChoiceOptions = isRelayConnected && hasRelaySessionToken;

  return (
    <section className={styles.section}>
      <StepHeading currentStep={state.currentStep} />

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

      {/* Planning assessment dropdowns — seven risk/readiness evaluations resolved from live SNow choices */}
      <div className={styles.assessmentGrid}>
        {PLANNING_ASSESSMENT_ROWS.map((row) => {
          const rowOptions = choiceOptions[row.snowFieldName] ?? [];
          const currentAssessmentValue = assessment[row.fieldKey];
          const renderedRowOptions = buildRenderedChoiceOptions(rowOptions, currentAssessmentValue);
          const hasRowOptions = hasSelectableChoiceOptions(renderedRowOptions);
          return (
            <label className={styles.fieldGroup} key={row.fieldKey}>
              <span className={styles.fieldLabel}>{row.label}</span>
              <select
                className={styles.input}
                disabled={isFetchFailed || !canLoadChoiceOptions || isLoadingChoices || !hasRowOptions}
                onChange={(event) => handleAssessmentChange(row.fieldKey, event)}
                value={currentAssessmentValue}
              >
                {isLoadingChoices ? (
                  <option disabled value="">Loading options…</option>
                ) : !isRelayConnected ? (
                  <option disabled value="">Connect SNow relay to load options</option>
                ) : !hasRelaySessionToken ? (
                  <option disabled value="">Waiting for SNow session token…</option>
                ) : isFetchFailed ? (
                  <option disabled value="">Load failed — click Retry above</option>
                ) : !hasRowOptions ? (
                  <option disabled value="">No live SNow options returned</option>
                ) : (
                  renderedRowOptions.map((option) => (
                    <option key={`${option.value}-${option.label}`} value={option.value}>{option.label || 'Select…'}</option>
                  ))
                )}
              </select>
            </label>
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

      <div className={styles.buttonRow}>
        <button className={styles.linkButton} onClick={() => actions.goToStep(3)} type="button">
          Back
        </button>
        <button className={styles.primaryButton} onClick={() => actions.goToStep(5)} type="button">
          Next: Environments
        </button>
      </div>
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
}: CrgStepProps & EnvironmentStepExtras) {
  const environmentOptions = choiceOptions['u_environment'] ?? [];
  const canLoadChoiceOptions = isRelayConnected && hasRelaySessionToken;

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

  function renderEnvironmentMappingOptions() {
    if (isLoadingChoices) return <option disabled value="">Loading options…</option>;
    if (!isRelayConnected) return <option disabled value="">Connect SNow relay to load options</option>;
    if (!hasRelaySessionToken) return <option disabled value="">Waiting for SNow session token…</option>;
    if (isFetchFailed) return <option disabled value="">Load failed — return to Planning and retry</option>;

    const renderedOptions = buildRenderedChoiceOptions(environmentOptions, state.chgBasicInfo.environment);
    if (!hasSelectableChoiceOptions(renderedOptions)) {
      return <option disabled value="">No live SNow environment options returned</option>;
    }

    return renderedOptions.map((option) => (
      <option key={`${option.value}-${option.label}`} value={option.value}>{option.label || 'Select…'}</option>
    ));
  }

  return (
    <section className={styles.section}>
      <StepHeading currentStep={state.currentStep} />
      <div className={styles.environmentMappingPanel}>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>ServiceNow Environment</span>
          <select
            aria-label="ServiceNow Environment"
            className={styles.input}
            disabled={
              isFetchFailed ||
              !canLoadChoiceOptions ||
              isLoadingChoices ||
              (!state.chgBasicInfo.environment && !hasSelectableChoiceOptions(environmentOptions))
            }
            onChange={(event) => actions.setChgBasicInfo({ environment: event.target.value })}
            value={state.chgBasicInfo.environment}
          >
            {renderEnvironmentMappingOptions()}
          </select>
        </label>
        <p className={styles.panelHint}>
          This maps the selected deployment environments below to the single SNow Environment field sent on create.
        </p>
      </div>
      <table aria-label="Environment schedule table" className={styles.issueTable}>
        <thead>
          <tr>
            <th scope="col">Environment</th>
            <th scope="col">Enabled</th>
            <th scope="col">Planned Start</th>
            <th scope="col">Planned End</th>
          </tr>
        </thead>
        <tbody>
          {ENVIRONMENT_ROW_DEFINITIONS.map((environmentRow) => {
            const environmentState = state[environmentRow.stateKey];
            const isDateInputDisabled = !environmentState.isEnabled;

            return (
              <tr key={environmentRow.key}>
                <td>{environmentRow.label}</td>
                <td>
                  <input
                    aria-label={`${environmentRow.label} enabled`}
                    checked={environmentState.isEnabled}
                    onChange={(event) => handleEnvironmentToggle(environmentRow.key, event)}
                    type="checkbox"
                  />
                </td>
                <td>
                  <input
                    className={styles.input}
                    disabled={isDateInputDisabled}
                    onChange={(event) => handleEnvironmentDateChange(environmentRow.key, 'plannedStartDate', event)}
                    type="datetime-local"
                    value={environmentState.plannedStartDate}
                  />
                </td>
                <td>
                  <input
                    className={styles.input}
                    disabled={isDateInputDisabled}
                    onChange={(event) => handleEnvironmentDateChange(environmentRow.key, 'plannedEndDate', event)}
                    type="datetime-local"
                    value={environmentState.plannedEndDate}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={styles.buttonRow}>
        <button className={styles.linkButton} onClick={() => actions.goToStep(4)} type="button">
          Back
        </button>
        <button className={styles.primaryButton} onClick={() => actions.goToStep(6)} type="button">
          Preview Results
        </button>
      </div>
    </section>
  );
}

function buildEnvironmentSummary(state: CrgStateData): string[] {
  return ENVIRONMENT_ROW_DEFINITIONS.map((environmentRow) => {
    const environmentState = state[environmentRow.stateKey];
    const scheduleSummary = environmentState.plannedStartDate && environmentState.plannedEndDate
      ? `${environmentState.plannedStartDate} → ${environmentState.plannedEndDate}`
      : EMPTY_ENVIRONMENT_DATES;

    return `${environmentRow.label}: ${environmentState.isEnabled ? 'Enabled' : 'Disabled'} — ${scheduleSummary}`;
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
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);

  useEffect(() => {
    if (!selectedTemplate) return;
    setTemplateName(selectedTemplate.name);
    setCtaskDraft(buildCtaskTemplateData(selectedTemplate));
  }, [selectedTemplate]);

  function handleStringFieldChange(fieldName: keyof Pick<CtaskTemplateData, 'shortDescription' | 'description' | 'plannedStartDate' | 'plannedEndDate' | 'closeNotes'>, value: string): void {
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

  return (
    <div className={styles.clonePanel}>
      <h4 className={styles.panelSectionTitle}>CTASK Templates</h4>
      <p className={styles.panelHint}>Add reusable Change Tasks to this CHG, or append the selected CTASKs to an existing CHG.</p>
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

function ResultsStep({ state, actions, ...ctaskTemplateExtras }: CrgStepProps & CtaskTemplateExtras) {
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
      </div>
      <CtaskTemplatePanel actions={actions} state={state} {...ctaskTemplateExtras} />
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
  ctaskTemplateExtras: CtaskTemplateExtras,
) {
  if (state.currentStep === 1) {
    return <FetchIssuesStep actions={actions} state={state} />;
  }

  if (state.currentStep === 2) {
    return <ReviewIssuesStep actions={actions} state={state} />;
  }

  if (state.currentStep === 3) {
    return <ChangeDetailsStep actions={actions} state={state} {...changeDetailsExtras} />;
  }

  if (state.currentStep === 4) {
    return <PlanningStep actions={actions} state={state} {...planningExtras} />;
  }

  if (state.currentStep === 5) {
    return <EnvironmentStep actions={actions} state={state} {...environmentExtras} />;
  }

  return <ResultsStep actions={actions} state={state} {...ctaskTemplateExtras} />;
}

/**
 * Renders the Change Request Generator so release managers can turn Jira release scope into a
 * comprehensive six-step ServiceNow Change Request with all required fields.
 * A hidden AI assist mode is available via keyboard shortcut for enhanced content generation.
 */
export default function CrgTab() {
  const { state, actions } = useCrgState();
  const { isUnlocked, verifyPassphrase, buildPrompt } = useRovoAssist();
  const { templates, saveTemplate, updateTemplate, deleteTemplate } = useCrgTemplates();
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

  const issueCountSummary = useMemo(() => `${state.fetchedIssues.length} issue(s) loaded`, [state.fetchedIssues.length]);

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
  };

  const environmentExtras: EnvironmentStepExtras = {
    choiceOptions,
    isLoadingChoices,
    isFetchFailed,
    isRelayConnected,
    hasRelaySessionToken,
  };

  const changeDetailsExtras: ChangeDetailsExtras = {
    choiceOptions,
    isLoadingChoices,
    isFetchFailed,
    isRelayConnected,
    hasRelaySessionToken,
    retryFetch,
    fetchErrorMessage,
    templates,
    saveTemplate,
    updateTemplate,
    deleteTemplate,
  };

  const ctaskTemplateExtras: CtaskTemplateExtras = {
    templates:      ctaskTemplates.templates,
    saveTemplate:   ctaskTemplates.saveTemplate,
    updateTemplate: ctaskTemplates.updateTemplate,
    deleteTemplate: ctaskTemplates.deleteTemplate,
  };

  return (
    <div className={styles.tabPanel}>
      <header className={styles.tabHeader}>
        <div>
          <h2 className={styles.tabTitle}>{TAB_TITLE}</h2>
          <p className={styles.tabSubtitle}>{TAB_SUBTITLE}</p>
        </div>
        <p className={styles.summaryPill}>{issueCountSummary}</p>
      </header>
      <StepIndicator currentStep={state.currentStep} />
      {renderCurrentStepPanel(state, actions, planningExtras, changeDetailsExtras, environmentExtras, ctaskTemplateExtras)}

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
