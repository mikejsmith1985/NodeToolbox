// versionMovement.test.ts — Answering "the release had 27 issues and now has 15; where did 12 go?"

import { describe, expect, it } from 'vitest';

import {
  buildCurrentlyInVersionJql,
  buildVersionSnapshot,
  readVersionDeparture,
  readVersionMembershipAt,
  buildEverInVersionJql,
  diffVersionMembership,
  groupDeparturesByDestination,
  type VersionMemberIssue,
} from './versionMovement.ts';

function member(key: string, fixVersionNames: string[] = []): VersionMemberIssue {
  return { key, summary: `Summary ${key}`, statusName: 'Working', assigneeDisplayName: 'Smith, Michael (CTR)', fixVersionNames };
}

describe('buildEverInVersionJql', () => {
  it('asks Jira for the history, which is the only place the answer lives', () => {
    expect(buildEverInVersionJql('ENCUC', '08/27/2026'))
      .toBe('project = "ENCUC" AND fixVersion WAS "08/27/2026" ORDER BY key ASC');
  });

  it('escapes a version name carrying quotes, so a rename cannot break the query', () => {
    expect(buildEverInVersionJql('ENCUC', '08/27/2026 B "pushed"'))
      .toContain('fixVersion WAS "08/27/2026 B \\"pushed\\""');
  });

  it('trims a project key somebody typed with spaces', () => {
    expect(buildEverInVersionJql('  ENCUC  ', 'v1')).toContain('project = "ENCUC"');
  });
});

describe('buildCurrentlyInVersionJql', () => {
  it('asks what the version holds today', () => {
    expect(buildCurrentlyInVersionJql('ENCUC', '08/27/2026'))
      .toBe('project = "ENCUC" AND fixVersion = "08/27/2026" ORDER BY key ASC');
  });
});

describe('diffVersionMembership', () => {
  it('names the issues that left, which Jira will not tell you', () => {
    const movement = diffVersionMembership(
      '08/27/2026',
      [member('ENC-1'), member('ENC-2'), member('ENC-3')],
      [member('ENC-1')],
    );

    expect(movement.departed.map((issue) => issue.key)).toEqual(['ENC-2', 'ENC-3']);
    expect(movement.stillIn.map((issue) => issue.key)).toEqual(['ENC-1']);
  });

  it('says where each departure went, read from where it IS now', () => {
    // Not from a changelog entry: an issue that moved twice would be reported at its first stop.
    const movement = diffVersionMembership(
      '08/27/2026',
      [member('ENC-2', ['08/27/2026 B (scope pushed from july)'])],
      [],
    );

    expect(movement.departed[0].movedToVersionNames).toEqual(['08/27/2026 B (scope pushed from july)']);
  });

  it('distinguishes an issue that was DROPPED from one that moved', () => {
    const movement = diffVersionMembership('08/27/2026', [member('ENC-2', [])], []);

    expect(movement.departed[0].movedToVersionNames).toEqual([]);
  });

  it('never reports the version it left as a destination', () => {
    // An issue can carry several versions; the one being reported on is not news.
    const movement = diffVersionMembership(
      '08/27/2026',
      [member('ENC-2', ['08/27/2026', '09/10/2026'])],
      [],
    );

    expect(movement.departed[0].movedToVersionNames).toEqual(['09/10/2026']);
  });

  it('lists an issue present today but absent from the history separately', () => {
    // Usually the sign that the instance answered the history query without history — worth showing
    // rather than folding into "still in", which would claim it had been there all along.
    const movement = diffVersionMembership('08/27/2026', [], [member('ENC-9', ['08/27/2026'])]);

    expect(movement.arrived.map((issue) => issue.key)).toEqual(['ENC-9']);
    expect(movement.stillIn).toEqual([]);
  });

  it('reports nothing moved when the two populations match', () => {
    const movement = diffVersionMembership('08/27/2026', [member('ENC-1')], [member('ENC-1')]);

    expect(movement.departed).toEqual([]);
    expect(movement.arrived).toEqual([]);
    expect(movement.stillIn).toHaveLength(1);
  });
});

describe('groupDeparturesByDestination', () => {
  it('answers the question once instead of twelve times', () => {
    // "Twelve went to 08/27/2026 B" is the answer; twelve rows naming the same place is that same
    // fact, repeated.
    const grouped = groupDeparturesByDestination([
      { key: 'ENC-1', summary: '', statusName: null, assigneeDisplayName: null, movedToVersionNames: ['08/27/2026 B'], departure: null },
      { key: 'ENC-2', summary: '', statusName: null, assigneeDisplayName: null, movedToVersionNames: ['08/27/2026 B'], departure: null },
      { key: 'ENC-3', summary: '', statusName: null, assigneeDisplayName: null, movedToVersionNames: ['09/10/2026'], departure: null },
    ]);

    expect(grouped[0]).toEqual({ destination: '08/27/2026 B', issueKeys: ['ENC-1', 'ENC-2'] });
    expect(grouped[1]).toEqual({ destination: '09/10/2026', issueKeys: ['ENC-3'] });
  });

  it('names having no version at all as its own destination', () => {
    const grouped = groupDeparturesByDestination([
      { key: 'ENC-1', summary: '', statusName: null, assigneeDisplayName: null, movedToVersionNames: [], departure: null },
    ]);

    expect(grouped[0].destination).toBe('no fix version at all');
  });

  it('counts an issue under every version it now carries', () => {
    const grouped = groupDeparturesByDestination([
      { key: 'ENC-1', summary: '', statusName: null, assigneeDisplayName: null, movedToVersionNames: ['A', 'B'], departure: null },
    ]);

    expect(grouped.map((group) => group.destination)).toEqual(['A', 'B']);
  });

  it('is empty when nothing left', () => {
    expect(groupDeparturesByDestination([])).toEqual([]);
  });
});

/** One Fix Version changelog entry, in the shape Jira returns it. */
function versionChange(createdIso: string, fromName: string | null, toName: string | null, author = 'Kumar, Sidhant') {
  return {
    created: createdIso,
    author: { displayName: author },
    items: [{ field: 'Fix Version', fromString: fromName, toString: toName }],
  };
}

describe('readVersionDeparture', () => {
  it('names who took the version off, and when', () => {
    // The most useful single fact: a release losing twelve issues is usually one person doing one
    // thing that cleared the field as a side effect.
    const departure = readVersionDeparture(
      [versionChange('2026-08-24T12:00:00.000+0000', '08/27/2026', null)],
      '08/27/2026',
    );

    expect(departure).toEqual({ atIso: '2026-08-24T12:00:00.000+0000', byDisplayName: 'Kumar, Sidhant' });
  });

  it('takes the LAST removal — an issue can be added back and removed again', () => {
    const departure = readVersionDeparture([
      versionChange('2026-07-01T09:00:00.000+0000', '08/27/2026', null),
      versionChange('2026-07-02T09:00:00.000+0000', null, '08/27/2026'),
      versionChange('2026-08-24T12:00:00.000+0000', '08/27/2026', null, 'Someone, Else'),
    ], '08/27/2026');

    expect(departure?.byDisplayName).toBe('Someone, Else');
  });

  it('ignores a removal of a DIFFERENT version', () => {
    expect(readVersionDeparture([versionChange('2026-08-24T12:00:00.000+0000', '09/10/2026', null)], '08/27/2026'))
      .toBeNull();
  });

  it('returns nothing rather than a guessed author when the history says nothing', () => {
    // "Removed by somebody, at some point" is worse than a blank, because it looks like an answer.
    expect(readVersionDeparture([], '08/27/2026')).toBeNull();
    expect(readVersionDeparture(undefined, '08/27/2026')).toBeNull();
  });
});

describe('readVersionMembershipAt', () => {
  const REMOVED_AT = '2026-08-24T12:00:00.000+0000';

  it('reports an issue as IN the release before it was removed', () => {
    const issue = { ...member('ENC-2', []), changeHistories: [versionChange(REMOVED_AT, '08/27/2026', null)] };

    expect(readVersionMembershipAt(issue, '08/27/2026', '2026-08-21T17:00:00.000+0000')).toBe(true);
  });

  it('reports it as OUT after the removal', () => {
    const issue = { ...member('ENC-2', []), changeHistories: [versionChange(REMOVED_AT, '08/27/2026', null)] };

    expect(readVersionMembershipAt(issue, '08/27/2026', '2026-08-25T09:00:00.000+0000')).toBe(false);
  });

  it('reports an issue as OUT before it was ever added', () => {
    const issue = {
      ...member('ENC-9', ['08/27/2026']),
      changeHistories: [versionChange('2026-08-22T09:00:00.000+0000', null, '08/27/2026')],
    };

    expect(readVersionMembershipAt(issue, '08/27/2026', '2026-08-21T17:00:00.000+0000')).toBe(false);
  });

  it('handles an issue added, removed, and added back again', () => {
    const issue = {
      ...member('ENC-3', ['08/27/2026']),
      changeHistories: [
        versionChange('2026-08-01T09:00:00.000+0000', null, '08/27/2026'),
        versionChange('2026-08-10T09:00:00.000+0000', '08/27/2026', null),
        versionChange('2026-08-23T09:00:00.000+0000', null, '08/27/2026'),
      ],
    };

    expect(readVersionMembershipAt(issue, '08/27/2026', '2026-08-05T09:00:00.000+0000')).toBe(true);
    expect(readVersionMembershipAt(issue, '08/27/2026', '2026-08-15T09:00:00.000+0000')).toBe(false);
    expect(readVersionMembershipAt(issue, '08/27/2026', '2026-08-24T09:00:00.000+0000')).toBe(true);
  });

  it('falls back to what the issue carries TODAY when it has no history at all', () => {
    // Rewinding from a fact beats replaying forward from a guess: a changelog records changes, never
    // the original value, so a forward replay has nowhere to start.
    expect(readVersionMembershipAt(member('ENC-1', ['08/27/2026']), '08/27/2026', '2026-01-01T00:00:00.000+0000'))
      .toBe(true);
    expect(readVersionMembershipAt(member('ENC-1', []), '08/27/2026', '2026-01-01T00:00:00.000+0000'))
      .toBe(false);
  });

  it('is unmoved by changes to other fields', () => {
    const issue = {
      ...member('ENC-1', ['08/27/2026']),
      changeHistories: [{
        created: '2026-08-24T12:00:00.000+0000',
        author: { displayName: 'Kumar, Sidhant' },
        items: [{ field: 'status', fromString: 'To Do', toString: 'Working' }],
      }],
    };

    expect(readVersionMembershipAt(issue, '08/27/2026', '2026-08-21T17:00:00.000+0000')).toBe(true);
  });
});

describe('buildVersionSnapshot', () => {
  const FRIDAY_1PM_EDT = '2026-08-21T17:00:00.000+0000';
  const REMOVED_AT = '2026-08-24T12:00:00.000+0000';

  it('rebuilds what the release held at a moment, including what has since left', () => {
    // The question: "what was in this release as of Friday at 1pm". Asking only what is in it today
    // would rebuild the present and call it the past.
    const snapshot = buildVersionSnapshot('08/27/2026', [
      member('ENC-1', ['08/27/2026']),
      { ...member('ENC-2', []), changeHistories: [versionChange(REMOVED_AT, '08/27/2026', null)] },
    ], FRIDAY_1PM_EDT);

    expect(snapshot.membersAt.map((issue) => issue.key)).toEqual(['ENC-1', 'ENC-2']);
  });

  it('names what has been removed since that moment', () => {
    const snapshot = buildVersionSnapshot('08/27/2026', [
      member('ENC-1', ['08/27/2026']),
      { ...member('ENC-2', []), changeHistories: [versionChange(REMOVED_AT, '08/27/2026', null)] },
    ], FRIDAY_1PM_EDT);

    expect(snapshot.removedSince.map((issue) => issue.key)).toEqual(['ENC-2']);
  });

  it('names what has been added since that moment', () => {
    const snapshot = buildVersionSnapshot('08/27/2026', [
      {
        ...member('ENC-9', ['08/27/2026']),
        changeHistories: [versionChange('2026-08-22T09:00:00.000+0000', null, '08/27/2026')],
      },
    ], FRIDAY_1PM_EDT);

    expect(snapshot.addedSince.map((issue) => issue.key)).toEqual(['ENC-9']);
    expect(snapshot.membersAt).toEqual([]);
  });

  it('reports no change when nothing moved', () => {
    const snapshot = buildVersionSnapshot('08/27/2026', [member('ENC-1', ['08/27/2026'])], FRIDAY_1PM_EDT);

    expect(snapshot.removedSince).toEqual([]);
    expect(snapshot.addedSince).toEqual([]);
    expect(snapshot.membersAt).toHaveLength(1);
  });
});
