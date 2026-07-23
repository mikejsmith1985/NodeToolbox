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
  '10': 'indeterminate', // a queue-like "Ready to Work" status Jira still categorises as in-progress
  '11': 'indeterminate', // a real "Working" status — the hands-on time we most want to see land here
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

  it('credits an issue she completed with no measurable hands-on time, with a null cycle time', () => {
    const issue = makeFlowIssue({
      key: 'NEW-1',
      initialStatusId: 'todo', // new the whole time — never in progress, so zero hands-on time
      ownershipTransitions: [
        { assignedToTarget: true, atIso: '2026-07-01T00:00:00.000Z' },
        { assignedToTarget: false, atIso: '2026-07-03T00:00:00.000Z' }, // completed by reassign-away in window
      ],
    });

    const result = computePersonalFlow(makeInput([issue]));

    // The completion counts toward throughput even though no in-progress time could be measured.
    expect(result.issueCount).toBe(1);
    expect(result.perIssue).toHaveLength(1);
    expect(result.perIssue[0].cycleTimeDays).toBeNull();
    // A null cycle time never feeds the duration statistics.
    expect(result.cycleTime.countWithCycleTime).toBe(0);
    expect(result.cycleTime.averageDays).toBeNull();
    expect(result.cycleTime.medianDays).toBeNull();
  });

  it('credits a done issue moved To-Do → Done under the person with no in-progress phase', () => {
    const issue = makeFlowIssue({
      key: 'JUMP-1',
      createdIso: '2026-06-30T00:00:00.000Z',
      initialStatusId: 'todo', // never entered an in-progress status
      initiallyAssignedToTarget: true,
      statusTransitions: [{ toStatusId: 'done', atIso: '2026-07-06T00:00:00.000Z' }], // To-Do → Done directly
    });

    const result = computePersonalFlow(makeInput([issue]));

    expect(result.issueCount).toBe(1);
    expect(result.perIssue[0].cycleTimeDays).toBeNull();
    expect(result.perIssue[0].lastActiveIso?.slice(0, 10)).toBe('2026-07-06');
    expect(result.cycleTime.countWithCycleTime).toBe(0);
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

// ── Hands-on time broken down by status id (diagnostic partition) ────────────

describe('computePersonalFlow — hands-on time by status id', () => {
  it('splits an issue\'s hands-on days across the individual in-progress statuses it sat in', () => {
    // Owned from creation on Mon 06-29 in status 10, moved to status 11 on Wed 07-01, reassigned away
    // on Mon 07-06. Status 10 held Mon+Tue = 2 business days; status 11 held Wed+Thu+Fri = 3 business days.
    const issue = makeFlowIssue({
      key: 'SPLIT-1',
      createdIso: '2026-06-29T00:00:00.000Z',
      initialStatusId: '10',
      initiallyAssignedToTarget: true,
      statusTransitions: [{ toStatusId: '11', atIso: '2026-07-01T00:00:00.000Z' }],
      ownershipTransitions: [{ assignedToTarget: false, atIso: '2026-07-06T00:00:00.000Z' }],
    });

    const result = computePersonalFlow(makeInput([issue]));

    // The partition names each status id with its hands-on days; the two sum to the credited cycle time.
    expect(result.handsOnDaysByStatusId['10']).toBeCloseTo(2, 10);
    expect(result.handsOnDaysByStatusId['11']).toBeCloseTo(3, 10);
    expect(result.perIssue[0].cycleTimeDays).toBeCloseTo(5, 10);
  });

  it('sums the per-status days to exactly the sum of the credited non-null cycle-time days (invariant)', () => {
    // A mix: two measured single-status issues, one two-status split issue, plus non-credited noise.
    const measuredA = buildBusinessDayIssue('INV-A', 2, '2026-06-23T00:00:00.000Z'); // 2 days in 'inProgress'
    const measuredB = buildBusinessDayIssue('INV-B', 4, '2026-06-24T00:00:00.000Z'); // 4 days in 'inProgress'
    const splitIssue = makeFlowIssue({
      key: 'INV-SPLIT',
      createdIso: '2026-06-29T00:00:00.000Z',
      initialStatusId: '10',
      initiallyAssignedToTarget: true,
      statusTransitions: [{ toStatusId: '11', atIso: '2026-07-01T00:00:00.000Z' }],
      ownershipTransitions: [{ assignedToTarget: false, atIso: '2026-07-06T00:00:00.000Z' }],
    });

    const result = computePersonalFlow(makeInput([measuredA, measuredB, splitIssue]));

    const summedStatusDays = Object.values(result.handsOnDaysByStatusId).reduce((total, days) => total + days, 0);
    const summedCreditedCycleDays = result.perIssue
      .map((row) => row.cycleTimeDays)
      .filter((days): days is number => days !== null)
      .reduce((total, days) => total + days, 0);
    expect(summedStatusDays).toBeCloseTo(summedCreditedCycleDays, 9);
    expect(summedStatusDays).toBeCloseTo(2 + 4 + 5, 9); // 2 + 4 measured, 2+3 split
  });

  it('excludes not-owned, WIP, and out-of-window issues from the per-status breakdown entirely', () => {
    // Only CRED-SPLIT is credited; the other three are dropped, so nothing they touched appears in the map.
    const creditedSplit = makeFlowIssue({
      key: 'CRED-SPLIT',
      createdIso: '2026-06-29T00:00:00.000Z',
      initialStatusId: '10',
      initiallyAssignedToTarget: true,
      statusTransitions: [{ toStatusId: '11', atIso: '2026-07-01T00:00:00.000Z' }],
      ownershipTransitions: [{ assignedToTarget: false, atIso: '2026-07-06T00:00:00.000Z' }],
    });
    const notOwned = makeFlowIssue({ key: 'NO-1', initialStatusId: '11', initiallyAssignedToTarget: false });
    const wipOpen = makeFlowIssue({ key: 'WIP-1', initialStatusId: '11', initiallyAssignedToTarget: true });
    const outOfWindow = makeFlowIssue({
      key: 'OOW-1',
      createdIso: '2026-02-20T00:00:00.000Z',
      initialStatusId: '11', // spends time in status 11, but its stint ends long before the window
      ownershipTransitions: [
        { assignedToTarget: true, atIso: '2026-02-23T00:00:00.000Z' },
        { assignedToTarget: false, atIso: '2026-02-27T00:00:00.000Z' },
      ],
    });

    const result = computePersonalFlow(makeInput([creditedSplit, notOwned, wipOpen, outOfWindow]));

    // The out-of-window issue also used status 11, but only the credited issue's 3 days for 11 are counted.
    expect(result.handsOnDaysByStatusId).toEqual({ '10': 2, '11': 3 });
    expect(result.issueCount).toBe(1);
  });

  it('leaves cycleTime, issueCount, and perIssue exactly as before when the breakdown is added', () => {
    // The same 2/4/9 fixture the cycle-time suite asserts — proving the additive field perturbs nothing.
    const issues = [
      buildBusinessDayIssue('M-1', 2, '2026-06-22T00:00:00.000Z'),
      buildBusinessDayIssue('M-2', 4, '2026-06-23T00:00:00.000Z'),
      buildBusinessDayIssue('M-3', 9, '2026-06-24T00:00:00.000Z'),
    ];

    const result = computePersonalFlow(makeInput(issues));

    expect(result.issueCount).toBe(3);
    expect(result.cycleTime.countWithCycleTime).toBe(3);
    expect(result.cycleTime.medianDays).toBeCloseTo(4, 10);
    expect(result.cycleTime.averageDays).toBeCloseTo(5, 10);
    expect(result.perIssue.map((row) => row.cycleTimeDays)).toEqual([9, 4, 2]);
    // All three measured issues sat in 'inProgress', so the whole 15 credited days land under that one id.
    expect(result.handsOnDaysByStatusId).toEqual({ inProgress: 2 + 4 + 9 });
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

  it('leaves average and median untouched when a null-cycle completion joins measured issues', () => {
    // The same 2/4/9 measured issues, plus one completed issue with no measurable hands-on time.
    const zeroTimeCompletion = makeFlowIssue({
      key: 'NULLCYCLE-1',
      initialStatusId: 'todo', // never in progress — zero hands-on, so a null cycle time
      ownershipTransitions: [
        { assignedToTarget: true, atIso: '2026-06-22T00:00:00.000Z' },
        { assignedToTarget: false, atIso: '2026-06-24T00:00:00.000Z' },
      ],
    });
    const issues = [
      buildBusinessDayIssue('M-1', 2, '2026-06-22T00:00:00.000Z'),
      buildBusinessDayIssue('M-2', 4, '2026-06-23T00:00:00.000Z'),
      buildBusinessDayIssue('M-3', 9, '2026-06-24T00:00:00.000Z'),
      zeroTimeCompletion,
    ];

    const result = computePersonalFlow(makeInput(issues));

    // The null-cycle issue counts as advanced but does not perturb the duration statistics.
    expect(result.issueCount).toBe(4);
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
  // A measured credited issue, a zero-time credited completion, and one issue for each of the three
  // surviving exclusion reasons — so a single run exercises every credit and exclusion branch.
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
  // Owned and reassigned away in-window, but only ever in a "new" status — zero hands-on in-progress
  // time. It is now CREDITED (with a null cycle time), NOT excluded, so it is not part of the audit list.
  const completedNoTimeIssue = makeFlowIssue({
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

  it('reports only the three surviving reasons; a zero-time completion is credited, not excluded', () => {
    const result = computePersonalFlow(
      makeInput([creditedIssue, notOwnedIssue, wipOpenIssue, completedNoTimeIssue, outOfWindowIssue]),
    );

    const reasonByKey = Object.fromEntries(result.excludedIssues.map((row) => [row.key, row.reason]));
    expect(reasonByKey).toEqual({
      'NOTOWNED-1': 'not-owned',
      'WIP-1': 'wip-open',
      'OOW-1': 'completed-out-of-window',
    });
    expect(result.excludedIssues).toHaveLength(3);
    // The zero-hands-on completion never lands in the exclusion audit — it is credited instead.
    expect(result.excludedIssues.some((row) => row.key === 'NOTIME-1')).toBe(false);
    // Each excluded row carries the issue summary for the audit table.
    expect(result.excludedIssues.find((row) => row.key === 'WIP-1')?.summary).toBe('Issue WIP-1');
  });

  it('credits both the measured qualifier and the zero-time completion, only one with a cycle time', () => {
    const result = computePersonalFlow(
      makeInput([creditedIssue, notOwnedIssue, wipOpenIssue, completedNoTimeIssue, outOfWindowIssue]),
    );

    // Two issues are credited: CRED-1 (measured) and NOTIME-1 (completed, unmeasured).
    expect(result.issueCount).toBe(2);
    expect(result.perIssue.map((row) => row.key).sort()).toEqual(['CRED-1', 'NOTIME-1']);

    const creditedRow = result.perIssue.find((row) => row.key === 'CRED-1');
    expect(creditedRow?.cycleTimeDays).toBeCloseTo(2, 10);
    expect(creditedRow?.lastActiveIso?.slice(0, 10)).toBe('2026-07-03');
    expect(creditedRow?.storyPoints).toBe(5);

    const unmeasuredRow = result.perIssue.find((row) => row.key === 'NOTIME-1');
    expect(unmeasuredRow?.cycleTimeDays).toBeNull();

    // Only the measured issue feeds the duration statistics.
    expect(result.cycleTime.countWithCycleTime).toBe(1);
  });

  it('preserves the original fetch order of the excluded issues (deterministic audit list)', () => {
    // Feed the excluded issues in a scrambled order; the audit must echo that exact order back.
    const scrambledOrder = [outOfWindowIssue, wipOpenIssue, notOwnedIssue, completedNoTimeIssue];
    const result = computePersonalFlow(makeInput(scrambledOrder));

    // NOTIME-1 is now credited, so only the three genuine exclusions remain, in fetch order.
    expect(result.excludedIssues.map((row) => row.key)).toEqual(['OOW-1', 'WIP-1', 'NOTOWNED-1']);
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

// ── Worked example: the evidence behind one credited issue's cycle time ───────
//
// Cycle time is reconstructed from issue history, so no Jira search reproduces it. The engine
// therefore has to hand back the working for ONE credited issue — enough that a reader can open
// that issue in Jira and confirm the method by hand.

describe('computePersonalFlow — worked example evidence', () => {
  /** An issue held Wed 1 Jul → Fri 3 Jul while in progress, then done. 2 working days. */
  function makeEvidenceIssue(key: string): PersonalFlowIssue {
    return makeFlowIssue({
      key,
      createdIso: '2026-07-01T00:00:00.000Z',
      initialStatusId: 'inProgress',
      initiallyAssignedToTarget: true,
      statusTransitions: [{ toStatusId: 'done', atIso: '2026-07-03T00:00:00.000Z' }],
    });
  }

  it('returns a worked example naming a credited issue', () => {
    const result = computePersonalFlow(makeInput([makeEvidenceIssue('FLOW-1')]));

    expect(result.workedExample).not.toBeNull();
    expect(result.workedExample?.issueKey).toBe('FLOW-1');
  });

  it('lists the ownership stints that were evaluated', () => {
    const result = computePersonalFlow(makeInput([makeEvidenceIssue('FLOW-1')]));

    expect(result.workedExample?.ownershipStints.length).toBeGreaterThan(0);
    expect(result.workedExample?.ownershipStints[0].fromIso).toBe('2026-07-01T00:00:00.000Z');
  });

  it('lists the qualifying in-progress spans with their working days', () => {
    const result = computePersonalFlow(makeInput([makeEvidenceIssue('FLOW-1')]));
    const spans = result.workedExample?.qualifyingSpans ?? [];

    expect(spans.length).toBeGreaterThan(0);
    expect(spans[0].statusId).toBe('inProgress');
    expect(spans[0].workingDays).toBeGreaterThan(0);
  });

  it('has spans that sum to its stated total', () => {
    const workedExample = computePersonalFlow(makeInput([makeEvidenceIssue('FLOW-1')])).workedExample;
    const summedSpanDays = (workedExample?.qualifyingSpans ?? [])
      .reduce((runningTotal, span) => runningTotal + span.workingDays, 0);

    expect(summedSpanDays).toBeCloseTo(workedExample?.totalWorkingDays ?? -1, 10);
  });

  it('states a total equal to that issue\'s reported cycle time — the example cannot contradict the table', () => {
    const result = computePersonalFlow(makeInput([makeEvidenceIssue('FLOW-1')]));
    const reportedRow = result.perIssue.find((row) => row.key === result.workedExample?.issueKey);

    expect(result.workedExample?.totalWorkingDays).toBeCloseTo(reportedRow?.cycleTimeDays ?? -1, 10);
  });

  it('never picks an issue with no measurable hands-on time, which would demonstrate nothing', () => {
    // Completed under her, but straight from To-Do to Done — credited, yet zero hands-on time.
    const noHandsOnIssue = makeFlowIssue({
      key: 'FLOW-EMPTY',
      createdIso: '2026-07-01T00:00:00.000Z',
      initialStatusId: 'todo',
      initiallyAssignedToTarget: true,
      statusTransitions: [{ toStatusId: 'done', atIso: '2026-07-03T00:00:00.000Z' }],
    });

    const result = computePersonalFlow(makeInput([noHandsOnIssue]));

    expect(result.perIssue.some((row) => row.key === 'FLOW-EMPTY')).toBe(true);
    expect(result.workedExample).toBeNull();
  });

  it('prefers a demonstrable issue when the set mixes measurable and unmeasurable work', () => {
    const noHandsOnIssue = makeFlowIssue({
      key: 'FLOW-EMPTY',
      createdIso: '2026-07-01T00:00:00.000Z',
      initialStatusId: 'todo',
      initiallyAssignedToTarget: true,
      statusTransitions: [{ toStatusId: 'done', atIso: '2026-07-02T00:00:00.000Z' }],
    });

    const result = computePersonalFlow(makeInput([noHandsOnIssue, makeEvidenceIssue('FLOW-2')]));

    expect(result.workedExample?.issueKey).toBe('FLOW-2');
  });

  it('returns no worked example when nothing was credited at all', () => {
    const unownedIssue = makeFlowIssue({ key: 'FLOW-NONE', initiallyAssignedToTarget: false });

    expect(computePersonalFlow(makeInput([unownedIssue])).workedExample).toBeNull();
  });
});

// ── Sub-task scope (feature 027) ─────────────────────────────────────────────
//
// Sub-tasks look like ordinary issues to a Jira search, so they were being counted as peers of the
// story they belong to: one piece of work credited twice, and — because they are short-lived — cycle
// times dragged DOWN, which flattered delivery. These pin the correction.
//
// The verdict is supplied by the caller (via classifyIssueScope) rather than derived here, so the
// engine stays free of any Jira field-shape knowledge.

describe('computePersonalFlow — sub-task scope', () => {
  /** The credited fixture from the hands-on suite: held Wed→Fri, then handed on. */
  function makeCreditedIssue(overrides: Partial<PersonalFlowIssue> = {}): PersonalFlowIssue {
    return {
      ...makeFlowIssue({
        key: 'SCOPE-1',
        storyPoints: 5,
        createdIso: '2026-06-30T00:00:00.000Z',
        initialStatusId: 'inProgress',
        initiallyAssignedToTarget: false,
        ownershipTransitions: [
          { assignedToTarget: true, atIso: '2026-07-01T00:00:00.000Z' },
          { assignedToTarget: false, atIso: '2026-07-03T00:00:00.000Z' },
        ],
      }),
      ...overrides,
    };
  }

  it('credits an issue with no scope verdict exactly as before', () => {
    // The optional-field guard. Every existing fixture omits scopeVerdict, so if this ever changed,
    // 35 shipped tests would be silently describing different behaviour from the one in production.
    const result = computePersonalFlow(makeInput([makeCreditedIssue()]));

    expect(result.issueCount).toBe(1);
    expect(result.totalStoryPoints).toBe(5);
  });

  it('excludes a sub-task and says so, rather than dropping it silently', () => {
    const result = computePersonalFlow(makeInput([makeCreditedIssue({ scopeVerdict: 'sub-task' })]));

    expect(result.issueCount).toBe(0);
    expect(result.totalStoryPoints).toBe(0);
    expect(result.excludedIssues).toEqual([
      { key: 'SCOPE-1', summary: 'Issue SCOPE-1', reason: 'sub-task' },
    ]);
  });

  it('still credits an issue whose type could not be read', () => {
    // Assuming sub-task would delete a real person's work on the strength of a missing field.
    const result = computePersonalFlow(makeInput([makeCreditedIssue({ scopeVerdict: 'unknown-type' })]));

    expect(result.issueCount).toBe(1);
  });

  it('keeps a retained issue\'s own cycle time byte-identical when a sub-task is removed beside it', () => {
    // Contract G5: exclusion changes WHICH issues are counted, never HOW a counted issue is measured.
    // That is what makes the moving averages explainable to anyone holding an older report.
    const withoutSubTask = computePersonalFlow(makeInput([makeCreditedIssue()]));
    const withSubTask = computePersonalFlow(makeInput([
      makeCreditedIssue(),
      makeCreditedIssue({ key: 'SCOPE-2', scopeVerdict: 'sub-task' }),
    ]));

    expect(withSubTask.perIssue).toEqual(withoutSubTask.perIssue);
    expect(withSubTask.cycleTime).toEqual(withoutSubTask.cycleTime);
  });

  it('raises the cycle-time average once short sub-tasks stop counting', () => {
    // The reason this matters: sub-tasks are short-lived, so including them made delivery look faster.
    const shortSubTask = makeCreditedIssue({
      key: 'SCOPE-3',
      ownershipTransitions: [
        { assignedToTarget: true, atIso: '2026-07-01T00:00:00.000Z' },
        { assignedToTarget: false, atIso: '2026-07-02T00:00:00.000Z' }, // one day only
      ],
    });

    const counted = computePersonalFlow(makeInput([makeCreditedIssue(), shortSubTask]));
    const excluded = computePersonalFlow(makeInput([
      makeCreditedIssue(),
      { ...shortSubTask, scopeVerdict: 'sub-task' },
    ]));

    expect(excluded.cycleTime.averageDays!).toBeGreaterThan(counted.cycleTime.averageDays!);
  });

  it('excludes a sub-task the person never owned as not-owned, so the sub-task count means "yours"', () => {
    // Ordering rule (R5): ownership is tested first. Otherwise the superset fetch would sweep other
    // people's sub-tasks into this person's sub-task count and make the number meaningless.
    const neverOwned = makeFlowIssue({ key: 'SCOPE-4', initiallyAssignedToTarget: false });

    const result = computePersonalFlow(makeInput([{ ...neverOwned, scopeVerdict: 'sub-task' }]));

    expect(result.excludedIssues[0].reason).toBe('not-owned');
  });
});
