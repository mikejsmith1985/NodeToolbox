// capacityPlanner.test.ts — Exercises the deterministic engine: ordering, capacity caps, dev→test
// sequencing with slip, proposals, bottleneck, projection beyond the PI, and unschedulable surfacing.

import { describe, expect, it } from 'vitest';

import { buildCapacityPlan } from './capacityPlanner.ts';
import type { PersonCapacity, PlanInput, PlanItem, PlanResult } from './capacityTypes.ts';

// ── Fixture builders ─────────────────────────────────────────────────────────

/** Builds a PlanItem with sensible defaults so each test only states the fields it cares about. */
function makeItem(overrides: Partial<PlanItem> & { key: string }): PlanItem {
  return {
    summary: overrides.key,
    bucket: 'Must',
    rankInBucket: 1,
    devPoints: 0,
    internalTestPoints: 0,
    externalTestPoints: 0,
    isTestEstimated: false,
    assignee: null,
    ...overrides,
  };
}

/** Builds a PersonCapacity with a default 8-point pool. */
function makePerson(displayName: string, roles: PersonCapacity['roles'], pointsPerSprint = 8): PersonCapacity {
  return { displayName, roles, pointsPerSprint };
}

/** Wraps items + people into a full PlanInput with the standard PI window and defaults. */
function makeInput(
  items: PlanItem[],
  people: PersonCapacity[],
  piName = 'PI 26.3 (05/21/26 - 06/18/26)',
): PlanInput {
  return { items, people, piName, sprintLengthDays: 14, syntheticTestFraction: 0.5 };
}

const TODAY_ISO = '2026-05-21';

/** Returns the 1-based sprint indices where the given item carries the given role's points. */
function sprintIndicesFor(result: PlanResult, itemKey: string, role: 'dev' | 'internalTest' | 'externalTest'): number[] {
  const field = role === 'dev' ? 'devPoints' : role === 'internalTest' ? 'internalTestPoints' : 'externalTestPoints';
  const indices: number[] = [];
  for (const sprint of result.sprints) {
    for (const load of sprint.loads) {
      if (load.itemKeys.includes(itemKey) && load[field] > 0) {
        indices.push(sprint.index);
        break;
      }
    }
  }
  return indices;
}

/** Asserts SC-2: no person is ever scheduled beyond their per-sprint pool across all roles. */
function assertNoPersonOverPool(result: PlanResult, pool = 8): void {
  for (const sprint of result.sprints) {
    for (const load of sprint.loads) {
      expect(load.devPoints + load.internalTestPoints + load.externalTestPoints).toBeLessThanOrEqual(pool);
    }
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('buildCapacityPlan — ordering and capacity', () => {
  it('schedules items in bucket then rank order (SC-3)', () => {
    // One developer, three items across buckets given out of order — must schedule Must→Should→Could.
    const items = [
      makeItem({ key: 'C1', bucket: 'Could', rankInBucket: 1, devPoints: 8, assignee: 'Solo' }),
      makeItem({ key: 'M2', bucket: 'Must', rankInBucket: 2, devPoints: 8, assignee: 'Solo' }),
      makeItem({ key: 'M1', bucket: 'Must', rankInBucket: 1, devPoints: 8, assignee: 'Solo' }),
    ];
    const result = buildCapacityPlan(makeInput(items, [makePerson('Solo', ['dev'])]), TODAY_ISO);
    expect(sprintIndicesFor(result, 'M1', 'dev')).toEqual([1]);
    expect(sprintIndicesFor(result, 'M2', 'dev')).toEqual([2]);
    expect(sprintIndicesFor(result, 'C1', 'dev')).toEqual([3]);
  });

  it('never schedules a person beyond their pool in a sprint (SC-2)', () => {
    const items = [
      makeItem({ key: 'A', bucket: 'Must', rankInBucket: 1, devPoints: 8, assignee: 'Alice' }),
      makeItem({ key: 'B', bucket: 'Must', rankInBucket: 2, devPoints: 8, assignee: 'Bob' }),
    ];
    const people = [makePerson('Alice', ['dev']), makePerson('Bob', ['dev'])];
    const result = buildCapacityPlan(makeInput(items, people), TODAY_ISO);
    expect(result.sprints).toHaveLength(1);
    expect(result.sprints[0].scheduledPoints).toBe(16);
    assertNoPersonOverPool(result);
  });

  it('spends a multi-role person from one pool, slipping test to the next sprint (SC-2)', () => {
    // Flex does dev+internal test. Dev fills the whole sprint-1 pool, so their own test slips to sprint 2.
    const items = [makeItem({ key: 'X', devPoints: 8, internalTestPoints: 8, assignee: 'Flex' })];
    const result = buildCapacityPlan(makeInput(items, [makePerson('Flex', ['dev', 'internalTest'])]), TODAY_ISO);
    expect(sprintIndicesFor(result, 'X', 'dev')).toEqual([1]);
    expect(sprintIndicesFor(result, 'X', 'internalTest')).toEqual([2]);
    assertNoPersonOverPool(result);
  });
});

describe('buildCapacityPlan — dev → internal → external sequencing (FR-11)', () => {
  it('slips internal test to a later sprint when the tester pool is full, then keeps external after it', () => {
    const items = [
      makeItem({ key: 'I1', rankInBucket: 1, devPoints: 8, internalTestPoints: 8, externalTestPoints: 8 }),
      makeItem({ key: 'I2', rankInBucket: 2, devPoints: 8, internalTestPoints: 8, externalTestPoints: 8 }),
    ];
    const people = [
      makePerson('Dana', ['dev']),
      makePerson('Erin', ['dev']),
      makePerson('Tess', ['internalTest']),
      makePerson('Xander', ['externalTest']),
    ];
    const result = buildCapacityPlan(makeInput(items, people), TODAY_ISO);

    // I2 develops in sprint 1 but the tester is full there, so its internal test slips to sprint 2,
    // and external testing may never precede internal testing.
    const devSprint = Math.min(...sprintIndicesFor(result, 'I2', 'dev'));
    const internalSprint = Math.min(...sprintIndicesFor(result, 'I2', 'internalTest'));
    const externalSprint = Math.min(...sprintIndicesFor(result, 'I2', 'externalTest'));
    expect(devSprint).toBe(1);
    expect(internalSprint).toBe(2);
    expect(externalSprint).toBeGreaterThanOrEqual(internalSprint);
    assertNoPersonOverPool(result);
  });

  it('never schedules any testing before its development', () => {
    const items = [makeItem({ key: 'S', devPoints: 8, internalTestPoints: 8, externalTestPoints: 8 })];
    const people = [
      makePerson('Dana', ['dev']),
      makePerson('Tess', ['internalTest']),
      makePerson('Xander', ['externalTest']),
    ];
    const result = buildCapacityPlan(makeInput(items, people), TODAY_ISO);
    const dev = Math.min(...sprintIndicesFor(result, 'S', 'dev'));
    const internal = Math.min(...sprintIndicesFor(result, 'S', 'internalTest'));
    const external = Math.min(...sprintIndicesFor(result, 'S', 'externalTest'));
    expect(internal).toBeGreaterThanOrEqual(dev);
    expect(external).toBeGreaterThanOrEqual(internal);
  });
});

describe('buildCapacityPlan — synthesized test cost (FR-8a)', () => {
  it('synthesizes internal-test points as a fraction of dev points when none are provided', () => {
    // dev 8 with null internal test → round(8 * 0.5) = 4 internal-test points charged to the tester.
    const items = [makeItem({ key: 'D', devPoints: 8, internalTestPoints: null, assignee: 'Dana' })];
    const people = [makePerson('Dana', ['dev']), makePerson('Tess', ['internalTest'])];
    const result = buildCapacityPlan(makeInput(items, people), TODAY_ISO);
    const testerLoad = result.sprints
      .flatMap((sprint) => sprint.loads)
      .find((load) => load.displayName === 'Tess');
    expect(testerLoad?.internalTestPoints).toBe(4);
  });
});

describe('buildCapacityPlan — assignment proposals (FR-9)', () => {
  it('proposes a role-capable assignee for unassigned work with the most free capacity', () => {
    const items = [makeItem({ key: 'U', devPoints: 8, assignee: null })];
    const people = [makePerson('Ada', ['dev']), makePerson('Ben', ['dev'])];
    const result = buildCapacityPlan(makeInput(items, people), TODAY_ISO);
    const devProposal = result.proposals.find((proposal) => proposal.role === 'dev');
    expect(devProposal).toBeDefined();
    expect(devProposal?.fromAssignee).toBeNull();
    expect(devProposal?.toAssignee).toBe('Ada'); // both free → alphabetical tiebreak
  });

  it('rebalances test work off a dev-only assignee onto a capable tester', () => {
    const items = [makeItem({ key: 'R', devPoints: 8, internalTestPoints: 8, assignee: 'Dana' })];
    const people = [makePerson('Dana', ['dev']), makePerson('Tess', ['internalTest'])];
    const result = buildCapacityPlan(makeInput(items, people), TODAY_ISO);
    const internalProposal = result.proposals.find((proposal) => proposal.role === 'internalTest');
    expect(internalProposal?.fromAssignee).toBe('Dana');
    expect(internalProposal?.toAssignee).toBe('Tess');
    // Dana validly holds dev, so no dev proposal is emitted.
    expect(result.proposals.some((proposal) => proposal.role === 'dev')).toBe(false);
  });
});

describe('buildCapacityPlan — bottleneck and projection (SC-4, SC-5)', () => {
  it('quantifies the internal-testing bottleneck and projects beyond the PI end', () => {
    // 3 devs (24 dev pts/sprint) + 1 tester (8 test pts/sprint). Six dev-8 items with synthesized
    // 50% internal test → dev demand 48 (2 sprints), internal demand 24 (3 sprints) — testing lags.
    const items = Array.from({ length: 6 }, (_unused, index) =>
      makeItem({ key: `W${index + 1}`, rankInBucket: index + 1, devPoints: 8, internalTestPoints: null }),
    );
    const people = [
      makePerson('Ada', ['dev']),
      makePerson('Ben', ['dev']),
      makePerson('Cam', ['dev']),
      makePerson('Tess', ['internalTest']),
    ];
    // Short PI (one sprint) so the internal-test tail lands past the PI end.
    const result = buildCapacityPlan(makeInput(items, people, 'PI 26.3 (05/21/26 - 06/04/26)'), TODAY_ISO);

    expect(result.bottleneck.limitingRole).toBe('internalTest');
    expect(result.bottleneck.additionalToMatchThroughput).toBe(2);
    expect(result.bottleneck.additionalToFinishByPiEnd).toBe(2);
    expect(result.completionSprintIndex).toBe(3);
    expect(result.sprintsBeyondPiEnd).toBeGreaterThanOrEqual(1);
    assertNoPersonOverPool(result);
  });
});

describe('buildCapacityPlan — unschedulable work and loop guards', () => {
  it('surfaces items whose required role has zero capacity instead of dropping them', () => {
    // The team has no internal tester, so an item needing internal testing cannot be scheduled.
    const items = [makeItem({ key: 'Z', devPoints: 8, internalTestPoints: 8, assignee: 'Dana' })];
    const result = buildCapacityPlan(makeInput(items, [makePerson('Dana', ['dev'])]), TODAY_ISO);
    expect(result.unschedulableItemKeys).toContain('Z');
    expect(result.sprints).toHaveLength(0);
    expect(result.completionSprintIndex).toBe(0);
    expect(result.completionDateIso).toBeNull();
  });

  it('caps projection and marks an item unschedulable rather than looping forever', () => {
    // 1608 dev points ÷ 8 per sprint = 201 sprints, past the 200-sprint safety cap.
    const items = [makeItem({ key: 'HUGE', devPoints: 8 * 201, assignee: 'Solo' })];
    const result = buildCapacityPlan(makeInput(items, [makePerson('Solo', ['dev'])]), TODAY_ISO);
    expect(result.unschedulableItemKeys).toContain('HUGE');
    expect(result.sprints.length).toBeLessThanOrEqual(200);
  });
});

describe('buildCapacityPlan — determinism (SC-1)', () => {
  it('produces a deeply-equal result for the same input and today, regardless of input order', () => {
    const people = [
      makePerson('Ada', ['dev']),
      makePerson('Tess', ['internalTest']),
      makePerson('Xander', ['externalTest']),
    ];
    const itemsInOrder = [
      makeItem({ key: 'A', rankInBucket: 1, devPoints: 8, internalTestPoints: 4 }),
      makeItem({ key: 'B', rankInBucket: 2, devPoints: 8, internalTestPoints: 4, externalTestPoints: 4 }),
      makeItem({ key: 'C', bucket: 'Should', rankInBucket: 1, devPoints: 5, internalTestPoints: null }),
    ];
    const scrambled = [itemsInOrder[2], itemsInOrder[0], itemsInOrder[1]];
    const first = buildCapacityPlan(makeInput(itemsInOrder, people), TODAY_ISO);
    const second = buildCapacityPlan(makeInput(scrambled, people), TODAY_ISO);
    expect(first).toEqual(second);
  });
});
