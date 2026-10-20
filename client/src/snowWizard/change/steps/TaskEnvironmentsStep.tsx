// TaskEnvironmentsStep.tsx — Step 8 "Which environment needs each task?": a grid of the chosen tasks × the environments in use.
//
// Ticks start from the default rules (Business Checkout on PRD and PFIX, not REL) and the user's saved defaults; the
// user can change any tick and keep the result as their own default for next time.

import { useState } from 'react';

import { readEnabledPlanEnvironments } from '../changeDraft.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';
import { listPlanErrors, saveCtaskEnvironmentDefault, toggleCtaskEnvironment, type CtaskEnvironmentPlan } from '../ctaskEnvironmentPlan.ts';

/** The grid also needs the plan, already matched to the chosen tasks and environments. */
export interface TaskEnvironmentsStepProps extends ChangeStepProps {
  ctaskEnvironmentPlan: CtaskEnvironmentPlan;
}

const SERVICENOW_TASK_ROWS = ['Implementation', 'Technical Checkout'];

/** Step 8: which environment's change each task goes on. */
export default function TaskEnvironmentsStep({ crg, updateSession, ctaskEnvironmentPlan }: TaskEnvironmentsStepProps) {
  const [wasSaved, setWasSaved] = useState(false);
  const enabledEnvironments = readEnabledPlanEnvironments(crg.state);
  const taskLabels = Object.keys(ctaskEnvironmentPlan);
  const planErrors = listPlanErrors(ctaskEnvironmentPlan, enabledEnvironments);

  function rememberDefaults() {
    for (const [taskLabel, ticks] of Object.entries(ctaskEnvironmentPlan)) saveCtaskEnvironmentDefault(taskLabel, ticks);
    setWasSaved(true);
  }

  return (
    <div>
      <p className={styles.stepIntro}>Tick the environments each task belongs to. Each environment gets its own change.</p>
      <table className={styles.gridTable}>
        <thead><tr><th>Task</th>{enabledEnvironments.map((environmentKey) => <th key={environmentKey}>{environmentKey}</th>)}</tr></thead>
        <tbody>
          {SERVICENOW_TASK_ROWS.map((taskLabel) => (
            <tr key={taskLabel}><td>{`${taskLabel} (added by ServiceNow)`}</td>{enabledEnvironments.map((environmentKey) => <td key={environmentKey}>Always</td>)}</tr>
          ))}
          {taskLabels.map((taskLabel) => (
            <tr key={taskLabel}>
              <td>{taskLabel}</td>
              {enabledEnvironments.map((environmentKey) => (
                <td key={environmentKey}>
                  <input type="checkbox" aria-label={`${taskLabel} on ${environmentKey}`} checked={ctaskEnvironmentPlan[taskLabel][environmentKey]}
                    onChange={() => updateSession({ ctaskEnvironmentPlan: toggleCtaskEnvironment(ctaskEnvironmentPlan, taskLabel, environmentKey) })} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {taskLabels.length === 0 ? <p className={styles.hint}>No extra tasks were chosen, so there is nothing more to place.</p> : null}
      {planErrors.map((planError) => <p key={planError} className={styles.errorText}>{planError}</p>)}
      {taskLabels.length > 0 ? (
        <div className={styles.buttonRow}>
          <button type="button" className={styles.secondaryButton} onClick={rememberDefaults}>Remember these ticks as my defaults</button>
          {wasSaved ? <span className={styles.hint} role="status">Saved for next time.</span> : null}
        </div>
      ) : null}
    </div>
  );
}
