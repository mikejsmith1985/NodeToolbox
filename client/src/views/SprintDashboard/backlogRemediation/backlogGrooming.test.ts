// backlogGrooming.test.ts — The deterministic grooming-bucket classifier and grouping helper.

import { describe, expect, it } from 'vitest';

import type { JiraIssue } from '../../../types/jira.ts';
import type { AgingTriageIssue } from '../../ReportsHub/agingTriage.ts';
import {
  classifyGroomingBucket,
  groupByGroomingBucket,
  GROOMING_BUCKET_ORDER,
} from './backlogGrooming.ts';

/** Builds triage signals defaulting to a healthy, recently-touched item; each test overrides what it needs. */
function signals(overrides: Partial<AgingTriageIssue> = {}): AgingTriageIssue {
  return {
    issueKey: 'DENP-1',
    issueType: 'Story',
    summary: 'A backlog item',
    status: 'In Progress',
    ageDays: 3,
    daysInStatus: 1,
    daysSinceUpdate: 1,
    assignee: 'Ada Lovelace',
    storyPoints: 3,
    hasDescription: true,
    hasAcceptanceCriteria: true,
    priority: 'Medium',
    featureKey: null,
    featureSummary: null,
    featureStatus: null,
    ...overrides,
  };
}

/** Builds a minimal freshly-fetched Jira issue carrying only the fields the classifier refines on. */
function rawIssue(fields: { statusCategoryKey?: string; resolutionName?: string | null }): JiraIssue {
  return {
    key: 'DENP-1',
    fields: {
      status: { name: 'To Do', statusCategory: { key: fields.statusCategoryKey ?? 'indeterminate' } },
      resolution: fields.resolutionName === undefined ? null : { name: fields.resolutionName },
    },
  } as unknown as JiraIssue;
}

describe('classifyGroomingBucket', () => {
  it('flags a done-NAMED status as already-done-not-closed, even when recently updated', () => {
    expect(classifyGroomingBucket(signals({ status: 'Done', daysSinceUpdate: 0 }))).toBe('ghost-done');
    expect(classifyGroomingBucket(signals({ status: 'Closed' }))).toBe('ghost-done');
  });

  it('flags a set resolution (from the fetched issue) as already-done-not-closed', () => {
    const bucket = classifyGroomingBucket(signals({ status: 'In Progress' }), rawIssue({ resolutionName: 'Done' }));
    expect(bucket).toBe('ghost-done');
    // An "Unresolved" resolution is NOT a done signal.
    expect(classifyGroomingBucket(signals({ status: 'In Progress' }), rawIssue({ resolutionName: 'Unresolved' }))).not.toBe('ghost-done');
  });

  it('marks long-idle unowned work as likely-cancel', () => {
    expect(classifyGroomingBucket(signals({ daysSinceUpdate: 120, assignee: null }))).toBe('likely-cancel');
  });

  it('marks an item under an already-Done parent feature as likely-cancel once stale', () => {
    expect(classifyGroomingBucket(signals({ daysSinceUpdate: 10, featureStatus: 'Closed' }))).toBe('likely-cancel');
  });

  it('marks an old, still-idle To-Do item that carries value as never-started', () => {
    // Assigned + defined + not long-idle ⇒ not a cancel; To-Do category + age ≥ 90 + stale ⇒ never-started.
    const bucket = classifyGroomingBucket(
      signals({ status: 'To Do', ageDays: 140, daysSinceUpdate: 30, daysInStatus: 30 }),
      rawIssue({ statusCategoryKey: 'new' }),
    );
    expect(bucket).toBe('never-started');
  });

  it('cannot claim never-started without the fetched issue, and falls back to just-stale', () => {
    // Same signals, but no raw issue ⇒ the To-Do category is unknown, so it degrades to just-stale.
    expect(classifyGroomingBucket(signals({ status: 'To Do', ageDays: 140, daysSinceUpdate: 30 }))).toBe('just-stale');
  });

  it('marks a stale-but-owned item as just-stale', () => {
    expect(classifyGroomingBucket(signals({ daysSinceUpdate: 12 }))).toBe('just-stale');
  });

  it('leaves a recently-touched item as active', () => {
    expect(classifyGroomingBucket(signals({ daysSinceUpdate: 1 }))).toBe('active');
  });

  it('honours the stale threshold', () => {
    expect(classifyGroomingBucket(signals({ daysSinceUpdate: 3 }), undefined, 5)).toBe('active');
    expect(classifyGroomingBucket(signals({ daysSinceUpdate: 3 }), undefined, 2)).toBe('just-stale');
  });

  it('prefers days-since-update, then time-in-status, then age for the idle measure', () => {
    // No update signal, but 40 days in status with a Done parent ⇒ stale ⇒ likely-cancel.
    expect(classifyGroomingBucket(signals({ daysSinceUpdate: null, daysInStatus: 40, featureStatus: 'Done' }))).toBe('likely-cancel');
  });
});

describe('groupByGroomingBucket', () => {
  it('returns non-empty buckets in the fixed display order', () => {
    const entries = [
      { id: 'a', s: signals({ daysSinceUpdate: 1 }) },                       // active
      { id: 'b', s: signals({ status: 'Done' }) },                            // ghost-done
      { id: 'c', s: signals({ daysSinceUpdate: 120, assignee: null }) },      // likely-cancel
      { id: 'd', s: signals({ daysSinceUpdate: 12 }) },                       // just-stale
    ];
    const groups = groupByGroomingBucket(entries, (entry) => classifyGroomingBucket(entry.s));

    expect(groups.map((group) => group.bucket)).toEqual(['ghost-done', 'likely-cancel', 'just-stale', 'active']);
    expect(groups.find((group) => group.bucket === 'ghost-done')?.entries.map((entry) => entry.id)).toEqual(['b']);
    // Every returned bucket is part of the canonical order and none is empty.
    for (const group of groups) {
      expect(GROOMING_BUCKET_ORDER).toContain(group.bucket);
      expect(group.entries.length).toBeGreaterThan(0);
    }
  });
});
