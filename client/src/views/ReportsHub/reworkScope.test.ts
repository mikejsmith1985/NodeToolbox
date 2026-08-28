// reworkScope.test.ts — What gets scanned, and what somebody is told when it does not work.

import { describe, expect, it } from 'vitest';

import { buildScopeClause, describeFetchFailure } from './reworkScope.ts';

// ── Picking a project rather than typing one (GH #376) ─────────────────────

describe('buildScopeClause', () => {
  it('turns a picked project into a project clause', () => {
    expect(buildScopeClause('ENCUC', '')).toBe('project = ENCUC');
  });

  it('brackets the extra JQL so an OR inside it cannot escape the project', () => {
    // "project = A AND b OR c" would otherwise return everything matching c, from anywhere.
    expect(buildScopeClause('ENCUC', 'issuetype = Story OR issuetype = Task'))
      .toBe('project = ENCUC AND (issuetype = Story OR issuetype = Task)');
  });

  it('uses the extra JQL alone when no project was picked', () => {
    expect(buildScopeClause('', 'issuetype = Story')).toBe('issuetype = Story');
  });

  it('scopes to everything when neither was given', () => {
    expect(buildScopeClause('', '')).toBe('');
  });
});

describe('describeFetchFailure', () => {
  it('points at the control that caused a JQL failure', () => {
    // Jira names a character position in a query the operator never wrote, which reads as their fault.
    const message = describeFetchFailure(new Error("Error in the JQL Query: Expecting operator but got ')'."));

    expect(message).toContain('Narrow it further');
    expect(message).toContain('not a project name');
  });

  it('still shows what Jira actually said', () => {
    const message = describeFetchFailure(new Error('Error in the JQL Query: bad things'));

    expect(message).toContain('Jira said:');
    expect(message).toContain('bad things');
  });

  it('passes an ordinary failure through unchanged', () => {
    expect(describeFetchFailure(new Error('Jira is unreachable'))).toBe('Jira is unreachable');
  });

  it('says something rather than nothing for a failure with no message', () => {
    expect(describeFetchFailure(new Error(''))).toBe('Could not read the issue history.');
  });
});
