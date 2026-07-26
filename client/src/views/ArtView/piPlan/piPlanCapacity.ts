// piPlanCapacity.ts — Adapts the team roster + the PI capacity summary into the FeatureCanvas planner's
// PersonCapacity contract (spec 028). This is the seam that lets us REUSE buildCapacityPlan for
// scheduling, assignment, and the capacity map. The per-person points-per-sprint derivation follows
// research R1 (the capacity summary is a single PI-window, per-role total with no per-sprint breakdown).

import type { DeliveryRole, PersonCapacity } from '../../FeatureCanvas/planner/capacityTypes.ts';
import type { CapacitySummary } from '../../SprintDashboard/capacityModel.ts';
import type { RosterRoleCapabilities, StandupRosterMember } from '../../SprintDashboard/hooks/useStandupRosterStore.ts';

/** A standard work-week is five of seven days; used to convert a sprint's calendar length to working days. */
const WORKING_DAYS_PER_WEEK = 5;
const CALENDAR_DAYS_PER_WEEK = 7;

/** Maps a roster member's capability flags to the three delivery roles the planner schedules against. */
export function mapDeliveryRoles(capabilities: RosterRoleCapabilities | undefined): DeliveryRole[] {
  if (!capabilities) {
    return [];
  }
  const roles: DeliveryRole[] = [];
  if (capabilities.canDevelop) roles.push('dev');
  if (capabilities.canInternalTest) roles.push('internalTest');
  if (capabilities.canExternalTest) roles.push('externalTest');
  return roles;
}

/** Number of whole sprints in the PI window (at least one), from the working-day count and sprint length. */
export function computeSprintsInPi(workDayCount: number, sprintLengthDays: number): number {
  const workingDaysPerSprint = Math.max(1, Math.round((sprintLengthDays * WORKING_DAYS_PER_WEEK) / CALENDAR_DAYS_PER_WEEK));
  return Math.max(1, Math.ceil(workDayCount / workingDaysPerSprint));
}

/**
 * Builds the planner's per-person capacities. Only members with at least one delivery capability are
 * included. Each person's points-per-sprint is the 80%-recommended team total spread evenly across the
 * PI's sprints and the active roster, unless an explicit per-person capacity is supplied (which wins).
 */
export function buildPersonCapacities(
  members: StandupRosterMember[],
  summary: CapacitySummary,
  sprintLengthDays: number,
  explicitPointsPerSprint: Record<string, number> = {},
): PersonCapacity[] {
  const activeMembers = members.filter((member) => mapDeliveryRoles(member.roleCapabilities).length > 0);
  if (activeMembers.length === 0) {
    return [];
  }
  const sprintsInPi = computeSprintsInPi(summary.workDayCount, sprintLengthDays);
  const teamPointsPerSprint = summary.recommendedCapacityPoints / sprintsInPi;
  const defaultPerPerson = teamPointsPerSprint / activeMembers.length;

  return activeMembers.map((member) => ({
    displayName: member.displayName,
    roles: mapDeliveryRoles(member.roleCapabilities),
    pointsPerSprint: explicitPointsPerSprint[member.displayName] ?? defaultPerPerson,
  }));
}
