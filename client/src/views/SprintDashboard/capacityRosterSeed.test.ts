// capacityRosterSeed.test.ts — Unit tests for seeding capacity rows from the team roster.

import { describe, expect, it } from 'vitest';

import { resolveMemberCapacityRole, seedCapacityRowsFromRoster } from './capacityRosterSeed.ts';
import type { StandupRosterMember, RosterRoleCapabilities } from './hooks/useStandupRosterStore.ts';

// ── Helpers ──

let memberSequence = 0;

/** Builds a minimal roster member carrying only the role capabilities under test. */
function buildRosterMember(roleCapabilities?: RosterRoleCapabilities): StandupRosterMember {
  memberSequence += 1;
  return {
    id: `member-${memberSequence}`,
    displayName: `Member ${memberSequence}`,
    assigneeQueryValue: `member${memberSequence}`,
    roleCapabilities,
  };
}

/** A deterministic id generator so tests can assert row output without time/randomness. */
function buildSequentialRowId(): () => string {
  let idSequence = 0;
  return () => {
    idSequence += 1;
    return `seed-row-${idSequence}`;
  };
}

// ── resolveMemberCapacityRole ──

describe('resolveMemberCapacityRole', () => {
  it('maps each counting roster capability to its capacity code', () => {
    expect(resolveMemberCapacityRole(buildRosterMember({ canDevelop: true } as RosterRoleCapabilities))).toBe('Developer');
    expect(resolveMemberCapacityRole(buildRosterMember({ canDevLead: true } as RosterRoleCapabilities))).toBe('Dev Lead');
    expect(resolveMemberCapacityRole(buildRosterMember({ canInternalTest: true } as RosterRoleCapabilities))).toBe('Internal Tester');
    expect(resolveMemberCapacityRole(buildRosterMember({ canExternalTest: true } as RosterRoleCapabilities))).toBe('External Tester');
    expect(resolveMemberCapacityRole(buildRosterMember({ canSystemsAnalyst: true } as RosterRoleCapabilities))).toBe('Systems Analyst');
  });

  it('excludes Scrum Master, Product Owner, Solution Architect, and Release Train Engineer from capacity', () => {
    expect(resolveMemberCapacityRole(buildRosterMember({ canScrumMaster: true } as RosterRoleCapabilities))).toBeNull();
    expect(resolveMemberCapacityRole(buildRosterMember({ canProductOwner: true } as RosterRoleCapabilities))).toBeNull();
    expect(resolveMemberCapacityRole(buildRosterMember({ canSolutionArchitect: true } as RosterRoleCapabilities))).toBeNull();
    expect(resolveMemberCapacityRole(buildRosterMember({ canReleaseTrainEngineer: true } as RosterRoleCapabilities))).toBeNull();
  });

  it('returns null when the member has no role capabilities at all', () => {
    expect(resolveMemberCapacityRole(buildRosterMember())).toBeNull();
    expect(resolveMemberCapacityRole(buildRosterMember({} as RosterRoleCapabilities))).toBeNull();
  });

  it('counts a delivery role even when an excluded coordination role is also set', () => {
    // "No one should have two roles" is the norm, but if it happens the delivery role wins.
    const member = buildRosterMember({ canDevelop: true, canScrumMaster: true } as RosterRoleCapabilities);
    expect(resolveMemberCapacityRole(member)).toBe('Developer');
  });
});

// ── seedCapacityRowsFromRoster ──

describe('seedCapacityRowsFromRoster', () => {
  it('returns an empty array for an empty roster', () => {
    expect(seedCapacityRowsFromRoster([], buildSequentialRowId())).toEqual([]);
  });

  it('groups members of the same role into a single row with a head count', () => {
    const roster = [
      buildRosterMember({ canDevelop: true } as RosterRoleCapabilities),
      buildRosterMember({ canDevelop: true } as RosterRoleCapabilities),
      buildRosterMember({ canDevelop: true } as RosterRoleCapabilities),
    ];
    const rows = seedCapacityRowsFromRoster(roster, buildSequentialRowId());
    expect(rows).toEqual([
      { id: 'seed-row-1', role: 'Developer', memberCount: 3, capacityPercentage: 100, totalPtoDays: 0 },
    ]);
  });

  it('produces one row per distinct counting role and drops excluded members', () => {
    const roster = [
      buildRosterMember({ canDevelop: true } as RosterRoleCapabilities),
      buildRosterMember({ canDevLead: true } as RosterRoleCapabilities),
      buildRosterMember({ canInternalTest: true } as RosterRoleCapabilities),
      buildRosterMember({ canExternalTest: true } as RosterRoleCapabilities),
      buildRosterMember({ canSystemsAnalyst: true } as RosterRoleCapabilities),
      buildRosterMember({ canScrumMaster: true } as RosterRoleCapabilities),
      buildRosterMember({ canProductOwner: true } as RosterRoleCapabilities),
      buildRosterMember({ canSolutionArchitect: true } as RosterRoleCapabilities),
      buildRosterMember({ canReleaseTrainEngineer: true } as RosterRoleCapabilities),
    ];
    const rows = seedCapacityRowsFromRoster(roster, buildSequentialRowId());
    // Five counting rows in the calculator's canonical role order; the four coordination-only
    // members are excluded.
    expect(rows.map((row) => row.role)).toEqual(['Developer', 'Dev Lead', 'Internal Tester', 'External Tester', 'Systems Analyst']);
    expect(rows.every((row) => row.memberCount === 1)).toBe(true);
  });

  it('defaults allocation to 100% and PTO to 0 so capacity numbers stay a manual entry', () => {
    const rows = seedCapacityRowsFromRoster(
      [buildRosterMember({ canDevelop: true } as RosterRoleCapabilities)],
      buildSequentialRowId(),
    );
    expect(rows[0].capacityPercentage).toBe(100);
    expect(rows[0].totalPtoDays).toBe(0);
  });
});
