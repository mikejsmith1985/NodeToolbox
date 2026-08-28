// reportScopeJql.test.ts — Reading a typed scope the way the person who typed it meant it.

import { describe, expect, it } from 'vitest';

import { buildScopedJql, readScopeExpression } from './reportScopeJql.ts';

describe('readScopeExpression', () => {
  it('reads a bare project key as the project it obviously is', () => {
    // "ENCUC" in a box labelled Scope is exactly what that box invites, and it produced a Jira parse
    // error naming a character position in a query nobody wrote (GH #376).
    expect(readScopeExpression('ENCUC')).toBe('project = ENCUC');
  });

  it('reads a comma-separated list of keys as a project list', () => {
    expect(readScopeExpression('ENCUC, DENP')).toBe('project in (ENCUC, DENP)');
  });

  it('reads a space-separated list too, because both are natural to type', () => {
    expect(readScopeExpression('ENCUC DENP')).toBe('project in (ENCUC, DENP)');
  });

  it('leaves a real JQL condition exactly as written', () => {
    expect(readScopeExpression('issuetype = Story')).toBe('issuetype = Story');
  });

  it('does not mistake a clause that begins with a word for a key', () => {
    expect(readScopeExpression('project in (A, B)')).toBe('project in (A, B)');
    expect(readScopeExpression('assignee WAS "Kevin"')).toBe('assignee WAS "Kevin"');
  });

  it('gives back nothing for an empty scope, so nothing gets bracketed', () => {
    expect(readScopeExpression('')).toBe('');
    expect(readScopeExpression('   ')).toBe('');
  });

  it('trims what somebody pasted with spaces around it', () => {
    expect(readScopeExpression('  ENCUC  ')).toBe('project = ENCUC');
  });
});

describe('buildScopedJql', () => {
  it('joins the scope to the report condition', () => {
    expect(buildScopedJql('ENCUC', 'statusCategory != Done ORDER BY created ASC'))
      .toBe('(project = ENCUC) AND statusCategory != Done ORDER BY created ASC');
  });

  it('brackets the scope so an OR inside it cannot escape the condition', () => {
    // Without brackets, "project = A OR project = B AND statusCategory != Done" returns every issue
    // in A whatever its status.
    expect(buildScopedJql('project = A OR project = B', 'statusCategory != Done'))
      .toBe('(project = A OR project = B) AND statusCategory != Done');
  });

  it('uses the condition alone when no scope was given, rather than empty brackets', () => {
    expect(buildScopedJql('', 'statusCategory != Done')).toBe('statusCategory != Done');
  });
});
