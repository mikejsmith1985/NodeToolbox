// rosterCapacity.test.ts — Unit tests for turning roster capacity estimates into a PI Review capacity snapshot.

import { describe, expect, it } from 'vitest';

import type { CapacitySummary } from './capacityModel.ts';
import type { StandupRosterMember } from './hooks/useStandupRosterStore.ts';
import { buildRosterCapacitySummary, countRosterCapacityEstimates } from './rosterCapacity.ts';

function buildMember(displayName: string, overrides: Partial<StandupRosterMember> = {}): StandupRosterMember {
  return { id: `roster-member:${displayName}`, displayName, assigneeQueryValue: displayName, ...overrides };
}

const EXISTING_SUMMARY: CapacitySummary = {
  summaryLabel: 'Team plan',
  startDate: '2026-10-05',
  endDate: '2026-12-11',
  workDayCount: 50,
  totalCapacityPoints: 300,
  recommendedCapacityPoints: 240,
  roleCapacities: {
    Developer: 200, 'Dev Lead': 0, 'Internal Tester': 100, 'External Tester': 0, 'Systems Analyst': 0,
  },
};

describe('buildRosterCapacitySummary', () => {
  it('totals every estimate and applies the 80% target', () => {
    const summary = buildRosterCapacitySummary([
      buildMember('Alice', { piCapacityPoints: 40, roleCapabilities: { canDevelop: true, canInternalTest: false, canExternalTest: false } }),
      buildMember('Bob', { piCapacityPoints: 25, roleCapabilities: { canDevelop: false, canInternalTest: true, canExternalTest: false } }),
      buildMember('Cara'),
    ], null);

    expect(summary?.totalCapacityPoints).toBe(65);
    expect(summary?.recommendedCapacityPoints).toBe(52);
    expect(summary?.summaryLabel).toBe('Roster capacity estimates (2 people)');
  });

  it('credits each person to one delivery role, so role totals never double-count', () => {
    const summary = buildRosterCapacitySummary([
      buildMember('Lead', {
        piCapacityPoints: 30,
        roleCapabilities: { canDevelop: true, canInternalTest: true, canExternalTest: false, canDevLead: true },
      }),
      buildMember('Tester', { piCapacityPoints: 20, roleCapabilities: { canDevelop: false, canInternalTest: true, canExternalTest: false } }),
      buildMember('No roles', { piCapacityPoints: 10 }),
    ], null);

    expect(summary?.roleCapacities).toEqual({
      Developer: 0, 'Dev Lead': 30, 'Internal Tester': 20, 'External Tester': 0, 'Systems Analyst': 0,
    });
    // Someone with no delivery role still counts toward the team total.
    expect(summary?.totalCapacityPoints).toBe(60);
  });

  it('keeps the dates and work days of the snapshot already shown', () => {
    const summary = buildRosterCapacitySummary([buildMember('Alice', { piCapacityPoints: 40 })], EXISTING_SUMMARY);

    expect(summary).toEqual(expect.objectContaining({
      startDate: '2026-10-05', endDate: '2026-12-11', workDayCount: 50, totalCapacityPoints: 40,
    }));
  });

  it('scales each estimate by the person\'s capacity percentage, treating a blank percentage as 100%', () => {
    const summary = buildRosterCapacitySummary([
      buildMember('Alice', {
        piCapacityPoints: 60,
        capacityPercentage: 50,
        roleCapabilities: { canDevelop: true, canInternalTest: false, canExternalTest: false },
      }),
      buildMember('Bob', { piCapacityPoints: 40 }),
      buildMember('Cara', { piCapacityPoints: 30, capacityPercentage: 0 }),
    ], null);

    expect(summary?.totalCapacityPoints).toBe(70);
    expect(summary?.recommendedCapacityPoints).toBe(56);
    expect(summary?.roleCapacities.Developer).toBe(30);
  });

  it('returns nothing when nobody on the roster has an estimate', () => {
    expect(buildRosterCapacitySummary([buildMember('Alice')], EXISTING_SUMMARY)).toBeNull();
  });
});

describe('countRosterCapacityEstimates', () => {
  it('counts only the people who have an estimate, including an estimate of zero', () => {
    expect(countRosterCapacityEstimates([
      buildMember('Alice', { piCapacityPoints: 40 }),
      buildMember('Bob', { piCapacityPoints: 0 }),
      buildMember('Cara'),
    ])).toBe(2);
  });
});
