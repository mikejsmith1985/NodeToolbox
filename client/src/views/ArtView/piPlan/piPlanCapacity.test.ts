// piPlanCapacity.test.ts — The roster→PersonCapacity adapter (spec 028, research R1/R2 mapping).

import { describe, expect, it } from 'vitest';

import { buildPersonCapacities, computeSprintsInPi, mapDeliveryRoles } from './piPlanCapacity.ts';
import type { CapacitySummary } from '../../SprintDashboard/capacityModel.ts';
import type { StandupRosterMember } from '../../SprintDashboard/hooks/useStandupRosterStore.ts';

function member(displayName: string, caps: Partial<StandupRosterMember['roleCapabilities']>): StandupRosterMember {
  return {
    id: displayName,
    displayName,
    assigneeQueryValue: displayName,
    roleCapabilities: { canDevelop: false, canInternalTest: false, canExternalTest: false, ...caps },
  };
}

const SUMMARY: CapacitySummary = {
  summaryLabel: 'PI 26.3',
  startDate: '2026-05-21',
  endDate: '2026-07-29',
  workDayCount: 50,
  totalCapacityPoints: 200,
  recommendedCapacityPoints: 160,
  roleCapacities: {
    Developer: 0, 'Dev Lead': 0, 'Internal Tester': 0, 'External Tester': 0, 'Systems Analyst': 0,
  },
};

describe('mapDeliveryRoles', () => {
  it('maps capability flags to delivery roles', () => {
    expect(mapDeliveryRoles({ canDevelop: true, canInternalTest: true, canExternalTest: false })).toEqual(['dev', 'internalTest']);
    expect(mapDeliveryRoles(undefined)).toEqual([]);
  });
});

describe('computeSprintsInPi', () => {
  it('divides working days by working days per sprint (14-day sprint = 10 working days)', () => {
    expect(computeSprintsInPi(50, 14)).toBe(5);
  });
});

describe('buildPersonCapacities', () => {
  const roster = [
    member('Dev One', { canDevelop: true }),
    member('Dev Two', { canDevelop: true }),
    member('QA One', { canInternalTest: true }),
    member('Ext One', { canExternalTest: true }),
    member('Manager', {}), // no delivery capability → excluded
  ];

  it('derives per-person pointsPerSprint = recommended ÷ sprints ÷ active members', () => {
    const people = buildPersonCapacities(roster, SUMMARY, 14);
    // 160 recommended ÷ 5 sprints = 32/sprint team; ÷ 4 active = 8 each
    expect(people).toHaveLength(4);
    expect(people.every((person) => person.pointsPerSprint === 8)).toBe(true);
    expect(people.find((person) => person.displayName === 'Manager')).toBeUndefined();
  });

  it('lets an explicit per-person capacity override the derived default', () => {
    const people = buildPersonCapacities(roster, SUMMARY, 14, { 'Dev One': 12 });
    expect(people.find((person) => person.displayName === 'Dev One')!.pointsPerSprint).toBe(12);
    expect(people.find((person) => person.displayName === 'Dev Two')!.pointsPerSprint).toBe(8);
  });

  it('returns no capacities when no member has a delivery capability', () => {
    expect(buildPersonCapacities([member('Manager', {})], SUMMARY, 14)).toEqual([]);
  });
});
