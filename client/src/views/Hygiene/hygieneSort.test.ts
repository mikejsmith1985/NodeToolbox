// hygieneSort.test.ts — Unit tests for the hygiene findings sort comparators.

import { describe, expect, it } from 'vitest';

import { sortHygieneFindings, HYGIENE_SORT_OPTIONS } from './hygieneSort.ts';
import type { HygieneFinding } from './checks/hygieneChecks.ts';

/** Builds a minimal finding with just the fields the comparators read. */
function buildFinding(
  issueKey: string,
  fields: Record<string, unknown> = {},
): HygieneFinding {
  return {
    issue: { key: issueKey, fields: { summary: `Finding ${issueKey}`, ...fields } },
    flags: [],
  } as unknown as HygieneFinding;
}

function readKeys(findings: HygieneFinding[]): string[] {
  return findings.map((finding) => finding.issue.key);
}

describe('sortHygieneFindings', () => {
  it('offers exactly the requested sort dimensions plus the default scan order', () => {
    expect(HYGIENE_SORT_OPTIONS.map((option) => option.value)).toEqual([
      'scan',
      'status',
      'assignee',
      'issueType',
      'age',
    ]);
  });

  it('keeps the scan order untouched for the default key and never mutates the input', () => {
    const findings = [buildFinding('B-2'), buildFinding('A-1')];

    const sorted = sortHygieneFindings(findings, 'scan');

    expect(readKeys(sorted)).toEqual(['B-2', 'A-1']);
    expect(sorted).not.toBe(findings);
  });

  it('sorts by status name alphabetically, grouping like statuses; missing status sorts last', () => {
    const findings = [
      buildFinding('T-1', { status: { name: 'Ready to Accept' } }),
      buildFinding('T-2', {}),
      buildFinding('T-3', { status: { name: 'In Progress' } }),
      buildFinding('T-4', { status: { name: 'In Progress' } }),
    ];

    expect(readKeys(sortHygieneFindings(findings, 'status'))).toEqual(['T-3', 'T-4', 'T-1', 'T-2']);
  });

  it('sorts by assignee display name; unassigned sorts last', () => {
    const findings = [
      buildFinding('T-1', { assignee: { displayName: 'Katkar, Rahul (CTR)' } }),
      buildFinding('T-2', { assignee: null }),
      buildFinding('T-3', { assignee: { displayName: 'Adams, Jo' } }),
    ];

    expect(readKeys(sortHygieneFindings(findings, 'assignee'))).toEqual(['T-3', 'T-1', 'T-2']);
  });

  it('sorts by issue type name; missing type sorts last', () => {
    const findings = [
      buildFinding('T-1', { issuetype: { name: 'Story' } }),
      buildFinding('T-2', { issuetype: { name: 'Defect' } }),
      buildFinding('T-3', {}),
    ];

    expect(readKeys(sortHygieneFindings(findings, 'issueType'))).toEqual(['T-2', 'T-1', 'T-3']);
  });

  it('sorts by age with the longest-idle finding first, reading updated before created', () => {
    const findings = [
      // Updated recently even though created long ago — the idle clock reads `updated`.
      buildFinding('T-1', { created: '2026-01-01T00:00:00.000Z', updated: '2026-07-10T00:00:00.000Z' }),
      buildFinding('T-2', { created: '2026-06-01T00:00:00.000Z' }),
      buildFinding('T-3', { created: '2026-03-01T00:00:00.000Z', updated: '2026-03-02T00:00:00.000Z' }),
    ];

    expect(readKeys(sortHygieneFindings(findings, 'age'))).toEqual(['T-3', 'T-2', 'T-1']);
  });

  it('sorts findings with no usable date last under the age sort', () => {
    const findings = [
      buildFinding('T-1', {}),
      buildFinding('T-2', { updated: '2026-05-01T00:00:00.000Z' }),
    ];

    expect(readKeys(sortHygieneFindings(findings, 'age'))).toEqual(['T-2', 'T-1']);
  });

  it('is stable: findings that compare equal keep their scan order', () => {
    const findings = [
      buildFinding('T-1', { status: { name: 'In Progress' } }),
      buildFinding('T-2', { status: { name: 'In Progress' } }),
      buildFinding('T-3', { status: { name: 'In Progress' } }),
    ];

    expect(readKeys(sortHygieneFindings(findings, 'status'))).toEqual(['T-1', 'T-2', 'T-3']);
  });
});
