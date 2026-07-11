// AgingBulkClosePanel.tsx — Preview-then-commit panel that transitions a feature + its items to one status.
//
// Opened from a cancel-safe feature group, this lists the feature and every supporting issue as an opt-out
// checklist, discovers the workflow transitions each can make, and lets the operator pick ONE target status
// to move them all to. Following the app's Review & Commit safety model, nothing is written to Jira until
// the operator presses Commit; each issue then transitions individually and shows its own result, so one
// issue lacking the transition or failing never blocks the others. Writes reuse the Feature Review helpers.

import { useEffect, useMemo, useState } from 'react';

import { fetchFeatureReviewTransitions, saveFeatureReviewTransition } from '../SprintDashboard/featureReviewFixes.ts';
import type { JiraTransition } from '../../types/jira.ts';
import {
  findTransitionToStatus,
  runBulkTransition,
  summarizeTargetStatuses,
  type BulkTransitionResult,
} from './agingBulkTransition.ts';
import type { TriageFeatureGroup } from './agingTriageActionModel.ts';
import styles from './ReportsHubView.module.css';

/** Props: the cancel-safe feature group to act on, and a callback to close the panel. */
export interface AgingBulkClosePanelProps {
  featureGroup: TriageFeatureGroup;
  onClose: () => void;
}

/** One selectable row in the preview: the feature itself or one of its supporting issues. */
interface BulkRow {
  key: string;
  summary: string;
  status: string;
  isFeature: boolean;
}

/** Builds the ordered preview rows: the feature (when present) first, then its supporting issues. */
function buildBulkRows(featureGroup: TriageFeatureGroup): BulkRow[] {
  const featureRow: BulkRow[] = featureGroup.featureKey !== null
    ? [{ key: featureGroup.featureKey, summary: featureGroup.featureSummary ?? '', status: featureGroup.featureStatus ?? '', isFeature: true }]
    : [];
  const issueRows = featureGroup.issues.map((issue) => ({ key: issue.issueKey, summary: issue.summary, status: issue.status, isFeature: false }));
  return [...featureRow, ...issueRows];
}

/** CSS class for a per-issue commit result badge. */
function resultClass(outcome: BulkTransitionResult['outcome']): string {
  if (outcome === 'done') {
    return styles.bulkResultDone;
  }
  return outcome === 'skipped' ? styles.bulkResultSkipped : styles.bulkResultFailed;
}

/** The gated preview → commit panel for moving a feature and its items to one target status. */
export function AgingBulkClosePanel({ featureGroup, onClose }: AgingBulkClosePanelProps): React.JSX.Element {
  const rows = useMemo(() => buildBulkRows(featureGroup), [featureGroup]);

  const [transitionsByKey, setTransitionsByKey] = useState<Map<string, JiraTransition[]>>(new Map());
  const [isLoadingTransitions, setIsLoadingTransitions] = useState(true);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set(rows.map((row) => row.key)));
  const [targetStatus, setTargetStatus] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [results, setResults] = useState<BulkTransitionResult[] | null>(null);

  // Discover each candidate issue's available transitions once, tolerating a per-issue failure (that issue
  // simply offers no transitions and will be skipped). The default target is the most-widely-reachable status.
  useEffect(() => {
    let isActive = true;
    async function loadTransitions(): Promise<void> {
      const entries = await Promise.all(rows.map(async (row) => {
        const transitions = await fetchFeatureReviewTransitions(row.key).catch(() => [] as JiraTransition[]);
        return [row.key, transitions] as const;
      }));
      if (!isActive) {
        return;
      }
      const byKey = new Map(entries);
      setTransitionsByKey(byKey);
      const options = summarizeTargetStatuses(byKey);
      setTargetStatus((current) => current || (options[0]?.statusName ?? ''));
      setIsLoadingTransitions(false);
    }
    void loadTransitions();
    return () => { isActive = false; };
  }, [rows]);

  const targetOptions = useMemo(() => summarizeTargetStatuses(transitionsByKey), [transitionsByKey]);

  const toggleRow = (key: string): void => {
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectedCount = rows.filter((row) => selectedKeys.has(row.key)).length;
  const hasResults = results !== null;

  const commit = async (): Promise<void> => {
    const keysToCommit = rows.filter((row) => selectedKeys.has(row.key)).map((row) => row.key);
    setIsCommitting(true);
    try {
      setResults(await runBulkTransition(keysToCommit, targetStatus, transitionsByKey, saveFeatureReviewTransition));
    } finally {
      setIsCommitting(false);
    }
  };

  const resultByKey = new Map((results ?? []).map((result) => [result.issueKey, result]));

  return (
    <div className={styles.bulkPanel}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className={styles.bulkPanelTitle}>
          Close {featureGroup.featureKey ?? 'these items'}{featureGroup.featureKey ? ' + supporting items' : ''}
        </span>
        <span className={styles.featureGroupSpacer} />
        <button type="button" className={styles.actionButton} onClick={onClose}>Close</button>
      </div>

      <label className={styles.controlLabel} style={{ maxWidth: 320 }}>
        Move selected to status
        <select
          className={styles.filterSelect}
          value={targetStatus}
          disabled={isLoadingTransitions || hasResults}
          onChange={(event) => setTargetStatus(event.target.value)}
        >
          {isLoadingTransitions && <option value="">Loading transitions…</option>}
          {!isLoadingTransitions && targetOptions.length === 0 && <option value="">No transitions available</option>}
          {targetOptions.map((option) => (
            <option key={option.statusName} value={option.statusName}>
              {option.statusName} (reachable by {option.availableCount}/{rows.length})
            </option>
          ))}
        </select>
      </label>

      <p className={styles.bulkSafetyNote}>Nothing is written to Jira until you press Commit.</p>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((row) => {
          const result = resultByKey.get(row.key);
          const isSelected = selectedKeys.has(row.key);
          const willSkip = isSelected && !hasResults && !isLoadingTransitions && targetStatus !== ''
            && findTransitionToStatus(transitionsByKey.get(row.key) ?? [], targetStatus) === null;
          return (
            <li key={row.key} className={`${styles.bulkRow} ${row.isFeature ? styles.bulkRowFeature : ''}`}>
              <input
                type="checkbox"
                aria-label={`Include ${row.key}`}
                checked={isSelected}
                disabled={hasResults || isCommitting}
                onChange={() => toggleRow(row.key)}
              />
              <span className={styles.issueRowKey}>{row.key}</span>
              <span className={styles.issueRowText}>{row.isFeature ? `Feature · ${row.summary}` : row.summary}</span>
              <span className={styles.bulkRowStatus}>{row.status}</span>
              {willSkip && <span className={styles.bulkResultSkipped}>no “{targetStatus}” transition</span>}
              {result && <span className={`${styles.bulkRowResult} ${resultClass(result.outcome)}`}>{result.outcome === 'done' ? '✓ ' : result.outcome === 'skipped' ? '⏭ ' : '✕ '}{result.message}</span>}
            </li>
          );
        })}
      </ul>

      {!hasResults && (
        <div className={styles.aiPanelActions}>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.primaryButton}`}
            disabled={selectedCount === 0 || targetStatus === '' || isCommitting || isLoadingTransitions}
            onClick={() => void commit()}
          >
            {isCommitting ? 'Committing…' : `Commit ${selectedCount} change(s)`}
          </button>
        </div>
      )}
      {hasResults && <p className={styles.captionText}>Done. Re-run the report to refresh the aged backlog.</p>}
    </div>
  );
}
