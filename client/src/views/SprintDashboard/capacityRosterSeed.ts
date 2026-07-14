// capacityRosterSeed.ts — Seeds Capacity tab "Team Composition" rows from the team roster.
//
// The roster stores each person's structured role capabilities; the capacity calculator uses its own
// role codes. This module maps the two so a planner can auto-fill the team makeup (roles + head counts)
// from the roster and then enter the capacity numbers (allocation %, PTO) by hand. Coordination roles
// that add no delivery capacity — Scrum Master, Product Owner, Solution Architect, Release Train
// Engineer — are deliberately excluded, matching the Feature Canvas re-allocation planner's rule.

import { ALL_TEAM_ROLES, generateCapacityRowId } from './capacityModel.ts';
import type { CapacityRow, TeamRole } from './capacityModel.ts';
import type { RosterRoleCapabilities, StandupRosterMember } from './hooks/useStandupRosterStore.ts';

// Seeded rows start fully allocated with no time off; the planner adjusts these by hand afterward.
const DEFAULT_SEEDED_CAPACITY_PERCENTAGE = 100;
const DEFAULT_SEEDED_PTO_DAYS = 0;

/**
 * Ordered map of roster capabilities that DO count toward capacity, paired with their capacity code.
 * Order is the tie-breaker on the rare member who carries more than one delivery capability (the team
 * norm is one role per person): the first match in this list wins, so a Dev Lead outranks a plain Dev.
 * Excluded coordination roles (Scrum Master, Product Owner, Solution Architect, Release Train Engineer)
 * are intentionally absent — a member holding only those maps to no capacity role.
 */
const COUNTING_CAPACITY_ROLE_ORDER: ReadonlyArray<{ capabilityKey: keyof RosterRoleCapabilities; role: TeamRole }> = [
  { capabilityKey: 'canDevLead', role: 'Dev Lead' },
  { capabilityKey: 'canDevelop', role: 'Developer' },
  { capabilityKey: 'canSystemsAnalyst', role: 'Systems Analyst' },
  { capabilityKey: 'canInternalTest', role: 'Internal Tester' },
  { capabilityKey: 'canExternalTest', role: 'External Tester' },
];

/**
 * Resolves the single capacity role a roster member should count toward, or null when the member holds
 * only excluded coordination roles (or no roles at all) and therefore adds no delivery capacity.
 */
export function resolveMemberCapacityRole(member: StandupRosterMember): TeamRole | null {
  const roleCapabilities = member.roleCapabilities;
  if (!roleCapabilities) {
    return null;
  }

  for (const { capabilityKey, role } of COUNTING_CAPACITY_ROLE_ORDER) {
    if (roleCapabilities[capabilityKey]) {
      return role;
    }
  }

  return null;
}

/**
 * Builds capacity Team Composition rows from a roster: one row per distinct counting role, with the
 * head count of people in that role. Allocation % and PTO default to a full-availability starting point
 * so the numbers remain a deliberate manual entry. Rows come back in the calculator's canonical role
 * order for a stable, predictable table. `createRowId` is injectable purely so tests stay deterministic.
 */
export function seedCapacityRowsFromRoster(
  rosterMembers: readonly StandupRosterMember[],
  createRowId: () => string = generateCapacityRowId,
): CapacityRow[] {
  const headCountByRole = new Map<TeamRole, number>();
  for (const rosterMember of rosterMembers) {
    const capacityRole = resolveMemberCapacityRole(rosterMember);
    if (capacityRole === null) {
      continue;
    }

    headCountByRole.set(capacityRole, (headCountByRole.get(capacityRole) ?? 0) + 1);
  }

  return ALL_TEAM_ROLES.filter((teamRole) => headCountByRole.has(teamRole)).map((teamRole) => ({
    id: createRowId(),
    role: teamRole,
    memberCount: headCountByRole.get(teamRole) ?? 0,
    capacityPercentage: DEFAULT_SEEDED_CAPACITY_PERCENTAGE,
    totalPtoDays: DEFAULT_SEEDED_PTO_DAYS,
  }));
}
