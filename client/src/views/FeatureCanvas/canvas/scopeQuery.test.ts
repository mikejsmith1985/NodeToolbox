// scopeQuery.test.ts — Verifies the default custom-JQL builder.

import { describe, expect, it } from 'vitest';

import { buildDefaultScopeJql } from './scopeQuery.ts';

describe('buildDefaultScopeJql', () => {
  it('targets the PI field by cf[<num>] id, not the display name', () => {
    expect(buildDefaultScopeJql({ projectKey: 'DENP', piName: 'PI 26.3', piFieldId: 'customfield_10301' }))
      .toBe('project = "DENP" AND cf[10301] = "PI 26.3" AND issuetype = "Feature"');
  });

  it('omits the PI clause when no PI is known', () => {
    expect(buildDefaultScopeJql({ projectKey: 'DENP', piName: '', piFieldId: 'customfield_10301' }))
      .toBe('project = "DENP" AND issuetype = "Feature"');
  });

  it('names only an issue type the instance defines', () => {
    // `issuetype in (Feature, Epic)` is a 400 on an instance with no Epic type, and Jira rejects the
    // WHOLE query rather than the unknown value — so the canvas came back empty (GH #376). The query
    // stays editable, so anybody whose instance does have Epics can widen it.
    expect(buildDefaultScopeJql({ projectKey: '', piName: '', piFieldId: '' })).toBe('issuetype = "Feature"');
  });
});
