// chainTargetStart.test.ts — The day the Feature's work has to begin to make code freeze.
//
// The old back-calculation counted only the issue's OWN effort, so a dev story due to be followed by
// a week of SL testing was told it could start a week too late. It then read "on track" right up to
// the day the Feature missed its commitment.

import { describe, expect, it } from 'vitest';

import {
  CODE_REVIEW_BUFFER_WORKING_DAYS,
  SL_QUEUE_BUFFER_WORKING_DAYS,
  buildChainTargetStarts,
} from './chainTargetStart.ts';
import type { ChainItem } from './forecastTypes.ts';

/** Monday-to-Friday, no holidays — so every expectation below can be counted by hand. */
const CALENDAR = { weekendDays: [0, 6], holidayIsoDates: [] };

function chainItem(overrides: Partial<ChainItem> & { issueKey: string }): ChainItem {
  return {
    summary: '[DEV] Build it',
    role: 'dev',
    remainingWorkingDays: 1,
    isInternalTestReady: false,
    isComplete: false,
    ...overrides,
  };
}

describe('the buffers', () => {
  it('reserves one working day for code review and one for the SL queue', () => {
    // Named separately because they are two different waits somebody can shorten independently.
    expect(CODE_REVIEW_BUFFER_WORKING_DAYS).toBe(1);
    expect(SL_QUEUE_BUFFER_WORKING_DAYS).toBe(1);
  });
});

describe('buildChainTargetStarts', () => {
  it('works the dev start back through the SL story and BOTH buffers', () => {
    // Deadline Friday 2026-09-25. SL needs 2 days: Thu 24, Fri 25. One day of SL queue before it:
    // Wed 23. One day of code review before that: Tue 22 — the day dev must be complete. Dev needs
    // 3 days and finishes Tue 22, so it runs Fri 18, Mon 21, Tue 22.
    const result = buildChainTargetStarts(
      [
        chainItem({ issueKey: 'DEV-1', role: 'dev', remainingWorkingDays: 3 }),
        chainItem({ issueKey: 'SL-1', role: 'sl', summary: '[SL] Test it', remainingWorkingDays: 2 }),
      ],
      '2026-09-25',
      CALENDAR,
    );

    expect(result.slStartIso).toBe('2026-09-24');
    expect(result.devMustCompleteIso).toBe('2026-09-22');
    expect(result.devStartIso).toBe('2026-09-18');
    expect(result.targetStartByIssueKey).toEqual({ 'DEV-1': '2026-09-18', 'SL-1': '2026-09-24' });
  });

  it('sums the dev stories, because the deadline cannot assume they run in parallel', () => {
    const result = buildChainTargetStarts(
      [
        chainItem({ issueKey: 'DEV-1', remainingWorkingDays: 2 }),
        chainItem({ issueKey: 'DEV-2', remainingWorkingDays: 2 }),
        chainItem({ issueKey: 'SL-1', role: 'sl', remainingWorkingDays: 1 }),
      ],
      '2026-09-25',
      CALENDAR,
    );

    // SL runs Fri 25. Queue Thu 24. Review Wed 23. Four dev days finish Wed 23: Fri 18, Mon 21,
    // Tue 22, Wed 23.
    expect(result.devStartIso).toBe('2026-09-18');
  });

  it('still reserves the buffers when there is no SL story, because dev still has to be reviewed', () => {
    const result = buildChainTargetStarts(
      [chainItem({ issueKey: 'DEV-1', remainingWorkingDays: 1 })],
      '2026-09-25',
      CALENDAR,
    );

    // No SL work to schedule, but code review and the queue are still two days somebody waits.
    expect(result.devMustCompleteIso).toBe('2026-09-23');
    expect(result.devStartIso).toBe('2026-09-23');
    expect(result.hasNoSlStory).toBe(true);
  });

  it('charges nothing for work already through, so a finished story does not drag the start earlier', () => {
    const result = buildChainTargetStarts(
      [
        chainItem({ issueKey: 'DEV-DONE', remainingWorkingDays: 5, isComplete: true }),
        chainItem({ issueKey: 'DEV-1', remainingWorkingDays: 1 }),
        chainItem({ issueKey: 'SL-1', role: 'sl', remainingWorkingDays: 1 }),
      ],
      '2026-09-25',
      CALENDAR,
    );

    // Only the one remaining dev day counts. SL Fri 25, queue Thu 24, review Wed 23, dev Wed 23.
    expect(result.devStartIso).toBe('2026-09-23');
    // A finished issue is given no start date at all rather than a fabricated one.
    expect(result.targetStartByIssueKey['DEV-DONE']).toBeUndefined();
  });

  it('charges nothing for dev already awaiting test, which is the state that releases SL', () => {
    const result = buildChainTargetStarts(
      [
        chainItem({ issueKey: 'DEV-1', remainingWorkingDays: 4, isInternalTestReady: true }),
        chainItem({ issueKey: 'SL-1', role: 'sl', remainingWorkingDays: 1 }),
      ],
      '2026-09-25',
      CALENDAR,
    );

    expect(result.targetStartByIssueKey['DEV-1']).toBeUndefined();
    expect(result.slStartIso).toBe('2026-09-25');
  });

  it('dates nothing at all when any of the work is unsized', () => {
    // A chain date that quietly omits unmeasured work reads exactly like a real one, which is worse
    // than saying it cannot be worked out.
    const result = buildChainTargetStarts(
      [
        chainItem({ issueKey: 'DEV-1', remainingWorkingDays: null }),
        chainItem({ issueKey: 'SL-1', role: 'sl', remainingWorkingDays: 1 }),
      ],
      '2026-09-25',
      CALENDAR,
    );

    expect(result.devStartIso).toBeNull();
    expect(result.targetStartByIssueKey).toEqual({});
    expect(result.hasUnsizedWork).toBe(true);
  });

  it('treats unclassified work as dev, which is the side that has to finish first', () => {
    const result = buildChainTargetStarts(
      [
        chainItem({ issueKey: 'TASK-1', role: 'unclassified', remainingWorkingDays: 1 }),
        chainItem({ issueKey: 'SL-1', role: 'sl', remainingWorkingDays: 1 }),
      ],
      '2026-09-25',
      CALENDAR,
    );

    expect(result.targetStartByIssueKey['TASK-1']).toBe('2026-09-23');
  });

  it('steps over weekends, because a deadline does not move but a weekend is not a working day', () => {
    // Deadline Monday 2026-09-21. One SL day: Mon 21. Queue Fri 18. Review Thu 17. One dev day:
    // Thu 17 — never Saturday.
    const result = buildChainTargetStarts(
      [
        chainItem({ issueKey: 'DEV-1', remainingWorkingDays: 1 }),
        chainItem({ issueKey: 'SL-1', role: 'sl', remainingWorkingDays: 1 }),
      ],
      '2026-09-21',
      CALENDAR,
    );

    expect(result.devStartIso).toBe('2026-09-17');
  });

  it('produces no dates without a deadline to work back from', () => {
    const result = buildChainTargetStarts([chainItem({ issueKey: 'DEV-1' })], null, CALENDAR);
    expect(result.targetStartByIssueKey).toEqual({});
    expect(result.devStartIso).toBeNull();
  });

  it('reports a start already in the past rather than clamping it to today', () => {
    // Clamping would report a chain that cannot be delivered as one starting today, which is the
    // false comfort this whole feature exists to remove.
    const result = buildChainTargetStarts(
      [chainItem({ issueKey: 'DEV-1', remainingWorkingDays: 40 })],
      '2026-09-25',
      CALENDAR,
    );

    expect(result.devStartIso! < '2026-08-01').toBe(true);
  });
});
