// forecastSettings.ts — Turns stored ART settings into the one config a forecast run uses.
//
// The rule this module exists to enforce: a setting that cannot be used falls back to its default
// AND is reported. Silently correcting it is worse than refusing to run, because the resulting
// forecast looks ordinary and cannot be reconciled with the settings screen — the operator ends up
// trusting whichever of the two they happened to look at last.
//
// Pure by construction: it takes a structural subset of the settings rather than importing the
// store, and today's date is injected rather than read. That keeps it testable with no browser and
// keeps every run reproducible.

import type { ForecastConfig, ForecastConfigResult, RejectedSetting } from './forecastTypes.ts';

/** The saturday/sunday weekend. Not configurable here — an ART that differs expresses it as holidays. */
const WEEKEND_DAY_INDEXES = [0, 6];

/** The rate used when the stored one cannot divide: one point is one person-day. */
const FALLBACK_POINTS_PER_WORKING_DAY = 1;

/** The tolerance used when the stored one is unusable: none, so any overage is visible. */
const FALLBACK_SIZING_TOLERANCE_PERCENT = 0;

/** A bare calendar day. A holiday has to name a day, not an instant and not a description. */
const CALENDAR_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Just the ART settings this module reads — so it never has to import the store or a browser. */
export interface ArtSettingsLike {
  pointsPerWorkingDay: number;
  holidayIsoDates: string[];
  featureSizingTolerancePercent: number;
}

/**
 * True when a string names a day the calendar actually has.
 *
 * The shape check alone is not enough: `2026-02-30` is correctly shaped and does not exist, and
 * JavaScript would happily roll it forward to March, quietly moving somebody's holiday.
 */
function isRealCalendarDay(candidate: string): boolean {
  if (!CALENDAR_DAY_PATTERN.test(candidate)) {
    return false;
  }
  const [year, month, day] = candidate.split('-').map((part) => Number(part));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

/** Resolves the points-to-days rate, refusing anything that cannot serve as a divisor. */
function resolveRate(storedRate: number, rejectedSettings: RejectedSetting[]): number {
  if (Number.isFinite(storedRate) && storedRate > 0) {
    return storedRate;
  }
  rejectedSettings.push({
    name: 'pointsPerWorkingDay',
    storedValue: String(storedRate),
    reason: `must be greater than zero; using ${FALLBACK_POINTS_PER_WORKING_DAY} point per working day`,
  });
  return FALLBACK_POINTS_PER_WORKING_DAY;
}

/** Resolves the sizing tolerance. Zero is allowed — it is the intended default, not an absent value. */
function resolveTolerance(storedTolerance: number, rejectedSettings: RejectedSetting[]): number {
  if (Number.isFinite(storedTolerance) && storedTolerance >= 0) {
    return storedTolerance;
  }
  rejectedSettings.push({
    name: 'featureSizingTolerancePercent',
    storedValue: String(storedTolerance),
    reason: `must be zero or greater; using ${FALLBACK_SIZING_TOLERANCE_PERCENT}%`,
  });
  return FALLBACK_SIZING_TOLERANCE_PERCENT;
}

/** Keeps the entries that name a real day, and reports each one that does not. */
function resolveHolidays(storedHolidays: string[], rejectedSettings: RejectedSetting[]): string[] {
  const usableDays: string[] = [];
  storedHolidays.forEach((storedHoliday) => {
    const trimmedHoliday = String(storedHoliday).trim();
    if (isRealCalendarDay(trimmedHoliday)) {
      usableDays.push(trimmedHoliday);
      return;
    }
    // Reported one at a time rather than as a count, so every bad entry can be corrected in a
    // single pass instead of one per save.
    rejectedSettings.push({
      name: 'holidayIsoDates',
      storedValue: trimmedHoliday,
      reason: 'is not a calendar day in YYYY-MM-DD form; it will be treated as a working day',
    });
  });
  return usableDays;
}

/**
 * Builds the validated config one forecast run uses, and lists everything it had to refuse.
 *
 * Every problem is collected in one pass rather than stopping at the first, because an operator
 * fixing settings wants the whole list, not one item and another save.
 */
export function buildForecastConfig(artSettings: ArtSettingsLike, todayIso: string): ForecastConfigResult {
  const rejectedSettings: RejectedSetting[] = [];

  const config: ForecastConfig = {
    pointsPerWorkingDay: resolveRate(artSettings.pointsPerWorkingDay, rejectedSettings),
    calendar: {
      weekendDays: [...WEEKEND_DAY_INDEXES],
      holidayIsoDates: resolveHolidays(artSettings.holidayIsoDates ?? [], rejectedSettings),
    },
    featureSizingTolerancePercent: resolveTolerance(artSettings.featureSizingTolerancePercent, rejectedSettings),
    todayIso: todayIso.slice(0, 10),
  };

  return { config, rejectedSettings };
}
