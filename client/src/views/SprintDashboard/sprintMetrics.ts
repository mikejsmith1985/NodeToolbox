// sprintMetrics.ts — Pure Sprint Dashboard metric helpers (board health + running-average velocity).
//
// Kept separate from the view so the logic is unit-testable and doesn't depend on React or fetches.

/** The overall delivery-health verdict for the current board/PI scope. */
export type BoardHealthStatus = 'on-track' | 'watch' | 'at-risk';

/** Inputs to the health verdict: point progress, how far through the window we are, and blockers. */
export interface BoardHealthInput {
  pointsDone: number;
  pointsTotal: number;
  /** 0..1 of the sprint/PI window elapsed; null when no date window is known. */
  timeElapsedFraction: number | null;
  blockedCount: number;
}

// How far point-completion may lag time-elapsed before we downgrade the verdict. Being a little behind
// is normal (work lands in bursts); being far behind, or having several blockers, is not.
const ON_TRACK_MAX_GAP = 0.1;
const WATCH_MAX_GAP = 0.25;
const AT_RISK_BLOCKER_COUNT = 3;

/**
 * Assesses delivery health from schedule progress AND blockers — not blockers alone. A board that has
 * burned only 32% of its points 67% of the way through the PI is NOT "on track" just because nothing
 * is flagged blocked. Falls back to the blocker-only signal when no date window is available.
 */
export function assessBoardHealth(input: BoardHealthInput): BoardHealthStatus {
  // Several blockers dominate the verdict regardless of schedule.
  if (input.blockedCount >= AT_RISK_BLOCKER_COUNT) {
    return 'at-risk';
  }
  // Without a time window or any points, we can only reason from blockers.
  if (input.timeElapsedFraction === null || input.pointsTotal <= 0) {
    return input.blockedCount === 0 ? 'on-track' : 'watch';
  }
  const doneFraction = input.pointsDone / input.pointsTotal;
  const scheduleGap = input.timeElapsedFraction - doneFraction; // positive = behind schedule
  let status: BoardHealthStatus;
  if (scheduleGap <= ON_TRACK_MAX_GAP) {
    status = 'on-track';
  } else if (scheduleGap <= WATCH_MAX_GAP) {
    status = 'watch';
  } else {
    status = 'at-risk';
  }
  // Any blocker keeps a schedule-healthy board out of a clean "on track".
  if (input.blockedCount > 0 && status === 'on-track') {
    return 'watch';
  }
  return status;
}

/** Running average of completed story points per sprint across the window — the team's velocity. */
export function computeAverageVelocity(sprintRows: readonly { completedPoints: number }[]): number {
  if (sprintRows.length === 0) {
    return 0;
  }
  const total = sprintRows.reduce((sum, row) => sum + row.completedPoints, 0);
  return Math.round(total / sprintRows.length);
}
