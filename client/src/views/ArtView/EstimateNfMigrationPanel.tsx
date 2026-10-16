// EstimateNfMigrationPanel.tsx — Previews, then runs, the move from story points to Estimate (NF) (GH #449).
//
// Estimate (NF) replaces story points as an Epic's size in the PI Review. This panel finds the team's Epics that
// still hold story points and shows what will happen to each BEFORE anything is written; one click then copies
// each value into Estimate (NF), confirms it, and clears story points — reporting every Epic's outcome.

import { useState } from 'react';

import styles from './PiReviewTab.module.css';
import type { EstimateNfMigrationPlan, EstimateNfMigrationResult } from './estimateNfMigration.ts';

interface EstimateNfMigrationPanelProps {
  /** Finds the Epics with story points and plans each one. */
  loadPlans: () => Promise<{ plans: EstimateNfMigrationPlan[]; isTruncated: boolean }>;
  /** Carries the plans out in Jira. */
  runPlans: (plans: EstimateNfMigrationPlan[]) => Promise<EstimateNfMigrationResult[]>;
}

const ACTION_LABELS: Readonly<Record<EstimateNfMigrationPlan['action'], string>> = {
  move: 'Move to Estimate (NF), then clear story points',
  clear: 'Already matches — clear story points',
  conflict: '⚠️ Different value already in Estimate (NF) — left alone',
  none: 'Nothing to do',
};
const OUTCOME_ICONS: Readonly<Record<EstimateNfMigrationResult['outcome'], string>> = {
  moved: '✅', cleared: '✅', skipped: '⏭️', failed: '❌',
};

/** "2 to move, 1 to clear, 1 conflict" — what the run will do, before it does it. */
function describePlans(plans: readonly EstimateNfMigrationPlan[]): string {
  const countAction = (action: EstimateNfMigrationPlan['action']) => plans.filter((plan) => plan.action === action).length;
  const conflictCount = countAction('conflict');
  return `${countAction('move')} to move, ${countAction('clear')} to clear, ${conflictCount} conflict${conflictCount === 1 ? '' : 's'}.`;
}

/** The preview table: one row per Epic with its current values and what will happen. */
function PlanTable({ plans, resultsByKey }: { plans: readonly EstimateNfMigrationPlan[]; resultsByKey: ReadonlyMap<string, EstimateNfMigrationResult> }) {
  return (
    <div className={styles.tableShell}>
      <table className={styles.dataTable}>
        <thead>
          <tr><th>Epic</th><th>Summary</th><th>Story points</th><th>Estimate (NF)</th><th>What happens</th></tr>
        </thead>
        <tbody>
          {plans.map((plan) => {
            const result = resultsByKey.get(plan.issueKey);
            return (
              <tr key={plan.issueKey}>
                <td>{plan.issueKey}</td>
                <td>{plan.summary}</td>
                <td>{plan.storyPointsValue}</td>
                <td>{plan.estimateNfValue || '—'}</td>
                <td>{result ? `${OUTCOME_ICONS[result.outcome]} ${result.message}` : ACTION_LABELS[plan.action]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The reconciliation: find, preview, run, report. */
export function EstimateNfMigrationPanel({ loadPlans, runPlans }: EstimateNfMigrationPanelProps) {
  const [plans, setPlans] = useState<EstimateNfMigrationPlan[] | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [results, setResults] = useState<EstimateNfMigrationResult[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleFind = async () => {
    setIsBusy(true);
    setErrorMessage('');
    setResults([]);
    try {
      const loaded = await loadPlans();
      setPlans(loaded.plans);
      setIsTruncated(loaded.isTruncated);
    } catch (loadError) {
      setErrorMessage(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsBusy(false);
    }
  };

  const handleRun = async () => {
    if (plans === null) return;
    setIsBusy(true);
    try {
      setResults(await runPlans(plans));
    } finally {
      setIsBusy(false);
    }
  };

  const hasRun = results.length > 0;
  const hasWork = plans !== null && plans.some((plan) => plan.action === 'move' || plan.action === 'clear');
  return (
    <div className={styles.pagePanel} data-export-exclude="true">
      <strong>Estimate (NF) replaces story points for Epics.</strong>
      <p className={styles.pullFeaturesHint}>
        Finds every Epic your Product Owners own, in every PI, that still holds story points. Nothing is written until
        you have seen the list. Each value is copied into Estimate (NF), read back to confirm it landed, and only then
        are story points cleared. An Epic whose Estimate (NF) already holds a different value is left for you.
      </p>
      <div className={styles.toolbar}>
        <button className={`${styles.actionButton} ${styles.actionButtonSecondary}`} disabled={isBusy} onClick={() => void handleFind()} type="button">
          {isBusy && plans === null ? 'Searching…' : '🔍 Find Epics with story points'}
        </button>
        {hasWork && !hasRun ? (
          <button className={`${styles.actionButton} ${styles.actionButtonPrimary}`} disabled={isBusy} onClick={() => void handleRun()} type="button">
            {isBusy ? 'Moving…' : 'Move story points to Estimate (NF)'}
          </button>
        ) : null}
      </div>
      {errorMessage ? <p className={styles.errorText} role="alert">{errorMessage}</p> : null}
      {plans !== null && plans.length === 0 ? <p className={styles.pullFeaturesHint}>No Epics have story points left — nothing to move.</p> : null}
      {plans !== null && plans.length > 0 ? (
        <>
          <p className={styles.pullFeaturesHint}>{describePlans(plans)}</p>
          {isTruncated ? <p className={styles.errorText}>More Epics match than could be read at once — run this again after this batch.</p> : null}
          <PlanTable plans={plans} resultsByKey={new Map(results.map((result) => [result.issueKey, result]))} />
        </>
      ) : null}
    </div>
  );
}
