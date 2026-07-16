// monthlyDeliveryScheduler.js — Monthly Delivery Report scheduler (feature 018).
//
// Fires ONCE per calendar month — on the 2nd Tuesday at a configurable local time (default 08:00),
// with same-month catch-up when the server was off at the scheduled moment — and generates a single
// AI-ready prompt covering every configured team's prior-month deliveries. Mirrors the PI Review
// scheduler chassis (60-second tick, injectable tick options, schedulerFiredState persistence); the
// once-per-month semantics live entirely here via a YYYY-MM prefix compare on the stored fired date.

'use strict';

// ── Constants ──

/** Stable name under which this scheduler's fired dates are persisted. */
const FIRED_STATE_SCHEDULER_NAME = 'monthlyDelivery';

/** The single fired-state config key: one report per month regardless of team count. */
const FIRED_STATE_CONFIG_KEY = 'monthlyDelivery';

/** Default fire time when the config has no scheduleTime set. */
const DEFAULT_SCHEDULE_TIME = '08:00';

/** Date.getDay() value for Tuesday. */
const DAY_TUESDAY = 2;

/** Days in one week — used to step from the first Tuesday of a month to the second. */
const DAYS_PER_WEEK = 7;

/** Length of a "YYYY-MM" month prefix inside a "YYYY-MM-DD" date string. */
const MONTH_PREFIX_LENGTH = 7;

// ── Pure date helpers (exported for unit tests) ──

/** Formats a Date as a local "YYYY-MM-DD" string. */
function formatLocalDate(date) {
  return date.getFullYear()
    + '-' + String(date.getMonth() + 1).padStart(2, '0')
    + '-' + String(date.getDate()).padStart(2, '0');
}

/**
 * Returns the 2nd Tuesday of the given month as a local "YYYY-MM-DD" string.
 * monthIndex is 0-based (0 = January), matching Date.
 */
function computeSecondTuesdayDate(year, monthIndex) {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const daysUntilFirstTuesday = (DAY_TUESDAY - firstOfMonth.getDay() + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  const secondTuesdayDayOfMonth = 1 + daysUntilFirstTuesday + DAYS_PER_WEEK;
  return formatLocalDate(new Date(year, monthIndex, secondTuesdayDayOfMonth));
}

/**
 * Returns the calendar month BEFORE the given local date as "YYYY-MM" — the month a run covers.
 * A January run rolls back to December of the previous year.
 */
function resolveCoveredMonth(todayDateString) {
  const year = Number(todayDateString.slice(0, 4));
  const monthIndex = Number(todayDateString.slice(5, 7)) - 1;
  const firstOfPreviousMonth = new Date(year, monthIndex - 1, 1);
  return firstOfPreviousMonth.getFullYear() + '-' + String(firstOfPreviousMonth.getMonth() + 1).padStart(2, '0');
}

/**
 * Builds the attribution window for a covered month ("YYYY-MM"): local first instant of day 1
 * through the last millisecond of the final day, plus the first/last day date strings the Jira
 * JQL builder needs.
 */
function buildCoveredMonthWindow(coveredMonth) {
  const year = Number(coveredMonth.slice(0, 4));
  const monthIndex = Number(coveredMonth.slice(5, 7)) - 1;
  const firstDay = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  const firstDayOfNextMonth = new Date(year, monthIndex + 1, 1, 0, 0, 0, 0);
  const lastDay = new Date(firstDayOfNextMonth.getTime() - 1);
  return {
    coveredMonth,
    startMs: firstDay.getTime(),
    endMs: firstDayOfNextMonth.getTime() - 1,
    firstDayDate: formatLocalDate(firstDay),
    lastDayDate: formatLocalDate(lastDay),
  };
}

/**
 * Once-per-month guard: true when the stored fired date ("YYYY-MM-DD") falls inside the same
 * calendar month as today. The shared fired-state store is value-agnostic, so month semantics
 * live entirely in this compare.
 */
function hasAlreadyFiredThisMonth(storedFiredDate, todayDateString) {
  if (!storedFiredDate) {
    return false;
  }
  return storedFiredDate.slice(0, MONTH_PREFIX_LENGTH) === todayDateString.slice(0, MONTH_PREFIX_LENGTH);
}

module.exports = {
  FIRED_STATE_SCHEDULER_NAME,
  FIRED_STATE_CONFIG_KEY,
  DEFAULT_SCHEDULE_TIME,
  computeSecondTuesdayDate,
  resolveCoveredMonth,
  buildCoveredMonthWindow,
  hasAlreadyFiredThisMonth,
};
