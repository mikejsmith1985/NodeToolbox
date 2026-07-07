// bottleneck.ts — Pure limiting-role detection plus the additional-headcount math for both staffing targets.
//
// With many developers and one internal tester, testing — not development — is the critical path. This
// module quantifies that: which delivery role stretches the schedule longest, and how many more people it
// needs to (a) keep pace with development and (b) finish the selected scope by the PI end. All formulas are
// taken verbatim from specs/013-capacity-work-planner/data-model.md §"Bottleneck math". Pure and deterministic.

import type { BottleneckReport, DeliveryRole } from './capacityTypes.ts';

/** Total demand (in story points) for each delivery role across the selected, schedulable scope. */
export interface RoleDemandPoints {
  dev: number;
  internalTest: number;
  externalTest: number;
}

/** Head-count of people capable of each delivery role (a multi-role person counts toward each role held). */
export interface RolePeopleCounts {
  dev: number;
  internalTest: number;
  externalTest: number;
}

// The only downstream roles that can be a staffing bottleneck; development is always the upstream baseline.
const DOWNSTREAM_ROLES: DeliveryRole[] = ['internalTest', 'externalTest'];

/** Number of sprints a role needs: demand ÷ its per-sprint capacity, or Infinity when demand has no capacity. */
function sprintsNeededForRole(demandPoints: number, capacityPerSprint: number): number {
  if (demandPoints <= 0) {
    return 0;
  }
  if (capacityPerSprint <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.ceil(demandPoints / capacityPerSprint);
}

/** Maps a delivery role to the plain-English label used in the operator-facing statement. */
function roleLabel(role: DeliveryRole): string {
  if (role === 'dev') {
    return 'development';
  }
  if (role === 'internalTest') {
    return 'internal testing';
  }
  return 'external testing';
}

/**
 * Picks the limiting delivery role: the downstream role whose demand needs MORE sprints than the
 * dev-driven span. Returns null when no downstream role exceeds the development span (no bottleneck).
 * Deterministic tiebreak: internal testing is considered before external testing.
 */
function findLimitingRole(demand: RoleDemandPoints, counts: RolePeopleCounts, pool: number): DeliveryRole | null {
  const devSprints = sprintsNeededForRole(demand.dev, pool * counts.dev);
  let limitingRole: DeliveryRole | null = null;
  let mostSprints = devSprints;
  for (const role of DOWNSTREAM_ROLES) {
    const roleSprints = sprintsNeededForRole(demand[role], pool * counts[role]);
    // Strictly greater so a role only counts as a bottleneck when it outlasts development.
    if (demand[role] > 0 && roleSprints > mostSprints) {
      limitingRole = role;
      mostSprints = roleSprints;
    }
  }
  return limitingRole;
}

/**
 * Computes the bottleneck report: which delivery role limits the schedule and how many additional people
 * that role needs to match development throughput and to finish the scope by the PI end.
 *
 * @param demand         Total story-point demand per delivery role across the selected scope.
 * @param counts         Number of people capable of each delivery role.
 * @param pool           Points per person per sprint (default 8) — the unit of one added head-count.
 * @param sprintsToPiEnd Whole sprints available between the plan anchor and the PI end date (at least 1).
 */
export function computeBottleneck(
  demand: RoleDemandPoints,
  counts: RolePeopleCounts,
  pool: number,
  sprintsToPiEnd: number,
): BottleneckReport {
  const limitingRole = findLimitingRole(demand, counts, pool);
  if (limitingRole === null) {
    return {
      limitingRole: null,
      additionalToMatchThroughput: 0,
      additionalToFinishByPiEnd: 0,
      statement: 'No delivery-role bottleneck: testing keeps pace with development.',
    };
  }

  const limitingCapacityPerSprint = pool * counts[limitingRole];

  // People needed so the limiting role's work finishes within the SAME span development takes — i.e. it
  // keeps pace with the rate testable work is produced, NOT with development's raw head-count. Testing
  // demand is typically a fraction of dev output, so this is the honest "keep pace" number (matching to
  // dev capacity would over-provision by that fraction). When there is no dev work, there is nothing to
  // keep pace with, so no testers are required on this target.
  const devSprints = sprintsNeededForRole(demand.dev, pool * counts.dev);
  const requiredToKeepPace = devSprints <= 0 ? 0 : Math.ceil(demand[limitingRole] / devSprints);
  const additionalToMatchThroughput = Math.max(
    0,
    Math.ceil((requiredToKeepPace - limitingCapacityPerSprint) / pool),
  );

  // People needed so the limiting role's whole demand fits inside the sprints left before the PI end.
  const requiredPerSprint = Math.ceil(demand[limitingRole] / sprintsToPiEnd);
  const additionalToFinishByPiEnd = Math.max(
    0,
    Math.ceil((requiredPerSprint - limitingCapacityPerSprint) / pool),
  );

  const label = roleLabel(limitingRole);
  const statement =
    `${label} is the limiting role: add ${additionalToMatchThroughput} more to match development ` +
    `throughput, and ${additionalToFinishByPiEnd} more to finish the selected scope by the PI end.`;

  return { limitingRole, additionalToMatchThroughput, additionalToFinishByPiEnd, statement };
}
