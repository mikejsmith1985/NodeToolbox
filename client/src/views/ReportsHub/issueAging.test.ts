// Tests for the open-item Aging pure compute module. The engine groups a team's NOT-Done issues by
// issue type and reports, per type, the count and the average / median / oldest AGE in calendar days
// since each issue was CREATED, the key of the single oldest issue, and a spread of ages across fixed
// day-range buckets — plus an overall "All" aggregate row. Everything is derived deterministically from
// an injected `todayIso`, so identical input always yields identical output.

import { describe, expect, it } from 'vitest';

import { computeIssueAging } from './issueAging.ts';
import type { IssueAgingIssueInput } from './issueAging.ts';

// A fixed anchor day so every age assertion is hand-computable. Ages are simple day differences from this.
const TODAY_ISO = '2026-07-09';

/** Builds an issue created a whole number of days before TODAY_ISO, so its age equals `ageDays` exactly. */
function issueAgedDays(key: string, issueType: string, ageDays: number): IssueAgingIssueInput {
  const createdMs = Date.parse(`${TODAY_ISO}T00:00:00.000Z`) - ageDays * 86_400_000;
  return { key, issueType, createdIso: new Date(createdMs).toISOString() };
}

describe('computeIssueAging', () => {
  it('returns zeros and nulls for empty input', () => {
    const result = computeIssueAging({ issues: [], todayIso: TODAY_ISO });
    expect(result.totalCount).toBe(0);
    expect(result.overallAverageAgeDays).toBeNull();
    expect(result.byType).toEqual([]);
    expect(result.overall).toMatchObject({ issueType: 'All', count: 0, oldestIssueKey: null });
    expect(result.overall.buckets).toEqual({
      ageZeroToSeven: 0, ageEightToThirty: 0, ageThirtyOneToNinety: 0, ageOverNinety: 0,
    });
  });

  it('computes calendar-day age from a fixed today for a single issue', () => {
    const result = computeIssueAging({
      issues: [issueAgedDays('T-1', 'Story', 10)],
      todayIso: TODAY_ISO,
    });
    expect(result.totalCount).toBe(1);
    expect(result.byType[0].oldestAgeDays).toBe(10);
    expect(result.byType[0].averageAgeDays).toBe(10);
    expect(result.overallAverageAgeDays).toBe(10);
  });

  it('floors a future-dated creation at zero rather than reporting a negative age', () => {
    const result = computeIssueAging({
      issues: [issueAgedDays('T-1', 'Bug', -5)], // created 5 days in the FUTURE
      todayIso: TODAY_ISO,
    });
    expect(result.byType[0].oldestAgeDays).toBe(0);
    expect(result.byType[0].buckets.ageZeroToSeven).toBe(1);
  });

  it('groups by exact issue type and computes average, median, and oldest per type', () => {
    const result = computeIssueAging({
      issues: [
        issueAgedDays('S-1', 'Story', 2),
        issueAgedDays('S-2', 'Story', 4),
        issueAgedDays('S-3', 'Story', 9),
        issueAgedDays('B-1', 'Bug', 20),
      ],
      todayIso: TODAY_ISO,
    });
    const story = result.byType.find((row) => row.issueType === 'Story');
    const bug = result.byType.find((row) => row.issueType === 'Bug');
    expect(story).toMatchObject({ count: 3, averageAgeDays: 5, medianAgeDays: 4, oldestAgeDays: 9 });
    expect(bug).toMatchObject({ count: 1, averageAgeDays: 20, medianAgeDays: 20, oldestAgeDays: 20 });
  });

  it('takes the median of two middle ages as their mean for an even count', () => {
    const result = computeIssueAging({
      issues: [
        issueAgedDays('T-1', 'Task', 2),
        issueAgedDays('T-2', 'Task', 4),
        issueAgedDays('T-3', 'Task', 6),
        issueAgedDays('T-4', 'Task', 10),
      ],
      todayIso: TODAY_ISO,
    });
    expect(result.byType[0].medianAgeDays).toBe(5); // (4 + 6) / 2
  });

  it('counts a null-created issue toward its type but adds no age to the statistics or buckets', () => {
    const result = computeIssueAging({
      issues: [
        issueAgedDays('S-1', 'Story', 8),
        { key: 'S-NULL', issueType: 'Story', createdIso: null },
        { key: 'S-BAD', issueType: 'Story', createdIso: 'not-a-date' },
      ],
      todayIso: TODAY_ISO,
    });
    const story = result.byType[0];
    expect(story.count).toBe(3); // all three counted
    expect(story.averageAgeDays).toBe(8); // only the one measurable age contributes
    expect(story.oldestAgeDays).toBe(8);
    expect(story.oldestIssueKey).toBe('S-1'); // the null-created issues are never the oldest
    // Only the one aged issue is bucketed; the two undated issues are excluded from the spread.
    expect(story.buckets).toEqual({
      ageZeroToSeven: 0, ageEightToThirty: 1, ageThirtyOneToNinety: 0, ageOverNinety: 0,
    });
    expect(result.overallAverageAgeDays).toBe(8);
  });

  it('reports null age statistics for a type whose issues all lack a created date', () => {
    const result = computeIssueAging({
      issues: [{ key: 'B-1', issueType: 'Bug', createdIso: null }],
      todayIso: TODAY_ISO,
    });
    expect(result.byType[0]).toMatchObject({
      count: 1,
      averageAgeDays: null,
      medianAgeDays: null,
      oldestAgeDays: null,
      oldestIssueKey: null,
    });
    expect(result.overallAverageAgeDays).toBeNull();
  });

  it('files a blank issue type under the Unknown label', () => {
    const result = computeIssueAging({
      issues: [{ key: 'X-1', issueType: '  ', createdIso: null }],
      todayIso: TODAY_ISO,
    });
    expect(result.byType[0].issueType).toBe('Unknown');
  });

  it('sorts byType by average age descending, with null averages last and a name tie-break', () => {
    const result = computeIssueAging({
      issues: [
        issueAgedDays('S-1', 'Story', 5), // avg 5
        issueAgedDays('B-1', 'Bug', 30), // avg 30
        issueAgedDays('T-1', 'Task', 5), // avg 5 — ties Story, so name breaks it (Story < Task)
        { key: 'SP-1', issueType: 'Spike', createdIso: null }, // null avg — sorts last
      ],
      todayIso: TODAY_ISO,
    });
    expect(result.byType.map((row) => row.issueType)).toEqual(['Bug', 'Story', 'Task', 'Spike']);
  });

  it('computes the overall average across every measurable age regardless of type', () => {
    const result = computeIssueAging({
      issues: [
        issueAgedDays('S-1', 'Story', 10),
        issueAgedDays('B-1', 'Bug', 20),
        issueAgedDays('T-1', 'Task', 30),
      ],
      todayIso: TODAY_ISO,
    });
    expect(result.overallAverageAgeDays).toBe(20); // (10 + 20 + 30) / 3
  });

  // ── Bucket boundary rules ──────────────────────────────────────────────────

  it('places ages exactly on 7, 30, and 90 in the LOWER bucket, and 91 in the over-90 bucket', () => {
    const result = computeIssueAging({
      issues: [
        issueAgedDays('A-1', 'Story', 7), // ≤ 7 → ageZeroToSeven
        issueAgedDays('A-2', 'Story', 30), // ≤ 30 → ageEightToThirty
        issueAgedDays('A-3', 'Story', 90), // ≤ 90 → ageThirtyOneToNinety
        issueAgedDays('A-4', 'Story', 91), // > 90 → ageOverNinety
      ],
      todayIso: TODAY_ISO,
    });
    expect(result.byType[0].buckets).toEqual({
      ageZeroToSeven: 1, ageEightToThirty: 1, ageThirtyOneToNinety: 1, ageOverNinety: 1,
    });
  });

  it('places an age just past a boundary (8, 31) in the next-higher bucket', () => {
    const result = computeIssueAging({
      issues: [
        issueAgedDays('A-1', 'Story', 8), // 7 < 8 → ageEightToThirty
        issueAgedDays('A-2', 'Story', 31), // 30 < 31 → ageThirtyOneToNinety
      ],
      todayIso: TODAY_ISO,
    });
    expect(result.byType[0].buckets).toMatchObject({ ageEightToThirty: 1, ageThirtyOneToNinety: 1 });
  });

  it('picks the max-age issue key as oldestIssueKey even when it is not last in input order', () => {
    const result = computeIssueAging({
      issues: [
        issueAgedDays('S-OLDEST', 'Story', 200), // the max age, but listed first
        issueAgedDays('S-2', 'Story', 5),
        issueAgedDays('S-3', 'Story', 50),
      ],
      todayIso: TODAY_ISO,
    });
    expect(result.byType[0].oldestAgeDays).toBe(200);
    expect(result.byType[0].oldestIssueKey).toBe('S-OLDEST');
  });

  // ── Overall aggregate row ──────────────────────────────────────────────────

  it('aggregates the overall "All" row across all types: count = totalCount, buckets = sum of per-type buckets', () => {
    const result = computeIssueAging({
      issues: [
        issueAgedDays('S-1', 'Story', 3), // 0–7
        issueAgedDays('S-2', 'Story', 15), // 8–30
        issueAgedDays('B-1', 'Bug', 60), // 31–90
        issueAgedDays('B-2', 'Bug', 120), // 90+
        { key: 'T-NULL', issueType: 'Task', createdIso: null }, // counts, not bucketed
      ],
      todayIso: TODAY_ISO,
    });

    expect(result.overall.issueType).toBe('All');
    expect(result.overall.count).toBe(result.totalCount);
    expect(result.overall.count).toBe(5);
    expect(result.overall.oldestAgeDays).toBe(120);
    expect(result.overall.oldestIssueKey).toBe('B-2');

    // The overall buckets equal the element-wise sum of every per-type bucket.
    const summedBuckets = result.byType.reduce(
      (running, row) => ({
        ageZeroToSeven: running.ageZeroToSeven + row.buckets.ageZeroToSeven,
        ageEightToThirty: running.ageEightToThirty + row.buckets.ageEightToThirty,
        ageThirtyOneToNinety: running.ageThirtyOneToNinety + row.buckets.ageThirtyOneToNinety,
        ageOverNinety: running.ageOverNinety + row.buckets.ageOverNinety,
      }),
      { ageZeroToSeven: 0, ageEightToThirty: 0, ageThirtyOneToNinety: 0, ageOverNinety: 0 },
    );
    expect(result.overall.buckets).toEqual(summedBuckets);
    expect(result.overall.buckets).toEqual({
      ageZeroToSeven: 1, ageEightToThirty: 1, ageThirtyOneToNinety: 1, ageOverNinety: 1,
    });
  });
});
