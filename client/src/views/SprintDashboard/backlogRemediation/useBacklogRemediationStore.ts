// useBacklogRemediationStore.ts — Per-team, persistent state for the Backlog Remediation panel.
//
// One team's remediation queue belongs to a specific team profile AND its project + PI scope — exactly like the
// re-allocation planner's per-canvas store (feature 012). So this keys its localStorage entry the same way (team
// profile id + the shared scope key) under its own prefix, giving every team its own resumable queue with no
// cross-scope bleed. Every mutation writes through; a corrupt or missing blob loads as an empty queue.

import { create } from 'zustand';

import { deriveScopeKey } from '../../FeatureCanvas/overlay/overlayStorage.ts';
import { resolveTeamScopedStorageProfileId } from '../hooks/teamScopedStorage.ts';
import type { AgingTriageSuggestion } from '../../ReportsHub/agingTriage.ts';
import type { ItemFingerprint, RemediationItem, RemediationStatus } from './remediationTypes.ts';

const BACKLOG_REMEDIATION_BASE_KEY = 'tbxBacklogRemediation';

/** The persisted shape written under a scope's key (the store's storageKey lives in React state, not on disk). */
interface PersistedQueue {
  items: RemediationItem[];
  lastRefreshedIso: string | null;
  scopeOverrideJql: string | null;
}

const EMPTY_QUEUE: PersistedQueue = { items: [], lastRefreshedIso: null, scopeOverrideJql: null };

interface BacklogRemediationState {
  /** The localStorage key the current scope persists under; null until a scope is set. */
  storageKey: string | null;
  /** Every tracked item for the current scope, in every status. */
  items: RemediationItem[];
  /** When the current scope's backlog was last reconciled; null before the first run. */
  lastRefreshedIso: string | null;
  /** The current scope's operator JQL override, or null to derive scope from the team profile. */
  scopeOverrideJql: string | null;

  /** Point the store at a team scope and LOAD that scope's persisted queue. */
  setScope: (teamProfileId: string, projectKey: string, piName: string) => void;
  /** Replace the item set with a freshly-reconciled one, stamp the refresh time, and persist. */
  applyReconcile: (nextItems: RemediationItem[], todayIso: string) => void;
  /** Set verdict + rationale on the matching pending items from an ingested triage reply; persist. */
  ingestVerdicts: (suggestions: readonly AgingTriageSuggestion[]) => void;
  /** Move a pending item to a terminal decision, recording its fingerprint; persist. */
  decide: (issueKey: string, status: RemediationStatus, fingerprint: ItemFingerprint, decidedAtIso: string) => void;
  /** Snooze a pending item until a date; persist. */
  snooze: (issueKey: string, snoozeUntilIso: string) => void;
  /** Manually return a terminal/snoozed item to pending; persist. */
  reopen: (issueKey: string) => void;
  /** Set (or clear) the per-team JQL override; persist. */
  setScopeOverrideJql: (jql: string | null) => void;
}

// ── localStorage helpers (private-browsing tolerant) ──────────────────────────────

/** Guards localStorage access so disabled/blocked storage degrades to in-memory use. */
function canUseLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/** Composes `tbxBacklogRemediation:<teamProfileId>:<scopeKey>`, matching the feature 012 pattern. */
function buildStorageKey(teamProfileId: string, projectKey: string, piName: string): string {
  const resolvedProfileId = resolveTeamScopedStorageProfileId(teamProfileId);
  return `${BACKLOG_REMEDIATION_BASE_KEY}:${resolvedProfileId}:${deriveScopeKey(projectKey, piName)}`;
}

/** Reads and validates a scope's queue, degrading to an empty queue on any failure (FR-012). */
function readQueue(storageKey: string): PersistedQueue {
  if (!canUseLocalStorage()) {
    return EMPTY_QUEUE;
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return EMPTY_QUEUE;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedQueue>;
    if (!Array.isArray(parsed.items)) {
      return EMPTY_QUEUE;
    }
    return {
      items: parsed.items,
      lastRefreshedIso: typeof parsed.lastRefreshedIso === 'string' ? parsed.lastRefreshedIso : null,
      scopeOverrideJql: typeof parsed.scopeOverrideJql === 'string' ? parsed.scopeOverrideJql : null,
    };
  } catch {
    return EMPTY_QUEUE;
  }
}

/** Persists a scope's queue; storage failures are non-fatal (the in-memory value stays authoritative). */
function writeQueue(storageKey: string, queue: PersistedQueue): void {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(queue));
  } catch {
    // Session-only fallback when storage is unavailable or full.
  }
}

// ── Store ──────────────────────────────────────────────────────────────────────

/** Zustand store for one team scope's persistent Backlog Remediation queue. */
export const useBacklogRemediationStore = create<BacklogRemediationState>((setState, getState) => {
  /** Persists the current in-memory queue under the active storage key, when one is set. */
  function persistCurrent(): void {
    const { storageKey, items, lastRefreshedIso, scopeOverrideJql } = getState();
    if (storageKey !== null) {
      writeQueue(storageKey, { items, lastRefreshedIso, scopeOverrideJql });
    }
  }

  return {
    storageKey: null,
    items: [],
    lastRefreshedIso: null,
    scopeOverrideJql: null,

    setScope: (teamProfileId, projectKey, piName) => {
      const storageKey = buildStorageKey(teamProfileId, projectKey, piName);
      const queue = readQueue(storageKey);
      setState({ storageKey, items: queue.items, lastRefreshedIso: queue.lastRefreshedIso, scopeOverrideJql: queue.scopeOverrideJql });
    },

    applyReconcile: (nextItems, todayIso) => {
      setState({ items: nextItems, lastRefreshedIso: todayIso });
      persistCurrent();
    },

    ingestVerdicts: (suggestions) => {
      const verdictByKey = new Map(suggestions.map((suggestion) => [suggestion.issueKey, suggestion]));
      const items = getState().items.map((item) => {
        const suggestion = verdictByKey.get(item.issueKey);
        // Only pending items take a fresh verdict — a decided item's verdict is history.
        if (suggestion === undefined || item.status !== 'pending') {
          return item;
        }
        return { ...item, verdict: suggestion.verdict, rationale: suggestion.rationale };
      });
      setState({ items });
      persistCurrent();
    },

    decide: (issueKey, status, fingerprint, decidedAtIso) => {
      const items = getState().items.map((item) =>
        item.issueKey === issueKey ? { ...item, status, fingerprint, decidedAtIso, snoozeUntilIso: null } : item,
      );
      setState({ items });
      persistCurrent();
    },

    snooze: (issueKey, snoozeUntilIso) => {
      const items = getState().items.map((item) =>
        item.issueKey === issueKey ? { ...item, status: 'snoozed' as RemediationStatus, snoozeUntilIso } : item,
      );
      setState({ items });
      persistCurrent();
    },

    reopen: (issueKey) => {
      const items = getState().items.map((item) =>
        item.issueKey === issueKey
          ? { ...item, status: 'pending' as RemediationStatus, fingerprint: null, snoozeUntilIso: null }
          : item,
      );
      setState({ items });
      persistCurrent();
    },

    setScopeOverrideJql: (jql) => {
      setState({ scopeOverrideJql: jql });
      persistCurrent();
    },
  };
});
