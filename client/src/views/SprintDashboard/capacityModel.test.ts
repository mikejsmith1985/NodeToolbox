// capacityModel.test.ts — Unit tests for shared Sprint and ART capacity calculations.

import { describe, expect, it, vi } from 'vitest';

import {
  ALL_TEAM_ROLES,
  areCapacitySummariesEqual,
  buildCapacitySummary,
  calculateRecommendedCapacity,
  calculateRowCapacity,
  calculateTotalCapacity,
  coerceLegacyCapacityRole,
  countWorkDays,
  generateCapacityRowId,
  type CapacityRow,
  type CapacitySummary,
} from './capacityModel.ts';

function buildCapacityRow(overrides: Partial<CapacityRow> = {}): CapacityRow {
  return {
    id: 'row-1',
    role: 'Developer',
    memberCount: 2,
    capacityPercentage: 100,
    totalPtoDays: 0,
    ...overrides,
  };
}

describe('capacityModel', () => {
  it('counts only weekdays in an inclusive date range', () => {
    expect(countWorkDays('2026-05-18', '2026-05-24')).toBe(5);
  });

  it('returns zero work days for invalid or reversed ranges', () => {
    expect(countWorkDays('', '2026-05-24')).toBe(0);
    expect(countWorkDays('2026-05-24', '2026-05-18')).toBe(0);
  });

  it('calculates row capacity after PTO and allocation are applied', () => {
    const capacityRow = buildCapacityRow({
      memberCount: 3,
      capacityPercentage: 50,
      totalPtoDays: 2,
    });

    expect(calculateRowCapacity(capacityRow, 10)).toBe(14);
  });

  it('never returns negative row capacity when PTO exceeds available person-days', () => {
    expect(calculateRowCapacity(buildCapacityRow({ memberCount: 1, totalPtoDays: 20 }), 10)).toBe(0);
  });

  it('sums total capacity and applies the standard planning buffer', () => {
    const capacityRows = [
      buildCapacityRow({ id: 'dev', memberCount: 2, capacityPercentage: 100 }),
      buildCapacityRow({ id: 'tester', role: 'External Tester', memberCount: 1, capacityPercentage: 50 }),
    ];

    const totalCapacity = calculateTotalCapacity(capacityRows, 10);
    expect(totalCapacity).toBe(25);
    expect(calculateRecommendedCapacity(totalCapacity)).toBe(20);
  });

  it('builds a reusable capacity summary with per-role totals and date metadata', () => {
    const capacitySummary = buildCapacitySummary('Alpha Team Capacity', [
      buildCapacityRow({ id: 'dev', role: 'Developer', memberCount: 2, capacityPercentage: 100 }),
      buildCapacityRow({ id: 'tester', role: 'External Tester', memberCount: 1, capacityPercentage: 50 }),
    ], '2026-05-18', '2026-05-22');

    expect(capacitySummary.summaryLabel).toBe('Alpha Team Capacity');
    expect(capacitySummary.workDayCount).toBe(5);
    expect(capacitySummary.totalCapacityPoints).toBe(12.5);
    expect(capacitySummary.recommendedCapacityPoints).toBe(10);
    expect(capacitySummary.roleCapacities.Developer).toBe(10);
    expect(capacitySummary.roleCapacities['External Tester']).toBe(2.5);
  });

  it('treats two value-equal capacity snapshots as equal, and any real difference as not', () => {
    const baseSummary: CapacitySummary = {
      summaryLabel: 'Alpha Team Capacity',
      startDate: '2026-05-18',
      endDate: '2026-05-22',
      workDayCount: 5,
      totalCapacityPoints: 12.5,
      recommendedCapacityPoints: 10,
      roleCapacities: { Developer: 10, 'Dev Lead': 0, 'Internal Tester': 0, 'External Tester': 2.5, 'Systems Analyst': 0 },
    };
    // A distinct object with identical values is equal — a re-render must not read as a change.
    expect(areCapacitySummariesEqual(baseSummary, { ...baseSummary, roleCapacities: { ...baseSummary.roleCapacities } })).toBe(true);
    // A scalar change is a change.
    expect(areCapacitySummariesEqual(baseSummary, { ...baseSummary, recommendedCapacityPoints: 11 })).toBe(false);
    // A per-role change is a change.
    expect(areCapacitySummariesEqual(baseSummary, {
      ...baseSummary,
      roleCapacities: { ...baseSummary.roleCapacities, Developer: 12 },
    })).toBe(false);
    // Null handling: two nulls equal, one null not.
    expect(areCapacitySummariesEqual(null, null)).toBe(true);
    expect(areCapacitySummariesEqual(baseSummary, null)).toBe(false);
  });

  it('exposes exactly the five roster-matched delivery roles', () => {
    expect(ALL_TEAM_ROLES).toEqual(
      ['Developer', 'Dev Lead', 'Internal Tester', 'External Tester', 'Systems Analyst'],
    );
  });

  it('translates legacy persisted role codes to the current taxonomy', () => {
    expect(coerceLegacyCapacityRole('Dev')).toBe('Developer');
    expect(coerceLegacyCapacityRole('SL')).toBe('Internal Tester');
    expect(coerceLegacyCapacityRole('QE')).toBe('External Tester');
    expect(coerceLegacyCapacityRole('BT')).toBe('External Tester');
    expect(coerceLegacyCapacityRole('Test Lead')).toBe('External Tester');
    expect(coerceLegacyCapacityRole('SA')).toBe('Systems Analyst');
    expect(coerceLegacyCapacityRole('Dev Lead')).toBe('Dev Lead');
  });

  it('drops retired coordination roles and unrecognized values when coercing legacy data', () => {
    expect(coerceLegacyCapacityRole('SM')).toBeNull();
    expect(coerceLegacyCapacityRole('PO')).toBeNull();
    expect(coerceLegacyCapacityRole('TPO')).toBeNull();
    expect(coerceLegacyCapacityRole('Something Unknown')).toBeNull();
  });

  it('generates a row id with the expected prefix', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1779300000000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    expect(generateCapacityRowId()).toMatch(/^row-1779300000000-/);
  });
});
