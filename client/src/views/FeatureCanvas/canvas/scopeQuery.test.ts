// scopeQuery.test.ts — Verifies the default custom-JQL builder.

import { describe, expect, it } from 'vitest';

import { buildDefaultScopeJql } from './scopeQuery.ts';

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
