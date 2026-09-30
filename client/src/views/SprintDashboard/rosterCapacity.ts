// rosterCapacity.ts — Turns the roster's per-person PI capacity estimates into a PI Review capacity snapshot.
//
// The Capacity tab derives capacity from role rows, allocation and PTO. This is the plainer route the
// team asked for: each person carries one points estimate on the roster, and a PI Review can adopt the
// sum on request. Producing the SAME `CapacitySummary` shape means the existing Team Capacity panel,
// load comparison and Confluence save all work unchanged.

import {
  ALL_TEAM_ROLES,
  calculateRecommendedCapacity,
  type CapacitySummary,
  type TeamRole,
} from './capacityModel.ts';
import type { RosterRoleCapabilities, StandupRosterMember } from './hooks/useStandupRosterStore.ts';

/**
 * The delivery role a person's points are credited to, most specific first. One role per person keeps
 * the role breakdown summing to the team total — a developer who also tests is not counted twice.
 */
const ROLE_CREDIT_ORDER: Array<{ capabilityKey: keyof RosterRoleCapabilities; teamRole: TeamRole }> = [
  { capabilityKey: 'canDevLead', teamRole: 'Dev Lead' },
  { capabilityKey: 'canDevelop', teamRole: 'Developer' },
  { capabilityKey: 'canInternalTest', teamRole: 'Internal Tester' },
  { capabilityKey: 'canExternalTest', teamRole: 'External Tester' },
  { capabilityKey: 'canSystemsAnalyst', teamRole: 'Systems Analyst' },
];

/** The roster members who have given a capacity estimate (zero counts — it is a real answer). */
function readMembersWithEstimates(rosterMembers: readonly StandupRosterMember[]): StandupRosterMember[] {
  return rosterMembers.filter((rosterMember) => typeof rosterMember.piCapacityPoints === 'number');
}

/** How many people on the roster have a PI capacity estimate. */
export function countRosterCapacityEstimates(rosterMembers: readonly StandupRosterMember[]): number {
  return readMembersWithEstimates(rosterMembers).length;
}

/** The single delivery role a person's points count toward, or null when they hold none. */
function resolveCreditedRole(rosterMember: StandupRosterMember): TeamRole | null {
  const matchingRole = ROLE_CREDIT_ORDER.find(
    (roleCredit) => rosterMember.roleCapabilities?.[roleCredit.capabilityKey] === true,
  );
  return matchingRole?.teamRole ?? null;
}

/**
 * Builds a capacity snapshot from the roster's estimates: the total at 100%, the 80% target, and a
 * per-role split. Dates and work days are carried over from the snapshot already on screen, because a
 * points estimate says nothing about the calendar. Returns null when nobody has an estimate.
 */
export function buildRosterCapacitySummary(
  rosterMembers: readonly StandupRosterMember[],
  currentSummary: CapacitySummary | null,
): CapacitySummary | null {
  const membersWithEstimates = readMembersWithEstimates(rosterMembers);
  if (membersWithEstimates.length === 0) {
    return null;
  }

  const roleCapacities = Object.fromEntries(ALL_TEAM_ROLES.map((teamRole) => [teamRole, 0])) as Record<TeamRole, number>;
  let totalCapacityPoints = 0;
  for (const rosterMember of membersWithEstimates) {
    const estimatePoints = rosterMember.piCapacityPoints ?? 0;
    totalCapacityPoints += estimatePoints;
    const creditedRole = resolveCreditedRole(rosterMember);
    if (creditedRole !== null) {
      roleCapacities[creditedRole] += estimatePoints;
    }
  }

  const personLabel = membersWithEstimates.length === 1 ? 'person' : 'people';
  return {
    summaryLabel: `Roster capacity estimates (${membersWithEstimates.length} ${personLabel})`,
    startDate: currentSummary?.startDate ?? '',
    endDate: currentSummary?.endDate ?? '',
    workDayCount: currentSummary?.workDayCount ?? 0,
    totalCapacityPoints,
    recommendedCapacityPoints: calculateRecommendedCapacity(totalCapacityPoints),
    roleCapacities,
  };
}
