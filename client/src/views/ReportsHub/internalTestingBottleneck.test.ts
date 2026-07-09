// Tests for the Internal Testing Bottleneck pure compute module. The engine measures how long each
// issue currently sitting in one of the team's internal-testing statuses has been WAITING there — from
// the moment it entered its CURRENT uninterrupted run of testing statuses — and rolls those waits up by
// status and by who holds the issue. Everything is derived deterministically from an injected `todayIso`
// plus each issue's status-transition timeline, so identical input always yields identical output.

import { describe, expect, it } from 'vitest';

import { computeInternalTestingBottleneck } from './internalTestingBottleneck.ts';
import type {
  BottleneckIssueInput,
  InternalTestingBottleneckInput,
} from './internalTestingBottleneck.ts';

// ── Shared fixtures ──────────────────────────────────────────────────────────

// A fixed anchor day so every waiting-days assertion is hand-computable. 2026-07-08 is a Wednesday.
const TODAY_ISO = '2026-07-08';

// The team's internal-testing statuses under test; deliberately mixed-case/spaced to exercise normalization.
const INTERNAL_TESTING_STATUS_NAMES = ['Integrated Test', 'Ready for Testing', 'Testing'];

/** Builds an InternalTestingBottleneckInput with sensible defaults so each test overrides only what it needs. */
function makeInput(
  issues: BottleneckIssueInput[],
  overrides: Partial<InternalTestingBottleneckInput> = {},
): InternalTestingBottleneckInput {
  return {
    issues,
    internalTestingStatusNames: INTERNAL_TESTING_STATUS_NAMES,
    todayIso: TODAY_ISO,
    ...overrides,
  };
}

/** Builds a BottleneckIssueInput with defaults, so a test states only the fields it cares about. */
function makeIssue(overrides: Partial<BottleneckIssueInput> & { key: string }): BottleneckIssueInput {
  return {
    key: overrides.key,
    summary: overrides.summary ?? `Issue ${overrides.key}`,
    currentStatusName: overrides.currentStatusName ?? 'Testing',
    assigneeDisplayName: 'assigneeDisplayName' in overrides ? overrides.assigneeDisplayName ?? null : 'Tester One',
    createdIso: 'createdIso' in overrides ? overrides.createdIso ?? null : '2026-06-01T00:00:00.000Z',
    statusTransitions: overrides.statusTransitions ?? [],
  };
}

// ── Phase-entry: waiting measured from the testing entry, not an earlier dev status ─────────────

describe('computeInternalTestingBottleneck — phase entry', () => {
  it('measures the wait from when the issue ENTERED testing, not from an earlier dev status', () => {
    // Moved into In Progress on 2026-06-20, then into Testing on 2026-07-01. The wait must count from
    // 2026-07-01 (7 calendar days to the 2026-07-08 anchor), never from the earlier dev transition.
    const issue = makeIssue({
      key: 'TBX-1',
      currentStatusName: 'Testing',
      statusTransitions: [
        { toStatusName: 'In Progress', atIso: '2026-06-20T00:00:00.000Z' },
        { toStatusName: 'Testing', atIso: '2026-07-01T00:00:00.000Z' },
      ],
    });

    const result = computeInternalTestingBottleneck(makeInput([issue]));

    expect(result.issues[0].waitingDays).toBe(7);
  });

  it('does NOT reset the wait when the issue moves between two testing sub-statuses', () => {
    // Entered the testing phase at Ready for Testing on 2026-07-01, then moved to Testing on 2026-07-05.
    // Because both are testing statuses, the second move is WITHIN the phase — the wait is still measured
    // from the 2026-07-01 phase entry (7 days), not from the 2026-07-05 sub-status move (3 days).
    const issue = makeIssue({
      key: 'TBX-2',
      currentStatusName: 'Testing',
      statusTransitions: [
        { toStatusName: 'In Progress', atIso: '2026-06-20T00:00:00.000Z' },
        { toStatusName: 'Ready for Testing', atIso: '2026-07-01T00:00:00.000Z' },
        { toStatusName: 'Testing', atIso: '2026-07-05T00:00:00.000Z' },
      ],
    });

    const result = computeInternalTestingBottleneck(makeInput([issue]));

    expect(result.issues[0].waitingDays).toBe(7);
  });

  it('re-enters the phase after leaving: the wait counts from the LATEST entry from outside', () => {
    // Testing → back to In Progress → Testing again. The current uninterrupted run began on 2026-07-06,
    // so the wait is 2 days, not measured from the first testing visit.
    const issue = makeIssue({
      key: 'TBX-3',
      currentStatusName: 'Testing',
      statusTransitions: [
        { toStatusName: 'Testing', atIso: '2026-06-25T00:00:00.000Z' },
        { toStatusName: 'In Progress', atIso: '2026-06-28T00:00:00.000Z' },
        { toStatusName: 'Testing', atIso: '2026-07-06T00:00:00.000Z' },
      ],
    });

    const result = computeInternalTestingBottleneck(makeInput([issue]));

    expect(result.issues[0].waitingDays).toBe(2);
  });

  it('falls back to createdIso when the issue was created already in a testing status', () => {
    // No transition enters testing from outside (only a testing→testing sub-status move), so the wait is
    // measured from creation on 2026-07-02 (6 days to the anchor).
    const issue = makeIssue({
      key: 'TBX-4',
      currentStatusName: 'Testing',
      createdIso: '2026-07-02T00:00:00.000Z',
      statusTransitions: [
        { toStatusName: 'Ready for Testing', atIso: '2026-07-03T00:00:00.000Z' },
        { toStatusName: 'Testing', atIso: '2026-07-04T00:00:00.000Z' },
      ],
    });

    const result = computeInternalTestingBottleneck(makeInput([issue]));

    expect(result.issues[0].waitingDays).toBe(6);
  });

  it('counts an issue with no transitions and a null createdIso as backlog with zero wait', () => {
    const issue = makeIssue({
      key: 'TBX-5',
      currentStatusName: 'Testing',
      createdIso: null,
      statusTransitions: [],
    });

    const result = computeInternalTestingBottleneck(makeInput([issue]));

    expect(result.backlogCount).toBe(1);
    expect(result.issues[0].waitingDays).toBe(0);
  });
});

// ── Aggregates across multiple issues ────────────────────────────────────────

describe('computeInternalTestingBottleneck — aggregates', () => {
  it('computes backlogCount, average/median/oldest, and the by-status and by-assignee rollups', () => {
    // Three issues held by one tester (the bottleneck), one unassigned. Waits: 7, 5, 3, and 1 days.
    // Each entered testing from an In Progress dev status, so the phase entry is detected from the change.
    const issues = [
      makeIssue({
        key: 'TBX-10', currentStatusName: 'Testing', assigneeDisplayName: 'Tester One',
        statusTransitions: [
          { toStatusName: 'In Progress', atIso: '2026-06-15T00:00:00.000Z' },
          { toStatusName: 'Testing', atIso: '2026-07-01T00:00:00.000Z' },
        ],
      }),
      makeIssue({
        key: 'TBX-11', currentStatusName: 'Ready for Testing', assigneeDisplayName: 'Tester One',
        statusTransitions: [
          { toStatusName: 'In Progress', atIso: '2026-06-15T00:00:00.000Z' },
          { toStatusName: 'Ready for Testing', atIso: '2026-07-03T00:00:00.000Z' },
        ],
      }),
      makeIssue({
        key: 'TBX-12', currentStatusName: 'Testing', assigneeDisplayName: 'Tester One',
        statusTransitions: [
          { toStatusName: 'In Progress', atIso: '2026-06-15T00:00:00.000Z' },
          { toStatusName: 'Testing', atIso: '2026-07-05T00:00:00.000Z' },
        ],
      }),
      makeIssue({
        key: 'TBX-13', currentStatusName: 'Testing', assigneeDisplayName: null,
        statusTransitions: [
          { toStatusName: 'In Progress', atIso: '2026-06-15T00:00:00.000Z' },
          { toStatusName: 'Testing', atIso: '2026-07-07T00:00:00.000Z' },
        ],
      }),
    ];

    const result = computeInternalTestingBottleneck(makeInput(issues));

    expect(result.backlogCount).toBe(4);
    // Waits are 7, 5, 3, 1 → average 4, median (mean of 3 and 5) 4, oldest 7.
    expect(result.averageWaitingDays).toBe(4);
    expect(result.medianWaitingDays).toBe(4);
    expect(result.oldestWaitingDays).toBe(7);
    // Two current statuses: Testing holds three, Ready for Testing one.
    expect(result.countByStatus).toEqual({ Testing: 3, 'Ready for Testing': 1 });
    // The bottleneck: one person holds three of the four, the fourth is Unassigned.
    expect(result.countByAssignee).toEqual({ 'Tester One': 3, Unassigned: 1 });
  });

  it('sorts issues by waiting DESC then key ASC', () => {
    const issues = [
      makeIssue({
        key: 'TBX-B',
        statusTransitions: [
          { toStatusName: 'In Progress', atIso: '2026-06-15T00:00:00.000Z' },
          { toStatusName: 'Testing', atIso: '2026-07-05T00:00:00.000Z' },
        ],
      }),
      makeIssue({
        key: 'TBX-A',
        statusTransitions: [
          { toStatusName: 'In Progress', atIso: '2026-06-15T00:00:00.000Z' },
          { toStatusName: 'Testing', atIso: '2026-07-05T00:00:00.000Z' },
        ],
      }),
      makeIssue({
        key: 'TBX-C',
        statusTransitions: [
          { toStatusName: 'In Progress', atIso: '2026-06-15T00:00:00.000Z' },
          { toStatusName: 'Testing', atIso: '2026-07-01T00:00:00.000Z' },
        ],
      }),
    ];

    const result = computeInternalTestingBottleneck(makeInput(issues));

    // TBX-C waited longest (7 days) → first; the two 3-day waits tie and break by key A before B.
    expect(result.issues.map((issue) => issue.key)).toEqual(['TBX-C', 'TBX-A', 'TBX-B']);
  });

  it('returns zeros and nulls for an empty backlog', () => {
    const result = computeInternalTestingBottleneck(makeInput([]));

    expect(result.backlogCount).toBe(0);
    expect(result.averageWaitingDays).toBeNull();
    expect(result.medianWaitingDays).toBeNull();
    expect(result.oldestWaitingDays).toBeNull();
    expect(result.countByStatus).toEqual({});
    expect(result.countByAssignee).toEqual({});
    expect(result.issues).toEqual([]);
  });
});
