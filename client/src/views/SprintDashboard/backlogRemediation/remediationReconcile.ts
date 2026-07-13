// remediationReconcile.ts — The pure merge at the heart of the Backlog Remediation queue.
//
// Given a team's saved decisions and a freshly-fetched backlog, it produces the next queue: newly-seen issues
// enter as pending, items that left the backlog are dropped, snoozes elapse, and decided items stay decided
// UNLESS a material change (a status-category change or a reassignment into the team) earns them another look.
// It touches no Jira, no React, and no clock — `todayIso` is injected — so it is fully deterministic and testable.

import type { AgingTriageIssue } from '../../ReportsHub/agingTriage.ts';
import {
  TERMINAL_REMEDIATION_STATUSES,
  type ItemFingerprint,
  type RemediationItem,
} from './remediationTypes.ts';

/**
 * Reconciles saved remediation decisions against the current backlog.
 *
 * @param savedItems              the team's previously-tracked items (any status)
 * @param fetched                 the current NOT-Done backlog for the team scope, as triage signals
 * @param currentFingerprintByKey the fingerprint (status category + team-scoped assignee) of each fetched issue NOW
 * @param todayIso                the injected "today" used to elapse snoozes
 * @returns                       the next queue, in fetched order (dropped items excluded)
 */
export function reconcile(
  savedItems: readonly RemediationItem[],
  fetched: readonly AgingTriageIssue[],
  currentFingerprintByKey: ReadonlyMap<string, ItemFingerprint>,
  todayIso: string,
): RemediationItem[] {
  const savedByKey = new Map(savedItems.map((item) => [item.issueKey, item]));

  // Only fetched issues survive — an item absent from the fetch has left the backlog (or the team) and is dropped.
  return fetched.map((signals) => {
    const saved = savedByKey.get(signals.issueKey);
    if (saved === undefined) {
      return createPendingItem(signals);
    }
    const currentFingerprint = currentFingerprintByKey.get(signals.issueKey) ?? null;
    return reconcileExistingItem(saved, signals, currentFingerprint, todayIso);
  });
}

// ── Per-item reconciliation ──────────────────────────────────────────────────────

/** Builds a brand-new pending item for a backlog issue we have never tracked before. */
function createPendingItem(signals: AgingTriageIssue): RemediationItem {
  return {
    issueKey: signals.issueKey,
    verdict: null,
    rationale: '',
    status: 'pending',
    snoozeUntilIso: null,
    fingerprint: null,
    decidedAtIso: null,
    signals,
  };
}

/**
 * Advances one already-tracked item: refresh its signals, elapse a due snooze, and re-admit a decided item only
 * on a material change. A pending item simply keeps its state with refreshed signals.
 */
function reconcileExistingItem(
  saved: RemediationItem,
  signals: AgingTriageIssue,
  currentFingerprint: ItemFingerprint | null,
  todayIso: string,
): RemediationItem {
  // Always show the latest facts (age, status, assignee) regardless of lifecycle state.
  const refreshed: RemediationItem = { ...saved, signals };

  if (refreshed.status === 'snoozed') {
    return hasSnoozeElapsed(refreshed.snoozeUntilIso, todayIso)
      ? { ...refreshed, status: 'pending', snoozeUntilIso: null }
      : refreshed;
  }

  if (isTerminal(refreshed.status) && isMaterialChange(refreshed.fingerprint, currentFingerprint)) {
    return { ...refreshed, status: 'pending', fingerprint: null };
  }

  return refreshed;
}

// ── Predicates ───────────────────────────────────────────────────────────────────

/** True when a snoozed item's wake date is today or earlier. A missing date is treated as already elapsed. */
function hasSnoozeElapsed(snoozeUntilIso: string | null, todayIso: string): boolean {
  if (snoozeUntilIso === null) {
    return true;
  }
  return todayIso >= snoozeUntilIso;
}

/** True when a status holds an item out of the actionable queue until a material change. */
function isTerminal(status: RemediationItem['status']): boolean {
  return TERMINAL_REMEDIATION_STATUSES.includes(status);
}

/**
 * A change is material (FR-013) when the item's status CATEGORY differs from what it was at decision time, or it
 * has been newly assigned to a team member (recorded assignee was null, current team-scoped assignee is set).
 * Any other difference — labels, rank, description, a reassignment to a non-team user — is cosmetic.
 */
function isMaterialChange(recorded: ItemFingerprint | null, current: ItemFingerprint | null): boolean {
  if (recorded === null || current === null) {
    return false;
  }
  const categoryChanged = current.statusCategoryKey !== recorded.statusCategoryKey;
  const newlyAssignedIntoTeam = recorded.assigneeKey === null && current.assigneeKey !== null;
  return categoryChanged || newlyAssignedIntoTeam;
}
