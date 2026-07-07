// capacityTypes.test.ts — Shape/round-trip guard for the capacity-planner data contracts.
//
// capacityTypes.ts is interface-only, so there is no runtime logic to unit-test; this instead pins the
// contract by constructing a representative value of the composite types and asserting their shape, so an
// accidental breaking rename of a field is caught here as well as by the engine's own tests.

import { describe, expect, it } from 'vitest';

import type { PersonCapacity, PlanInput, PlanItem, PlanResult } from './capacityTypes.ts';

describe('capacityTypes', () => {
  it('models a plan item with dev and test effort and a MoSCoW rank', () => {
    const planItem: PlanItem = {
      key: 'DENP-1',
      summary: 'Build login',
      bucket: 'Must',
      rankInBucket: 0,
      devPoints: 5,
      internalTestPoints: null,
      externalTestPoints: null,
      isTestEstimated: false,
      assignee: 'Ada Lovelace',
    };
    expect(planItem.bucket).toBe('Must');
    expect(planItem.devPoints).toBe(5);
  });

  it('models a person as one capacity pool spendable across their delivery roles', () => {
    const person: PersonCapacity = {
      displayName: 'Ada Lovelace',
      roles: ['dev', 'internalTest'],
      pointsPerSprint: 8,
    };
    expect(person.roles).toContain('dev');
    expect(person.pointsPerSprint).toBe(8);
  });

  it('composes a plan input the engine consumes', () => {
    const input: PlanInput = {
      items: [],
      people: [],
      piName: 'PI 26.3 (05/21/26 - 07/29/26)',
      sprintLengthDays: 14,
      syntheticTestFraction: 0.5,
    };
    expect(input.sprintLengthDays).toBe(14);
  });

  it('describes the plan result surface', () => {
    const result: PlanResult = {
      sprints: [],
      proposals: [],
      bottleneck: {
        limitingRole: null,
        additionalToMatchThroughput: 0,
        additionalToFinishByPiEnd: 0,
        statement: 'No bottleneck.',
      },
      completionSprintIndex: 0,
      completionDateIso: null,
      sprintsBeyondPiEnd: 0,
      unschedulableItemKeys: [],
    };
    expect(result.bottleneck.limitingRole).toBeNull();
    expect(result.unschedulableItemKeys).toEqual([]);
  });
});
