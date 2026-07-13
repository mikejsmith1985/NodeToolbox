// remediationReconcile.test.ts — Verifies the pure merge of a fresh backlog against saved remediation decisions.

import { describe, expect, it } from 'vitest';

import type { AgingTriageIssue } from '../../ReportsHub/agingTriage.ts';
import { reconcile } from './remediationReconcile.ts';
import type { ItemFingerprint, RemediationItem } from './remediationTypes.ts';

const TODAY = '2026-07-13';

/** A fully-populated triage signal set, so tests override only what they exercise. */
function makeSignals(overrides: Partial<AgingTriageIssue> = {}): AgingTriageIssue {
  return {
    issueKey: 'ENCUC-1',
    issueType: 'Story',
    summary: 'Add export button',
    status: 'To Do',
    ageDays: 200,
    daysInStatus: 120,
    daysSinceUpdate: 90,
    assignee: null,
    storyPoints: 5,
    hasDescription: true,
    hasAcceptanceCriteria: true,
    priority: 'Low',
    featureKey: null,
    featureSummary: null,
    featureStatus: null,
    ...overrides,
  };
}

/** A saved queue item with sensible defaults. */
function makeSaved(overrides: Partial<RemediationItem> = {}): RemediationItem {
  return {
    issueKey: 'ENCUC-1',
    verdict: 'cancel-safe',
    rationale: 'Stale and unowned.',
    status: 'pending',
    snoozeUntilIso: null,
    fingerprint: null,
    decidedAtIso: null,
    signals: makeSignals(),
    ...overrides,
  };
}

/** Builds the current-fingerprint map the caller derives from the fresh fetch. */
function fingerprints(entries: Record<string, ItemFingerprint>): Map<string, ItemFingerprint> {
  return new Map(Object.entries(entries));
}

describe('reconcile', () => {
  it('drops a saved item that is no longer in the fetched backlog', () => {
    const saved = [makeSaved({ issueKey: 'GONE-1', status: 'kept' })];
    const result = reconcile(saved, [makeSignals({ issueKey: 'ENCUC-1' })], fingerprints({ 'ENCUC-1': { statusCategoryKey: 'new', assigneeKey: null } }), TODAY);
    expect(result.map((item) => item.issueKey)).toEqual(['ENCUC-1']);
  });

  it('admits a newly-fetched key as pending with no verdict or fingerprint', () => {
    const result = reconcile([], [makeSignals({ issueKey: 'NEW-9' })], fingerprints({ 'NEW-9': { statusCategoryKey: 'new', assigneeKey: null } }), TODAY);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ issueKey: 'NEW-9', status: 'pending', verdict: null, fingerprint: null });
  });

  it('returns a snoozed item to pending once its snooze date has elapsed', () => {
    const saved = [makeSaved({ status: 'snoozed', snoozeUntilIso: '2026-07-01' })];
    const result = reconcile(saved, [makeSignals()], fingerprints({ 'ENCUC-1': { statusCategoryKey: 'new', assigneeKey: null } }), TODAY);
    expect(result[0]).toMatchObject({ status: 'pending', snoozeUntilIso: null });
  });

  it('keeps a snoozed item hidden while its snooze date is still in the future', () => {
    const saved = [makeSaved({ status: 'snoozed', snoozeUntilIso: '2026-08-01' })];
    const result = reconcile(saved, [makeSignals()], fingerprints({ 'ENCUC-1': { statusCategoryKey: 'new', assigneeKey: null } }), TODAY);
    expect(result[0].status).toBe('snoozed');
  });

  it('holds a terminal item terminal when nothing material changed (cosmetic edit)', () => {
    const saved = [makeSaved({ status: 'canceled', fingerprint: { statusCategoryKey: 'new', assigneeKey: null } })];
    // Same category, still no team assignee — only cosmetic differences in signals.
    const result = reconcile(saved, [makeSignals({ summary: 'renamed' })], fingerprints({ 'ENCUC-1': { statusCategoryKey: 'new', assigneeKey: null } }), TODAY);
    expect(result[0].status).toBe('canceled');
  });

  it('re-admits a terminal item to pending when its status category changed', () => {
    const saved = [makeSaved({ status: 'canceled', fingerprint: { statusCategoryKey: 'done', assigneeKey: null } })];
    const result = reconcile(saved, [makeSignals()], fingerprints({ 'ENCUC-1': { statusCategoryKey: 'indeterminate', assigneeKey: null } }), TODAY);
    expect(result[0]).toMatchObject({ status: 'pending', fingerprint: null });
  });

  it('re-admits a terminal item when it was reassigned INTO the team', () => {
    const saved = [makeSaved({ status: 'kept', fingerprint: { statusCategoryKey: 'new', assigneeKey: null } })];
    const result = reconcile(saved, [makeSignals()], fingerprints({ 'ENCUC-1': { statusCategoryKey: 'new', assigneeKey: 'JIRAUSER99' } }), TODAY);
    expect(result[0].status).toBe('pending');
  });

  it('does NOT re-admit when reassigned to a non-team user (current key stays null)', () => {
    const saved = [makeSaved({ status: 'kept', fingerprint: { statusCategoryKey: 'new', assigneeKey: null } })];
    // Caller encodes a non-team assignee as null, so no material change.
    const result = reconcile(saved, [makeSignals({ assignee: 'Outsider' })], fingerprints({ 'ENCUC-1': { statusCategoryKey: 'new', assigneeKey: null } }), TODAY);
    expect(result[0].status).toBe('kept');
  });

  it('refreshes a surviving item\'s signals to the latest fetched values', () => {
    const saved = [makeSaved({ status: 'pending', signals: makeSignals({ ageDays: 200 }) })];
    const result = reconcile(saved, [makeSignals({ ageDays: 260, status: 'In Review' })], fingerprints({ 'ENCUC-1': { statusCategoryKey: 'indeterminate', assigneeKey: null } }), TODAY);
    expect(result[0].signals.ageDays).toBe(260);
    expect(result[0].signals.status).toBe('In Review');
  });

  it('is deterministic and preserves fetched order', () => {
    const fetched = [makeSignals({ issueKey: 'B-2' }), makeSignals({ issueKey: 'A-1' }), makeSignals({ issueKey: 'C-3' })];
    const fps = fingerprints({ 'B-2': { statusCategoryKey: 'new', assigneeKey: null }, 'A-1': { statusCategoryKey: 'new', assigneeKey: null }, 'C-3': { statusCategoryKey: 'new', assigneeKey: null } });
    const first = reconcile([], fetched, fps, TODAY).map((item) => item.issueKey);
    const second = reconcile([], fetched, fps, TODAY).map((item) => item.issueKey);
    expect(first).toEqual(['B-2', 'A-1', 'C-3']);
    expect(second).toEqual(first);
  });
});
