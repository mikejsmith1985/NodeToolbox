// reworkScan.test.ts — The work that was done twice and charged once.

import { describe, expect, it } from 'vitest';

import {
  describeReworkExclusions,
  describeReworkScan,
  findReworkRounds,
  isAbandonedStatusName,
  scanRework,
  type ReworkIssue,
} from './reworkScan.ts';

const TODAY_MS = Date.parse('2026-08-28T12:00:00.000Z');

/** A day, as an ISO timestamp. */
function day(dayOfMonth: number): string {
  return `2026-08-${String(dayOfMonth).padStart(2, '0')}T12:00:00.000Z`;
}

/** One issue with the history the test is about. */
function issue(
  key: string,
  transitions: [string, number][],
  overrides: Partial<ReworkIssue> = {},
): ReworkIssue {
  return {
    key,
    summary: `Summary for ${key}`,
    storyPoints: 5,
    assigneeName: 'Reynolds, Kevin',
    initialStatusName: 'To Do',
    statusTransitions: transitions.map(([toStatusName, dayOfMonth]) => ({
      toStatusName,
      atIso: day(dayOfMonth),
    })),
    ...overrides,
  };
}

describe('findReworkRounds', () => {
  it('finds an issue pushed back out of delivery', () => {
    // Reaching "Ready for QA" and being pushed back to In Progress is unmistakably work done twice.
    const rounds = findReworkRounds(
      issue('ENCUC-1', [['In Progress', 3], ['Ready for QA', 5], ['In Progress', 10], ['Ready for QA', 14]]),
      TODAY_MS,
    );

    expect(rounds).toHaveLength(1);
    expect(rounds[0].fellBackToStatus).toBe('In Progress');
    expect(rounds[0].isStillOut).toBe(false);
  });

  it('names the status it fell back INTO, which is the best answer to who sent it back', () => {
    const rounds = findReworkRounds(
      issue('ENCUC-1', [['Ready for QA', 3], ['In Development', 5], ['Ready for QA', 7]]),
      TODAY_MS,
    );

    expect(rounds[0].fellBackToStatus).toBe('In Development');
  });

  it('measures the round trip in WORKING days', () => {
    // 5 Aug (Wed) to 10 Aug (Mon) is three working days, not five.
    const rounds = findReworkRounds(
      issue('ENCUC-1', [['Ready for QA', 5], ['In Progress', 5], ['Ready for QA', 10]]),
      TODAY_MS,
    );

    expect(rounds[0].workingDays).toBeGreaterThan(0);
    expect(rounds[0].workingDays).toBeLessThan(5);
  });

  it('counts an issue that has NOT come back, and says it is still out', () => {
    // Waiting for it to return before admitting it went away would under-report the worst cases.
    const rounds = findReworkRounds(issue('ENCUC-1', [['Ready for QA', 3], ['In Progress', 5]]), TODAY_MS);

    expect(rounds).toHaveLength(1);
    expect(rounds[0].isStillOut).toBe(true);
    expect(rounds[0].returnedAtIso).toBeNull();
  });

  it('counts every round when an issue went back more than once', () => {
    const rounds = findReworkRounds(
      issue('ENCUC-1', [
        ['Ready for QA', 3], ['In Progress', 4], ['Ready for QA', 6],
        ['In Progress', 7], ['Ready for QA', 11],
      ]),
      TODAY_MS,
    );

    expect(rounds).toHaveLength(2);
  });

  it('does NOT count a move between two in-progress statuses', () => {
    // Ordinary work. Counting it would inflate the number until nobody believed any of it.
    const rounds = findReworkRounds(
      issue('ENCUC-1', [['In Progress', 3], ['In Review', 5], ['In Progress', 6]]),
      TODAY_MS,
    );

    expect(rounds).toEqual([]);
  });

  it('does not count an issue that simply moved forward through delivery', () => {
    const rounds = findReworkRounds(
      issue('ENCUC-1', [['In Progress', 3], ['Ready for QA', 5], ['Done', 9]]),
      TODAY_MS,
    );

    expect(rounds).toEqual([]);
  });

  it('treats a done-category status as delivered, so closing and reopening counts', () => {
    const rounds = findReworkRounds(issue('ENCUC-1', [['Done', 3], ['In Progress', 5]]), TODAY_MS);

    expect(rounds).toHaveLength(1);
  });

  it('reads an issue that was already delivered when the window opened', () => {
    const rounds = findReworkRounds(
      issue('ENCUC-1', [['In Progress', 5]], { initialStatusName: 'Ready for QA' }),
      TODAY_MS,
    );

    expect(rounds).toHaveLength(1);
  });

  it('survives a transition whose timestamp cannot be read', () => {
    const brokenIssue: ReworkIssue = {
      ...issue('ENCUC-1', []),
      statusTransitions: [
        { toStatusName: 'Ready for QA', atIso: 'not a date' },
        { toStatusName: 'In Progress', atIso: day(5) },
      ],
    };

    expect(() => findReworkRounds(brokenIssue, TODAY_MS)).not.toThrow();
  });

  it('finds nothing in an issue with no history at all', () => {
    expect(findReworkRounds(issue('ENCUC-1', []), TODAY_MS)).toEqual([]);
  });
});

describe('scanRework', () => {
  const wentBack = issue('ENCUC-1', [['Ready for QA', 3], ['In Progress', 5], ['Ready for QA', 12]]);
  const cleanRun = issue('ENCUC-2', [['In Progress', 3], ['Ready for QA', 6]]);
  const neverGotThere = issue('ENCUC-3', [['In Progress', 3]]);

  it('reports the rate against the issues that COULD have come back', () => {
    // "12 of 145" is misleading when a hundred never reached delivery; "12 of 45 that got there" is
    // the number somebody can act on.
    const result = scanRework([wentBack, cleanRun, neverGotThere], TODAY_MS);

    expect(result.examinedCount).toBe(3);
    expect(result.deliveredCount).toBe(2);
    expect(result.reworkedCount).toBe(1);
  });

  it('adds up the days and the points that went round again', () => {
    const result = scanRework([wentBack, cleanRun], TODAY_MS);

    expect(result.totalRounds).toBe(1);
    expect(result.totalWorkingDays).toBeGreaterThan(0);
    expect(result.reworkedPoints).toBe(5);
  });

  it('says which status the returns fell into, worst first', () => {
    const result = scanRework([
      issue('A-1', [['Ready for QA', 3], ['In Progress', 4], ['Ready for QA', 6]]),
      issue('A-2', [['Ready for QA', 3], ['In Progress', 4], ['Ready for QA', 6]]),
      issue('A-3', [['Ready for QA', 3], ['In Development', 4], ['Ready for QA', 6]]),
    ], TODAY_MS);

    expect(result.returnsByStatus[0]).toEqual({ statusName: 'In Progress', count: 2 });
    expect(result.returnsByStatus[1]).toEqual({ statusName: 'In Development', count: 1 });
  });

  it('puts the worst issue first, because that is the one worth reading out', () => {
    const brief = issue('A-1', [['Ready for QA', 3], ['In Progress', 3], ['Ready for QA', 4]]);
    const long = issue('A-2', [['Ready for QA', 3], ['In Progress', 3], ['Ready for QA', 21]]);

    const result = scanRework([brief, long], TODAY_MS);

    expect(result.issues[0].key).toBe('A-2');
  });

  it('reports nothing rather than failing on an empty set', () => {
    const result = scanRework([], TODAY_MS);

    expect(result.reworkedCount).toBe(0);
    expect(result.returnsByStatus).toEqual([]);
  });

  it('handles an issue with no points without treating it as zero effort in the count', () => {
    const unpointed = issue('A-1', [['Ready for QA', 3], ['In Progress', 5], ['Ready for QA', 7]], { storyPoints: null });

    const result = scanRework([unpointed], TODAY_MS);

    expect(result.reworkedCount).toBe(1);
    expect(result.reworkedPoints).toBe(0);
  });
});

describe('describeReworkScan', () => {
  it('states the rate, the rounds and the days in one sentence', () => {
    const result = scanRework([
      issue('A-1', [['Ready for QA', 3], ['In Progress', 5], ['Ready for QA', 12]]),
      issue('A-2', [['In Progress', 3], ['Ready for QA', 6]]),
    ], TODAY_MS);

    const sentence = describeReworkScan(result);

    expect(sentence).toContain('50% of the work that reached delivery came back');
    expect(sentence).toContain('1 of 2 issues');
  });

  it('leads with what a return costs to RECOVER, the figure the report exists for', () => {
    // The first version led with a points total, which was zero, because the issues that come back
    // are defects and nobody points defects. A cost argument resting on a zero is worse than none.
    const result = scanRework([issue('A-1', [['Ready for QA', 3], ['In Progress', 5], ['Ready for QA', 12]])], TODAY_MS);

    expect(describeReworkScan(result)).toContain('working days to recover');
  });

  it('says outright when NOTHING that came back carried points', () => {
    const unpointed = issue('A-1', [['Ready for QA', 3], ['In Progress', 5], ['Ready for QA', 12]], { storyPoints: null });

    expect(describeReworkScan(scanRework([unpointed], TODAY_MS)))
      .toContain('recorded nowhere at all');
  });

  it('reports what is still out separately, because its clock has not stopped', () => {
    const result = scanRework([issue('A-1', [['Ready for QA', 3], ['In Progress', 5]])], TODAY_MS);

    expect(describeReworkScan(result)).toContain('still out');
  });

  it('says nothing came back rather than reporting a zero rate', () => {
    const result = scanRework([issue('A-1', [['In Progress', 3], ['Ready for QA', 6]])], TODAY_MS);

    expect(describeReworkScan(result)).toContain('None of the 1 issues that reached delivery came back');
  });

  it('says when nothing could have come back at all', () => {
    const result = scanRework([issue('A-1', [['In Progress', 3]])], TODAY_MS);

    expect(describeReworkScan(result)).toContain('none could have come back');
  });
});

// ── The counting rules that make the figure mean something (GH #376) ───────

describe('scanRework — what does not count as rework', () => {
  it('does NOT count an issue that was cancelled', () => {
    // Falling into Cancelled means the work stopped, not that it was done again. Counting it put days
    // into the total that nobody ever spent redoing anything.
    const result = scanRework([issue('A-1', [['Ready for QA', 3], ['Cancelled', 5]])], TODAY_MS);

    expect(result.reworkedCount).toBe(0);
    expect(result.excludedAbandonedRounds).toBe(1);
  });

  it('treats rejected, withdrawn and duplicate the same way', () => {
    ['Rejected', 'Withdrawn', 'Duplicate'].forEach((abandonedStatus) => {
      const result = scanRework([issue('A-1', [['Ready for QA', 3], [abandonedStatus, 5]])], TODAY_MS);

      expect(result.reworkedCount).toBe(0);
    });
  });

  it('is not fooled by the casing somebody configured', () => {
    expect(isAbandonedStatusName('CANCELLED')).toBe(true);
    expect(isAbandonedStatusName('  cancelled  ')).toBe(true);
    expect(isAbandonedStatusName('In Progress')).toBe(false);
  });

  it('does NOT count a bounce that came back the same day', () => {
    // Somebody fixing a mis-click in Jira, not a developer doing the job twice. Eight rows of zeroes
    // were going into a table that was supposed to be evidence.
    const result = scanRework([issue('A-1', [['Ready for QA', 3], ['In Progress', 3], ['Ready for QA', 3]])], TODAY_MS);

    expect(result.reworkedCount).toBe(0);
    expect(result.excludedShortRounds).toBe(1);
  });

  it('still counts a bounce that took longer than half a working day', () => {
    const result = scanRework([issue('A-1', [['Ready for QA', 3], ['In Progress', 3], ['Ready for QA', 6]])], TODAY_MS);

    expect(result.reworkedCount).toBe(1);
  });

  it('never excludes a still-open round as too short — its clock has not stopped', () => {
    const result = scanRework([issue('A-1', [['Ready for QA', 28], ['In Progress', 28]])], TODAY_MS);

    expect(result.excludedShortRounds).toBe(0);
    expect(result.stillOutRounds).toBe(1);
  });

  it('keeps the excluded counts so nothing is silently dropped', () => {
    const result = scanRework([
      issue('A-1', [['Ready for QA', 3], ['Cancelled', 5]]),
      issue('A-2', [['Ready for QA', 3], ['In Progress', 3], ['Ready for QA', 3]]),
    ], TODAY_MS);

    expect(describeReworkExclusions(result)).toContain('abandoned, not redone');
    expect(describeReworkExclusions(result)).toContain('a correction, not rework');
  });

  it('says nothing about exclusions when there were none', () => {
    const result = scanRework([issue('A-1', [['Ready for QA', 3], ['In Progress', 5], ['Ready for QA', 12]])], TODAY_MS);

    expect(describeReworkExclusions(result)).toBe('');
  });
});

describe('scanRework — settled against still out', () => {
  it('measures the median on SETTLED rounds only', () => {
    // Averaging an open round in with completed ones produces a cost-per-return no return ever cost.
    const result = scanRework([
      issue('A-1', [['Ready for QA', 3], ['In Progress', 3], ['Ready for QA', 6]]),
      issue('A-2', [['Ready for QA', 3], ['In Progress', 3]]),
    ], TODAY_MS);

    expect(result.settledRounds).toBe(1);
    expect(result.stillOutRounds).toBe(1);
    expect(result.medianSettledWorkingDays).toBeLessThan(result.stillOutWorkingDays);
  });

  it('uses the MEDIAN, so one long outlier is not reported as typical', () => {
    const result = scanRework([
      issue('A-1', [['Ready for QA', 3], ['In Progress', 3], ['Ready for QA', 6]]),
      issue('A-2', [['Ready for QA', 3], ['In Progress', 3], ['Ready for QA', 7]]),
      issue('A-3', [['Ready for QA', 3], ['In Progress', 3], ['Ready for QA', 28]]),
    ], TODAY_MS);

    expect(result.medianSettledWorkingDays).toBeLessThan(10);
  });

  it('reports no median when every round is still open', () => {
    const result = scanRework([issue('A-1', [['Ready for QA', 3], ['In Progress', 5]])], TODAY_MS);

    expect(result.medianSettledWorkingDays).toBeNull();
  });

  it('counts how many reworked issues carried no points at all', () => {
    const result = scanRework([
      issue('A-1', [['Ready for QA', 3], ['In Progress', 5], ['Ready for QA', 12]], { storyPoints: null }),
      issue('A-2', [['Ready for QA', 3], ['In Progress', 5], ['Ready for QA', 12]]),
    ], TODAY_MS);

    expect(result.unpointedCount).toBe(1);
    expect(result.reworkedPoints).toBe(5);
  });
});
