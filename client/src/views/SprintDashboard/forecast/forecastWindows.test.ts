// forecastWindows.test.ts — The two clocks, and the boundaries between the release's three weeks.
//
// The tiling assertion is the important one. Code freeze, external test and the deploy buffer have
// to cover the three weeks before a release exactly: leave a gap and work vanishes into it, overlap
// and the same day is counted as both test capacity and buffer. Either would go unnoticed, because
// each window looks correct on its own.

import { describe, expect, it } from 'vitest';

import { buildPiClock, buildReleaseClock, parsePiEndFromName } from './forecastWindows.ts';
import type { ForecastConfig } from './forecastTypes.ts';

/** Today is Thursday 2026-08-20 throughout, so every expected count can be checked by hand. */
function configOn(todayIso: string, holidayIsoDates: string[] = []): ForecastConfig {
  return {
    pointsPerWorkingDay: 1,
    calendar: { weekendDays: [0, 6], holidayIsoDates },
    featureSizingTolerancePercent: 0,
    todayIso,
  };
}

const RELEASE_ISO = '2026-10-02';

describe('buildReleaseClock', () => {
  it('puts code freeze three weeks before the release', () => {
    expect(buildReleaseClock(RELEASE_ISO, configOn('2026-08-20')).codeFreezeIso).toBe('2026-09-11');
  });

  it('runs external test for the two weeks after code freeze', () => {
    const clock = buildReleaseClock(RELEASE_ISO, configOn('2026-08-20'));
    expect(clock.externalTestStartIso).toBe('2026-09-12');
    expect(clock.externalTestEndIso).toBe('2026-09-25');
  });

  it('leaves the last week as deploy buffer, ending on the release itself', () => {
    const clock = buildReleaseClock(RELEASE_ISO, configOn('2026-08-20'));
    expect(clock.deployBufferStartIso).toBe('2026-09-26');
    expect(clock.deployBuffer.endIso).toBe(RELEASE_ISO);
  });

  it('tiles the three weeks with no gap and no overlap', () => {
    // The invariant behind the whole release clock: 21 = 1 + 14 + 6. A change to any one boundary
    // that opened a hole would leave every individual window still looking right.
    const clock = buildReleaseClock(RELEASE_ISO, configOn('2026-08-20'));
    const dayAfter = (iso: string): string => {
      const asDate = new Date(`${iso}T00:00:00.000Z`);
      asDate.setUTCDate(asDate.getUTCDate() + 1);
      return asDate.toISOString().slice(0, 10);
    };
    expect(clock.externalTestStartIso).toBe(dayAfter(clock.codeFreezeIso));
    expect(clock.deployBufferStartIso).toBe(dayAfter(clock.externalTestEndIso));
    expect(clock.deployBuffer.endIso).toBe(clock.releaseDateIso);
  });

  it('counts the working days between today and code freeze', () => {
    // Thursday 2026-08-20 to Friday 2026-09-11 inclusive is 23 calendar days holding 17 weekdays.
    // Inclusive of both ends deliberately: work starting today has today available to it.
    const clock = buildReleaseClock(RELEASE_ISO, configOn('2026-08-20'));
    expect(clock.toCodeFreeze.workingDayCount).toBe(17);
    expect(clock.toCodeFreeze.hasPassed).toBe(false);
  });

  it('reports a passed code freeze rather than computing a negative window', () => {
    const clock = buildReleaseClock(RELEASE_ISO, configOn('2026-09-20'));
    expect(clock.toCodeFreeze.hasPassed).toBe(true);
    expect(clock.toCodeFreeze.workingDayCount).toBe(0);
  });

  it('excludes a holiday from the count', () => {
    const withHoliday = buildReleaseClock(RELEASE_ISO, configOn('2026-08-20', ['2026-09-07']));
    const withoutHoliday = buildReleaseClock(RELEASE_ISO, configOn('2026-08-20'));
    expect(withHoliday.toCodeFreeze.workingDayCount).toBe(withoutHoliday.toCodeFreeze.workingDayCount - 1);
  });

  it('counts ten working days in the external test fortnight', () => {
    const clock = buildReleaseClock(RELEASE_ISO, configOn('2026-08-20'));
    expect(clock.externalTest.workingDayCount).toBe(10);
  });

  it('labels each window with the span it describes', () => {
    const clock = buildReleaseClock(RELEASE_ISO, configOn('2026-08-20'));
    expect(clock.toCodeFreeze.kind).toBe('to-code-freeze');
    expect(clock.externalTest.kind).toBe('external-test');
    expect(clock.deployBuffer.kind).toBe('deploy-buffer');
  });
});

describe('buildPiClock', () => {
  it('says NOT CONFIGURED when the ART has no PI end date, rather than guessing one', () => {
    // A guessed commitment date is indistinguishable from a real one once somebody acts on it.
    const clock = buildPiClock('', configOn('2026-08-20'));
    expect(clock.isConfigured).toBe(false);
    expect(clock.piEndIso).toBeNull();
    expect(clock.toPiEnd).toBeNull();
  });

  it('says NOT CONFIGURED when the stored value is not a date', () => {
    const clock = buildPiClock('not-a-date', configOn('2026-08-20'));
    expect(clock.isConfigured).toBe(false);
  });

  it('counts the working days to PI end when one is configured', () => {
    const clock = buildPiClock('2026-11-06', configOn('2026-08-20'));
    expect(clock.isConfigured).toBe(true);
    expect(clock.piEndIso).toBe('2026-11-06');
    expect(clock.toPiEnd?.kind).toBe('to-pi-end');
    expect(clock.toPiEnd?.workingDayCount).toBeGreaterThan(0);
  });

  it('reports a PI that has already ended rather than counting backwards', () => {
    const clock = buildPiClock('2026-07-01', configOn('2026-08-20'));
    expect(clock.toPiEnd?.hasPassed).toBe(true);
    expect(clock.toPiEnd?.workingDayCount).toBe(0);
  });
});

describe('parsePiEndFromName', () => {
  // The org writes the window into the PI name. Without reading it, every board reported
  // "No PI end set" while the answer sat in the PI selector directly above it.

  it('reads the END of the range, not the start', () => {
    // Taking the opening date would put the deadline at the beginning of the increment and report
    // every Feature as hopelessly late on day one.
    expect(parsePiEndFromName('PI 26.4 (07/30/26 - 10/07/26)')).toBe('2026-10-07');
  });

  it('handles four-digit years', () => {
    expect(parsePiEndFromName('PI 26.4 (07/30/2026 - 10/07/2026)')).toBe('2026-10-07');
  });

  it('handles single-digit months and days', () => {
    expect(parsePiEndFromName('PI 27.1 (1/5/27 - 3/9/27)')).toBe('2027-03-09');
  });

  it('finds nothing in a PI named without a window', () => {
    expect(parsePiEndFromName('PI 26.4')).toBeNull();
    expect(parsePiEndFromName('')).toBeNull();
  });

  it('refuses a value that is not a day the calendar has', () => {
    expect(parsePiEndFromName('PI 26.4 (13/45/26 - 99/99/26)')).toBeNull();
  });
});

describe('buildPiClock falling back to the PI name', () => {
  it('uses the ART setting when one is configured', () => {
    // A setting is somebody's deliberate answer and outranks a parse.
    const clock = buildPiClock('2026-11-06', configOn('2026-08-20'), 'PI 26.4 (07/30/26 - 10/07/26)');
    expect(clock.piEndIso).toBe('2026-11-06');
  });

  it('falls back to the PI name when the setting is blank', () => {
    const clock = buildPiClock('', configOn('2026-08-20'), 'PI 26.4 (07/30/26 - 10/07/26)');
    expect(clock.isConfigured).toBe(true);
    expect(clock.piEndIso).toBe('2026-10-07');
  });

  it('falls back when the stored setting is not a date', () => {
    const clock = buildPiClock('not-a-date', configOn('2026-08-20'), 'PI 26.4 (07/30/26 - 10/07/26)');
    expect(clock.piEndIso).toBe('2026-10-07');
  });

  it('still reports unconfigured when neither the setting nor the name carries a date', () => {
    const clock = buildPiClock('', configOn('2026-08-20'), 'PI 26.4');
    expect(clock.isConfigured).toBe(false);
  });

  it('behaves as before when no PI name is supplied at all', () => {
    expect(buildPiClock('', configOn('2026-08-20')).isConfigured).toBe(false);
  });
});
