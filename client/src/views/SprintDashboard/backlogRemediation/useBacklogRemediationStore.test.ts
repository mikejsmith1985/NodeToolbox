// useBacklogRemediationStore.test.ts — Verifies per-team persistence, isolation, and tolerant loading.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgingTriageIssue, AgingTriageSuggestion } from '../../ReportsHub/agingTriage.ts';
import { useBacklogRemediationStore } from './useBacklogRemediationStore.ts';
import type { ItemFingerprint, RemediationItem } from './remediationTypes.ts';

const TEAM_A = 'team-a';
const TEAM_B = 'team-b';
const PROJECT = 'ENCUC';
const PI = 'PI 2026.3';

function makeSignals(issueKey: string): AgingTriageIssue {
  return {
    issueKey, issueType: 'Story', summary: 'x', status: 'To Do', ageDays: 100, daysInStatus: 60,
    daysSinceUpdate: 90, assignee: null, storyPoints: 3, hasDescription: true, hasAcceptanceCriteria: true,
    priority: 'Low', featureKey: null, featureSummary: null, featureStatus: null,
  };
}

function pendingItem(issueKey: string): RemediationItem {
  return {
    issueKey, verdict: 'cancel-safe', rationale: 'stale', status: 'pending', snoozeUntilIso: null,
    fingerprint: null, decidedAtIso: null, signals: makeSignals(issueKey),
  };
}

const FINGERPRINT: ItemFingerprint = { statusCategoryKey: 'new', assigneeKey: null };

/** Reads the raw persisted blob for a scope, so tests can assert on-disk state directly. */
function readStored(teamProfileId: string): { items: RemediationItem[] } | null {
  const key = useBacklogRemediationStore.getState().storageKey;
  void teamProfileId;
  const raw = key ? localStorage.getItem(key) : null;
  return raw ? (JSON.parse(raw) as { items: RemediationItem[] }) : null;
}

describe('useBacklogRemediationStore', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('round-trips a decision through persistence for a scope', () => {
    const store = useBacklogRemediationStore.getState();
    store.setScope(TEAM_A, PROJECT, PI);
    store.applyReconcile([pendingItem('A-1')], '2026-07-13');
    store.decide('A-1', 'canceled', FINGERPRINT, '2026-07-13');

    // A fresh setScope to the SAME scope must load the persisted decision.
    useBacklogRemediationStore.getState().setScope(TEAM_A, PROJECT, PI);
    const loaded = useBacklogRemediationStore.getState().items.find((item) => item.issueKey === 'A-1');
    expect(loaded?.status).toBe('canceled');
    expect(loaded?.fingerprint).toEqual(FINGERPRINT);
  });

  it('isolates teams — a decision under team A is invisible under team B and vice-versa', () => {
    const store = useBacklogRemediationStore.getState();
    store.setScope(TEAM_A, PROJECT, PI);
    store.applyReconcile([pendingItem('A-1')], '2026-07-13');
    store.decide('A-1', 'dismissed', FINGERPRINT, '2026-07-13');

    store.setScope(TEAM_B, PROJECT, PI);
    expect(useBacklogRemediationStore.getState().items).toEqual([]);

    store.setScope(TEAM_A, PROJECT, PI);
    expect(useBacklogRemediationStore.getState().items[0]?.status).toBe('dismissed');
  });

  it('tolerates a corrupt persisted blob by loading an empty queue', () => {
    const store = useBacklogRemediationStore.getState();
    store.setScope(TEAM_A, PROJECT, PI);
    const key = useBacklogRemediationStore.getState().storageKey as string;
    localStorage.setItem(key, '{not json');
    store.setScope(TEAM_A, PROJECT, PI);
    expect(useBacklogRemediationStore.getState().items).toEqual([]);
    expect(useBacklogRemediationStore.getState().lastRefreshedIso).toBeNull();
  });

  it('persists a per-team JQL override that does not leak to another scope', () => {
    const store = useBacklogRemediationStore.getState();
    store.setScope(TEAM_A, PROJECT, PI);
    store.setScopeOverrideJql('assignee in (jane)');
    store.setScope(TEAM_B, PROJECT, PI);
    expect(useBacklogRemediationStore.getState().scopeOverrideJql).toBeNull();
    store.setScope(TEAM_A, PROJECT, PI);
    expect(useBacklogRemediationStore.getState().scopeOverrideJql).toBe('assignee in (jane)');
  });

  it('ingests verdicts onto matching pending items only', () => {
    const store = useBacklogRemediationStore.getState();
    store.setScope(TEAM_A, PROJECT, PI);
    store.applyReconcile([{ ...pendingItem('A-1'), verdict: null, rationale: '' }], '2026-07-13');
    const suggestions: AgingTriageSuggestion[] = [
      { issueKey: 'A-1', verdict: 'review', rationale: 'needs a look' },
      { issueKey: 'UNKNOWN-9', verdict: 'cancel-safe', rationale: 'ignored' },
    ];
    store.ingestVerdicts(suggestions);
    const item = useBacklogRemediationStore.getState().items.find((entry) => entry.issueKey === 'A-1');
    expect(item?.verdict).toBe('review');
    expect(item?.rationale).toBe('needs a look');
    expect(readStored(TEAM_A)?.items[0].verdict).toBe('review');
  });
});
