// rosterIdentity.test.ts — Tests for translating roster members into Jira-queryable machine ids.
//
// The bug this prevents: a roster stores DISPLAY NAMES, and Jira rejects a display name in the
// assignee field. Every report that queries by roster member must resolve each name to a machine id
// first. When only one report did this, the other sent display names to Jira and every query 400'd.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import { resolveRosterIdentity, resolveRosterMachineIds } from './rosterIdentity.ts';
import type { StandupRosterMember } from '../SprintDashboard/hooks/useStandupRosterStore.ts';

beforeEach(() => {
  mockJiraGet.mockReset();
});

describe('resolveRosterIdentity', () => {
  it('trusts a stored Jira accountId without hitting Jira', async () => {
    const member: StandupRosterMember = {
      id: 'roster-member:mark',
      displayName: 'Sokol, Mark (CTR)',
      assigneeQueryValue: 'Sokol, Mark (CTR)',
      jiraAccountId: 'acct-123',
    };

    const identity = await resolveRosterIdentity(member);

    expect(identity?.queryValue).toBe('acct-123');
    expect(mockJiraGet).not.toHaveBeenCalled();
  });

  it('resolves a display name to a Server username via Jira', async () => {
    // The core fix: "Sokol, Mark (CTR)" is not a value Jira's assignee field accepts; "msokol" is.
    mockJiraGet.mockResolvedValue([{ name: 'msokol', displayName: 'Sokol, Mark (CTR)' }]);
    const member: StandupRosterMember = {
      id: 'roster-member:mark',
      displayName: 'Sokol, Mark (CTR)',
      assigneeQueryValue: 'Sokol, Mark (CTR)',
    };

    const identity = await resolveRosterIdentity(member);

    expect(identity?.queryValue).toBe('msokol');
  });

  it('prefers the exact-name candidate over the first result', async () => {
    mockJiraGet.mockResolvedValue([
      { name: 'msokoljr', displayName: 'Sokol, Mark Jr' },
      { name: 'msokol', displayName: 'Sokol, Mark (CTR)' },
    ]);
    const member: StandupRosterMember = {
      id: 'roster-member:mark',
      displayName: 'Sokol, Mark (CTR)',
      assigneeQueryValue: 'Sokol, Mark (CTR)',
    };

    expect((await resolveRosterIdentity(member))?.queryValue).toBe('msokol');
  });

  it('returns null when Jira matches nobody and there is nothing to query by', async () => {
    // Firing a query with an unresolvable value would 400. Better to report the member as unmatched.
    mockJiraGet.mockResolvedValue([]);
    const member: StandupRosterMember = {
      id: 'roster-member:ghost',
      displayName: 'Nobody, Real',
      assigneeQueryValue: '',
    };

    expect(await resolveRosterIdentity(member)).toBeNull();
  });

  it('falls back to the roster assignee value when Jira errors but a value exists', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira down'));
    const member: StandupRosterMember = {
      id: 'roster-member:mark',
      displayName: 'Sokol, Mark (CTR)',
      assigneeQueryValue: 'msokol', // already a username
    };

    expect((await resolveRosterIdentity(member))?.queryValue).toBe('msokol');
  });
});

describe('resolveRosterMachineIds', () => {
  it('resolves every member, keeping unmatched ones as null rather than dropping them', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path.includes('Sokol')) return Promise.resolve([{ name: 'msokol', displayName: 'Sokol, Mark (CTR)' }]);
      return Promise.resolve([]); // nobody else matches
    });
    const roster: StandupRosterMember[] = [
      { id: 'roster-member:mark', displayName: 'Sokol, Mark (CTR)', assigneeQueryValue: 'Sokol, Mark (CTR)' },
      { id: 'roster-member:ghost', displayName: 'Nobody, Real', assigneeQueryValue: '' },
    ];

    const resolved = await resolveRosterMachineIds(roster);

    expect(resolved).toEqual([
      { member: roster[0], queryValue: 'msokol' },
      { member: roster[1], queryValue: null },
    ]);
  });
});
