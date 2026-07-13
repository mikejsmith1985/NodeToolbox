// remediationTypes.ts — Domain types for the per-team, persistent Backlog Remediation queue.
//
// A remediation queue is one team's standing set of triaged backlog issues plus the decisions made about each.
// It persists per team so cleanup accrues over time instead of resetting on every run, and it remembers enough
// about each handled item (a fingerprint of its status category + team ownership) to know when a genuine change
// should bring a decided item back for another look — without cosmetic edits resurfacing it.

import type { AgingTriageIssue, AgingTriageVerdict } from '../../ReportsHub/agingTriage.ts';

// ── Lifecycle ──────────────────────────────────────────────────────────────────

/**
 * Where an item sits in the remediation lifecycle:
 *   • pending    — awaiting a decision; shown in the actionable queue.
 *   • canceled   — closed/transitioned via bulk close (terminal until a material change).
 *   • kept       — explicitly decided to keep (terminal until a material change).
 *   • dismissed  — "not cleanup-worthy right now" (terminal until a material change).
 *   • snoozed    — hidden until `snoozeUntilIso`, then reverts to pending.
 */
export type RemediationStatus = 'pending' | 'canceled' | 'kept' | 'dismissed' | 'snoozed';

/** The three statuses that hold an item out of the actionable queue until a material change (FR-013). */
export const TERMINAL_REMEDIATION_STATUSES: readonly RemediationStatus[] = ['canceled', 'kept', 'dismissed'];

// ── Material-change detection ────────────────────────────────────────────────────

/**
 * The minimal signals that decide whether a handled item deserves another look. Recorded at decision time and
 * compared on refresh: a change in status category (e.g. reopened) or a reassignment INTO the team is material;
 * everything else (labels, rank, description, a bare `updated` bump) is cosmetic and must not resurface the item.
 */
export interface ItemFingerprint {
  /** Jira status category key at decision time (e.g. `new`, `indeterminate`, `done`). */
  statusCategoryKey: string;
  /** Assignee machine id at decision time, but ONLY when that assignee is a member of the active team; else null. */
  assigneeKey: string | null;
}

// ── Queue items ──────────────────────────────────────────────────────────────────

/** One backlog issue tracked in a team's remediation queue: its AI verdict plus its lifecycle state. */
export interface RemediationItem {
  /** Jira issue key — the item's identity within the queue. */
  issueKey: string;
  /** The last ingested AI verdict, or null before any triage reply has been ingested for this item. */
  verdict: AgingTriageVerdict | null;
  /** The AI rationale accompanying the verdict; empty when there is none yet. */
  rationale: string;
  /** Where the item currently sits in the lifecycle; new items start `pending`. */
  status: RemediationStatus;
  /** Set only while `status === 'snoozed'`: the date the item returns to the actionable queue. */
  snoozeUntilIso: string | null;
  /** Recorded when a terminal decision is made; used to detect a later material change. Null while `pending`. */
  fingerprint: ItemFingerprint | null;
  /** When the current status was set, for audit. Null while an item has never been decided. */
  decidedAtIso: string | null;
  /** The enriched triage signals the verdict was judged on; refreshed to the latest fetch on each reconcile. */
  signals: AgingTriageIssue;
}

/** One team scope's persisted remediation state — the blob stored under the team-scoped localStorage key. */
export interface RemediationQueue {
  /** The localStorage key this queue persists under: `tbxBacklogRemediation:<teamProfileId>:<scope>`. */
  storageKey: string;
  /** Every tracked item, in every status; the actionable subset is derived on read. */
  items: RemediationItem[];
  /** When the backlog was last re-fetched and reconciled; null before the first run. */
  lastRefreshedIso: string | null;
  /** An operator JQL override for this team, or null to derive the scope from the team profile. */
  scopeOverrideJql: string | null;
}

// ── Scope ────────────────────────────────────────────────────────────────────────

/** The resolved backlog scope for one fetch: the team identity plus the JQL to query. */
export interface TeamScope {
  /** Active dashboard team profile id — the storage-key segment. */
  teamProfileId: string;
  /** The scope's project key (from the live sprint data / team profile). */
  projectKey: string;
  /** The scope's PI name (from the live sprint data / team profile). */
  piName: string;
  /** The derived (or overridden) backlog JQL, already wrapped by `buildAgingJql`; empty when nothing is derivable. */
  jql: string;
}
