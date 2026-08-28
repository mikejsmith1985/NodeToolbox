// queueScan.test.ts — Finding where work piles up, without being told where to look.

import { describe, expect, it } from 'vitest';

import { calendarDaysWaiting, describeConstraint, scanQueues, type QueueIssueInput } from './queueScan.ts';

const NOW_MS = Date.parse('2026-08-28T12:00:00.000Z');

/** A moment the given number of days before now. */
function daysAgo(dayCount: number): string {
  return new Date(NOW_MS - dayCount * 86_400_000).toISOString();
}

/** One issue sitting in a status. */
function issue(
  key: string,
  statusName: string,
  waitedDays: number,
  overrides: Partial<QueueIssueInput> = {},
): QueueIssueInput {
  return {
    key,
    summary: `Summary for ${key}`,
    statusName,
    assigneeName: 'Reynolds, Kevin',
    enteredStatusIso: daysAgo(waitedDays),
    storyPoints: 5,
    ...overrides,
  };
}

describe('calendarDaysWaiting', () => {
  it('counts CALENDAR days, because a ticket untouched over a weekend has still been waiting', () => {
    // A queue that discounts weekends under-reports itself by two days in every seven.
    expect(calendarDaysWaiting(daysAgo(9), NOW_MS)).toBe(9);
  });

  it('returns nothing when history did not say when it arrived', () => {
    expect(calendarDaysWaiting(null, NOW_MS)).toBeNull();
    expect(calendarDaysWaiting('not a date', NOW_MS)).toBeNull();
  });

  it('never reports a negative wait', () => {
    expect(calendarDaysWaiting(new Date(NOW_MS + 86_400_000).toISOString(), NOW_MS)).toBe(0);
  });
});

describe('scanQueues', () => {
  it('ranks stages by ACCUMULATED waiting, not by how many are in them', () => {
    // Thirty issues that arrived yesterday are not a bottleneck; four that have sat a month are.
    const manyButFresh = Array.from({ length: 30 }, (_unused, index) => issue(`FRESH-${index}`, 'In Progress', 1));
    const fewButStale = Array.from({ length: 4 }, (_unused, index) => issue(`STALE-${index}`, 'Ready for Testing', 30));

    const result = scanQueues([...manyButFresh, ...fewButStale], NOW_MS);

    expect(result.stages[0].statusName).toBe('Ready for Testing');
    expect(result.stages[0].issueCount).toBe(4);
  });

  it('needs nobody to nominate which statuses matter', () => {
    // A report that has to be told where the bottleneck is cannot tell you where the bottleneck is.
    const result = scanQueues([
      issue('A-1', 'Some Status Nobody Configured', 40),
      issue('A-2', 'In Progress', 1),
    ], NOW_MS);

    expect(result.stages[0].statusName).toBe('Some Status Nobody Configured');
  });

  it('reports the median and the longest, so one ancient ticket does not describe the stage', () => {
    const result = scanQueues([
      issue('A-1', 'Ready for Testing', 2),
      issue('A-2', 'Ready for Testing', 3),
      issue('A-3', 'Ready for Testing', 100),
    ], NOW_MS);

    expect(result.stages[0].medianWaitingDays).toBe(3);
    expect(result.stages[0].longestWaitingDays).toBe(100);
  });

  it('rolls the waiting up by who is holding it', () => {
    const result = scanQueues([
      issue('A-1', 'Ready for Testing', 20, { assigneeName: 'Phatate, Smita' }),
      issue('A-2', 'Ready for Testing', 20, { assigneeName: 'Phatate, Smita' }),
      issue('A-3', 'In Progress', 1, { assigneeName: 'Jordan, John' }),
    ], NOW_MS);

    expect(result.holders[0].holderName).toBe('Phatate, Smita');
    expect(result.holders[0].issueCount).toBe(2);
  });

  it('names an unassigned holder rather than leaving the row blank', () => {
    const result = scanQueues([issue('A-1', 'Ready for Testing', 5, { assigneeName: null })], NOW_MS);

    expect(result.holders[0].holderName).toBe('Unassigned');
  });

  it('counts an undated issue separately rather than ageing it at zero', () => {
    // A silent zero would drag a stage's median down and make a queue look healthier than it is.
    const result = scanQueues([
      issue('A-1', 'Ready for Testing', 30),
      issue('A-2', 'Ready for Testing', 0, { enteredStatusIso: null }),
    ], NOW_MS);

    expect(result.undatedCount).toBe(1);
    expect(result.stages[0].issueCount).toBe(1);
    expect(result.stages[0].medianWaitingDays).toBe(30);
  });

  it('puts the longest-waiting issue first, because that is the one worth naming', () => {
    const result = scanQueues([issue('A-1', 'X', 3), issue('A-2', 'X', 40)], NOW_MS);

    expect(result.issues[0].key).toBe('A-2');
  });

  it('adds up the points held in each stage', () => {
    const result = scanQueues([
      issue('A-1', 'Ready for Testing', 5, { storyPoints: 8 }),
      issue('A-2', 'Ready for Testing', 5, { storyPoints: 3 }),
    ], NOW_MS);

    expect(result.stages[0].storyPoints).toBe(11);
  });

  it('survives an issue with no points at all', () => {
    const result = scanQueues([issue('A-1', 'X', 5, { storyPoints: null })], NOW_MS);

    expect(result.stages[0].storyPoints).toBe(0);
  });

  it('reports nothing rather than failing on an empty scope', () => {
    const result = scanQueues([], NOW_MS);

    expect(result.stages).toEqual([]);
    expect(result.totalWaitingDays).toBe(0);
  });
});

describe('describeConstraint', () => {
  it('names the stage and its SHARE of all the waiting', () => {
    // "112 days in Ready for Testing" means nothing alone; "41% of every waiting day" is the finding.
    const result = scanQueues([
      ...Array.from({ length: 4 }, (_unused, index) => issue(`SL-${index}`, 'Ready for Testing', 25)),
      issue('DEV-1', 'In Progress', 2),
    ], NOW_MS);

    const sentence = describeConstraint(result);

    expect(sentence).toContain('Ready for Testing');
    expect(sentence).toContain('% of all the waiting');
  });

  it('says how long the middle one and the oldest have been there', () => {
    const sentence = describeConstraint(scanQueues([issue('A-1', 'Ready for Testing', 30)], NOW_MS));

    expect(sentence).toContain('The middle one has been there 30 days');
    expect(sentence).toContain('the oldest, 30');
  });

  it('says nothing is waiting rather than naming a stage that does not exist', () => {
    expect(describeConstraint(scanQueues([], NOW_MS))).toContain('Nothing is waiting');
  });
});
