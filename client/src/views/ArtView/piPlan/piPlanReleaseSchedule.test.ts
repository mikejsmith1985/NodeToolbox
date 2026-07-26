// piPlanReleaseSchedule.test.ts — The pure release-calendar builder (spec 028, FR-007).
// The monthly-suggestion cases are added in User Story 5; this covers the Foundational read/build.

import { describe, expect, it } from 'vitest';

import { buildReleaseSchedule, suggestMonthlyReleases } from './piPlanReleaseSchedule.ts';
import type { RawJiraVersion } from './piPlanReleaseSchedule.ts';
import type { ReleaseSchedule, WorkingCalendar } from './piPlanTypes.ts';

const PI_START = '2026-05-21';
const PI_END = '2026-07-29';
const CAL: WorkingCalendar = { weekendDays: [0, 6], holidayIsoDates: [] };

describe('buildReleaseSchedule', () => {
  it('keeps in-window releases, drops out-of-window and archived, and sorts by date', () => {
    const versions: RawJiraVersion[] = [
      { name: 'Rel B', releaseDate: '2026-06-15' },
      { name: 'Rel A', releaseDate: '2026-05-25' },
      { name: 'Too Early', releaseDate: '2026-04-01' },
      { name: 'Archived', releaseDate: '2026-06-01', archived: true },
      { name: 'No Date' },
    ];
    const schedule = buildReleaseSchedule(versions, PI_START, PI_END);
    expect(schedule.entries.map((entry) => entry.name)).toEqual(['Rel A', 'Rel B']);
    expect(schedule.entries.every((entry) => entry.isSuggested === false)).toBe(true);
  });

  it('includes a release shortly after the PI end (production may follow the PI DoD)', () => {
    const versions: RawJiraVersion[] = [{ name: 'Post-PI', releaseDate: '2026-08-20' }];
    const schedule = buildReleaseSchedule(versions, PI_START, PI_END);
    expect(schedule.entries).toHaveLength(1); // within the trailing margin
  });

  it('returns an empty calendar honestly when no versions fall in the window', () => {
    const schedule = buildReleaseSchedule([{ name: 'Old', releaseDate: '2025-01-01' }], PI_START, PI_END);
    expect(schedule.entries).toEqual([]);
  });
});

describe('suggestMonthlyReleases', () => {
  it('uses an existing release that already covers the needed date (no suggestion)', () => {
    const schedule: ReleaseSchedule = { entries: [{ name: 'R1', releaseDateIso: '2026-06-15', isSuggested: false }] };
    const result = suggestMonthlyReleases(schedule, ['2026-06-04'], PI_START, CAL);
    expect(result.entries.filter((entry) => entry.isSuggested)).toHaveLength(0);
  });

  it('adds a suggested release ≥ the needed date and ≥ 28 days after the previous one', () => {
    const schedule: ReleaseSchedule = { entries: [{ name: 'R1', releaseDateIso: '2026-06-15', isSuggested: false }] };
    const result = suggestMonthlyReleases(schedule, ['2026-08-10'], PI_START, CAL);
    const suggested = result.entries.find((entry) => entry.isSuggested)!;
    expect(suggested.releaseDateIso >= '2026-08-10').toBe(true);
    expect(suggested.releaseDateIso >= '2026-07-13').toBe(true); // ≥ 28 days after 2026-06-15
  });

  it('anchors the first suggestion to the PI start when there are no existing releases, on a working day', () => {
    const result = suggestMonthlyReleases({ entries: [] }, ['2026-05-25'], PI_START, CAL);
    const suggested = result.entries.find((entry) => entry.isSuggested)!;
    expect(suggested.releaseDateIso >= '2026-05-25').toBe(true);
    expect([0, 6]).not.toContain(new Date(`${suggested.releaseDateIso}T00:00:00Z`).getUTCDay()); // working day
  });
});
