// forecastSettings.test.ts — A bad setting must be refused OUT LOUD, never quietly corrected.
//
// The distinction this file exists to protect: falling back to a default is correct, and doing so
// silently is not. An operator who typed a rate of zero and sees an ordinary-looking forecast has
// no way to reconcile the numbers with the settings screen, and will trust the wrong one.

import { describe, expect, it } from 'vitest';

import { buildForecastConfig, type ArtSettingsLike } from './forecastSettings.ts';

const TODAY_ISO = '2026-08-20';

/** Valid settings, so each test can vary exactly one thing. */
function settingsWith(overrides: Partial<ArtSettingsLike> = {}): ArtSettingsLike {
  return {
    pointsPerWorkingDay: 1,
    holidayIsoDates: [],
    featureSizingTolerancePercent: 0,
    ...overrides,
  };
}

describe('buildForecastConfig', () => {
  it('accepts settings that are already valid, and refuses nothing', () => {
    const result = buildForecastConfig(settingsWith(), TODAY_ISO);
    expect(result.config.pointsPerWorkingDay).toBe(1);
    expect(result.config.featureSizingTolerancePercent).toBe(0);
    expect(result.rejectedSettings).toEqual([]);
  });

  it('injects today rather than reading a clock, so a run is reproducible', () => {
    expect(buildForecastConfig(settingsWith(), TODAY_ISO).config.todayIso).toBe(TODAY_ISO);
  });

  it('fixes the weekend at Saturday and Sunday, which this feature does not make configurable', () => {
    expect(buildForecastConfig(settingsWith(), TODAY_ISO).config.calendar.weekendDays).toEqual([0, 6]);
  });

  describe('the points-per-working-day rate', () => {
    it('falls back to one AND says so when the rate is zero', () => {
      const result = buildForecastConfig(settingsWith({ pointsPerWorkingDay: 0 }), TODAY_ISO);
      expect(result.config.pointsPerWorkingDay).toBe(1);
      expect(result.rejectedSettings).toHaveLength(1);
      expect(result.rejectedSettings[0].name).toBe('pointsPerWorkingDay');
      expect(result.rejectedSettings[0].storedValue).toBe('0');
      expect(result.rejectedSettings[0].reason).toBeTruthy();
    });

    it('falls back and reports when the rate is negative', () => {
      const result = buildForecastConfig(settingsWith({ pointsPerWorkingDay: -3 }), TODAY_ISO);
      expect(result.config.pointsPerWorkingDay).toBe(1);
      expect(result.rejectedSettings.map((rejected) => rejected.name)).toEqual(['pointsPerWorkingDay']);
    });

    it('falls back and reports when the rate is not a finite number', () => {
      const result = buildForecastConfig(settingsWith({ pointsPerWorkingDay: Number.NaN }), TODAY_ISO);
      expect(result.config.pointsPerWorkingDay).toBe(1);
      expect(result.rejectedSettings).toHaveLength(1);
    });

    it('keeps a fractional rate, because a team may size in half-days', () => {
      const result = buildForecastConfig(settingsWith({ pointsPerWorkingDay: 0.5 }), TODAY_ISO);
      expect(result.config.pointsPerWorkingDay).toBe(0.5);
      expect(result.rejectedSettings).toEqual([]);
    });
  });

  describe('the sizing tolerance', () => {
    it('falls back to zero AND says so when the tolerance is negative', () => {
      const result = buildForecastConfig(settingsWith({ featureSizingTolerancePercent: -1 }), TODAY_ISO);
      expect(result.config.featureSizingTolerancePercent).toBe(0);
      expect(result.rejectedSettings.map((rejected) => rejected.name)).toEqual(['featureSizingTolerancePercent']);
    });

    it('keeps a tolerance of zero without reporting it, because zero is the intended default', () => {
      const result = buildForecastConfig(settingsWith({ featureSizingTolerancePercent: 0 }), TODAY_ISO);
      expect(result.config.featureSizingTolerancePercent).toBe(0);
      expect(result.rejectedSettings).toEqual([]);
    });

    it('keeps a positive tolerance', () => {
      const result = buildForecastConfig(settingsWith({ featureSizingTolerancePercent: 20 }), TODAY_ISO);
      expect(result.config.featureSizingTolerancePercent).toBe(20);
    });
  });

  describe('the holiday list', () => {
    it('keeps the days that are days and names the ones that are not', () => {
      const result = buildForecastConfig(
        settingsWith({ holidayIsoDates: ['2026-12-25', 'Christmas'] }),
        TODAY_ISO,
      );
      expect(result.config.calendar.holidayIsoDates).toEqual(['2026-12-25']);
      expect(result.rejectedSettings).toHaveLength(1);
      expect(result.rejectedSettings[0].storedValue).toBe('Christmas');
    });

    it('reports each unusable entry separately, so all of them can be corrected at once', () => {
      const result = buildForecastConfig(
        settingsWith({ holidayIsoDates: ['25/12/2026', 'Boxing Day'] }),
        TODAY_ISO,
      );
      expect(result.config.calendar.holidayIsoDates).toEqual([]);
      expect(result.rejectedSettings).toHaveLength(2);
    });

    it('treats an empty list as a real answer, not as an absence', () => {
      const result = buildForecastConfig(settingsWith({ holidayIsoDates: [] }), TODAY_ISO);
      expect(result.config.calendar.holidayIsoDates).toEqual([]);
      expect(result.rejectedSettings).toEqual([]);
    });

    it('refuses a date-shaped value that is not a real day', () => {
      const result = buildForecastConfig(settingsWith({ holidayIsoDates: ['2026-02-30'] }), TODAY_ISO);
      expect(result.config.calendar.holidayIsoDates).toEqual([]);
      expect(result.rejectedSettings).toHaveLength(1);
    });
  });

  it('reports every problem in one pass, rather than stopping at the first', () => {
    const result = buildForecastConfig(
      settingsWith({ pointsPerWorkingDay: 0, featureSizingTolerancePercent: -5, holidayIsoDates: ['nope'] }),
      TODAY_ISO,
    );
    expect(result.rejectedSettings.map((rejected) => rejected.name).sort()).toEqual([
      'featureSizingTolerancePercent',
      'holidayIsoDates',
      'pointsPerWorkingDay',
    ]);
  });
});
