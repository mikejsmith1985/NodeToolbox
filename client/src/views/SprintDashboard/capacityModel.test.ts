// capacityModel.test.ts — Unit tests for shared Sprint and ART capacity calculations.

import { describe, expect, it, vi } from 'vitest';

import {
  ALL_TEAM_ROLES,
  buildCapacitySummary,
  calculateRecommendedCapacity,
  calculateRowCapacity,
  calculateTotalCapacity,
  countWorkDays,
  generateCapacityRowId,
  type CapacityRow,
} from './capacityModel.ts';

function buildCapacityRow(overrides: Partial<CapacityRow> = {}): CapacityRow {
  return {
    id: 'row-1',
    role: 'Dev',
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
      buildCapacityRow({ id: 'qe', role: 'QE', memberCount: 1, capacityPercentage: 50 }),
    ];

    const totalCapacity = calculateTotalCapacity(capacityRows, 10);
    expect(totalCapacity).toBe(25);
    expect(calculateRecommendedCapacity(totalCapacity)).toBe(20);
  });

  it('builds a reusable capacity summary with per-role totals and date metadata', () => {
    const capacitySummary = buildCapacitySummary('Alpha Team Capacity', [
      buildCapacityRow({ id: 'dev', role: 'Dev', memberCount: 2, capacityPercentage: 100 }),
      buildCapacityRow({ id: 'qe', role: 'QE', memberCount: 1, capacityPercentage: 50 }),
    ], '2026-05-18', '2026-05-22');

    expect(capacitySummary.summaryLabel).toBe('Alpha Team Capacity');
    expect(capacitySummary.workDayCount).toBe(5);
    expect(capacitySummary.totalCapacityPoints).toBe(12.5);
    expect(capacitySummary.recommendedCapacityPoints).toBe(10);
    expect(capacitySummary.roleCapacities.Dev).toBe(10);
    expect(capacitySummary.roleCapacities.QE).toBe(2.5);
  });

  it('includes the expanded ART role set used by capacity planners', () => {
    expect(ALL_TEAM_ROLES).toEqual(
      expect.arrayContaining(['Dev Lead', 'Test Lead', 'TPO']),
    );
  });

  it('generates a row id with the expected prefix', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1779300000000);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    expect(generateCapacityRowId()).toMatch(/^row-1779300000000-/);
  });
});
