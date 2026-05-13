// CrgTab.tsx — Five-step Change Request Generator tab for building SNow release content from Jira issues.

import type { ChangeEvent, KeyboardEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCrgState } from '../hooks/useCrgState.ts';
import { useRovoAssist } from '../hooks/useRovoAssist.ts';
import styles from './CrgTab.module.css';

const TAB_TITLE = 'Change Request Generator';
const TAB_SUBTITLE = 'Guide a release from Jira issue lookup through final ServiceNow-ready content.';
const STEP_DEFINITIONS = [
  { step: 1, label: 'Fetch Issues' },
  { step: 2, label: 'Review Issues' },
  { step: 3, label: 'Preview Docs' },
  { step: 4, label: 'Environments' },
  { step: 5, label: 'Results' },
] as const;
const GENERATED_FIELD_DEFINITIONS = [
  { key: 'shortDescription', label: 'Short Description', valueKey: 'generatedShortDescription' },
  { key: 'description', label: 'Description', valueKey: 'generatedDescription' },
  { key: 'justification', label: 'Justification', valueKey: 'generatedJustification' },
  { key: 'riskImpact', label: 'Risk & Impact', valueKey: 'generatedRiskImpact' },
] as const;
const ENVIRONMENT_ROW_DEFINITIONS = [
  { key: 'rel', label: 'REL', stateKey: 'relEnvironment', canToggle: false },
  { key: 'prd', label: 'PRD', stateKey: 'prdEnvironment', canToggle: false },
  { key: 'pfix', label: 'PFIX', stateKey: 'pfixEnvironment', canToggle: true },
] as const;
const CONSOLIDATED_RESULT_LABEL = 'Consolidated Result';
const STEP_TITLE_PREFIX = 'Step';
const DEFAULT_RESULT_MESSAGE = 'Generated content will appear here after you complete the wizard.';
const EMPTY_ENVIRONMENT_DATES = 'Not scheduled';

type CrgHookResult = ReturnType<typeof useCrgState>;
type CrgStateData = CrgHookResult['state'];
type CrgActionSet = CrgHookResult['actions'];
type GeneratedFieldName = Parameters<CrgActionSet['updateGeneratedField']>[0];
type EnvironmentKey = Parameters<CrgActionSet['updateEnvironment']>[0];
type FetchMode = CrgStateData['fetchMode'];

interface StepIndicatorProps {
  currentStep: CrgStateData['currentStep'];
}

interface CrgStepProps {
  state: CrgStateData;
  actions: CrgActionSet;
}

/** Additional props passed to PreviewDocsStep when Rovo assist is active. */
interface PreviewDocsStepExtras {
  isRovoUnlocked: boolean;
  onEnhanceWithRovo: () => void;
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

function PreviewDocsStep({ state, actions, isRovoUnlocked, onEnhanceWithRovo }: CrgStepProps & PreviewDocsStepExtras) {
  function handleGeneratedFieldChange(fieldName: GeneratedFieldName, event: ChangeEvent<HTMLTextAreaElement>): void {
    actions.updateGeneratedField(fieldName, event.target.value);
  }

  return (
    <section className={styles.section}>
      <StepHeading currentStep={state.currentStep} />
      <div className={styles.editorGrid}>
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
        <button className={styles.linkButton} onClick={() => actions.goToStep(2)} type="button">
          Back
        </button>
        <button className={styles.primaryButton} onClick={() => actions.goToStep(4)} type="button">
          Next: Environments
        </button>
      </div>
    </section>
  );
}

function EnvironmentStep({ state, actions }: CrgStepProps) {
  function handleEnvironmentToggle(environmentKey: EnvironmentKey, event: ChangeEvent<HTMLInputElement>): void {
    actions.updateEnvironment(environmentKey, { isEnabled: event.target.checked });
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

  return (
    <section className={styles.section}>
      <StepHeading currentStep={state.currentStep} />
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
                    checked={environmentState.isEnabled}
                    disabled={!environmentRow.canToggle}
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
        <button className={styles.linkButton} onClick={() => actions.goToStep(3)} type="button">
          Back
        </button>
        <button className={styles.primaryButton} onClick={() => actions.goToStep(5)} type="button">
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
  previewExtras: PreviewDocsStepExtras,
) {
  if (state.currentStep === 1) {
    return <FetchIssuesStep actions={actions} state={state} />;
  }

  if (state.currentStep === 2) {
    return <ReviewIssuesStep actions={actions} state={state} />;
  }

  if (state.currentStep === 3) {
    return <PreviewDocsStep actions={actions} state={state} {...previewExtras} />;
  }

  if (state.currentStep === 4) {
    return <EnvironmentStep actions={actions} state={state} />;
  }

  return <ResultsStep actions={actions} state={state} />;
}

/**
 * Renders the Change Request Generator so release managers can turn Jira release scope into a five-step ServiceNow-ready package.
 * A hidden AI assist mode is available via keyboard shortcut for enhanced content generation.
 */
export default function CrgTab() {
  const { state, actions } = useCrgState();
  const { isUnlocked, verifyPassphrase, buildPrompt } = useRovoAssist();

  // Modal visibility and passphrase input state for the hidden activation flow.
  const [isPassphraseModalVisible, setIsPassphraseModalVisible] = useState(false);
  const [passphraseInput, setPassphraseInput] = useState('');
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const passphraseInputRef = useRef<HTMLInputElement>(null);

  // Prompt modal state — holds the generated prompt text the user pastes into Rovo.
  const [rovoPrompt, setRovoPrompt] = useState<string | null>(null);

  const issueCountSummary = useMemo(() => `${state.fetchedIssues.length} issue(s) loaded`, [state.fetchedIssues.length]);

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

  const previewExtras: PreviewDocsStepExtras = {
    isRovoUnlocked:    isUnlocked,
    onEnhanceWithRovo: handleEnhanceWithRovo,
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
      {renderCurrentStepPanel(state, actions, previewExtras)}

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
