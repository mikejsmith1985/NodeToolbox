// ModifyChgTab.tsx — Modify existing ServiceNow Changes using a 5-step wizard UI.
// Step 1: Fetch CHG by key
// Steps 2-4: Edit change details, planning, and environments  
// Step 5: Review, add CTASKs via templates, and save

import { useState, useCallback } from 'react';

import type {
  ChgBasicInfo,
  ChgPlanningAssessment,
  ChgPlanningContent,
  CtaskTemplate,
} from '../hooks/useCrgState.ts';
import { useCtaskTemplates } from '../hooks/useCtaskTemplates.ts';

import styles from './CrgTab.module.css';

const TAB_TITLE = 'Modify Change';
const TAB_SUBTITLE = 'Fetch an existing ServiceNow CHG, edit all fields with full CTASK template support, save changes.';

const STEP_DEFINITIONS = [
  { step: 1, label: 'Fetch Change' },
  { step: 2, label: 'Change Details' },
  { step: 3, label: 'Planning' },
  { step: 4, label: 'Environments' },
  { step: 5, label: 'Review & Save' },
] as const;

interface ModifyChgState {
  currentStep: 1 | 2 | 3 | 4 | 5;
  changeKey: string;
  isFetching: boolean;
  fetchError: string | null;
  change: {
    shortDescription: string;
    description: string;
    justification: string;
    riskImpactAnalysis: string;
    chgBasicInfo: ChgBasicInfo;
    chgPlanningAssessment: ChgPlanningAssessment;
    chgPlanningContent: ChgPlanningContent;
  } | null;
  changeTasks: CtaskTemplate[];
  isSaving: boolean;
  saveError: string | null;
  saveSuccess: string | null;
}

/**
 * Fetches a CHG from ServiceNow relay by change key.
 */
async function fetchChangeFromSnow(changeKey: string): Promise<any> {
  const response = await fetch(`/api/snow-relay/change/${encodeURIComponent(changeKey.toUpperCase())}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch change: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Saves a modified CHG back to ServiceNow.
 */
async function saveChangeToSnow(changeKey: string, changeData: any): Promise<void> {
  const response = await fetch(`/api/snow-relay/change/${encodeURIComponent(changeKey.toUpperCase())}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(changeData),
  });
  if (!response.ok) {
    throw new Error(`Failed to save change: ${response.statusText}`);
  }
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
function FetchChangeStep({ state, onChangeKeyChange, onFetchClick }: {
  state: ModifyChgState;
  onChangeKeyChange: (key: string) => void;
  onFetchClick: () => void;
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
function PlanningStep({ state, onFieldChange }: {
  state: ModifyChgState;
  onFieldChange: (field: string, value: string) => void;
}) {
  if (!state.change) return null;

  const assessment = state.change.chgPlanningAssessment;

  return (
    <section className={styles.section}>
      <StepHeading currentStep={3} />
      <div className={styles.assessmentGrid}>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Impact</span>
          <input
            className={styles.input}
            onChange={(event) => onFieldChange('chgPlanningAssessment.impact', event.target.value)}
            value={assessment.impact}
          />
        </label>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>System Availability Implication</span>
          <input
            className={styles.input}
            onChange={(event) => onFieldChange('chgPlanningAssessment.systemAvailabilityImplication', event.target.value)}
            value={assessment.systemAvailabilityImplication}
          />
        </label>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Has Been Tested</span>
          <input
            className={styles.input}
            onChange={(event) => onFieldChange('chgPlanningAssessment.hasBeenTested', event.target.value)}
            value={assessment.hasBeenTested}
          />
        </label>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Has Been Performed Previously</span>
          <input
            className={styles.input}
            onChange={(event) => onFieldChange('chgPlanningAssessment.hasBeenPerformedPreviously', event.target.value)}
            value={assessment.hasBeenPerformedPreviously}
          />
        </label>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Success Probability</span>
          <input
            className={styles.input}
            onChange={(event) => onFieldChange('chgPlanningAssessment.successProbability', event.target.value)}
            value={assessment.successProbability}
          />
        </label>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Can Be Backed Out</span>
          <input
            className={styles.input}
            onChange={(event) => onFieldChange('chgPlanningAssessment.canBeBackedOut', event.target.value)}
            value={assessment.canBeBackedOut}
          />
        </label>
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
 * Step 4: Environments — Edit environment-specific fields (placeholder)
 */
function EnvironmentsStep({ state }: {
  state: ModifyChgState;
}) {
  if (!state.change) return null;

  return (
    <section className={styles.section}>
      <StepHeading currentStep={4} />
      <p className={styles.panelHint}>Edit environment-specific details for REL, PRD, and PFIX.</p>
      {/* Placeholder for environment-specific fields */}
      <p>Environment configuration to be displayed here.</p>
    </section>
  );
}

/**
 * Step 5: Review & Save — Show summary and CTASK template picker
 */
function ReviewSaveStep({ state, ctaskTemplates, onAddCtask, onRemoveCtask, onSaveClick }: {
  state: ModifyChgState;
  ctaskTemplates: CtaskTemplate[];
  onAddCtask: (template: CtaskTemplate) => void;
  onRemoveCtask: (id: string) => void;
  onSaveClick: () => void;
}) {
  if (!state.change) return null;

  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const selectedTemplate = ctaskTemplates.find((t) => t.id === selectedTemplateId);

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
              onClick={() => selectedTemplate && onAddCtask(selectedTemplate)}
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
          <h4 className={styles.panelSectionTitle}>Change Tasks</h4>
          <ul className={styles.summaryText}>
            {state.changeTasks.map((ctask) => (
              <li key={ctask.id}>
                {ctask.name}: {ctask.shortDescription}
                <button
                  className={styles.linkButton}
                  onClick={() => onRemoveCtask(ctask.id)}
                  type="button"
                  aria-label={`Remove CTASK ${ctask.shortDescription || ctask.name}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
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
      setModifyState((prev) => ({ ...prev, isFetching: false, fetchError: errorMessage }));
    }
  }, [modifyState.changeKey]);

  const handleFieldChange = useCallback((field: string, value: string) => {
    setModifyState((prev) => {
      if (!prev.change) return prev;

      const updateNestedField = (obj: any, path: string, val: string): any => {
        const keys = path.split('.');
        if (keys.length === 1) {
          return { ...obj, [path]: val };
        }
        const [first, ...rest] = keys;
        return { ...obj, [first]: updateNestedField(obj[first] || {}, rest.join('.'), val) };
      };

      return {
        ...prev,
        change: updateNestedField(prev.change, field, value),
      };
    });
  }, []);

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

  const handleSaveChange = useCallback(async () => {
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
      setModifyState((prev) => ({ ...prev, isSaving: false, saveError: errorMessage }));
    }
  }, [modifyState]);

  const handleStepSelect = useCallback((step: 1 | 2 | 3 | 4 | 5) => {
    if (step === 1 || modifyState.change) {
      setModifyState((prev) => ({ ...prev, currentStep: step }));
    }
  }, [modifyState.change]);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h2 className={styles.title}>{TAB_TITLE}</h2>
        <p className={styles.subtitle}>{TAB_SUBTITLE}</p>
      </header>

      <StepIndicator currentStep={modifyState.currentStep} onStepSelect={handleStepSelect} />

      {modifyState.currentStep === 1 && (
        <FetchChangeStep state={modifyState} onChangeKeyChange={handleChangeKeyChange} onFetchClick={handleFetchChange} />
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
          <PlanningStep state={modifyState} onFieldChange={handleFieldChange} />
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
          <EnvironmentsStep state={modifyState} />
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
