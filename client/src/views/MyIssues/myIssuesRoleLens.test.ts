// myIssuesRoleLens.test.ts — Unit tests for the My Issues persona/role-lens pure module.

import { describe, expect, it } from 'vitest';

import {
  buildAssigneeJql,
  defaultRoleFromCapabilities,
  myIssuesRoleLens,
  type ReportSubject,
} from './myIssuesRoleLens.ts';

// ── buildAssigneeJql ──

describe('buildAssigneeJql', () => {
  it('returns the current-user clause for the viewer subject', () => {
    const viewerSubject: ReportSubject = { kind: 'viewer' };

    expect(buildAssigneeJql(viewerSubject)).toBe('assignee = currentUser()');
  });

  it('returns an accountId-scoped clause for a simulated user subject', () => {
    const userSubject: ReportSubject = {
      kind: 'user',
      accountId: 'acc-123',
      displayName: 'Bob Tester',
    };

    expect(buildAssigneeJql(userSubject)).toBe('assignee = "acc-123"');
  });

  it('returns an assignee-in clause for a team subject using the supplied members', () => {
    const teamSubject: ReportSubject = { kind: 'team', teamName: 'Falcons' };

    expect(buildAssigneeJql(teamSubject, ['alice@x.com', 'bob@x.com'])).toBe(
      'assignee in ("alice@x.com", "bob@x.com")',
    );
  });

  it('escapes embedded double-quotes in team member identifiers', () => {
    const teamSubject: ReportSubject = { kind: 'team', teamName: 'Falcons' };

    expect(buildAssigneeJql(teamSubject, ['a"b'])).toBe('assignee in ("a\\"b")');
  });

  it('returns an empty assignee-in clause when a team has no members', () => {
    const teamSubject: ReportSubject = { kind: 'team', teamName: 'Falcons' };

    expect(buildAssigneeJql(teamSubject, [])).toBe('assignee in ()');
  });
});

// ── myIssuesRoleLens ──

describe('myIssuesRoleLens', () => {
  it('pins the Dev emphasis to in-progress, blocked, and needs-estimate', () => {
    expect(myIssuesRoleLens('dev').emphasizedCriteria).toEqual([
      'In progress',
      'Blocked',
      'Needs estimate',
    ]);
  });

  it('pins the Tester emphasis to ready-for-QA and in-test', () => {
    expect(myIssuesRoleLens('tester').emphasizedCriteria).toEqual([
      'Ready for QA',
      'In test',
    ]);
  });

  it('pins the SM emphasis to team blockers, hygiene flags, and flow', () => {
    expect(myIssuesRoleLens('sm').emphasizedCriteria).toEqual([
      'Team blockers',
      'Hygiene flags',
      'Flow (aging / WIP)',
    ]);
  });

  it('pins the PO emphasis to feature readiness and backlog hygiene', () => {
    expect(myIssuesRoleLens('po').emphasizedCriteria).toEqual([
      'Feature readiness',
      'Backlog hygiene (ownership / estimate / fixVersion)',
    ]);
  });
});

// ── defaultRoleFromCapabilities ──

describe('defaultRoleFromCapabilities', () => {
  it('prefers Scrum Master when the capability is set', () => {
    expect(
      defaultRoleFromCapabilities({
        canDevelop: true,
        canInternalTest: false,
        canExternalTest: false,
        canScrumMaster: true,
      }),
    ).toBe('sm');
  });

  it('falls to Product Owner when SM is absent but PO is set', () => {
    expect(
      defaultRoleFromCapabilities({
        canDevelop: true,
        canInternalTest: false,
        canExternalTest: false,
        canProductOwner: true,
      }),
    ).toBe('po');
  });

  it('falls to Tester when only a testing capability is set', () => {
    expect(
      defaultRoleFromCapabilities({
        canDevelop: false,
        canInternalTest: true,
        canExternalTest: false,
      }),
    ).toBe('tester');
  });

  it('defaults to Dev when no coordinating or testing capability is set', () => {
    expect(
      defaultRoleFromCapabilities({
        canDevelop: true,
        canInternalTest: false,
        canExternalTest: false,
      }),
    ).toBe('dev');
  });

  it('defaults to Dev when capabilities are undefined', () => {
    expect(defaultRoleFromCapabilities(undefined)).toBe('dev');
  });
});
