// reworkScan.test.ts — The work that was done twice and charged once.

import { describe, expect, it } from 'vitest';

import { describeReworkScan, findReworkRounds, scanRework, type ReworkIssue } from './reworkScan.ts';

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

    expect(sentence).toContain('1 of 2 issues that reached delivery came back');
    expect(sentence).toContain('50%');
  });

  it('says plainly that the points are a scale, not a measurement', () => {
    // Nobody re-estimated the second pass — that is the whole problem — and a number presented as
    // exact would be the first thing challenged in the room.
    const result = scanRework([issue('A-1', [['Ready for QA', 3], ['In Progress', 5], ['Ready for QA', 12]])], TODAY_MS);

    expect(describeReworkScan(result)).toContain('the second pass was never sized');
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
