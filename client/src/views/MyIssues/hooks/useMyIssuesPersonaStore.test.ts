// useMyIssuesPersonaStore.test.ts — The tool-wide "simulate as" subject store + helpers (My Issues).

import { beforeEach, describe, expect, it } from 'vitest';

import { setMyIssuesPersonaSubject, useMyIssuesPersonaStore } from './useMyIssuesPersonaStore.ts';
import { buildAssigneeJql, resolveSubjectAccountId } from '../myIssuesRoleLens.ts';

beforeEach(() => {
  useMyIssuesPersonaStore.setState({ subject: { kind: 'viewer' }, memberIdentifiers: [] });
});

describe('useMyIssuesPersonaStore', () => {
  it('defaults to the viewer', () => {
    expect(useMyIssuesPersonaStore.getState().subject).toEqual({ kind: 'viewer' });
  });

  it('sets a simulated user and drops any member identifiers', () => {
    setMyIssuesPersonaSubject({ kind: 'user', accountId: '5b10', displayName: 'Jane Doe' }, ['ignored']);
    const state = useMyIssuesPersonaStore.getState();
    expect(state.subject).toEqual({ kind: 'user', accountId: '5b10', displayName: 'Jane Doe' });
    expect(state.memberIdentifiers).toEqual([]);
  });

  it('keeps member identifiers only for a team subject', () => {
    setMyIssuesPersonaSubject({ kind: 'team', teamName: 'Enrollment' }, ['a', 'b']);
    expect(useMyIssuesPersonaStore.getState().memberIdentifiers).toEqual(['a', 'b']);
  });
});

describe('resolveSubjectAccountId', () => {
  it('uses the simulated user account id, else the viewer', () => {
    expect(resolveSubjectAccountId({ kind: 'user', accountId: '5b10', displayName: 'X' }, 'me')).toBe('5b10');
    expect(resolveSubjectAccountId({ kind: 'viewer' }, 'me')).toBe('me');
    expect(resolveSubjectAccountId({ kind: 'team', teamName: 'T' }, 'me')).toBe('me');
  });
});

describe('buildAssigneeJql (persona clause the tabs reuse)', () => {
  it('is currentUser() for the viewer and an accountId for a simulated user', () => {
    expect(buildAssigneeJql({ kind: 'viewer' })).toBe('assignee = currentUser()');
    expect(buildAssigneeJql({ kind: 'user', accountId: '5b10', displayName: 'X' })).toBe('assignee = "5b10"');
  });
});
