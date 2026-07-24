// capacityModel.ts — Shared capacity roles, row types, and calculations used by Sprint and ART views.

const SUNDAY_DAY_INDEX = 0;
const SATURDAY_DAY_INDEX = 6;
const EIGHTY_PERCENT_MULTIPLIER = 0.8;

/**
 * Supported team roles in the capacity calculator across Team Dashboard and ART View.
 * These match the roster's delivery-role labels exactly, so seeding from the roster is a 1:1 fill.
 * Coordination roles (Scrum Master, Product Owner, Solution Architect, Release Train Engineer) are
 * intentionally excluded — they add no delivery capacity.
 */
export type TeamRole = 'Developer' | 'Dev Lead' | 'Internal Tester' | 'External Tester' | 'Systems Analyst';

/** Ordered list of all supported team roles shown in the capacity role dropdowns. */
export const ALL_TEAM_ROLES: TeamRole[] = ['Developer', 'Dev Lead', 'Internal Tester', 'External Tester', 'Systems Analyst'];

/**
 * Maps a role value read from older persisted capacity data to a current role, or null when the role
 * no longer counts toward capacity (the retired Scrum Master / Product Owner / Technical PO codes).
 * We overwrite legacy data with the new format on load rather than preserving the old taxonomy, so
 * this is a one-way convenience — not a two-way reconciliation.
 */
const LEGACY_CAPACITY_ROLE_ALIASES: Record<string, TeamRole | null> = {
  Dev: 'Developer',
  SL: 'Internal Tester',
  QE: 'External Tester',
  BT: 'External Tester',
  'Test Lead': 'External Tester',
  SA: 'Systems Analyst',
  SM: null,
  PO: null,
  TPO: null,
};

/**
 * Normalizes any persisted role string to a current TeamRole, or null when it should be dropped.
 * A value already in the current set passes through unchanged; a known legacy code is translated;
 * anything unrecognized is dropped so a stale row can never render a broken role dropdown.
 */
export function coerceLegacyCapacityRole(role: string): TeamRole | null {
  if ((ALL_TEAM_ROLES as string[]).includes(role)) {
    return role as TeamRole;
  }

  return Object.prototype.hasOwnProperty.call(LEGACY_CAPACITY_ROLE_ALIASES, role)
    ? LEGACY_CAPACITY_ROLE_ALIASES[role]
    : null;
}

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
 * Value-equality for two capacity snapshots, so a screen can tell a genuine capacity change from a
 * harmless re-render of an equivalent snapshot. Used by PI Review to mark the page unsaved only when
 * the live capacity actually differs from what is already saved to Confluence.
 */
export function areCapacitySummariesEqual(
  leftSummary: CapacitySummary | null,
  rightSummary: CapacitySummary | null,
): boolean {
  if (leftSummary === rightSummary) {
    return true;
  }
  if (leftSummary === null || rightSummary === null) {
    return false;
  }
  const haveSameScalars = leftSummary.summaryLabel === rightSummary.summaryLabel
    && leftSummary.startDate === rightSummary.startDate
    && leftSummary.endDate === rightSummary.endDate
    && leftSummary.workDayCount === rightSummary.workDayCount
    && leftSummary.totalCapacityPoints === rightSummary.totalCapacityPoints
    && leftSummary.recommendedCapacityPoints === rightSummary.recommendedCapacityPoints;
  if (!haveSameScalars) {
    return false;
  }
  return ALL_TEAM_ROLES.every(
    (teamRole) => (leftSummary.roleCapacities[teamRole] ?? 0) === (rightSummary.roleCapacities[teamRole] ?? 0),
  );
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
