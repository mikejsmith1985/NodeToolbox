// sprintNaming.test.ts — Verifies the YY.PI#.Sprint# naming, including PI and year rollover.

import { describe, expect, it } from 'vitest';

import { buildSprintName, parsePiYearNumber } from './sprintNaming.ts';

const PI = 'PI 26.3 (05/21/26 - 07/29/26)';

describe('parsePiYearNumber', () => {
  it('reads the two-digit year and PI number from a PI name', () => {
    expect(parsePiYearNumber(PI)).toEqual({ yearTwoDigit: 26, piNumber: 3 });
  });

  it('returns null when there is no YY.PI# token', () => {
    expect(parsePiYearNumber('Program Increment Three')).toBeNull();
  });
});

describe('buildSprintName', () => {
  it('names each sprint of the base PI 26.3.1 … 26.3.5', () => {
    expect(buildSprintName(PI, '2026-05-21')).toBe('26.3.1');
    expect(buildSprintName(PI, '2026-07-02')).toBe('26.3.4'); // today's sprint
    expect(buildSprintName(PI, '2026-07-16')).toBe('26.3.5'); // last sprint of the PI
  });

  it('rolls to the next PI after the 5th sprint (26.3.5 → 26.4.1)', () => {
    expect(buildSprintName(PI, '2026-07-30')).toBe('26.4.1');
    expect(buildSprintName(PI, '2026-08-13')).toBe('26.4.2');
  });

  it('rolls the year after 5 PIs (26.5.5 → 27.1.1)', () => {
    // Offset 14 sprints from the PI start = 26.5.5; offset 15 = 27.1.1.
    const twentySixFiveFive = new Date(Date.parse('2026-05-21T00:00:00Z') + 14 * 14 * 86_400_000).toISOString().slice(0, 10);
    const twentySevenOneOne = new Date(Date.parse('2026-05-21T00:00:00Z') + 15 * 14 * 86_400_000).toISOString().slice(0, 10);
    expect(buildSprintName(PI, twentySixFiveFive)).toBe('26.5.5');
    expect(buildSprintName(PI, twentySevenOneOne)).toBe('27.1.1');
  });

  it('clamps a start before the PI to the first sprint, and is deterministic', () => {
    expect(buildSprintName(PI, '2026-05-01')).toBe('26.3.1');
    expect(buildSprintName(PI, '2026-07-02')).toBe(buildSprintName(PI, '2026-07-02'));
  });

  it('returns null when the PI name lacks a YY.PI# token or a date window', () => {
    expect(buildSprintName('Sprint season', '2026-07-02')).toBeNull();
    expect(buildSprintName('PI 26.3', '2026-07-02')).toBeNull(); // no date window
  });
});
