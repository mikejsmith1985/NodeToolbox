// releaseAlignment.test.ts — Flagging Epics and children that disagree about the release (GH #395).

import { describe, expect, it } from 'vitest';

import { computeMisalignments, isInRelease } from './releaseAlignment.ts';
import type { EpicGroup, ReleaseItem } from './releaseGather.ts';

const RELEASE_NAME = '10/14/2026';

/** A row in the release by default. */
function buildItem(key: string, fixVersionNames: string[] = [RELEASE_NAME]): ReleaseItem {
  return { key, summary: key, issueTypeName: 'Story', statusName: 'Done', assigneeName: 'A', fixVersionNames, epicKey: null, notes: '' };
}

/** A group with an Epic in the given versions and one child in the release. */
function buildGroup(epicVersionNames: string[], overrides: Partial<EpicGroup> = {}): EpicGroup {
  return {
    epicKey: 'DENP-20',
    epic: buildItem('DENP-20', epicVersionNames),
    items: [buildItem('ENCUC-2')],
    outsideItems: [],
    misalignments: [],
    ...overrides,
  };
}

describe('isInRelease', () => {
  it('compares version names ignoring case and surrounding spaces, since versions are per project', () => {
    expect(isInRelease([' 10/14/2026 '], RELEASE_NAME)).toBe(true);
    expect(isInRelease(['Release A'], 'release a')).toBe(true);
    expect(isInRelease(['11/11/2026'], RELEASE_NAME)).toBe(false);
  });
});

describe('computeMisalignments', () => {
  it('finds nothing when the Epic and its children agree', () => {
    expect(computeMisalignments(buildGroup([RELEASE_NAME]), RELEASE_NAME)).toEqual([]);
  });

  it('flags an Epic with no fixVersion whose children are in the release', () => {
    expect(computeMisalignments(buildGroup([]), RELEASE_NAME)).toEqual([
      { kind: 'epic-has-no-version', issueKey: 'DENP-20', message: 'DENP-20 has no fixVersion, but 1 of its children is in this release.' },
    ]);
  });

  it('flags an Epic planned for a different release, naming it', () => {
    expect(computeMisalignments(buildGroup(['11/11/2026']), RELEASE_NAME)).toEqual([
      { kind: 'epic-in-other-version', issueKey: 'DENP-20', message: 'DENP-20 is planned for 11/11/2026, not this release.' },
    ]);
  });

  it('flags each team child of the Epic that sits outside the release', () => {
    const group = buildGroup([RELEASE_NAME], {
      outsideItems: [{ key: 'ENCUC-9', fixVersionNames: ['11/11/2026'] }, { key: 'ENCUC-10', fixVersionNames: [] }],
    });

    expect(computeMisalignments(group, RELEASE_NAME).map((misalignment) => misalignment.message)).toEqual([
      'ENCUC-9 is in 11/11/2026, not this release.',
      'ENCUC-10 has no fixVersion, not this release.',
    ]);
  });

  it('has nothing to say about the "No Epic" group or an Epic it could not read', () => {
    expect(computeMisalignments(buildGroup([], { epicKey: null, epic: null }), RELEASE_NAME)).toEqual([]);
    expect(computeMisalignments(buildGroup([], { epic: null }), RELEASE_NAME)).toEqual([]);
  });
});
