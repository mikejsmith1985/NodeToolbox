// BacklogRemediationPanel.tsx — The per-team, persistent Backlog Remediation panel on the Team Dashboard.
//
// This is the actionable Aging cleanup triage, relocated so each team keeps its own resumable queue. It reuses
// the shared AI copy-prompt/paste-reply shell (ReportAiPanel, which self-gates on AI Assist), the shared enriched
// backlog fetch, the triage prompt/parse, and the grouped actionable table. What is new here is that verdicts and
// decisions live in a per-team persisted store, so reopening the panel resumes the prior state with no re-run.

import { useEffect, useMemo, useState } from 'react';

import type { JiraIssue } from '../../../types/jira.ts';
import { fetchAgingBacklog } from '../../ReportsHub/agingBacklogFetch.ts';
import { AgingTriageActionTable } from '../../ReportsHub/AgingTriageActionTable.tsx';
import { ReportAiPanel } from '../../ReportsHub/ReportAiPanel.tsx';
import {
  buildAgingTriagePrompt,
  parseAgingTriageResponse,
  type AgingTriageIssue,
  type AgingTriageSuggestion,
} from '../../ReportsHub/agingTriage.ts';
import { buildTriageActionModel } from '../../ReportsHub/agingTriageActionModel.ts';
import styles from '../../ReportsHub/ReportsHubView.module.css';
import { reconcile } from './remediationReconcile.ts';
import type { ItemFingerprint, RemediationItem } from './remediationTypes.ts';
import { useBacklogRemediationStore } from './useBacklogRemediationStore.ts';

/** Props: the active team profile identity and its project + PI scope (the storage-key inputs). */
export interface BacklogRemediationPanelProps {
  teamProfileId: string;
  projectKey: string;
  piName: string;
}

/** The item statuses that belong in the actionable queue (the table + the prompt work over these). */
function isActionable(item: RemediationItem): boolean {
  return item.status === 'pending';
}

/** Projects a queue item that already carries a verdict into the triage-action-model's suggestion shape. */
function toSuggestion(item: RemediationItem): AgingTriageSuggestion | null {
  return item.verdict === null ? null : { issueKey: item.issueKey, verdict: item.verdict, rationale: item.rationale };
}

/**
 * The Team Dashboard's Backlog Remediation panel. Renders nothing while AI Assist is locked (via ReportAiPanel).
 * On mount it points the store at this team's scope and loads any saved queue; a Refresh re-fetches the backlog
 * and reconciles it against saved decisions; ingesting a reply records verdicts on the pending items.
 */
export function BacklogRemediationPanel({ teamProfileId, projectKey, piName }: BacklogRemediationPanelProps): React.JSX.Element {
  const items = useBacklogRemediationStore((state) => state.items);
  const setScope = useBacklogRemediationStore((state) => state.setScope);
  const applyReconcile = useBacklogRemediationStore((state) => state.applyReconcile);
  const ingestVerdicts = useBacklogRemediationStore((state) => state.ingestVerdicts);

  // The full issue objects + AC field ids from the last fetch, for the table's inline detail. Empty on a pure
  // resume (no fetch yet) — the verdicts still render from the persisted queue.
  const [issuesByKey, setIssuesByKey] = useState<Map<string, JiraIssue>>(new Map());
  const [acceptanceCriteriaFieldIds, setAcceptanceCriteriaFieldIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);

  // Point the store at this team's scope (and load its saved queue) whenever the active scope changes.
  useEffect(() => {
    setScope(teamProfileId, projectKey, piName);
  }, [setScope, teamProfileId, projectKey, piName]);

  // Until US3 wires the full team-scope resolver, derive a simple project-scoped query.
  const scopeJql = projectKey.trim() === '' ? '' : `project = ${projectKey}`;

  const actionableItems = useMemo(() => items.filter(isActionable), [items]);
  const actionableSignals = useMemo<AgingTriageIssue[]>(() => actionableItems.map((item) => item.signals), [actionableItems]);
  const suggestions = useMemo<AgingTriageSuggestion[]>(
    () => actionableItems.map(toSuggestion).filter((suggestion): suggestion is AgingTriageSuggestion => suggestion !== null),
    [actionableItems],
  );
  const prompt = useMemo(() => buildAgingTriagePrompt(actionableSignals), [actionableSignals]);
  const triageActionModel = useMemo(() => buildTriageActionModel(suggestions, actionableSignals), [suggestions, actionableSignals]);

  /** Re-fetches the backlog for the current scope and reconciles it against the saved decisions. */
  const handleRefresh = async (): Promise<void> => {
    if (scopeJql === '') {
      return;
    }
    setIsLoading(true);
    setFetchError(null);
    try {
      const todayIso = new Date().toISOString().slice(0, 10);
      const backlog = await fetchAgingBacklog(scopeJql, todayIso);
      // US4 supplies the real status-category/assignee fingerprints; until then material-change re-entry is a
      // no-op (an empty map leaves terminal items terminal), which is correct for the resume-focused MVP.
      const currentFingerprintByKey = new Map<string, ItemFingerprint>();
      const nextItems = reconcile(useBacklogRemediationStore.getState().items, backlog.triageIssues, currentFingerprintByKey, todayIso);
      applyReconcile(nextItems, todayIso);
      setIssuesByKey(backlog.issuesByKey);
      setAcceptanceCriteriaFieldIds(backlog.acceptanceCriteriaFieldIds);
    } catch (caughtError) {
      setFetchError(caughtError instanceof Error ? caughtError.message : 'Failed to fetch the backlog.');
    } finally {
      setIsLoading(false);
    }
  };

  /** Parses a pasted assistant reply into verdicts, keeping only issues currently shown, and records them. */
  const handleIngest = (responseText: string): void => {
    try {
      const shownKeys = new Set(actionableSignals.map((signal) => signal.issueKey));
      const parsed = parseAgingTriageResponse(responseText).filter((item) => shownKeys.has(item.issueKey));
      ingestVerdicts(parsed);
      setIngestError(null);
    } catch (caughtError) {
      setIngestError(caughtError instanceof Error ? caughtError.message : 'Could not read the response.');
    }
  };

  return (
    <ReportAiPanel
      title="Backlog remediation triage"
      prompt={prompt}
      ingestLabel="Ingest verdicts"
      onIngest={handleIngest}
      error={ingestError}
    >
      <div className={styles.aiPanelActions}>
        <button
          type="button"
          className={`${styles.actionButton} ${styles.primaryButton}`}
          onClick={() => void handleRefresh()}
          disabled={isLoading || scopeJql === ''}
        >
          {isLoading ? 'Refreshing…' : 'Refresh backlog'}
        </button>
      </div>
      {fetchError !== null && <p role="alert" className={styles.warningText}>{fetchError}</p>}
      <AgingTriageActionTable
        model={triageActionModel}
        issuesByKey={issuesByKey}
        acceptanceCriteriaFieldIds={acceptanceCriteriaFieldIds}
      />
    </ReportAiPanel>
  );
}
