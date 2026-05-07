// PrbWizard.tsx — Four-step stepper UI wrapper around the PRB → Jira flow.
//
// Reuses the existing usePrbState hook so behaviour (fetching the PRB, building
// summaries, creating issues) is identical to the Quick Create form. The wizard
// guides users step-by-step:
//   1. Pick Problem Record  — load the PRB
//   2. Defect Details       — choose Jira project + edit Defect summary
//   3. Story Details        — edit Story summary
//   4. Review & Create      — confirm and create both Jira issues

import { useState, type ChangeEvent } from 'react';

import type { usePrbState } from '../hooks/usePrbState.ts';
import styles from './PrbTab.module.css';

const STEP_TITLES = ['Pick PRB', 'Defect', 'Story', 'Review'] as const;
const TOTAL_STEPS = STEP_TITLES.length;
const FIRST_STEP_INDEX = 0;
const LAST_STEP_INDEX = TOTAL_STEPS - 1;

type PrbHookResult = ReturnType<typeof usePrbState>;

interface PrbWizardProps {
  state: PrbHookResult['state'];
  actions: PrbHookResult['actions'];
}

/** Renders the active step's body so each step focuses the user on one decision. */
function renderStepBody(currentStep: number, props: PrbWizardProps): React.ReactNode {
  const { state, actions } = props;

  if (currentStep === 0) {
    return (
      <div className={styles.sectionBody}>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>PRB Number</span>
          <input
            className={styles.input}
            onChange={(event: ChangeEvent<HTMLInputElement>) => actions.setPrbNumber(event.target.value)}
            value={state.prbNumber}
          />
        </label>
        <div className={styles.buttonRow}>
          <button className={styles.primaryButton} onClick={() => void actions.fetchPrb()} type="button">
            Load PRB
          </button>
        </div>
        {state.isFetchingPrb ? <p className={styles.loadingText}>Loading PRB details...</p> : null}
        {state.fetchError ? <p className={styles.errorText} role="alert">{state.fetchError}</p> : null}
        {state.prbData ? (
          <p className={styles.detailValue}>
            ✅ Loaded {state.prbData.number}: {state.prbData.shortDescription}
          </p>
        ) : null}
      </div>
    );
  }

  if (currentStep === 1) {
    return (
      <div className={styles.sectionBody}>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Jira Project Key</span>
          <input
            className={styles.input}
            onChange={(event: ChangeEvent<HTMLInputElement>) => actions.setJiraProjectKey(event.target.value)}
            value={state.jiraProjectKey}
          />
        </label>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Defect Summary</span>
          <input
            className={styles.input}
            onChange={(event: ChangeEvent<HTMLInputElement>) => actions.setDefectSummary(event.target.value)}
            value={state.defectSummaryTemplate}
          />
        </label>
      </div>
    );
  }

  if (currentStep === 2) {
    return (
      <div className={styles.sectionBody}>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Story Summary</span>
          <input
            className={styles.input}
            onChange={(event: ChangeEvent<HTMLInputElement>) => actions.setStorySummary(event.target.value)}
            value={state.storySummaryTemplate}
          />
        </label>
      </div>
    );
  }

  return (
    <div className={styles.sectionBody}>
      <p className={styles.detailValue}>Project: {state.jiraProjectKey}</p>
      <p className={styles.detailValue}>Defect: {state.defectSummaryTemplate}</p>
      <p className={styles.detailValue}>Story: {state.storySummaryTemplate}</p>
      <div className={styles.buttonRow}>
        <button className={styles.primaryButton} onClick={() => void actions.createJiraIssues()} type="button">
          Create Jira Issues
        </button>
      </div>
      {state.isCreatingIssues ? <p className={styles.loadingText}>Creating Jira issues...</p> : null}
      {state.createError ? <p className={styles.errorText} role="alert">{state.createError}</p> : null}
      {state.createdIssueKeys.length > 0 ? (
        <ul>{state.createdIssueKeys.map((issueKey) => <li key={issueKey}>{issueKey}</li>)}</ul>
      ) : null}
    </div>
  );
}

/** Returns true when the wizard can advance from the given step given current state. */
function canAdvanceFromStep(currentStep: number, state: PrbHookResult['state']): boolean {
  if (currentStep === 0) {
    return state.prbData !== null;
  }
  if (currentStep === 1) {
    return state.jiraProjectKey.length > 0 && state.defectSummaryTemplate.length > 0;
  }
  if (currentStep === 2) {
    return state.storySummaryTemplate.length > 0;
  }
  return false;
}

/** Renders the four-step PRB wizard so users can convert a PRB into Jira issues with explicit checkpoints. */
export default function PrbWizard({ state, actions }: PrbWizardProps) {
  const [currentStep, setCurrentStep] = useState<number>(FIRST_STEP_INDEX);
  const isAtFirst = currentStep === FIRST_STEP_INDEX;
  const isAtLast = currentStep === LAST_STEP_INDEX;
  const canAdvance = canAdvanceFromStep(currentStep, state);

  return (
    <section aria-label="PRB Wizard" className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>
          Step {currentStep + 1} of {TOTAL_STEPS}: {STEP_TITLES[currentStep]}
        </h3>
      </div>
      <ol aria-label="Wizard steps">
        {STEP_TITLES.map((title, stepIndex) => (
          <li
            key={title}
            aria-current={stepIndex === currentStep ? 'step' : undefined}
            data-active={stepIndex === currentStep ? 'true' : 'false'}
          >
            {title}
          </li>
        ))}
      </ol>
      {renderStepBody(currentStep, { state, actions })}
      <div className={styles.buttonRow}>
        <button
          className={styles.secondaryButton}
          disabled={isAtFirst}
          onClick={() => setCurrentStep((previousStep) => Math.max(FIRST_STEP_INDEX, previousStep - 1))}
          type="button"
        >
          Back
        </button>
        {!isAtLast ? (
          <button
            className={styles.primaryButton}
            disabled={!canAdvance}
            onClick={() => setCurrentStep((previousStep) => Math.min(LAST_STEP_INDEX, previousStep + 1))}
            type="button"
          >
            Next
          </button>
        ) : null}
        <button className={styles.secondaryButton} onClick={() => { actions.reset(); setCurrentStep(FIRST_STEP_INDEX); }} type="button">
          Start Over
        </button>
      </div>
    </section>
  );
}
