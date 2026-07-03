// scopeQuery.test.ts — Verifies the default-JQL builder and the client-side refine filters.

import { describe, expect, it } from 'vitest';

import type { FeatureReviewItem } from '../../SprintDashboard/featureReview.ts';
import { applyScopeFilters, buildDefaultScopeJql, EMPTY_SCOPE_FILTERS } from './scopeQuery.ts';

function buildItem(overrides: { key?: string; summary?: string; status?: string; labels?: string[] } = {}): FeatureReviewItem {
  return {
    feature: {
      type: 'feature',
      key: overrides.key ?? 'DENP-1',
      summary: overrides.summary ?? 'Login redesign',
      status: overrides.status ?? 'In Progress',
      health: 'yellow',
      completionPercent: 40,
      children: [],
      offTrain: [],
      isExternal: false,
    },
    featureIssue: { key: overrides.key ?? 'DENP-1', fields: { labels: overrides.labels ?? [] } } as unknown as FeatureReviewItem['featureIssue'],
    hygieneFlags: [],
    blockedChildCount: 0,
    doneChildCount: 0,
    inFlightChildCount: 0,
    totalChildCount: 0,
  };
}

describe('buildDefaultScopeJql', () => {
  it('targets the PI field by cf[<num>] id, not the display name', () => {
    expect(buildDefaultScopeJql({ projectKey: 'DENP', piName: 'PI 26.3', piFieldId: 'customfield_10301' }))
      .toBe('project = "DENP" AND cf[10301] = "PI 26.3" AND issuetype in (Feature, Epic)');
  });

  it('omits the PI clause when no PI is known', () => {
    expect(buildDefaultScopeJql({ projectKey: 'DENP', piName: '', piFieldId: 'customfield_10301' }))
      .toBe('project = "DENP" AND issuetype in (Feature, Epic)');
  });

  it('always includes the feature/epic issue-type clause', () => {
    expect(buildDefaultScopeJql({ projectKey: '', piName: '', piFieldId: '' })).toBe('issuetype in (Feature, Epic)');
  });
});

describe('applyScopeFilters', () => {
  const items = [
    buildItem({ key: 'DENP-1', summary: 'Login redesign', status: 'In Progress', labels: ['ENCUC', 'ux'] }),
    buildItem({ key: 'DENP-2', summary: 'Payment gateway', status: 'To Do', labels: ['payments'] }),
  ];

  it('returns everything for empty filters (no-op)', () => {
    expect(applyScopeFilters(items, EMPTY_SCOPE_FILTERS)).toHaveLength(2);
  });

  it('filters by free-text on key/summary', () => {
    expect(applyScopeFilters(items, { ...EMPTY_SCOPE_FILTERS, text: 'payment' }).map((item) => item.feature.key)).toEqual(['DENP-2']);
  });

  it('filters by status', () => {
    expect(applyScopeFilters(items, { ...EMPTY_SCOPE_FILTERS, status: 'To Do' }).map((item) => item.feature.key)).toEqual(['DENP-2']);
  });

  it('filters by label', () => {
    expect(applyScopeFilters(items, { ...EMPTY_SCOPE_FILTERS, label: 'ENCUC' }).map((item) => item.feature.key)).toEqual(['DENP-1']);
  });
});
