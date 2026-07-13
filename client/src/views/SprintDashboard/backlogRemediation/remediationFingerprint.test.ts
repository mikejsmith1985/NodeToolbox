// remediationFingerprint.test.ts — Verifies the status-category + team-scoped assignee fingerprint.

import { describe, expect, it } from 'vitest';

import type { JiraIssue } from '../../../types/jira.ts';
import type { StandupRosterMember } from '../hooks/useStandupRosterStore.ts';
import { buildItemFingerprint, buildTeamAssigneeIds } from './remediationFingerprint.ts';

function member(displayName: string, assigneeQueryValue: string): StandupRosterMember {
  return { displayName, assigneeQueryValue } as unknown as StandupRosterMember;
}

/** A minimal fetched issue with a status category and an optional assignee. */
function issue(statusCategoryKey: string, assignee: Record<string, unknown> | null): JiraIssue {
  return { fields: { status: { statusCategory: { key: statusCategoryKey } }, assignee } } as unknown as JiraIssue;
}

const TEAM = buildTeamAssigneeIds([member('Jane Dev', 'jane'), member('Bhargavi', 'JIRAUSER10100')]);

describe('buildTeamAssigneeIds', () => {
  it('collects both the machine id and display name of each member', () => {
    expect(TEAM.has('jane')).toBe(true);
    expect(TEAM.has('Jane Dev')).toBe(true);
    expect(TEAM.has('JIRAUSER10100')).toBe(true);
  });
});

describe('buildItemFingerprint', () => {
  it('reads the status category and null assignee for an unassigned issue', () => {
    expect(buildItemFingerprint(issue('new', null), TEAM)).toEqual({ statusCategoryKey: 'new', assigneeKey: null });
  });

  it('records the assignee machine id when the assignee is on the team (matched by key)', () => {
    const fingerprint = buildItemFingerprint(issue('indeterminate', { key: 'JIRAUSER10100', displayName: 'Bhargavi' }), TEAM);
    expect(fingerprint).toEqual({ statusCategoryKey: 'indeterminate', assigneeKey: 'JIRAUSER10100' });
  });

  it('records the assignee machine id when matched by display name (Server changelog case)', () => {
    const fingerprint = buildItemFingerprint(issue('new', { accountId: '', name: 'jdev', displayName: 'Jane Dev' }), TEAM);
    expect(fingerprint.assigneeKey).toBe('jdev');
  });

  it('treats an assignee NOT on the team as no team assignee (null)', () => {
    const fingerprint = buildItemFingerprint(issue('new', { accountId: 'acc-outsider', displayName: 'Outsider' }), TEAM);
    expect(fingerprint).toEqual({ statusCategoryKey: 'new', assigneeKey: null });
  });
});
