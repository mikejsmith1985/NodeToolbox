// sprintNaming.ts — Derives the org's YY.PI#.Sprint# sprint names for the capacity projection.
//
// The team names sprints "PIYear.PI#.Sprint#" (e.g. 26.3.4 = year 2026, PI 3, sprint 4). A PI always has
// 5 sprints and a year always has 5 PIs, so after a PI's 5th sprint the PI number advances, and after the
// 5th PI the year advances and the PI number resets to 1 (26.5.5 → 27.1.1). The base year + PI number are
// read from the PI name, and each projected sprint's position is derived from its start date relative to the
// PI window. Pure and deterministic — no clock. Returns null when the PI name has no recognisable YY.PI#.

import { parsePiDateRange } from '../logic/piSchedule.ts';

const MS_PER_DAY = 86_400_000;
const SPRINT_LENGTH_DAYS = 14;
const SPRINTS_PER_PI = 5;
const PIS_PER_YEAR = 5;

// Matches the "YY.PI#" that opens a PI name, e.g. "PI 26.3 (05/21/26 - 07/29/26)" → year 26, PI 3.
const PI_YEAR_NUMBER_PATTERN = /\b(\d{2})\.(\d{1,2})\b/;

/** The base year (two-digit) and PI number parsed from a PI name. */
interface PiYearNumber {
  yearTwoDigit: number;
  piNumber: number;
}

/** Reads the two-digit year and PI number from a PI name, or null when it carries no YY.PI# token. */
export function parsePiYearNumber(piName: string): PiYearNumber | null {
  const match = PI_YEAR_NUMBER_PATTERN.exec(piName);
  if (match === null) {
    return null;
  }
  return { yearTwoDigit: Number(match[1]), piNumber: Number(match[2]) };
}

/**
 * Builds the YY.PI#.Sprint# name for a sprint that starts on `sprintStartIso`, given the PI name it is
 * anchored to. The offset from the PI's start date decides the sprint index; every 5 sprints advance the PI
 * number and every 5 PIs advance the year (with the PI number wrapping back to 1). Returns null when the PI
 * name lacks a YY.PI# token or a parseable date window, so the caller can fall back to a plain sprint number.
 */
export function buildSprintName(piName: string, sprintStartIso: string): string | null {
  const base = parsePiYearNumber(piName);
  const piWindow = parsePiDateRange(piName);
  if (base === null || piWindow === null) {
    return null;
  }
  const piStartMs = Date.parse(`${piWindow.startIso}T00:00:00Z`);
  const sprintStartMs = Date.parse(`${sprintStartIso}T00:00:00Z`);
  if (Number.isNaN(piStartMs) || Number.isNaN(sprintStartMs)) {
    return null;
  }

  // 0-based sprint offset from the PI's first sprint (clamped so a start before the PI never goes negative).
  const offsetSprints = Math.max(0, Math.round((sprintStartMs - piStartMs) / (SPRINT_LENGTH_DAYS * MS_PER_DAY)));
  const sprintInPi = (offsetSprints % SPRINTS_PER_PI) + 1;

  // Advance the PI number by whole PIs elapsed, then roll whole years off the top (5 PIs per year).
  let piNumber = base.piNumber + Math.floor(offsetSprints / SPRINTS_PER_PI);
  let yearTwoDigit = base.yearTwoDigit;
  while (piNumber > PIS_PER_YEAR) {
    piNumber -= PIS_PER_YEAR;
    yearTwoDigit += 1;
  }

  return `${yearTwoDigit}.${piNumber}.${sprintInPi}`;
}
