// useStandupRosterStore.test.ts — Tests for the persisted Team Dashboard roster store and Jira assignee clause helper.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildStandupRosterAssigneeClause,
  readStoredStandupRosterMembers,
  useStandupRosterStore,
} from './useStandupRosterStore.ts';

describe('useStandupRosterStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useStandupRosterStore.setState({ rosterMembers: [] });
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
        roleName: 'QE',
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
});
