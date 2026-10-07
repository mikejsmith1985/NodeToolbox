// epicDateSchedule.test.ts — Turning Epic points and team capacity into Target Start / Target End dates.

import { describe, expect, it } from 'vitest';

import { readDailyCapacityPoints, scheduleEpicDates, type EpicToSchedule } from './epicDateSchedule.ts';

const WEEKENDS_ONLY = { weekendDays: [0, 6], holidayIsoDates: [] };
// PI 26.5 starts Monday 12 October 2026.
const SETTINGS = {
  piStartDate: '2026-10-12',
  piEndDate: '2026-12-30',
  today: '2026-10-07',
  dailyCapacityPoints: 10,
  maxParallelEpics: 3,
  calendar: WEEKENDS_ONLY,
};

function buildEpic(epicKey: string, points: number | null, overrides: Partial<EpicToSchedule> = {}): EpicToSchedule {
  return { epicKey, summary: `${epicKey} summary`, points, isStarted: false, existingTargetStart: null, ...overrides };
}

describe('readDailyCapacityPoints', () => {
  it('spreads the 80% capacity evenly over the PI\'s work days', () => {
    expect(readDailyCapacityPoints(640, 60)).toBeCloseTo(10.667, 3);
    expect(readDailyCapacityPoints(640, 0)).toBe(0);
  });
});

describe('scheduleEpicDates', () => {
  it('starts a not-yet-started Epic on the PI\'s first day, never before, and puts it in INT the day after it finishes', () => {
    const [proposal] = scheduleEpicDates([buildEpic('DENP-1', 20)], SETTINGS);

    // 20 points at 10 a day: Monday and Tuesday of work, into INT on Wednesday.
    expect(proposal).toEqual(expect.objectContaining({ targetStart: '2026-10-12', targetEnd: '2026-10-14', status: 'scheduled' }));
  });

  it('skips weekends', () => {
    const [proposal] = scheduleEpicDates([buildEpic('DENP-1', 30)], { ...SETTINGS, piStartDate: '2026-10-15' });

    // Thursday, Friday, Monday of work; into INT on Tuesday.
    expect(proposal).toEqual(expect.objectContaining({ targetStart: '2026-10-15', targetEnd: '2026-10-20' }));
  });

  it('runs up to the parallel limit at once, shares the capacity, and starts the next Epic when a slot frees', () => {
    const proposals = scheduleEpicDates(
      [buildEpic('DENP-1', 10), buildEpic('DENP-2', 10), buildEpic('DENP-3', 10)],
      { ...SETTINGS, maxParallelEpics: 2 },
    );

    expect(proposals.map(({ epicKey, targetStart, targetEnd }) => [epicKey, targetStart, targetEnd])).toEqual([
      ['DENP-1', '2026-10-12', '2026-10-14'],
      ['DENP-2', '2026-10-12', '2026-10-14'],
      ['DENP-3', '2026-10-14', '2026-10-15'],
    ]);
  });

  it('keeps a started Epic\'s Target Start, works its remaining points from today, and lets it go first', () => {
    const proposals = scheduleEpicDates(
      [buildEpic('DENP-2', 10), buildEpic('DENP-1', 10, { isStarted: true, existingTargetStart: '2026-09-21' })],
      { ...SETTINGS, today: '2026-10-14', maxParallelEpics: 1 },
    );

    expect(proposals.find((proposal) => proposal.epicKey === 'DENP-1'))
      .toEqual(expect.objectContaining({ targetStart: '2026-09-21', targetEnd: '2026-10-15' }));
    expect(proposals.find((proposal) => proposal.epicKey === 'DENP-2'))
      .toEqual(expect.objectContaining({ targetStart: '2026-10-15', targetEnd: '2026-10-16' }));
  });

  it('leaves an Epic with no points unscheduled, without taking a slot', () => {
    const proposals = scheduleEpicDates([buildEpic('DENP-9', null), buildEpic('DENP-1', 10)], { ...SETTINGS, maxParallelEpics: 1 });

    expect(proposals[0]).toEqual(expect.objectContaining({ epicKey: 'DENP-9', status: 'no-points', targetStart: null, targetEnd: null }));
    expect(proposals[1]).toEqual(expect.objectContaining({ targetStart: '2026-10-12', targetEnd: '2026-10-13' }));
  });

  it('flags an Epic that lands in INT after the PI ends', () => {
    const [proposal] = scheduleEpicDates([buildEpic('DENP-1', 600)], SETTINGS);

    expect(proposal.isPastPiEnd).toBe(true);
  });

  it('schedules nothing when the team has no capacity', () => {
    const [proposal] = scheduleEpicDates([buildEpic('DENP-1', 10)], { ...SETTINGS, dailyCapacityPoints: 0 });

    expect(proposal).toEqual(expect.objectContaining({ status: 'no-capacity', targetStart: null, targetEnd: null }));
  });
});
