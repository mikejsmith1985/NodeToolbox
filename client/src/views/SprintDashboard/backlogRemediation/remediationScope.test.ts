// remediationScope.test.ts — Verifies the backlog scope is derived project-first, with an override and a roster
// fallback, and that the default never narrows by assignee (so unassigned stale work stays visible).

import { describe, expect, it } from 'vitest';

import type { StandupRosterMember } from '../hooks/useStandupRosterStore.ts';
import { resolveTeamScope } from './remediationScope.ts';

const TEAM = 'team-a';
const PI = 'PI 2026.3';

/** Minimal roster member carrying just the assignee query value the clause builder reads. */
function member(assigneeQueryValue: string): StandupRosterMember {
  return { assigneeQueryValue } as unknown as StandupRosterMember;
}

describe('resolveTeamScope', () => {
  it('uses the operator JQL override when present, even if a project is also set', () => {
    const scope = resolveTeamScope({
      teamProfileId: TEAM, projectKey: 'ENCUC', piName: PI,
      rosterMembers: [], activeRosterTeamName: null, scopeOverrideJql: 'assignee = jane',
    });
    expect(scope.jql).toBe('(assignee = jane) AND statusCategory != Done ORDER BY created ASC');
  });

  it('derives a project-first scope that does NOT narrow by assignee', () => {
    const scope = resolveTeamScope({
      teamProfileId: TEAM, projectKey: 'ENCUC', piName: PI,
      rosterMembers: [member('jane')], activeRosterTeamName: null, scopeOverrideJql: null,
    });
    expect(scope.jql).toBe('(project = ENCUC) AND statusCategory != Done ORDER BY created ASC');
    expect(scope.jql).not.toContain('assignee'); // unassigned stale work must remain in scope
  });

  it('falls back to the roster assignee clause when there is no project', () => {
    const scope = resolveTeamScope({
      teamProfileId: TEAM, projectKey: '', piName: PI,
      rosterMembers: [member('jane'), member('bhargavi')], activeRosterTeamName: null, scopeOverrideJql: null,
    });
    expect(scope.jql).toContain('assignee in (');
    expect(scope.jql).toContain('statusCategory != Done');
  });

  it('returns an empty jql when nothing is derivable (panel then prompts for a JQL)', () => {
    const scope = resolveTeamScope({
      teamProfileId: TEAM, projectKey: '  ', piName: PI,
      rosterMembers: [], activeRosterTeamName: null, scopeOverrideJql: null,
    });
    expect(scope.jql).toBe('');
    expect(scope.teamProfileId).toBe(TEAM);
  });
});
