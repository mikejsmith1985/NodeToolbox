// recentVersionChanges.test.ts — "Show me everything whose fix version was removed today."

import { describe, expect, it } from 'vitest';

import {
  buildUpdatedSinceJql,
  collectFixVersionRemovals,
  formatJqlDateTime,
  groupRemovalsByAuthor,
  readFixVersionRemovals,
  readStartOfLocalDay,
  summariseRemovalCauses,
  type FixVersionRemoval,
} from './recentVersionChanges.ts';
import type { VersionChangeHistory, VersionMemberIssue } from './versionMovement.ts';

function issueWith(key: string, changeHistories: VersionChangeHistory[], fixVersionNames: string[] = []): VersionMemberIssue {
  return {
    key,
    summary: `Summary ${key}`,
    statusName: 'Working',
    assigneeDisplayName: 'Smith, Michael (CTR)',
    fixVersionNames,
    changeHistories,
  };
}

function versionChange(createdIso: string, fromName: string | null, toName: string | null, author = 'Kumar, Sidhant') {
  return {
    created: createdIso,
    author: { displayName: author },
    items: [{ field: 'Fix Version', fromString: fromName, toString: toName }],
  };
}

const THIS_MORNING = '2026-08-24T04:00:00.000Z';

describe('buildUpdatedSinceJql', () => {
  it('uses a plain updated clause, which every Jira supports', () => {
    // `fixVersion WAS` / `CHANGED` are not exposed on every deployment. This is the query that
    // always works; the histories that come back narrow it afterwards.
    expect(buildUpdatedSinceJql('ENCUC', '2026/08/24 00:00'))
      .toBe('project = "ENCUC" AND updated >= "2026/08/24 00:00" ORDER BY updated DESC');
  });

  it('escapes a project key rather than trusting it', () => {
    expect(buildUpdatedSinceJql('EN"CUC', '2026/08/24 00:00')).toContain('project = "EN\\"CUC"');
  });
});

describe('formatJqlDateTime', () => {
  it('formats an instant the way Jira reads a date-time clause', () => {
    expect(formatJqlDateTime(new Date(2026, 7, 24, 9, 5))).toBe('2026/08/24 09:05');
  });

  it('pads single-digit months, days, hours and minutes', () => {
    expect(formatJqlDateTime(new Date(2026, 0, 2, 3, 4))).toBe('2026/01/02 03:04');
  });
});

describe('readStartOfLocalDay', () => {
  it('is midnight this morning in the reader-s own zone, which is what "today" means', () => {
    const startOfDay = readStartOfLocalDay(new Date(2026, 7, 24, 14, 30));

    expect(startOfDay.getHours()).toBe(0);
    expect(startOfDay.getMinutes()).toBe(0);
    expect(startOfDay.getDate()).toBe(24);
  });
});

describe('readFixVersionRemovals', () => {
  it('finds a version taken off, with who did it and when', () => {
    const removals = readFixVersionRemovals(
      issueWith('ENC-2', [versionChange('2026-08-24T12:00:00.000Z', '08/27/2026', null)]),
      THIS_MORNING,
    );

    expect(removals).toHaveLength(1);
    expect(removals[0].removedVersionNames).toEqual(['08/27/2026']);
    expect(removals[0].byDisplayName).toBe('Kumar, Sidhant');
    expect(removals[0].atIso).toBe('2026-08-24T12:00:00.000Z');
  });

  it('ignores a change made before the moment asked about', () => {
    const removals = readFixVersionRemovals(
      issueWith('ENC-2', [versionChange('2026-08-20T12:00:00.000Z', '08/27/2026', null)]),
      THIS_MORNING,
    );

    expect(removals).toEqual([]);
  });

  it('ignores an ADDED version — that is not the event being hunted', () => {
    const removals = readFixVersionRemovals(
      issueWith('ENC-9', [versionChange('2026-08-24T12:00:00.000Z', null, '09/10/2026')]),
      THIS_MORNING,
    );

    expect(removals).toEqual([]);
  });

  it('counts a swap as a removal, because the old release did lose it', () => {
    const removals = readFixVersionRemovals(
      issueWith('ENC-3', [versionChange('2026-08-24T12:00:00.000Z', '08/27/2026', '09/10/2026')], ['09/10/2026']),
      THIS_MORNING,
    );

    expect(removals[0].removedVersionNames).toEqual(['08/27/2026']);
    expect(removals[0].currentVersionNames).toEqual(['09/10/2026']);
  });

  it('reports every version a single change took off, not just the first', () => {
    const removals = readFixVersionRemovals(issueWith('ENC-4', [{
      created: '2026-08-24T12:00:00.000Z',
      author: { displayName: 'Kumar, Sidhant' },
      items: [
        { field: 'Fix Version', fromString: '08/27/2026', toString: null },
        { field: 'Fix Version', fromString: '09/10/2026', toString: null },
      ],
    }]), THIS_MORNING);

    expect(removals[0].removedVersionNames).toEqual(['08/27/2026', '09/10/2026']);
  });

  it('reports two changes to one issue as two events, not one', () => {
    // An issue touched twice in a morning genuinely had two things happen to it.
    const removals = readFixVersionRemovals(issueWith('ENC-5', [
      versionChange('2026-08-24T09:00:00.000Z', '08/27/2026', null),
      versionChange('2026-08-24T15:00:00.000Z', '09/10/2026', null),
    ]), THIS_MORNING);

    expect(removals).toHaveLength(2);
  });

  it('is unmoved by changes to other fields', () => {
    const removals = readFixVersionRemovals(issueWith('ENC-6', [{
      created: '2026-08-24T12:00:00.000Z',
      author: { displayName: 'Kumar, Sidhant' },
      items: [{ field: 'status', fromString: 'To Do', toString: 'Working' }],
    }]), THIS_MORNING);

    expect(removals).toEqual([]);
  });

  it('handles an issue with no history at all', () => {
    expect(readFixVersionRemovals(issueWith('ENC-7', []), THIS_MORNING)).toEqual([]);
  });
});

describe('collectFixVersionRemovals', () => {
  it('returns the newest change first — this is read to see what just happened', () => {
    const removals = collectFixVersionRemovals([
      issueWith('ENC-1', [versionChange('2026-08-24T09:00:00.000Z', '08/27/2026', null)]),
      issueWith('ENC-2', [versionChange('2026-08-24T15:00:00.000Z', '08/27/2026', null)]),
    ], THIS_MORNING);

    expect(removals.map((removal) => removal.issueKey)).toEqual(['ENC-2', 'ENC-1']);
  });

  it('is empty when nothing was cleared', () => {
    expect(collectFixVersionRemovals([issueWith('ENC-1', [])], THIS_MORNING)).toEqual([]);
  });
});

describe('groupRemovalsByAuthor', () => {
  function removalBy(issueKey: string, byDisplayName: string | null): FixVersionRemoval {
    return {
      issueKey,
      summary: '',
      statusName: null,
      assigneeDisplayName: null,
      removedVersionNames: ['08/27/2026'],
      currentVersionNames: [],
      atIso: '2026-08-24T12:00:00.000Z',
      byDisplayName,
      statusChangeInSameAction: null,
    };
  }

  it('says "one person cleared twelve" instead of listing twelve independent events', () => {
    const batches = groupRemovalsByAuthor([
      removalBy('ENC-1', 'Kumar, Sidhant'),
      removalBy('ENC-2', 'Kumar, Sidhant'),
      removalBy('ENC-3', 'Someone, Else'),
    ]);

    expect(batches[0]).toEqual({ byDisplayName: 'Kumar, Sidhant', removals: [expect.anything(), expect.anything()] });
    expect(batches[0].removals).toHaveLength(2);
    expect(batches[1].byDisplayName).toBe('Someone, Else');
  });

  it('names an author Jira did not record rather than dropping the change', () => {
    const batches = groupRemovalsByAuthor([removalBy('ENC-1', null)]);

    expect(batches[0].byDisplayName).toBe('unattributed');
  });

  it('is empty when nothing was cleared', () => {
    expect(groupRemovalsByAuthor([])).toEqual([]);
  });
});

describe('what actually cleared the fix version', () => {
  /** One changelog entry that changed BOTH the fix version and the status — i.e. a transition. */
  function transitionEntry(createdIso: string) {
    return {
      created: createdIso,
      author: { displayName: 'Kumar, Sidhant' },
      items: [
        { field: 'Fix Version', fromString: '08/27/2026', toString: null },
        { field: 'status', fromString: 'Ready for Testing', toString: 'Cancelled' },
      ],
    };
  }

  it('names the status change made by the SAME action', () => {
    // Jira records one action as one changelog entry, so a version that vanished alongside a status
    // change was cleared BY that transition — a workflow post-function or a transition screen.
    const removals = readFixVersionRemovals(issueWith('ENC-2', [transitionEntry('2026-08-24T12:00:00.000Z')]), THIS_MORNING);

    expect(removals[0].statusChangeInSameAction).toEqual({
      fromStatus: 'Ready for Testing',
      toStatus: 'Cancelled',
    });
  });

  it('reports a plain field edit as having no status change beside it', () => {
    const removals = readFixVersionRemovals(
      issueWith('ENC-2', [versionChange('2026-08-24T12:00:00.000Z', '08/27/2026', null)]),
      THIS_MORNING,
    );

    expect(removals[0].statusChangeInSameAction).toBeNull();
  });

  it('counts the two populations, which is what settles the argument', () => {
    const removals = collectFixVersionRemovals([
      issueWith('ENC-1', [transitionEntry('2026-08-24T12:00:00.000Z')]),
      issueWith('ENC-2', [transitionEntry('2026-08-24T13:00:00.000Z')]),
      issueWith('ENC-3', [versionChange('2026-08-24T14:00:00.000Z', '08/27/2026', null)]),
    ], THIS_MORNING);

    expect(summariseRemovalCauses(removals)).toEqual({ withStatusChange: 2, fieldEditOnly: 1 });
  });

  it('is all zeroes when nothing was cleared', () => {
    expect(summariseRemovalCauses([])).toEqual({ withStatusChange: 0, fieldEditOnly: 0 });
  });
});
