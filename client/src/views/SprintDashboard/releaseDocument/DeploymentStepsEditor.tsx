// DeploymentStepsEditor.tsx — Type or paste a release's deployment steps: add, edit, reorder, remove (GH #395).

import styles from '../SprintDashboardView.module.css';
import { createEmptyDeploymentStep, DEPLOYMENT_STEP_COLUMNS, type DeploymentStep } from './releasePageStorage.ts';

interface DeploymentStepsEditorProps {
  steps: DeploymentStep[];
  /** Receives the whole new list after every change; the tab owns the state. */
  onChange: (steps: DeploymentStep[]) => void;
}

/** A copy of the list with the steps at two positions swapped. */
function swapSteps(steps: DeploymentStep[], firstIndex: number, secondIndex: number): DeploymentStep[] {
  const reorderedSteps = [...steps];
  [reorderedSteps[firstIndex], reorderedSteps[secondIndex]] = [reorderedSteps[secondIndex], reorderedSteps[firstIndex]];
  return reorderedSteps;
}

/**
 * One card per deployment step with a box for each of its twelve fields. Values are kept exactly as typed or
 * pasted — "Does not matter" and "To be created" are real answers, not blanks.
 */
export function DeploymentStepsEditor({ steps, onChange }: DeploymentStepsEditorProps) {
  const updateField = (stepIndex: number, field: keyof DeploymentStep, value: string) => {
    onChange(steps.map((step, index) => (index === stepIndex ? { ...step, [field]: value } : step)));
  };

  return (
    <div className={styles.deploymentStepsEditor}>
      {steps.length === 0 ? (
        <p className={styles.issueMetaText}>No deployment steps yet — add one for each deploy action in this release.</p>
      ) : null}
      {steps.map((step, stepIndex) => {
        const stepNumber = stepIndex + 1;
        return (
          <section aria-label={`Deployment step ${stepNumber}`} className={styles.deploymentStepCard} key={step.id}>
            <div className={styles.deploymentStepHeader}>
              <strong>{`Step ${stepNumber}`}</strong>
              <button
                aria-label={`Move step ${stepNumber} up`}
                className={styles.textActionButton}
                disabled={stepIndex === 0}
                onClick={() => onChange(swapSteps(steps, stepIndex, stepIndex - 1))}
                type="button"
              >
                ↑
              </button>
              <button
                aria-label={`Move step ${stepNumber} down`}
                className={styles.textActionButton}
                disabled={stepIndex === steps.length - 1}
                onClick={() => onChange(swapSteps(steps, stepIndex, stepIndex + 1))}
                type="button"
              >
                ↓
              </button>
              <button
                aria-label={`Remove step ${stepNumber}`}
                className={styles.textActionButton}
                onClick={() => onChange(steps.filter((_, index) => index !== stepIndex))}
                type="button"
              >
                Remove
              </button>
            </div>
            <div className={styles.deploymentStepGrid}>
              {DEPLOYMENT_STEP_COLUMNS.map(({ field, header }) => (
                <label className={styles.rosterCapacityField} key={field}>
                  <span className={styles.rosterRoleLegend}>{header}</span>
                  <input
                    aria-label={`${header} for step ${stepNumber}`}
                    className={styles.settingsInput}
                    onChange={(changeEvent) => updateField(stepIndex, field, changeEvent.target.value)}
                    type="text"
                    value={step[field]}
                  />
                </label>
              ))}
            </div>
          </section>
        );
      })}
      <button className={styles.secondaryButton} onClick={() => onChange([...steps, createEmptyDeploymentStep()])} type="button">
        + Add deployment step
      </button>
    </div>
  );
}
