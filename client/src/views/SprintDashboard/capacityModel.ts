// capacityModel.ts — Shared capacity roles, row types, and calculations used by Sprint and ART views.

const SUNDAY_DAY_INDEX = 0;
const SATURDAY_DAY_INDEX = 6;
const EIGHTY_PERCENT_MULTIPLIER = 0.8;

/** Supported team roles in the capacity calculator across Team Dashboard and ART View. */
export type TeamRole = 'Dev' | 'Dev Lead' | 'QE' | 'Test Lead' | 'BT' | 'SL' | 'SA' | 'PO' | 'TPO' | 'SM';

/** Ordered list of all supported team roles shown in the capacity role dropdowns. */
export const ALL_TEAM_ROLES: TeamRole[] = ['Dev', 'Dev Lead', 'QE', 'Test Lead', 'BT', 'SL', 'SA', 'PO', 'TPO', 'SM'];

/** A reusable capacity snapshot that can be shown in the UI or written into Confluence. */
export interface CapacitySummary {
  summaryLabel: string;
  startDate: string;
  endDate: string;
  workDayCount: number;
  totalCapacityPoints: number;
  recommendedCapacityPoints: number;
  roleCapacities: Record<TeamRole, number>;
}

/**
 * One row in a capacity table.
 * Each row represents a group of people in the same role working at the same weighted allocation.
 */
export interface CapacityRow {
  id: string;
  role: TeamRole;
  memberCount: number;
  capacityPercentage: number;
  totalPtoDays: number;
}

/**
 * Count Monday-Friday work days between two ISO date strings, inclusive.
 * Returns 0 when the range is empty, invalid, or reversed.
 */
export function countWorkDays(startDateString: string, endDateString: string): number {
  if (!startDateString || !endDateString) {
    return 0;
  }

  const startDate = new Date(`${startDateString}T00:00:00`);
  const endDate = new Date(`${endDateString}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate > endDate) {
    return 0;
  }

  let workDayCount = 0;
  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const dayOfWeek = currentDate.getDay();
    const isWeekday = dayOfWeek !== SUNDAY_DAY_INDEX && dayOfWeek !== SATURDAY_DAY_INDEX;
    if (isWeekday) {
      workDayCount += 1;
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return workDayCount;
}

/**
 * Calculate one row's capacity contribution in story points.
 * PTO is subtracted before the allocation multiplier because PTO removes entire work days.
 */
export function calculateRowCapacity(row: CapacityRow, workDayCount: number): number {
  const availablePersonDays = workDayCount * row.memberCount - row.totalPtoDays;
  const clampedPersonDays = Math.max(0, availablePersonDays);
  return clampedPersonDays * (row.capacityPercentage / 100);
}

/** Sum all row contributions to produce the total capacity at 100%. */
export function calculateTotalCapacity(rows: CapacityRow[], workDayCount: number): number {
  return rows.reduce((runningTotal, row) => runningTotal + calculateRowCapacity(row, workDayCount), 0);
}

/** Returns the recommended commitment target by applying the standard 80% planning buffer. */
export function calculateRecommendedCapacity(totalCapacityPoints: number): number {
  return Math.floor(totalCapacityPoints * EIGHTY_PERCENT_MULTIPLIER);
}

/**
 * Builds a complete capacity snapshot for one team or summary group.
 * This keeps every ART surface aligned on the same capacity math and labels.
 */
export function buildCapacitySummary(
  summaryLabel: string,
  rows: CapacityRow[],
  startDate: string,
  endDate: string,
): CapacitySummary {
  const workDayCount = countWorkDays(startDate, endDate);
  const totalCapacityPoints = calculateTotalCapacity(rows, workDayCount);
  const roleCapacities = Object.fromEntries(
    ALL_TEAM_ROLES.map((teamRole) => [
      teamRole,
      calculateTotalCapacity(
        rows.filter((row) => row.role === teamRole),
        workDayCount,
      ),
    ]),
  ) as Record<TeamRole, number>;

  return {
    summaryLabel,
    startDate,
    endDate,
    workDayCount,
    totalCapacityPoints,
    recommendedCapacityPoints: calculateRecommendedCapacity(totalCapacityPoints),
    roleCapacities,
  };
}

/** Generate a simple time-based unique ID for a new capacity row. */
export function generateCapacityRowId(): string {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
