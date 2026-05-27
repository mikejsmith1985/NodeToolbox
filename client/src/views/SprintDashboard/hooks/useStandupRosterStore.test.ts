// useStandupRosterStore.test.ts — Tests for the persisted Team Dashboard roster store and Jira assignee clause helper.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildStandupRosterAssigneeClause,
  filterRosterMembersByActiveTeam,
  resolveActiveRosterTeamName,
  readStoredStandupRosterMembers,
  useStandupRosterStore,
} from './useStandupRosterStore.ts';

describe('useStandupRosterStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useStandupRosterStore.setState({ dashboardTeamProfileId: 'legacy-default', rosterMembers: [] });
  });

  it('adds and persists roster members without duplicate assignee values', () => {
    useStandupRosterStore.getState().addRosterMember({
      displayName: 'Alice Adams',
      assigneeQueryValue: 'Alice Adams',
    });
    useStandupRosterStore.getState().addRosterMember({
      displayName: 'Alice Adams',
      assigneeQueryValue: 'alice adams',
    });

    expect(useStandupRosterStore.getState().rosterMembers).toEqual([
      {
        id: 'roster-member:alice adams',
        displayName: 'Alice Adams',
        assigneeQueryValue: 'Alice Adams',
      },
    ]);
    expect(readStoredStandupRosterMembers()).toEqual([
      {
        id: 'roster-member:alice adams',
        displayName: 'Alice Adams',
        assigneeQueryValue: 'Alice Adams',
      },
    ]);
  });

  it('builds a Jira assignee clause from the stored roster members', () => {
    useStandupRosterStore.setState({
      rosterMembers: [
        { id: 'roster-member:alice adams', displayName: 'Alice Adams', assigneeQueryValue: 'Alice Adams' },
        { id: 'roster-member:bob brown', displayName: 'Bob Brown', assigneeQueryValue: 'Bob Brown' },
      ],
    });

    expect(buildStandupRosterAssigneeClause()).toBe('assignee in ("Alice Adams", "Bob Brown")');
  });

  it('filters the Jira assignee clause down to the active team roster members', () => {
    useStandupRosterStore.setState({
      rosterMembers: [
        {
          id: 'roster-member:alice adams',
          displayName: 'Alice Adams',
          assigneeQueryValue: 'Alice Adams',
          teamName: 'Transformers',
        },
        {
          id: 'roster-member:bob brown',
          displayName: 'Bob Brown',
          assigneeQueryValue: 'Bob Brown',
          teamName: 'Clean Up Crew',
        },
      ],
    });

    expect(buildStandupRosterAssigneeClause(undefined, 'Clean Up Crew')).toBe('assignee in ("Bob Brown")');
  });

  it('keeps the full roster when no active team filter is supplied', () => {
    useStandupRosterStore.setState({
      rosterMembers: [
        {
          id: 'roster-member:alice adams',
          displayName: 'Alice Adams',
          assigneeQueryValue: 'Alice Adams',
          teamName: 'Transformers',
        },
        {
          id: 'roster-member:bob brown',
          displayName: 'Bob Brown',
          assigneeQueryValue: 'Bob Brown',
          teamName: 'Clean Up Crew',
        },
      ],
    });

    expect(buildStandupRosterAssigneeClause()).toBe('assignee in ("Alice Adams", "Bob Brown")');
  });

  it('defaults the active roster team to the first imported team when none is stored yet', () => {
    expect(resolveActiveRosterTeamName('', [
      {
        id: 'roster-member:beta',
        displayName: 'Beta Builder',
        assigneeQueryValue: 'Beta Builder',
        teamName: 'Zeta Team',
      },
      {
        id: 'roster-member:alpha',
        displayName: 'Alpha Analyst',
        assigneeQueryValue: 'Alpha Analyst',
        teamName: 'Alpha Team',
      },
    ])).toBe('Alpha Team');
  });

  it('can keep teamless members visible in the roster settings view while a team filter is active', () => {
    expect(filterRosterMembersByActiveTeam([
      {
        id: 'roster-member:alice',
        displayName: 'Alice Adams',
        assigneeQueryValue: 'Alice Adams',
        teamName: 'Transformers',
      },
      {
        id: 'roster-member:legacy',
        displayName: 'Legacy Person',
        assigneeQueryValue: 'Legacy Person',
      },
    ], 'Transformers', { includeTeamlessMembers: true }).map((rosterMember) => rosterMember.displayName)).toEqual([
      'Alice Adams',
      'Legacy Person',
    ]);
  });

  it('upserts imported roster members and preserves their metadata fields', () => {
    useStandupRosterStore.setState({
      rosterMembers: [
        { id: 'roster-member:alice adams', displayName: 'Alice Adams', assigneeQueryValue: 'Alice Adams' },
      ],
    });

    useStandupRosterStore.getState().upsertRosterMembers([
      {
        displayName: 'Alice Adams',
        assigneeQueryValue: 'Alice Adams',
        jiraAccountId: 'acct-alice',
        snowUserDisplayName: 'Alice Adams SN',
        snowUserSysId: 'snow-alice',
        emailAddress: 'alice@example.com',
        roleName: 'QE',
        teamName: 'Transformers',
      },
      {
        displayName: 'Bob Brown',
        assigneeQueryValue: 'Bob Brown',
        teamName: 'Clean Up Crew',
      },
    ]);

    expect(useStandupRosterStore.getState().rosterMembers).toEqual([
      {
        assigneeQueryValue: 'Alice Adams',
        displayName: 'Alice Adams',
        emailAddress: 'alice@example.com',
        id: 'roster-member:alice adams',
        jiraAccountId: 'acct-alice',
        roleName: 'QE',
        snowUserDisplayName: 'Alice Adams SN',
        snowUserSysId: 'snow-alice',
        teamName: 'Transformers',
      },
      {
        assigneeQueryValue: 'Bob Brown',
        displayName: 'Bob Brown',
        id: 'roster-member:bob brown',
        teamName: 'Clean Up Crew',
      },
    ]);
  });

  it('keeps distinct roster members removable when their assignee values differ by punctuation', () => {
    useStandupRosterStore.getState().addRosterMember({
      displayName: 'John Dot Smith',
      assigneeQueryValue: 'john.smith',
    });
    useStandupRosterStore.getState().addRosterMember({
      displayName: 'John Dash Smith',
      assigneeQueryValue: 'john-smith',
    });

    useStandupRosterStore.getState().removeRosterMember('roster-member:john.smith');

    expect(useStandupRosterStore.getState().rosterMembers).toEqual([
      {
        assigneeQueryValue: 'john-smith',
        displayName: 'John Dash Smith',
        id: 'roster-member:john-smith',
      },
    ]);
  });

  it('migrates the bare legacy roster into the first scoped team key', () => {
    localStorage.setItem('tbxSprintDashboardRoster', JSON.stringify({
      rosterMembers: [
        {
          id: 'roster-member:legacy person',
          displayName: 'Legacy Person',
          assigneeQueryValue: 'Legacy Person',
        },
      ],
    }));

    useStandupRosterStore.getState().setDashboardTeamProfileId('team-alpha');

    expect(useStandupRosterStore.getState().rosterMembers).toEqual([
      {
        id: 'roster-member:legacy person',
        displayName: 'Legacy Person',
        assigneeQueryValue: 'Legacy Person',
      },
    ]);
    expect(localStorage.getItem('tbxSprintDashboardRoster:team-alpha')).toBe(JSON.stringify({
      rosterMembers: [
        {
          id: 'roster-member:legacy person',
          displayName: 'Legacy Person',
          assigneeQueryValue: 'Legacy Person',
        },
      ],
    }));
  });

  it('does not let a new team inherit the bare legacy roster after scoped data exists', () => {
    localStorage.setItem('tbxSprintDashboardRoster', JSON.stringify({
      rosterMembers: [
        {
          id: 'roster-member:legacy person',
          displayName: 'Legacy Person',
          assigneeQueryValue: 'Legacy Person',
        },
      ],
    }));
    localStorage.setItem('tbxSprintDashboardRoster:team-alpha', JSON.stringify({
      rosterMembers: [
        {
          id: 'roster-member:alpha person',
          displayName: 'Alpha Person',
          assigneeQueryValue: 'Alpha Person',
        },
      ],
    }));

    useStandupRosterStore.getState().setDashboardTeamProfileId('team-beta');

    expect(useStandupRosterStore.getState().rosterMembers).toEqual([]);
    expect(buildStandupRosterAssigneeClause()).toBeNull();
  });
});
