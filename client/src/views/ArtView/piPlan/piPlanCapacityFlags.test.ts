// piPlanCapacityFlags.test.ts — The defect-bucket undersize check (spec 032 capacity honesty).

import { describe, expect, it } from 'vitest';

import { detectDefectUndersize, isDefectFeature } from './piPlanCapacityFlags.ts';

describe('isDefectFeature', () => {
  it('matches "Defect" / "Defects" on a word boundary, case-insensitively', () => {
    expect(isDefectFeature('DENP-1414 Defects — Enrollment')).toBe(true);
    expect(isDefectFeature('Production defect bucket')).toBe(true);
    expect(isDefectFeature('Q3 DEFECT capacity')).toBe(true);
  });

  it('does not match a substring that is not the word defect', () => {
    expect(isDefectFeature('Defective-part enrollment rework')).toBe(false);
    expect(isDefectFeature('Enhance duplicate matching')).toBe(false);
  });
});

describe('detectDefectUndersize', () => {
  const defect = { key: 'DENP-1414', summary: 'Defects — Enrollment', sizePoints: 40 };

  it('flags a defect Feature whose child points exceed its size, with the overage', () => {
    const [flag] = detectDefectUndersize([defect], { 'DENP-1414': 52 });
    expect(flag).toEqual({ featureKey: 'DENP-1414', summary: 'Defects — Enrollment', featureSize: 40, childTotal: 52, overBy: 12 });
  });

  it('does not flag when children are at or under budget', () => {
    expect(detectDefectUndersize([defect], { 'DENP-1414': 40 })).toEqual([]);
    expect(detectDefectUndersize([defect], { 'DENP-1414': 8 })).toEqual([]);
    expect(detectDefectUndersize([defect], {})).toEqual([]); // no children yet
  });

  it('ignores non-defect Features and unsized defect buckets', () => {
    const normal = { key: 'DENP-100', summary: 'Enhance matching', sizePoints: 5 };
    const unsized = { key: 'DENP-200', summary: 'Defects — unsized', sizePoints: null };
    expect(detectDefectUndersize([normal, unsized], { 'DENP-100': 99, 'DENP-200': 99 })).toEqual([]);
  });
});
