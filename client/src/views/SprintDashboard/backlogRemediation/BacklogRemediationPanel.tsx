// BacklogRemediationPanel.tsx — The per-team, persistent Backlog Remediation panel on the Team Dashboard.
//
// This is the actionable Aging cleanup triage, relocated so each team keeps its own resumable queue. It reuses
// the shared AI copy-prompt/paste-reply shell (ReportAiPanel, which self-gates on AI Assist), the shared enriched
// backlog fetch, the triage prompt/parse, and the grouped actionable table. What is new here is that verdicts and
// decisions live in a per-team persisted store, so reopening the panel resumes the prior state with no re-run.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AssigneeAvatar } from '../../../components/IssueMeta/AssigneeAvatar.tsx';
import { StatusChip } from '../../../components/IssueMeta/StatusChip.tsx';
import type { JiraIssue } from '../../../types/jira.ts';
import { readAcceptanceCriteriaText } from '../../../utils/acceptanceCriteria.ts';
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
 * Renders one item's decision context — status, owner, and acceptance criteria — beside its action buttons.
 * The context is read from the item's freshly-fetched Jira issue; while that detail is still loading it shows a
 * compact loading note, and if it never arrives an explicit "unavailable" note — so a live button is never left
 * next to a silent blank (FR-015, FR-017).
 */
function RemediationDecisionContext({ issue, acceptanceCriteriaText, isHydrating }: {
  issue: JiraIssue | undefined;
  acceptanceCriteriaText: string | null;
  isHydrating: boolean;
}): React.JSX.Element {
  if (issue !== undefined) {
    return (
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        <StatusChip statusName={issue.fields.status?.name ?? ''} statusCategoryKey={issue.fields.status?.statusCategory?.key} />
        <AssigneeAvatar displayName={issue.fields.assignee?.displayName ?? null} />
        {acceptanceCriteriaText !== null && (
          <span className={styles.captionText}><strong>AC:</strong> {acceptanceCriteriaText}</span>
        )}
      </span>
    );
  }
  if (isHydrating) {
    return <span role="status" className={styles.captionText}>Loading context…</span>;
  }
  return <span className={styles.captionText}>Context unavailable</span>;
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
  // True while the on-load detail hydration is in flight — drives the per-item "Loading context…" note so no
  // action button is ever shown next to a blank context region (FR-016, FR-017).
  const [isHydratingDetails, setIsHydratingDetails] = useState(false);
  // The scope whose detail we have already hydrated (or refreshed), so the auto-hydration fires at most once per
  // scope and a manual Refresh is not immediately followed by a redundant fetch.
  const hydratedScopeRef = useRef<string | null>(null);

  // Point the store at this team's scope, which loads its saved queue.
  //
  // Nothing local is cleared here any more: SprintDashboardView keys this panel by scope, so a team
  // switch remounts it and every local value starts fresh. That is both simpler and more thorough —
  // the manual reset cleared three of the five, leaving a previous team's isLoading and ingestError
  // on screen.
  useEffect(() => {
    setScope(teamProfileId, projectKey, piName);
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

  /**
   * Fetches the enriched backlog only to populate each item's inline detail (full issue + AC field ids). Unlike a
   * Refresh, it deliberately does NOT reconcile or touch the persisted queue — this is pure read-side hydration so
   * a resumed session can show decision context. A failed fetch simply leaves the detail empty; each item then
   * reports an honest "Context unavailable" note rather than a blank.
   */
  const hydrateDetails = useCallback(async (): Promise<void> => {
    if (scopeJql === '') {
      return;
    }
    setIsHydratingDetails(true);
    try {
      const backlog = await fetchAgingBacklog(scopeJql, todayIsoDate());
      setIssuesByKey(backlog.issuesByKey);
      setAcceptanceCriteriaFieldIds(backlog.acceptanceCriteriaFieldIds);
    } catch {
      // Detail is best-effort: the per-item note reports "Context unavailable" when hydration fails.
    } finally {
      setIsHydratingDetails(false);
    }
  }, [scopeJql]);

  // Hydrate each actionable item's full Jira detail once per scope on LOAD — not only when the operator hits
  // Refresh — so a resumed session shows status / owner / AC beside every action button (FR-016). A manual
  // Refresh marks the scope hydrated, so it is never followed by a second, redundant fetch. Mirrors the
  // ref-guarded auto-load pattern used by ArtView's BlueprintTab.
  useEffect(() => {
    if (scopeJql === '' || actionableItems.length === 0 || hydratedScopeRef.current === scopeJql) {
      return;
    }
    hydratedScopeRef.current = scopeJql;
    void hydrateDetails();
  }, [scopeJql, actionableItems.length, hydrateDetails]);

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
      // A manual Refresh has now supplied this scope's detail, so the on-load auto-hydration must not re-fetch it.
      hydratedScopeRef.current = scopeJql;
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
    // The triage workflow (scope, refresh, manual decisions, action table) renders unconditionally —
    // it does not need AI. Only the copy/paste verdict accelerator below self-gates on Ctrl+Alt+Z, so
    // the tab is fully usable without unlocking AI (which previously blanked the whole panel).
    <>
      <h3 style={{ margin: '0 0 4px' }}>Backlog remediation</h3>
      <p className={styles.captionText}>
        Triage this team&apos;s aging backlog — Keep, Cancel, Dismiss, or Snooze stale items. Decisions
        persist per team and resume when you return.
      </p>
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
          {actionableItems.map((item) => {
            // Read this item's decision context from its freshly-fetched issue; both live beside its own buttons.
            const fullIssue = issuesByKey.get(item.issueKey);
            const acceptanceCriteriaText = fullIssue !== undefined
              ? readAcceptanceCriteriaText(fullIssue, acceptanceCriteriaFieldIds)
              : null;
            return (
              <li
                key={item.issueKey}
                style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 0', borderTop: '1px solid rgba(127,127,127,0.2)' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  <code style={{ flex: '0 0 auto' }}>{item.issueKey}</code>
                  {item.verdict !== null && <span className={styles.captionText}>{item.verdict}</span>}
                  <RemediationDecisionContext
                    issue={fullIssue}
                    acceptanceCriteriaText={acceptanceCriteriaText}
                    isHydrating={isHydratingDetails}
                  />
                </div>
                <span className={styles.captionText}>{item.signals.summary}</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button type="button" className={styles.actionButton} aria-label={`Cancel ${item.issueKey}`} onClick={() => handleDecide(item, 'canceled')}>Cancel</button>
                  <button type="button" className={styles.actionButton} aria-label={`Keep ${item.issueKey}`} onClick={() => handleDecide(item, 'kept')}>Keep</button>
                  <button type="button" className={styles.actionButton} aria-label={`Dismiss ${item.issueKey}`} onClick={() => handleDecide(item, 'dismissed')}>Dismiss</button>
                  <button type="button" className={styles.actionButton} aria-label={`Snooze ${item.issueKey}`} onClick={() => handleSnooze(item)}>Snooze</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <AgingTriageActionTable
        model={triageActionModel}
        issuesByKey={issuesByKey}
        acceptanceCriteriaFieldIds={acceptanceCriteriaFieldIds}
        onItemsCanceled={handleItemsCanceled}
      />

      {/* Optional AI accelerator: proposes verdicts to copy/paste. Self-gates on Ctrl+Alt+Z and
          renders nothing while locked, so it never blocks the manual triage above. */}
      <ReportAiPanel
        title="Backlog remediation triage"
        prompt={prompt}
        ingestLabel="Ingest verdicts"
        onIngest={handleIngest}
        error={ingestError}
      />
    </>
  );
}
