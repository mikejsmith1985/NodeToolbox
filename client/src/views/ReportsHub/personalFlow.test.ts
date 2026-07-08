// Tests for the Personal Flow pure compute module. The engine credits a person's
// HANDS-ON in-progress time per issue (reassignment-aware, counted in Mon–Fri
// working days) toward cycle time, and credits throughput for every issue she
// moved forward — not only tickets she personally closed. Everything is derived
// deterministically from an injected `todayIso` plus each issue's reconstructed
// status-category and ownership timelines.

import { describe, expect, it } from 'vitest';

import { businessMillisBetween, computePersonalFlow } from './personalFlow.ts';
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

// A fixed anchor day so every window / working-day assertion is hand-computable.
// 2026-07-08 is a Wednesday; 2026-07-01 is a Wednesday and 2026-07-03 a Friday.
const TODAY_ISO = '2026-07-08';

// Milliseconds in one calendar day, mirrored here so tests can convert freely.
const MILLISECONDS_PER_DAY = 86_400_000;

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

/** Builds a PersonalFlowIssue with defaults, so a test states only the fields it cares about. */
function makeFlowIssue(overrides: Partial<PersonalFlowIssue> & { key: string }): PersonalFlowIssue {
  return {
    key: overrides.key,
    summary: overrides.summary ?? `Issue ${overrides.key}`,
    storyPoints: 'storyPoints' in overrides ? (overrides.storyPoints as number | null) : 1,
    createdIso: overrides.createdIso ?? '2026-06-20T00:00:00.000Z',
    initialStatusId: overrides.initialStatusId ?? 'inProgress',
    statusTransitions: overrides.statusTransitions ?? [],
    initiallyAssignedToTarget: overrides.initiallyAssignedToTarget ?? false,
    ownershipTransitions: overrides.ownershipTransitions ?? [],
  };
}

// ── businessMillisBetween ────────────────────────────────────────────────────

describe('businessMillisBetween', () => {
  it('counts a Wed→Fri span as 2 business days', () => {
    const wednesdayMidnight = Date.parse('2026-07-01T00:00:00.000Z'); // Wed
    const fridayMidnight = Date.parse('2026-07-03T00:00:00.000Z'); // Fri
    const businessDays = businessMillisBetween(wednesdayMidnight, fridayMidnight) / MILLISECONDS_PER_DAY;
    expect(businessDays).toBeCloseTo(2, 10);
  });

  it('counts a Fri→Mon span as 1 business day (weekend excluded)', () => {
    const fridayMidnight = Date.parse('2026-07-03T00:00:00.000Z'); // Fri
    const mondayMidnight = Date.parse('2026-07-06T00:00:00.000Z'); // Mon
    const businessDays = businessMillisBetween(fridayMidnight, mondayMidnight) / MILLISECONDS_PER_DAY;
    expect(businessDays).toBeCloseTo(1, 10);
  });

  it('counts a Sat→Sun span as 0 business days', () => {
    const saturdayMidnight = Date.parse('2026-07-04T00:00:00.000Z'); // Sat
    const sundayMidnight = Date.parse('2026-07-05T00:00:00.000Z'); // Sun
    expect(businessMillisBetween(saturdayMidnight, sundayMidnight)).toBe(0);
  });

  it('returns 0 when the end is not after the start', () => {
    const noon = Date.parse('2026-07-01T12:00:00.000Z');
    expect(businessMillisBetween(noon, noon)).toBe(0);
    expect(businessMillisBetween(noon + 1, noon)).toBe(0);
  });

  it('counts partial business days proportionally', () => {
    const wednesdayMidnight = Date.parse('2026-07-01T00:00:00.000Z'); // Wed
    const wednesdayNoon = Date.parse('2026-07-01T12:00:00.000Z');
    const businessDays = businessMillisBetween(wednesdayMidnight, wednesdayNoon) / MILLISECONDS_PER_DAY;
    expect(businessDays).toBeCloseTo(0.5, 10);
  });
});

// ── The user's scenario (reassignment-aware hands-on time) ───────────────────

describe('computePersonalFlow — hands-on time credited across ownership', () => {
  it('credits 2 business days for an in-progress issue held Wed→Fri then reassigned away', () => {
    const issue = makeFlowIssue({
      key: 'HANDS-1',
      storyPoints: 5,
      createdIso: '2026-06-30T00:00:00.000Z',
      initialStatusId: 'inProgress', // indeterminate for its whole life
      initiallyAssignedToTarget: false,
      ownershipTransitions: [
        { assignedToTarget: true, atIso: '2026-07-01T00:00:00.000Z' }, // gains it Wed
        { assignedToTarget: false, atIso: '2026-07-03T00:00:00.000Z' }, // loses it Fri
      ],
    });

    const result = computePersonalFlow(makeInput([issue]));

    expect(result.issueCount).toBe(1);
    expect(result.perIssue[0].cycleTimeDays).toBeCloseTo(2, 10);
    expect(result.perIssue[0].lastActiveIso?.slice(0, 10)).toBe('2026-07-03');
    expect(result.totalStoryPoints).toBe(5);
  });

  it('excludes an issue she held only while it sat in a "new" status (no hands-on time)', () => {
    const issue = makeFlowIssue({
      key: 'NEW-1',
      initialStatusId: 'todo', // new the whole time — never in progress
      ownershipTransitions: [
        { assignedToTarget: true, atIso: '2026-07-01T00:00:00.000Z' },
        { assignedToTarget: false, atIso: '2026-07-03T00:00:00.000Z' },
      ],
    });

    const result = computePersonalFlow(makeInput([issue]));

    expect(result.issueCount).toBe(0);
    expect(result.perIssue).toEqual([]);
  });

  it('excludes an issue she still holds that never reached done (open interval)', () => {
    const issue = makeFlowIssue({
      key: 'OPEN-1',
      initialStatusId: 'inProgress',
      initiallyAssignedToTarget: true,
      ownershipTransitions: [], // never handed off
      statusTransitions: [], // never done
    });

    const result = computePersonalFlow(makeInput([issue]));

    expect(result.issueCount).toBe(0);
  });

  it('counts an issue she closed herself, dated at the done moment', () => {
    const issue = makeFlowIssue({
      key: 'CLOSED-1',
      createdIso: '2026-06-30T00:00:00.000Z',
      initialStatusId: 'inProgress',
      initiallyAssignedToTarget: true,
      statusTransitions: [{ toStatusId: 'done', atIso: '2026-07-06T00:00:00.000Z' }], // Mon
    });

    const result = computePersonalFlow(makeInput([issue]));

    expect(result.issueCount).toBe(1);
    // Indeterminate business days 06-30(Tue),07-01,02,03 = 4 before the Mon done moment.
    expect(result.perIssue[0].cycleTimeDays).toBeCloseTo(4, 10);
    expect(result.perIssue[0].lastActiveIso?.slice(0, 10)).toBe('2026-07-06');
  });

  it('sums hands-on time across multiple ownership stints on the same issue', () => {
    const issue = makeFlowIssue({
      key: 'STINTS-1',
      createdIso: '2026-06-20T00:00:00.000Z',
      initialStatusId: 'inProgress',
      initiallyAssignedToTarget: false,
      ownershipTransitions: [
        { assignedToTarget: true, atIso: '2026-06-24T00:00:00.000Z' }, // Wed
        { assignedToTarget: false, atIso: '2026-06-26T00:00:00.000Z' }, // Fri (stint 1 = 2 days)
        { assignedToTarget: true, atIso: '2026-06-29T00:00:00.000Z' }, // Mon
        { assignedToTarget: false, atIso: '2026-07-01T00:00:00.000Z' }, // Wed (stint 2 = 2 days)
      ],
    });

    const result = computePersonalFlow(makeInput([issue]));

    expect(result.issueCount).toBe(1);
    expect(result.perIssue[0].cycleTimeDays).toBeCloseTo(4, 10); // 2 + 2 business days
    expect(result.perIssue[0].lastActiveIso?.slice(0, 10)).toBe('2026-07-01');
  });
});

// ── Window filtering (by completed interval end) ─────────────────────────────

describe('computePersonalFlow — window filtering', () => {
  it('drops issues whose only completed interval ended before the window', () => {
    const issue = makeFlowIssue({
      key: 'OLD-1',
      createdIso: '2026-04-20T00:00:00.000Z',
      initialStatusId: 'inProgress',
      ownershipTransitions: [
        { assignedToTarget: true, atIso: '2026-04-22T00:00:00.000Z' },
        { assignedToTarget: false, atIso: '2026-05-01T00:00:00.000Z' }, // ended long before a 30-day window
      ],
    });

    const result = computePersonalFlow(makeInput([issue], { windowDays: 30 }));

    expect(result.issueCount).toBe(0);
  });
});

// ── Throughput stays CALENDAR-based ──────────────────────────────────────────

describe('computePersonalFlow — throughput math (calendar days)', () => {
  it('computes issues and points per day / week / two weeks on calendar days', () => {
    const issues = [
      makeFlowIssue({
        key: 'T-1',
        storyPoints: 2,
        initiallyAssignedToTarget: true,
        statusTransitions: [{ toStatusId: 'done', atIso: '2026-07-01T00:00:00.000Z' }],
      }),
      makeFlowIssue({
        key: 'T-2',
        storyPoints: 4,
        initiallyAssignedToTarget: true,
        statusTransitions: [{ toStatusId: 'done', atIso: '2026-07-02T00:00:00.000Z' }],
      }),
    ];

    const result = computePersonalFlow(makeInput(issues, { windowDays: 20 }));

    expect(result.issueCount).toBe(2);
    expect(result.totalStoryPoints).toBe(6);
    // Calendar throughput: 2 issues / 20 days = 0.1 per day (NOT working-day scaled).
    expect(result.throughput.issuesPerDay).toBeCloseTo(0.1, 10);
    expect(result.throughput.issuesPerWeek).toBeCloseTo(0.7, 10);
    expect(result.throughput.issuesPerTwoWeeks).toBeCloseTo(1.4, 10);
    // Points: 6 / 20 = 0.3 per day.
    expect(result.throughput.pointsPerDay).toBeCloseTo(0.3, 10);
    expect(result.throughput.pointsPerWeek).toBeCloseTo(2.1, 10);
    expect(result.throughput.pointsPerTwoWeeks).toBeCloseTo(4.2, 10);
  });

  it('treats null story points as zero when summing', () => {
    const issues = [
      makeFlowIssue({
        key: 'P-1',
        storyPoints: 5,
        initiallyAssignedToTarget: true,
        statusTransitions: [{ toStatusId: 'done', atIso: '2026-07-01T00:00:00.000Z' }],
      }),
      makeFlowIssue({
        key: 'P-2',
        storyPoints: null,
        initiallyAssignedToTarget: true,
        statusTransitions: [{ toStatusId: 'done', atIso: '2026-07-02T00:00:00.000Z' }],
      }),
    ];

    const result = computePersonalFlow(makeInput(issues));

    expect(result.totalStoryPoints).toBe(5);
  });
});

// ── Cycle-time statistics ────────────────────────────────────────────────────

describe('computePersonalFlow — cycle-time statistics', () => {
  it('computes average and median over qualifying issues', () => {
    // Three issues with hands-on business days of 2, 4, 9 -> median 4, average 5.
    const issues = [
      buildBusinessDayIssue('M-1', 2, '2026-06-22T00:00:00.000Z'),
      buildBusinessDayIssue('M-2', 4, '2026-06-23T00:00:00.000Z'),
      buildBusinessDayIssue('M-3', 9, '2026-06-24T00:00:00.000Z'),
    ];

    const result = computePersonalFlow(makeInput(issues));

    expect(result.cycleTime.countWithCycleTime).toBe(3);
    expect(result.cycleTime.medianDays).toBeCloseTo(4, 10);
    expect(result.cycleTime.averageDays).toBeCloseTo(5, 10);
  });
});

/**
 * Builds an issue whose single reassigned-away stint yields exactly the requested
 * number of business days of hands-on time, ending on the given reassign date.
 * The stint starts on the Monday before that many weekdays so the arithmetic is exact.
 */
function buildBusinessDayIssue(key: string, businessDays: number, reassignedIso: string): PersonalFlowIssue {
  // Start the stint enough calendar days earlier that the working-day count lands on target.
  const reassignedMs = Date.parse(reassignedIso);
  // Walk backwards counting only weekdays until we have accumulated `businessDays`.
  let cursorMs = reassignedMs;
  let remaining = businessDays;
  while (remaining > 0) {
    cursorMs -= MILLISECONDS_PER_DAY;
    const dayOfWeek = new Date(cursorMs).getUTCDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      remaining -= 1;
    }
  }
  return makeFlowIssue({
    key,
    createdIso: new Date(cursorMs - MILLISECONDS_PER_DAY).toISOString(),
    initialStatusId: 'inProgress',
    ownershipTransitions: [
      { assignedToTarget: true, atIso: new Date(cursorMs).toISOString() },
      { assignedToTarget: false, atIso: reassignedIso },
    ],
  });
}

// ── Ordering ─────────────────────────────────────────────────────────────────

describe('computePersonalFlow — ordering', () => {
  it('sorts perIssue by lastActiveIso descending, tie-breaking by key ascending', () => {
    const issues = [
      buildReassignedAwayIssue('O-3', '2026-07-01T00:00:00.000Z'),
      buildReassignedAwayIssue('O-1', '2026-07-06T00:00:00.000Z'),
      buildReassignedAwayIssue('O-2', '2026-07-06T00:00:00.000Z'),
    ];

    const result = computePersonalFlow(makeInput(issues));

    expect(result.perIssue.map((row) => row.key)).toEqual(['O-1', 'O-2', 'O-3']);
  });
});

/** Builds an in-progress issue held from a fixed Monday until it is reassigned away on the given date. */
function buildReassignedAwayIssue(key: string, reassignedIso: string): PersonalFlowIssue {
  return makeFlowIssue({
    key,
    createdIso: '2026-06-20T00:00:00.000Z',
    initialStatusId: 'inProgress',
    ownershipTransitions: [
      { assignedToTarget: true, atIso: '2026-06-29T00:00:00.000Z' }, // Mon
      { assignedToTarget: false, atIso: reassignedIso },
    ],
  });
}

// ── Exclusion-reason audit breakdown ─────────────────────────────────────────

describe('computePersonalFlow — per-issue exclusion reasons', () => {
  // A credited issue plus one issue for each exclusion reason, so a single run exercises every branch.
  const creditedIssue = makeFlowIssue({
    key: 'CRED-1',
    storyPoints: 5,
    createdIso: '2026-06-30T00:00:00.000Z',
    initialStatusId: 'inProgress',
    initiallyAssignedToTarget: false,
    ownershipTransitions: [
      { assignedToTarget: true, atIso: '2026-07-01T00:00:00.000Z' }, // gains it Wed
      { assignedToTarget: false, atIso: '2026-07-03T00:00:00.000Z' }, // loses it Fri (2 business days)
    ],
  });
  // Never appears in the ownership timeline — no interval is ever assigned to the target.
  const notOwnedIssue = makeFlowIssue({
    key: 'NOTOWNED-1',
    initialStatusId: 'inProgress',
    initiallyAssignedToTarget: false,
    ownershipTransitions: [],
  });
  // Assigned and in progress, but never handed off and never done — a still-open WIP stint.
  const wipOpenIssue = makeFlowIssue({
    key: 'WIP-1',
    initialStatusId: 'inProgress',
    initiallyAssignedToTarget: true,
    ownershipTransitions: [],
    statusTransitions: [],
  });
  // Owned and reassigned away, but only ever in a "new" status — zero hands-on in-progress time.
  const noInProgressIssue = makeFlowIssue({
    key: 'NOTIME-1',
    initialStatusId: 'todo',
    ownershipTransitions: [
      { assignedToTarget: true, atIso: '2026-07-01T00:00:00.000Z' },
      { assignedToTarget: false, atIso: '2026-07-03T00:00:00.000Z' },
    ],
  });
  // A completed stint whose end (2026-03-01) is long before the 90-day window began (~2026-04-09).
  const outOfWindowIssue = makeFlowIssue({
    key: 'OOW-1',
    createdIso: '2026-02-20T00:00:00.000Z',
    initialStatusId: 'inProgress',
    ownershipTransitions: [
      { assignedToTarget: true, atIso: '2026-02-22T00:00:00.000Z' },
      { assignedToTarget: false, atIso: '2026-03-01T00:00:00.000Z' },
    ],
  });

  it('reports the correct reason for every non-credited issue and credits only the qualifier', () => {
    const result = computePersonalFlow(
      makeInput([creditedIssue, notOwnedIssue, wipOpenIssue, noInProgressIssue, outOfWindowIssue]),
    );

    const reasonByKey = Object.fromEntries(result.excludedIssues.map((row) => [row.key, row.reason]));
    expect(reasonByKey).toEqual({
      'NOTOWNED-1': 'not-owned',
      'WIP-1': 'wip-open',
      'NOTIME-1': 'no-in-progress-time',
      'OOW-1': 'completed-out-of-window',
    });
    expect(result.excludedIssues).toHaveLength(4);
    // Each excluded row carries the issue summary for the audit table.
    expect(result.excludedIssues.find((row) => row.key === 'WIP-1')?.summary).toBe('Issue WIP-1');
  });

  it('leaves the credited issue byte-for-byte unchanged from the pre-audit behaviour', () => {
    const result = computePersonalFlow(
      makeInput([creditedIssue, notOwnedIssue, wipOpenIssue, noInProgressIssue, outOfWindowIssue]),
    );

    // Only the qualifier is credited; the four excluded issues never inflate the counts.
    expect(result.issueCount).toBe(1);
    expect(result.perIssue).toHaveLength(1);
    expect(result.perIssue[0].key).toBe('CRED-1');
    expect(result.perIssue[0].cycleTimeDays).toBeCloseTo(2, 10);
    expect(result.perIssue[0].lastActiveIso?.slice(0, 10)).toBe('2026-07-03');
    expect(result.perIssue[0].storyPoints).toBe(5);
    expect(result.totalStoryPoints).toBe(5);
  });

  it('preserves the original fetch order of the excluded issues (deterministic audit list)', () => {
    // Feed the excluded issues in a scrambled order; the audit must echo that exact order back.
    const scrambledOrder = [outOfWindowIssue, wipOpenIssue, notOwnedIssue, noInProgressIssue];
    const result = computePersonalFlow(makeInput(scrambledOrder));

    expect(result.excludedIssues.map((row) => row.key)).toEqual(['OOW-1', 'WIP-1', 'NOTOWNED-1', 'NOTIME-1']);
  });
});

// ── Determinism & edge cases ─────────────────────────────────────────────────

describe('computePersonalFlow — determinism and edges', () => {
  it('returns deeply equal results for the same input and today', () => {
    const issues = [buildReassignedAwayIssue('D-1', '2026-07-02T00:00:00.000Z')];

    const firstResult = computePersonalFlow(makeInput(issues));
    const secondResult = computePersonalFlow(makeInput(issues));

    expect(firstResult).toEqual(secondResult);
  });

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
    expect(result.cycleTime).toEqual({ averageDays: null, medianDays: null, countWithCycleTime: 0 });
    expect(result.perIssue).toEqual([]);
    expect(result.excludedIssues).toEqual([]);
  });

  it('clamps a non-positive windowDays to 1 to avoid divide-by-zero', () => {
    const issue = buildReassignedAwayIssue('W-1', '2026-07-08T00:00:00.000Z');

    const result = computePersonalFlow(makeInput([issue], { windowDays: 0 }));

    expect(result.windowDays).toBe(1);
  });
});
