// capacityRosterSeed.ts — Seeds Capacity tab "Team Composition" rows from the team roster.
//
// The roster stores each person's structured role capabilities and their capacity %; the capacity
// calculator uses its own role codes and groups people into rows of the same role AND allocation. This
// module maps the two so a planner can auto-fill the team makeup (roles, head counts, allocation, PTO days)
// straight from the roster. Coordination roles that add no delivery capacity — Scrum Master,
// Product Owner, Solution Architect, Release Train Engineer — are deliberately excluded, matching the
// Feature Canvas re-allocation planner's rule.

import { ALL_TEAM_ROLES, generateCapacityRowId } from './capacityModel.ts';
import type { CapacityRow, TeamRole } from './capacityModel.ts';
import type { RosterRoleCapabilities, StandupRosterMember } from './hooks/useStandupRosterStore.ts';

// A person with no capacity % on the roster is fully on the team; one with no PTO days has none.
const DEFAULT_SEEDED_CAPACITY_PERCENTAGE = 100;
const DEFAULT_SEEDED_PTO_DAYS = 0;

/** One Team Composition row in the making: how many people share it and their PTO days between them. */
interface SeededRowTotals {
  memberCount: number;
  totalPtoDays: number;
}

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
 * Builds capacity Team Composition rows from a roster: one row per distinct counting role AND capacity %,
 * with the head count of people in it and the sum of their roster PTO days. Splitting by allocation is what
 * lets one half-time developer sit beside seven full-time ones — a single "Developer" row can only carry
 * one percentage. Rows come back in the calculator's canonical role order, highest allocation first within
 * a role. `createRowId` is injectable purely so tests stay deterministic.
 */
export function seedCapacityRowsFromRoster(
  rosterMembers: readonly StandupRosterMember[],
  createRowId: () => string = generateCapacityRowId,
): CapacityRow[] {
  const rowTotalsByPercentageByRole = new Map<TeamRole, Map<number, SeededRowTotals>>();
  for (const rosterMember of rosterMembers) {
    const capacityRole = resolveMemberCapacityRole(rosterMember);
    if (capacityRole === null) {
      continue;
    }

    const capacityPercentage = rosterMember.capacityPercentage ?? DEFAULT_SEEDED_CAPACITY_PERCENTAGE;
    const rowTotalsByPercentage = rowTotalsByPercentageByRole.get(capacityRole) ?? new Map<number, SeededRowTotals>();
    const rowTotals = rowTotalsByPercentage.get(capacityPercentage) ?? { memberCount: 0, totalPtoDays: 0 };
    rowTotalsByPercentage.set(capacityPercentage, {
      memberCount: rowTotals.memberCount + 1,
      totalPtoDays: rowTotals.totalPtoDays + (rosterMember.ptoDays ?? DEFAULT_SEEDED_PTO_DAYS),
    });
    rowTotalsByPercentageByRole.set(capacityRole, rowTotalsByPercentage);
  }

  return ALL_TEAM_ROLES.flatMap((teamRole) => {
    const rowTotalsByPercentage = rowTotalsByPercentageByRole.get(teamRole);
    if (rowTotalsByPercentage === undefined) {
      return [];
    }
    return [...rowTotalsByPercentage.entries()]
      .sort(([firstPercentage], [secondPercentage]) => secondPercentage - firstPercentage)
      .map(([capacityPercentage, rowTotals]) => ({
        id: createRowId(),
        role: teamRole,
        memberCount: rowTotals.memberCount,
        capacityPercentage,
        totalPtoDays: rowTotals.totalPtoDays,
      }));
  });
}
