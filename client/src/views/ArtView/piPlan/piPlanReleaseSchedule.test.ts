// piPlanReleaseSchedule.test.ts — The pure release-calendar builder (spec 028, FR-007).
// The monthly-suggestion cases are added in User Story 5; this covers the Foundational read/build.

import { describe, expect, it } from 'vitest';

import { buildReleaseSchedule } from './piPlanReleaseSchedule.ts';
import type { RawJiraVersion } from './piPlanReleaseSchedule.ts';

const PI_START = '2026-05-21';
const PI_END = '2026-07-29';

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
