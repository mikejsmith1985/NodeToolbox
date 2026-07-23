// personalFlowRoleRollup.test.ts — Unit tests for the pure "throughput by role" aggregation.
//
// These prove the rollup groups people by roster role capability, SUMS the additive volume and
// rate metrics across each role's members, POOLS every credited issue's hands-on cycle time to
// derive an average and median, and — critically — counts a multi-role person under EACH of their
// roles (the overlap is intentional). The bottleneck case shows the contrast the feature exists to
// expose: many developers feeding one internal tester means Developer throughput dwarfs it.

import { describe, expect, it } from 'vitest';

import type { RosterRoleCapabilities } from '../SprintDashboard/hooks/useStandupRosterStore.ts';
import type {
  PersonalFlowIssueMetric,
  PersonalFlowResult,
} from './personalFlow.ts';
import { rollUpThroughputByRole, TEAM_ROLE_DEFINITIONS } from './personalFlowRoleRollup.ts';

/**
 * Builds a minimal PersonalFlowResult carrying only the fields the rollup reads (issue/point counts,
 * per-week rates, and each issue's cycle time). The unused engine fields are filled with inert defaults
 * so the tests stay focused on the aggregation under test rather than the full compute pipeline.
 */
function buildResult(options: {
  issueCount: number;
  totalStoryPoints: number;
  issuesPerWeek: number;
  pointsPerWeek: number;
  cycleTimeDays: Array<number | null>;
}): PersonalFlowResult {
  const perIssue: PersonalFlowIssueMetric[] = options.cycleTimeDays.map((cycleTimeDays, index) => ({
    key: `ISSUE-${index}`,
    summary: `Issue ${index}`,
    storyPoints: null,
    cycleTimeDays,
    lastActiveIso: '2026-07-01T00:00:00.000Z',
  }));
  return {
    windowDays: 90,
    issueCount: options.issueCount,
    totalStoryPoints: options.totalStoryPoints,
    throughput: {
      issuesPerDay: 0,
      issuesPerWeek: options.issuesPerWeek,
      issuesPerTwoWeeks: 0,
      pointsPerDay: 0,
      pointsPerWeek: options.pointsPerWeek,
      pointsPerTwoWeeks: 0,
    },
    cycleTime: { averageDays: null, medianDays: null, countWithCycleTime: 0 },
    perIssue,
    excludedIssues: [],
    handsOnDaysByStatusId: {},
    // The role rollup only sums figures; it never renders the derivation evidence.
    workedExample: null,
  };
}

/** Builds a role-capability set from the true flags, leaving every other capability false/absent. */
function roles(...enabledKeys: Array<keyof RosterRoleCapabilities>): RosterRoleCapabilities {
  const capabilities = {
    canDevelop: false,
    canInternalTest: false,
    canExternalTest: false,
  } as RosterRoleCapabilities;
  for (const key of enabledKeys) {
    capabilities[key] = true;
  }
  return capabilities;
}

/** Finds the single rolled-up row for a role key, failing loudly if it was omitted. */
function rowFor(rows: ReturnType<typeof rollUpThroughputByRole>, key: keyof RosterRoleCapabilities) {
  const match = rows.find((row) => row.roleKey === key);
  if (match === undefined) {
    throw new Error(`Expected a rolled-up row for role "${String(key)}" but it was omitted.`);
  }
  return match;
}

describe('TEAM_ROLE_DEFINITIONS', () => {
  it('mirrors the roster ROSTER_ROLE_OPTIONS canonical order and labels', () => {
    expect(TEAM_ROLE_DEFINITIONS.map((definition) => definition.key)).toEqual([
      'canDevelop',
      'canInternalTest',
      'canExternalTest',
      'canScrumMaster',
      'canProductOwner',
      'canSystemsAnalyst',
      'canSolutionArchitect',
      'canDevLead',
      'canReleaseTrainEngineer',
    ]);
    expect(TEAM_ROLE_DEFINITIONS.map((definition) => definition.label)).toEqual([
      'Developer',
      'Internal Tester',
      'External Tester',
      'Scrum Master',
      'Product Owner',
      'Systems Analyst',
      'Solution Architect',
      'Dev Lead',
      'Release Train Engineer',
    ]);
  });
});

describe('rollUpThroughputByRole', () => {
  it('counts a canDevelop + canDevLead person under BOTH roles (intentional overlap)', () => {
    const dualRolePerson = {
      roleCapabilities: roles('canDevelop', 'canDevLead'),
      result: buildResult({
        issueCount: 4,
        totalStoryPoints: 12,
        issuesPerWeek: 2,
        pointsPerWeek: 6,
        cycleTimeDays: [3, 5],
      }),
    };

    const rows = rollUpThroughputByRole([dualRolePerson]);

    // The same person appears in the Developer row AND the Dev Lead row — no dedupe.
    const developerRow = rowFor(rows, 'canDevelop');
    const devLeadRow = rowFor(rows, 'canDevLead');
    expect(developerRow.peopleCount).toBe(1);
    expect(devLeadRow.peopleCount).toBe(1);
    expect(developerRow.issueCount).toBe(4);
    expect(devLeadRow.issueCount).toBe(4);
  });

  it('sums issues, points, and per-week rates across a role\'s members', () => {
    const firstDeveloper = {
      roleCapabilities: roles('canDevelop'),
      result: buildResult({ issueCount: 3, totalStoryPoints: 8, issuesPerWeek: 1.5, pointsPerWeek: 4, cycleTimeDays: [] }),
    };
    const secondDeveloper = {
      roleCapabilities: roles('canDevelop'),
      result: buildResult({ issueCount: 5, totalStoryPoints: 13, issuesPerWeek: 2.5, pointsPerWeek: 6, cycleTimeDays: [] }),
    };

    const developerRow = rowFor(rollUpThroughputByRole([firstDeveloper, secondDeveloper]), 'canDevelop');

    expect(developerRow.peopleCount).toBe(2);
    expect(developerRow.issueCount).toBe(8); // 3 + 5
    expect(developerRow.totalStoryPoints).toBe(21); // 8 + 13
    expect(developerRow.issuesPerWeek).toBe(4); // 1.5 + 2.5
    expect(developerRow.pointsPerWeek).toBe(10); // 4 + 6
  });

  it('pools every member\'s cycle times to compute the average and median', () => {
    // Pooled cycle times across the role's two members: [2, 4, 6, 8] → mean 5, median (4+6)/2 = 5.
    const firstTester = {
      roleCapabilities: roles('canInternalTest'),
      result: buildResult({ issueCount: 2, totalStoryPoints: 0, issuesPerWeek: 0, pointsPerWeek: 0, cycleTimeDays: [2, 8] }),
    };
    const secondTester = {
      roleCapabilities: roles('canInternalTest'),
      result: buildResult({ issueCount: 2, totalStoryPoints: 0, issuesPerWeek: 0, pointsPerWeek: 0, cycleTimeDays: [4, 6] }),
    };

    const testerRow = rowFor(rollUpThroughputByRole([firstTester, secondTester]), 'canInternalTest');

    expect(testerRow.averageCycleDays).toBe(5);
    expect(testerRow.medianCycleDays).toBe(5);
  });

  it('takes the middle value as the median for an odd-sized pool and filters null/zero cycle times', () => {
    // Pooled, after filtering out null and non-positive: [2, 4, 9] → mean 5, median 4 (odd → middle).
    const developer = {
      roleCapabilities: roles('canDevelop'),
      result: buildResult({
        issueCount: 5,
        totalStoryPoints: 0,
        issuesPerWeek: 0,
        pointsPerWeek: 0,
        cycleTimeDays: [2, null, 0, 4, 9],
      }),
    };

    const developerRow = rowFor(rollUpThroughputByRole([developer]), 'canDevelop');

    expect(developerRow.averageCycleDays).toBe(5); // (2 + 4 + 9) / 3
    expect(developerRow.medianCycleDays).toBe(4);
  });

  it('reports null cycle stats when a role\'s pool has no positive cycle times', () => {
    const developer = {
      roleCapabilities: roles('canDevelop'),
      result: buildResult({ issueCount: 1, totalStoryPoints: 0, issuesPerWeek: 0, pointsPerWeek: 0, cycleTimeDays: [null, 0] }),
    };

    const developerRow = rowFor(rollUpThroughputByRole([developer]), 'canDevelop');

    expect(developerRow.averageCycleDays).toBeNull();
    expect(developerRow.medianCycleDays).toBeNull();
  });

  it('omits any role that has no people entirely', () => {
    const developerOnly = {
      roleCapabilities: roles('canDevelop'),
      result: buildResult({ issueCount: 1, totalStoryPoints: 0, issuesPerWeek: 0, pointsPerWeek: 0, cycleTimeDays: [] }),
    };

    const rows = rollUpThroughputByRole([developerOnly]);

    // Only the Developer role is present; every empty role is dropped, not rendered as a zero row.
    expect(rows.map((row) => row.roleKey)).toEqual(['canDevelop']);
  });

  it('preserves the canonical TEAM_ROLE_DEFINITIONS order in the output rows', () => {
    // Seed people out of canonical order; the output must still follow the definitions order.
    const externalTester = {
      roleCapabilities: roles('canExternalTest'),
      result: buildResult({ issueCount: 1, totalStoryPoints: 0, issuesPerWeek: 0, pointsPerWeek: 0, cycleTimeDays: [] }),
    };
    const developer = {
      roleCapabilities: roles('canDevelop'),
      result: buildResult({ issueCount: 1, totalStoryPoints: 0, issuesPerWeek: 0, pointsPerWeek: 0, cycleTimeDays: [] }),
    };
    const internalTester = {
      roleCapabilities: roles('canInternalTest'),
      result: buildResult({ issueCount: 1, totalStoryPoints: 0, issuesPerWeek: 0, pointsPerWeek: 0, cycleTimeDays: [] }),
    };

    const rows = rollUpThroughputByRole([externalTester, developer, internalTester]);

    expect(rows.map((row) => row.roleKey)).toEqual(['canDevelop', 'canInternalTest', 'canExternalTest']);
  });

  it('ignores an entry whose result is null', () => {
    const developerWithNoResult = { roleCapabilities: roles('canDevelop'), result: null };
    const developerWithResult = {
      roleCapabilities: roles('canDevelop'),
      result: buildResult({ issueCount: 3, totalStoryPoints: 0, issuesPerWeek: 1, pointsPerWeek: 0, cycleTimeDays: [] }),
    };

    const developerRow = rowFor(rollUpThroughputByRole([developerWithNoResult, developerWithResult]), 'canDevelop');

    // The null-result person is not counted; only the person with a real result contributes.
    expect(developerRow.peopleCount).toBe(1);
    expect(developerRow.issueCount).toBe(3);
  });

  it('produces Systems Analyst and Release Train Engineer rows when members hold those roles', () => {
    const systemsAnalyst = {
      roleCapabilities: roles('canSystemsAnalyst'),
      result: buildResult({ issueCount: 2, totalStoryPoints: 5, issuesPerWeek: 1, pointsPerWeek: 2, cycleTimeDays: [] }),
    };
    const releaseTrainEngineer = {
      roleCapabilities: roles('canReleaseTrainEngineer'),
      result: buildResult({ issueCount: 3, totalStoryPoints: 7, issuesPerWeek: 1.5, pointsPerWeek: 3, cycleTimeDays: [] }),
    };

    const rows = rollUpThroughputByRole([systemsAnalyst, releaseTrainEngineer]);

    expect(rowFor(rows, 'canSystemsAnalyst').roleLabel).toBe('Systems Analyst');
    expect(rowFor(rows, 'canReleaseTrainEngineer').roleLabel).toBe('Release Train Engineer');
    expect(rowFor(rows, 'canSystemsAnalyst').issueCount).toBe(2);
    expect(rowFor(rows, 'canReleaseTrainEngineer').issueCount).toBe(3);
  });

  it('omits Systems Analyst and Release Train Engineer rows when nobody holds those roles', () => {
    const developerOnly = {
      roleCapabilities: roles('canDevelop'),
      result: buildResult({ issueCount: 1, totalStoryPoints: 0, issuesPerWeek: 0, pointsPerWeek: 0, cycleTimeDays: [] }),
    };

    const rows = rollUpThroughputByRole([developerOnly]);

    expect(rows.map((row) => row.roleKey)).not.toContain('canSystemsAnalyst');
    expect(rows.map((row) => row.roleKey)).not.toContain('canReleaseTrainEngineer');
  });

  it('exposes the bottleneck: eight developers\' throughput dwarfs one internal tester\'s', () => {
    // The real-world shape this feature targets: ~8 developers each pushing work through, feeding a
    // single internal tester who cannot keep pace. The Developer row must show far higher issues/week.
    const developers = Array.from({ length: 8 }, () => ({
      roleCapabilities: roles('canDevelop'),
      result: buildResult({ issueCount: 6, totalStoryPoints: 15, issuesPerWeek: 3, pointsPerWeek: 7, cycleTimeDays: [2] }),
    }));
    const loneInternalTester = {
      roleCapabilities: roles('canInternalTest'),
      result: buildResult({ issueCount: 4, totalStoryPoints: 4, issuesPerWeek: 1, pointsPerWeek: 1, cycleTimeDays: [9] }),
    };

    const rows = rollUpThroughputByRole([...developers, loneInternalTester]);
    const developerRow = rowFor(rows, 'canDevelop');
    const internalTesterRow = rowFor(rows, 'canInternalTest');

    expect(developerRow.peopleCount).toBe(8);
    expect(internalTesterRow.peopleCount).toBe(1);
    expect(developerRow.issuesPerWeek).toBe(24); // 8 × 3
    expect(internalTesterRow.issuesPerWeek).toBe(1);
    // The contrast the table exists to surface: developer throughput vastly outstrips tester throughput.
    expect(developerRow.issuesPerWeek).toBeGreaterThan(internalTesterRow.issuesPerWeek * 10);
  });
});
