// Tests for the Personal Flow pure compute module: throughput (issues + story
// points over a lookback window) and cycle time (in-progress -> done) for one
// person, derived deterministically from their closed issues' changelogs.

import { describe, expect, it } from 'vitest';

import { computePersonalFlow } from './personalFlow.ts';
import type { PersonalFlowInput, PersonalFlowIssue } from './personalFlow.ts';

// ── Shared fixtures ──────────────────────────────────────────────────────────

// Status ids mapped to Jira status category keys, so tests read declaratively.
const STATUS_CATEGORY_BY_ID: Record<string, string> = {
  todo: 'new',
  inProgress: 'indeterminate',
  review: 'indeterminate',
  done: 'done',
  released: 'done',
  mystery: 'nonsense-category', // exercises the "unknown -> treated as new" rule
};

// A fixed anchor day so every window/throughput assertion is hand-computable.
const TODAY_ISO = '2026-07-08';

/** Builds a PersonalFlowInput with sensible defaults so each test overrides only what it needs. */
function makeInput(
  issues: PersonalFlowIssue[],
  overrides: Partial<PersonalFlowInput> = {},
): PersonalFlowInput {
  return {
    issues,
    statusCategoryByStatusId: STATUS_CATEGORY_BY_ID,
    windowDays: 90,
    todayIso: TODAY_ISO,
    ...overrides,
  };
}

describe('computePersonalFlow — window filtering', () => {
  it('keeps issues resolved within the window and drops older ones', () => {
    const insideIssue: PersonalFlowIssue = {
      key: 'A-1',
      summary: 'Inside the window',
      storyPoints: 3,
      resolvedIso: '2026-06-01', // 37 days before today — inside 90-day window
      transitions: [],
    };
    const outsideIssue: PersonalFlowIssue = {
      key: 'A-2',
      summary: 'Outside the window',
      storyPoints: 5,
      resolvedIso: '2026-01-01', // ~188 days before today — outside 90-day window
      transitions: [],
    };

    const result = computePersonalFlow(makeInput([insideIssue, outsideIssue]));

    expect(result.issueCount).toBe(1);
    expect(result.perIssue.map((row) => row.key)).toEqual(['A-1']);
  });

  it('drops issues with null or unparseable resolvedIso', () => {
    const nullResolved: PersonalFlowIssue = {
      key: 'B-1',
      summary: 'Never resolved',
      storyPoints: 8,
      resolvedIso: null,
      transitions: [],
    };
    const garbageResolved: PersonalFlowIssue = {
      key: 'B-2',
      summary: 'Bad date',
      storyPoints: 8,
      resolvedIso: 'not-a-date',
      transitions: [],
    };

    const result = computePersonalFlow(makeInput([nullResolved, garbageResolved]));

    expect(result.issueCount).toBe(0);
    expect(result.totalStoryPoints).toBe(0);
  });

  it('includes issues resolved exactly on the window boundaries (inclusive)', () => {
    const onTodayIssue: PersonalFlowIssue = {
      key: 'C-1',
      summary: 'Resolved today',
      storyPoints: 1,
      resolvedIso: '2026-07-08',
      transitions: [],
    };
    const onEdgeIssue: PersonalFlowIssue = {
      key: 'C-2',
      summary: 'Resolved on the far edge',
      storyPoints: 1,
      resolvedIso: '2026-04-09', // exactly 90 days before 2026-07-08
      transitions: [],
    };

    const result = computePersonalFlow(makeInput([onTodayIssue, onEdgeIssue]));

    expect(result.issueCount).toBe(2);
  });
});

describe('computePersonalFlow — throughput math', () => {
  it('computes issues and points per day / week / two weeks', () => {
    // Three in-window issues, story points 2 + 4 + 6 = 12, over a 30-day window.
    const issues: PersonalFlowIssue[] = [
      { key: 'T-1', summary: 'One', storyPoints: 2, resolvedIso: '2026-07-01', transitions: [] },
      { key: 'T-2', summary: 'Two', storyPoints: 4, resolvedIso: '2026-07-02', transitions: [] },
      { key: 'T-3', summary: 'Three', storyPoints: 6, resolvedIso: '2026-07-03', transitions: [] },
    ];

    const result = computePersonalFlow(makeInput(issues, { windowDays: 30 }));

    expect(result.issueCount).toBe(3);
    expect(result.totalStoryPoints).toBe(12);

    // Issues: 3 / 30 = 0.1 per day.
    expect(result.throughput.issuesPerDay).toBeCloseTo(0.1, 10);
    expect(result.throughput.issuesPerWeek).toBeCloseTo(0.7, 10);
    expect(result.throughput.issuesPerTwoWeeks).toBeCloseTo(1.4, 10);

    // Points: 12 / 30 = 0.4 per day.
    expect(result.throughput.pointsPerDay).toBeCloseTo(0.4, 10);
    expect(result.throughput.pointsPerWeek).toBeCloseTo(2.8, 10);
    expect(result.throughput.pointsPerTwoWeeks).toBeCloseTo(5.6, 10);
  });

  it('treats null story points as zero when summing', () => {
    const issues: PersonalFlowIssue[] = [
      { key: 'P-1', summary: 'Has points', storyPoints: 5, resolvedIso: '2026-07-01', transitions: [] },
      { key: 'P-2', summary: 'No points', storyPoints: null, resolvedIso: '2026-07-02', transitions: [] },
    ];

    const result = computePersonalFlow(makeInput(issues));

    expect(result.totalStoryPoints).toBe(5);
  });
});

describe('computePersonalFlow — cycle time from transitions', () => {
  it('measures first in-progress to last done', () => {
    const issue: PersonalFlowIssue = {
      key: 'CT-1',
      summary: 'Full lifecycle',
      storyPoints: 3,
      resolvedIso: '2026-07-06',
      transitions: [
        { toStatusId: 'todo', atIso: '2026-07-01' },
        { toStatusId: 'inProgress', atIso: '2026-07-02' }, // first in-progress
        { toStatusId: 'review', atIso: '2026-07-03' }, // also in-progress, later — must NOT win
        { toStatusId: 'done', atIso: '2026-07-05' },
        { toStatusId: 'released', atIso: '2026-07-06' }, // last done — wins
      ],
    };

    const result = computePersonalFlow(makeInput([issue]));

    // 2026-07-02 -> 2026-07-06 = 4 calendar days.
    expect(result.perIssue[0].cycleTimeDays).toBeCloseTo(4, 10);
    expect(result.cycleTime.countWithCycleTime).toBe(1);
    expect(result.cycleTime.averageDays).toBeCloseTo(4, 10);
    expect(result.cycleTime.medianDays).toBeCloseTo(4, 10);
  });

  it('falls back to resolvedIso when there is no done transition', () => {
    const issue: PersonalFlowIssue = {
      key: 'CT-2',
      summary: 'No done transition',
      storyPoints: 2,
      resolvedIso: '2026-07-05',
      transitions: [
        { toStatusId: 'inProgress', atIso: '2026-07-01' },
        { toStatusId: 'review', atIso: '2026-07-02' },
      ],
    };

    const result = computePersonalFlow(makeInput([issue]));

    // 2026-07-01 -> resolvedIso 2026-07-05 = 4 days.
    expect(result.perIssue[0].cycleTimeDays).toBeCloseTo(4, 10);
  });

  it('yields null cycle time when the issue never entered in-progress', () => {
    const issue: PersonalFlowIssue = {
      key: 'CT-3',
      summary: 'Straight to done',
      storyPoints: 1,
      resolvedIso: '2026-07-05',
      transitions: [
        { toStatusId: 'todo', atIso: '2026-07-01' },
        { toStatusId: 'done', atIso: '2026-07-05' },
      ],
    };

    const result = computePersonalFlow(makeInput([issue]));

    expect(result.perIssue[0].cycleTimeDays).toBeNull();
    expect(result.cycleTime.countWithCycleTime).toBe(0);
    expect(result.cycleTime.averageDays).toBeNull();
    expect(result.cycleTime.medianDays).toBeNull();
  });

  it('keeps fractional cycle-time days (does not floor)', () => {
    const issue: PersonalFlowIssue = {
      key: 'CT-4',
      summary: 'Half a day',
      storyPoints: 1,
      resolvedIso: '2026-07-02',
      transitions: [
        { toStatusId: 'inProgress', atIso: '2026-07-01T00:00:00.000Z' },
        { toStatusId: 'done', atIso: '2026-07-01T12:00:00.000Z' },
      ],
    };

    const result = computePersonalFlow(makeInput([issue]));

    expect(result.perIssue[0].cycleTimeDays).toBeCloseTo(0.5, 10);
  });

  it('yields null cycle time when done precedes the in-progress start', () => {
    const issue: PersonalFlowIssue = {
      key: 'CT-5',
      summary: 'Out-of-order changelog',
      storyPoints: 1,
      resolvedIso: '2026-07-05',
      transitions: [
        { toStatusId: 'done', atIso: '2026-07-01' }, // done before in-progress
        { toStatusId: 'inProgress', atIso: '2026-07-04' },
      ],
    };

    const result = computePersonalFlow(makeInput([issue]));

    expect(result.perIssue[0].cycleTimeDays).toBeNull();
  });

  it('treats an unknown status id as new (neither in-progress nor done)', () => {
    const issue: PersonalFlowIssue = {
      key: 'CT-6',
      summary: 'Unknown status only',
      storyPoints: 1,
      resolvedIso: '2026-07-05',
      transitions: [
        { toStatusId: 'mystery', atIso: '2026-07-01' }, // unknown category -> new
      ],
    };

    const result = computePersonalFlow(makeInput([issue]));

    // No in-progress start -> null cycle time; the unknown status is ignored.
    expect(result.perIssue[0].cycleTimeDays).toBeNull();
  });
});

describe('computePersonalFlow — median', () => {
  it('takes the middle value for an odd count', () => {
    // Cycle times of 2, 4, 9 days -> median 4. All resolved dates stay in-window.
    const issues: PersonalFlowIssue[] = [
      buildCycleIssue('M-1', '2026-06-22', '2026-06-20', '2026-06-22'), // 2 days
      buildCycleIssue('M-2', '2026-06-24', '2026-06-20', '2026-06-24'), // 4 days
      buildCycleIssue('M-3', '2026-06-29', '2026-06-20', '2026-06-29'), // 9 days
    ];

    const result = computePersonalFlow(makeInput(issues));

    expect(result.cycleTime.countWithCycleTime).toBe(3);
    expect(result.cycleTime.medianDays).toBeCloseTo(4, 10);
    expect(result.cycleTime.averageDays).toBeCloseTo(5, 10); // (2+4+9)/3
  });

  it('averages the two middle values for an even count', () => {
    // Cycle times of 2, 4, 6, 10 days -> median (4+6)/2 = 5. All resolved in-window.
    const issues: PersonalFlowIssue[] = [
      buildCycleIssue('M-4', '2026-06-22', '2026-06-20', '2026-06-22'), // 2 days
      buildCycleIssue('M-5', '2026-06-24', '2026-06-20', '2026-06-24'), // 4 days
      buildCycleIssue('M-6', '2026-06-26', '2026-06-20', '2026-06-26'), // 6 days
      buildCycleIssue('M-7', '2026-06-30', '2026-06-20', '2026-06-30'), // 10 days
    ];

    const result = computePersonalFlow(makeInput(issues));

    expect(result.cycleTime.countWithCycleTime).toBe(4);
    expect(result.cycleTime.medianDays).toBeCloseTo(5, 10);
    expect(result.cycleTime.averageDays).toBeCloseTo(5.5, 10); // (2+4+6+10)/4
  });
});

/** Builds an issue whose single in-progress and done transitions yield a known cycle time. */
function buildCycleIssue(
  key: string,
  resolvedIso: string,
  inProgressIso: string,
  doneIso: string,
): PersonalFlowIssue {
  return {
    key,
    summary: `Cycle issue ${key}`,
    storyPoints: 1,
    resolvedIso,
    transitions: [
      { toStatusId: 'inProgress', atIso: inProgressIso },
      { toStatusId: 'done', atIso: doneIso },
    ],
  };
}

describe('computePersonalFlow — ordering', () => {
  it('sorts perIssue by resolvedIso descending, tie-breaking by key', () => {
    const issues: PersonalFlowIssue[] = [
      { key: 'O-3', summary: 'Oldest', storyPoints: 1, resolvedIso: '2026-07-01', transitions: [] },
      { key: 'O-1', summary: 'Newest A', storyPoints: 1, resolvedIso: '2026-07-05', transitions: [] },
      { key: 'O-2', summary: 'Newest B', storyPoints: 1, resolvedIso: '2026-07-05', transitions: [] },
    ];

    const result = computePersonalFlow(makeInput(issues));

    // Same resolved date -> tie-break by key ascending, then the older issue last.
    expect(result.perIssue.map((row) => row.key)).toEqual(['O-1', 'O-2', 'O-3']);
  });
});

describe('computePersonalFlow — determinism', () => {
  it('returns deeply equal results for the same input and today', () => {
    const issues: PersonalFlowIssue[] = [
      buildCycleIssue('D-1', '2026-07-03', '2026-07-01', '2026-07-03'),
      buildCycleIssue('D-2', '2026-07-06', '2026-07-02', '2026-07-06'),
    ];

    const firstResult = computePersonalFlow(makeInput(issues));
    const secondResult = computePersonalFlow(makeInput(issues));

    expect(firstResult).toEqual(secondResult);
  });
});

describe('computePersonalFlow — edge cases', () => {
  it('returns zeros and null cycle time for empty input', () => {
    const result = computePersonalFlow(makeInput([]));

    expect(result.issueCount).toBe(0);
    expect(result.totalStoryPoints).toBe(0);
    expect(result.throughput).toEqual({
      issuesPerDay: 0,
      issuesPerWeek: 0,
      issuesPerTwoWeeks: 0,
      pointsPerDay: 0,
      pointsPerWeek: 0,
      pointsPerTwoWeeks: 0,
    });
    expect(result.cycleTime).toEqual({
      averageDays: null,
      medianDays: null,
      countWithCycleTime: 0,
    });
    expect(result.perIssue).toEqual([]);
  });

  it('clamps a non-positive windowDays to 1 to avoid divide-by-zero', () => {
    const issues: PersonalFlowIssue[] = [
      { key: 'W-1', summary: 'Only issue', storyPoints: 3, resolvedIso: '2026-07-08', transitions: [] },
    ];

    const result = computePersonalFlow(makeInput(issues, { windowDays: 0 }));

    // Window clamped to 1 day; 1 issue / 1 day = 1 per day, 3 points / 1 day = 3 per day.
    expect(result.windowDays).toBe(1);
    expect(result.throughput.issuesPerDay).toBeCloseTo(1, 10);
    expect(result.throughput.pointsPerDay).toBeCloseTo(3, 10);
  });
});
