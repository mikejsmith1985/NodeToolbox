// sharedRoster.test.ts — The roster has to survive the trip to Confluence and back.
//
// It lived only in localStorage, so "Clear All Connection Data" took it with no copy anywhere, and
// the team-to-team sharing that covers boards and settings did not cover the people.

import { describe, expect, it } from 'vitest';

import { buildSharedRoster, findRosterProfileId, readSharedRoster } from './sharedRoster.ts';
import type { StandupRosterMember } from '../SprintDashboard/hooks/useStandupRosterStore.ts';

function member(overrides: Partial<StandupRosterMember> = {}): StandupRosterMember {
  return {
    id: 'member-1',
    displayName: 'Smith, Mike (CTR)',
    assigneeQueryValue: 'msmith',
    jiraAccountId: 'acc-1',
    githubAccountId: 'C13471_Zilver',
    roleName: 'Developer',
    roleCapabilities: { canDevelop: true, canInternalTest: false, canExternalTest: false },
    ...overrides,
  };
}

describe('a roster round trip', () => {
  it('returns every member unchanged, capabilities and all', () => {
    // Round-tripped wholesale rather than rebuilt field by field: a rebuild needs a list of fields
    // to copy, and the day somebody adds one without updating that list it disappears on sync.
    const original = [member(), member({ id: 'member-2', displayName: 'Doe, Jane' })];

    const restored = readSharedRoster(buildSharedRoster(original));

    expect(restored).toEqual(original);
  });

  it('keeps the GitHub id, which is what links an email actor back to a person', () => {
    const restored = readSharedRoster(buildSharedRoster([member()]));

    expect(restored[0].githubAccountId).toBe('C13471_Zilver');
  });
});

describe('buildSharedRoster', () => {
  it('writes nothing at all for an empty roster', () => {
    // An empty ARRAY is a value, and the merge would treat it as a deliberate emptying — so the
    // first person with a blank machine to press Share would wipe the team's shared roster.
    expect(buildSharedRoster([])).toBeUndefined();
  });

  it('leaves out a half-finished row with no name', () => {
    expect(buildSharedRoster([member(), member({ id: 'member-2', displayName: '   ' })])).toHaveLength(1);
  });
});

describe('readSharedRoster', () => {
  it('reads an absent roster as no members rather than failing', () => {
    // What every payload written before this existed looks like.
    expect(readSharedRoster(undefined)).toEqual([]);
  });

  it('drops a stored row with no id or no name instead of inventing one', () => {
    const stored = [
      { id: '', displayName: 'Nameless', assigneeQueryValue: 'x' },
      { id: 'member-2', displayName: '  ', assigneeQueryValue: 'y' },
      { id: 'member-3', displayName: 'Real Person', assigneeQueryValue: 'z' },
    ];

    expect(readSharedRoster(stored).map((person) => person.id)).toEqual(['member-3']);
  });

  it('falls back to the display name when an older payload has no query value', () => {
    const stored = [{ id: 'member-1', displayName: 'Doe, Jane' } as never];

    expect(readSharedRoster(stored)[0].assigneeQueryValue).toBe('Doe, Jane');
  });
});

describe('findRosterProfileId — an ART team and a dashboard profile are different records', () => {
  it('joins them on the board, since a team is its board', () => {
    const profileId = findRosterProfileId(
      { id: 'art-team-1', boardId: '4021' },
      [{ id: 'profile-a', boardId: '9999' }, { id: 'profile-b', boardId: '4021' }],
    );

    expect(profileId).toBe('profile-b');
  });

  it('refuses when two profiles claim the same board', () => {
    // Sharing the wrong team's roster puts other people into this team's capacity planning, with
    // nothing on screen saying where they came from. Sharing none is the smaller failure.
    const profileId = findRosterProfileId(
      { id: 'art-team-1', boardId: '4021' },
      [{ id: 'profile-a', boardId: '4021' }, { id: 'profile-b', boardId: '4021' }],
    );

    expect(profileId).toBeNull();
  });

  it('refuses when no profile matches the board', () => {
    expect(findRosterProfileId({ id: 'art-team-1', boardId: '4021' }, [{ id: 'a', boardId: '1' }])).toBeNull();
  });

  it('refuses a team with no board rather than matching another team with none', () => {
    expect(findRosterProfileId({ id: 'art-team-1' }, [{ id: 'a' }, { id: 'b' }])).toBeNull();
  });
})
