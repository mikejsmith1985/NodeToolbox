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
import { useStandupRosterStore } from '../hooks/useStandupRosterStore.ts';
import { buildItemFingerprint, buildTeamAssigneeIds } from './remediationFingerprint.ts';
import { reconcile } from './remediationReconcile.ts';
import { resolveTeamScope } from './remediationScope.ts';
import type { ItemFingerprint, RemediationItem, RemediationStatus } from './remediationTypes.ts';
import { useBacklogRemediationStore } from './useBacklogRemediationStore.ts';

// How many days ahead a "Snooze" hides an item before it returns to the actionable queue.
const SNOOZE_DAYS = 14;

/** Returns today's date as YYYY-MM-DD; a small seam so the component reads the clock in exactly one place. */
function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns the YYYY-MM-DD date `days` ahead of today, for the snooze wake date. */
function isoDateDaysAhead(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

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
  const scopeOverrideJql = useBacklogRemediationStore((state) => state.scopeOverrideJql);
  const setScope = useBacklogRemediationStore((state) => state.setScope);
  const applyReconcile = useBacklogRemediationStore((state) => state.applyReconcile);
  const ingestVerdicts = useBacklogRemediationStore((state) => state.ingestVerdicts);
  const setScopeOverrideJql = useBacklogRemediationStore((state) => state.setScopeOverrideJql);
  const decide = useBacklogRemediationStore((state) => state.decide);
  const snooze = useBacklogRemediationStore((state) => state.snooze);
  const rosterMembers = useStandupRosterStore((state) => state.rosterMembers);
  const teamAssigneeIds = useMemo(() => buildTeamAssigneeIds(rosterMembers), [rosterMembers]);

  // The full issue objects + AC field ids from the last fetch, for the table's inline detail. Empty on a pure
  // resume (no fetch yet) — the verdicts still render from the persisted queue.
  const [issuesByKey, setIssuesByKey] = useState<Map<string, JiraIssue>>(new Map());
  const [acceptanceCriteriaFieldIds, setAcceptanceCriteriaFieldIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);

  // Point the store at this team's scope (and load its saved queue) whenever the active team/scope changes. Also
  // clear the previous team's fetched detail so nothing — queue or inline detail — bleeds across a team switch.
  useEffect(() => {
    setScope(teamProfileId, projectKey, piName);
    setIssuesByKey(new Map());
    setAcceptanceCriteriaFieldIds([]);
    setFetchError(null);
  }, [setScope, teamProfileId, projectKey, piName]);

  // Derive the backlog scope from the team profile (project-first), honouring the per-team JQL override. Empty
  // when nothing is derivable and no override is set — the panel then prompts for a JQL.
  const scopeJql = useMemo(
    () => resolveTeamScope({ teamProfileId, projectKey, piName, rosterMembers, activeRosterTeamName: null, scopeOverrideJql }).jql,
    [teamProfileId, projectKey, piName, rosterMembers, scopeOverrideJql],
  );

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
      const todayIso = todayIsoDate();
      const backlog = await fetchAgingBacklog(scopeJql, todayIso);
      // Fingerprint every fetched issue (status category + team-scoped assignee) so reconcile can re-admit a
      // decided item only on a material change (FR-013), never on a cosmetic edit.
      const currentFingerprintByKey = new Map<string, ItemFingerprint>();
      for (const [issueKey, issue] of backlog.issuesByKey) {
        currentFingerprintByKey.set(issueKey, buildItemFingerprint(issue, teamAssigneeIds));
      }
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

  /**
   * Captures an item's material-change fingerprint at decision time. Prefers the freshly-fetched Jira issue (full
   * status category + assignee); falls back to the item's own signals when deciding on a resumed, not-yet-refreshed
   * queue (no status category is known, but the display-name assignee can still be matched to the team).
   */
  const fingerprintForItem = (item: RemediationItem): ItemFingerprint => {
    const fetchedIssue = issuesByKey.get(item.issueKey);
    if (fetchedIssue !== undefined) {
      return buildItemFingerprint(fetchedIssue, teamAssigneeIds);
    }
    const assignee = item.signals.assignee;
    return { statusCategoryKey: '', assigneeKey: assignee !== null && teamAssigneeIds.has(assignee) ? assignee : null };
  };

  /** Records a terminal decision on an item, stamping the fingerprint used to detect a later material change. */
  const handleDecide = (item: RemediationItem, status: RemediationStatus): void => {
    decide(item.issueKey, status, fingerprintForItem(item), todayIsoDate());
  };

  /** Hides an item until SNOOZE_DAYS from now, then it returns to the actionable queue on the next reconcile. */
  const handleSnooze = (item: RemediationItem): void => {
    snooze(item.issueKey, isoDateDaysAhead(SNOOZE_DAYS));
  };

  /** Records the issues a bulk close actually transitioned in Jira as `canceled` in this team's queue. */
  const handleItemsCanceled = (issueKeys: readonly string[]): void => {
    const decidedAtIso = todayIsoDate();
    const itemByKey = new Map(items.map((item) => [item.issueKey, item]));
    for (const issueKey of issueKeys) {
      const item = itemByKey.get(issueKey);
      if (item !== undefined) {
        decide(issueKey, 'canceled', fingerprintForItem(item), decidedAtIso);
      }
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
      <label className={styles.controlLabel}>
        Scope override (JQL)
        <input
          value={scopeOverrideJql ?? ''}
          onChange={(event) => setScopeOverrideJql(event.target.value.trim() === '' ? null : event.target.value)}
          placeholder="leave blank to scope by the team's project"
          className={styles.textInput}
          style={{ minWidth: 260 }}
          aria-label="Backlog remediation scope override"
        />
      </label>
      {scopeJql === '' && (
        <p className={styles.captionText}>
          This team has no project or roster to scope from — enter a JQL override above to load its backlog.
        </p>
      )}
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
      {actionableItems.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '8px 0', padding: 0 }} aria-label="Backlog remediation decisions">
          {actionableItems.map((item) => (
            <li key={item.issueKey} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
              <code style={{ flex: '0 0 auto' }}>{item.issueKey}</code>
              {item.verdict !== null && <span className={styles.captionText}>{item.verdict}</span>}
              <span style={{ flex: '1 1 auto', minWidth: 0 }} className={styles.captionText}>{item.signals.summary}</span>
              <button type="button" className={styles.actionButton} aria-label={`Cancel ${item.issueKey}`} onClick={() => handleDecide(item, 'canceled')}>Cancel</button>
              <button type="button" className={styles.actionButton} aria-label={`Keep ${item.issueKey}`} onClick={() => handleDecide(item, 'kept')}>Keep</button>
              <button type="button" className={styles.actionButton} aria-label={`Dismiss ${item.issueKey}`} onClick={() => handleDecide(item, 'dismissed')}>Dismiss</button>
              <button type="button" className={styles.actionButton} aria-label={`Snooze ${item.issueKey}`} onClick={() => handleSnooze(item)}>Snooze</button>
            </li>
          ))}
        </ul>
      )}
      <AgingTriageActionTable
        model={triageActionModel}
        issuesByKey={issuesByKey}
        acceptanceCriteriaFieldIds={acceptanceCriteriaFieldIds}
        onItemsCanceled={handleItemsCanceled}
      />
    </ReportAiPanel>
  );
}
