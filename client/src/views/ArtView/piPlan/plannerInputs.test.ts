// plannerInputs.test.ts — Pure PI-Review→planner input mapping (spec 028, US1 mount).

import { describe, expect, it } from 'vitest';

import { buildFeatureInputs, deriveSprints, parseDependencyKeys, parsePoints, readRepoComponentNames, toIsoDate } from './plannerInputs.ts';
import type { FeatureIssueLike } from './plannerInputs.ts';
import type { PiReviewRow } from '../piReviewTable.ts';

function row(overrides: Partial<PiReviewRow>): PiReviewRow {
  return {
    rowId: 'r1', carryOver: '', priority: '', feature: 'ABC-1 Login form', pointEstimate: '8',
    dependency: '', risks: '', committed: '', notes: '', devWork: '', testSupport: '', carryToNext: '',
    devStart: '', devTest: '', intPvs: '', prodDeploy: '', ...overrides,
  } as PiReviewRow;
}

describe('small parsers', () => {
  it('parsePoints handles numbers and blanks', () => {
    expect(parsePoints('8')).toBe(8);
    expect(parsePoints('')).toBeNull();
    expect(parsePoints('—')).toBeNull();
  });

  it('parseDependencyKeys extracts Jira keys from free text', () => {
    expect(parseDependencyKeys('blocked by ABC-2 and DENP-99')).toEqual(['ABC-2', 'DENP-99']);
    expect(parseDependencyKeys('none')).toEqual([]);
  });

  it('toIsoDate formats a Date as YYYY-MM-DD', () => {
    expect(toIsoDate(new Date(2026, 4, 21))).toBe('2026-05-21'); // month is 0-based
  });
});

describe('buildFeatureInputs', () => {
  it('maps a reconciled row + Jira issue into a FeatureInput', () => {
    const rows = [row({ priority: 'High', committed: 'Yes', dependency: 'needs ABC-2', pointEstimate: '13' })];
    const jira: Record<string, FeatureIssueLike> = { 'ABC-1': { fields: { fixVersions: [{ name: 'R1' }], priority: { name: 'Medium' } } } };
    const [feature] = buildFeatureInputs(rows, jira);
    expect(feature.key).toBe('ABC-1');
    expect(feature.summary).toBe('Login form');
    expect(feature.sizePoints).toBe(13);
    expect(feature.priorityName).toBe('High'); // row wins over jira
    expect(feature.isCommitted).toBe(true);
    expect(feature.dependencyKeys).toEqual(['ABC-2']);
    expect(feature.targetFixVersion).toBe('R1');
  });

  it('falls back to the Jira priority and null size when the row is blank', () => {
    const [feature] = buildFeatureInputs([row({ priority: '', pointEstimate: '' })], { 'ABC-1': { fields: { priority: { name: 'Low' } } } });
    expect(feature.priorityName).toBe('Low');
    expect(feature.sizePoints).toBeNull();
    expect(feature.targetFixVersion).toBeNull();
  });
});

describe('readRepoComponentNames', () => {
  const getKind = (name: string): 'repo' | 'domain' | null =>
    (name === 'payments-api' || name === 'ui-web' ? 'repo' : name === 'Enrollment' ? 'domain' : null);

  it('keeps only repo-classified components, de-duplicated', () => {
    const issue: FeatureIssueLike = {
      fields: { components: [{ name: 'payments-api' }, { name: 'Enrollment' }, { name: 'ui-web' }, { name: 'payments-api' }, { name: 'mystery' }] },
    };
    expect(readRepoComponentNames(issue, getKind)).toEqual(['payments-api', 'ui-web']);
  });

  it('returns [] when the issue has no components or is undefined', () => {
    expect(readRepoComponentNames(undefined, getKind)).toEqual([]);
    expect(readRepoComponentNames({ fields: { components: null } }, getKind)).toEqual([]);
  });
});

describe('deriveSprints', () => {
  it('splits the PI window into sequential sprints', () => {
    const sprints = deriveSprints('2026-05-21', '2026-06-17', 14);
    expect(sprints).toHaveLength(2);
    expect(sprints[0]).toEqual({ name: 'Sprint 1', startIso: '2026-05-21', endIso: '2026-06-03' });
    expect(sprints[1].name).toBe('Sprint 2');
  });
});
