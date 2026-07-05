// piSchedule.ts — Parses the date range embedded in a PI name and computes time remaining.
//
// PI names carry their window, e.g. "PI 26.3 (05/21/26 - 07/29/26)". Time-to-PI-end is a real
// prioritization signal — with only days left, favor features that can realistically reach Definition
// of Done in the window. This is pure and deterministic: the caller injects "today" so tests never
// depend on the wall clock.

/** A parsed PI window (ISO YYYY-MM-DD dates). */
export interface PiDateRange {
  startIso: string;
  endIso: string;
}

const MS_PER_DAY = 86_400_000;
// Matches "(MM/DD/YY - MM/DD/YY)" (also en-dash, and 2- or 4-digit years) anywhere in the name.
const PI_RANGE_PATTERN = /\((\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*[-–]\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\)/;

/** Normalizes a US m/d/y triple to an ISO YYYY-MM-DD string; 2-digit years map to 20xx. */
function toIso(month: string, day: string, year: string): string {
  const fullYear = year.length <= 2 ? 2000 + Number(year) : Number(year);
  return `${fullYear}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/** Extracts the start/end dates from a PI name, or null when no date range is present. */
export function parsePiDateRange(piName: string): PiDateRange | null {
  const match = PI_RANGE_PATTERN.exec(piName);
  if (!match) {
    return null;
  }
  return {
    startIso: toIso(match[1], match[2], match[3]),
    endIso: toIso(match[4], match[5], match[6]),
  };
}

/**
 * Days from `todayIso` to the PI's end date (negative if the PI has ended). Null when the PI name
 * carries no parseable range. Both dates are compared at UTC midnight so the result is whole days.
 */
export function daysRemainingInPi(piName: string, todayIso: string): number | null {
  const range = parsePiDateRange(piName);
  if (range === null) {
    return null;
  }
  const endMs = Date.parse(`${range.endIso}T00:00:00Z`);
  const todayMs = Date.parse(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(endMs) || Number.isNaN(todayMs)) {
    return null;
  }
  return Math.round((endMs - todayMs) / MS_PER_DAY);
}
