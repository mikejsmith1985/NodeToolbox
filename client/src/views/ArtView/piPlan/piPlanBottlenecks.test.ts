// piPlanBottlenecks.test.ts — Deterministic bottleneck detection (spec 032, US4, contract bottleneck-detection.md).

import { describe, expect, it } from 'vitest';

import { detectBottlenecks, attachMitigations } from './piPlanBottlenecks.ts';
import type { PlannedStory } from './piDeliveryEngine.ts';
import type { PlanResult } from '../../FeatureCanvas/planner/capacityTypes.ts';
import type { Bottleneck, PiPlanningFactSheet } from './piPlanTypes.ts';

function planResult(limitingRole: PlanResult['bottleneck']['limitingRole']): PlanResult {
  return {
    sprints: [], proposals: [],
    bottleneck: { limitingRole, additionalToMatchThroughput: 1, additionalToFinishByPiEnd: 2, statement: 'SL limited' },
    completionSprintIndex: 1, completionDateIso: null, sprintsBeyondPiEnd: 0, unschedulableItemKeys: [],
  };
}

function factSheet(overrides: Partial<PiPlanningFactSheet> = {}): PiPlanningFactSheet {
  return {
    piName: '26.4', piStartIso: '2026-07-30', deliveryDeadlineIso: '2026-09-30',
    features: [
      { key: 'DENP-1', summary: 'A', sizePoints: 5, priorityRank: 1, priorityName: 'High', isCommitted: true, repoComponentNames: ['api'], domainComponentNames: [], dependencyKeys: ['DENP-2'], targetFixVersion: null, existingChildren: [] },
      { key: 'DENP-2', summary: 'B', sizePoints: 5, priorityRank: 2, priorityName: 'High', isCommitted: true, repoComponentNames: ['ui'], domainComponentNames: [], dependencyKeys: [], targetFixVersion: null, existingChildren: [] },
    ],
    people: [
      { displayName: 'Dev One', accountId: 'a1', roles: ['dev'], pointsPerSprint: 8 },
      { displayName: 'Dev Two', accountId: 'a2', roles: ['dev'], pointsPerSprint: 8 },
      { displayName: 'SL Tester', accountId: 'a3', roles: ['internalTest'], pointsPerSprint: 8 },
    ],
    sprints: [
      { name: '26.4.1', startIso: '2026-07-30', endIso: '2026-08-12' },
      { name: '26.4.2', startIso: '2026-08-13', endIso: '2026-08-26' },
    ],
    releaseSchedule: { entries: [] }, repoAllowlist: ['api', 'ui'],
    fieldConfig: { inIntStatusNames: [], slDoneStatusNames: [], doneCategoryNames: [] }, velocityByPerson: {}, notes: [],
    ...overrides,
  };
}

function story(featureKey: string, sprintName: string, dueIso: string | null): PlannedStory {
  return {
    tempId: `${featureKey}#1`, featureKey, summary: featureKey, sizePoints: 5, codingSubtasks: [],
    slAssignee: null, sprintName,
    dates: { targetStartIso: '', internalTestEndIso: null, targetEndIso: '', deployIntIso: '', deployRelIso: '', deployProdIso: dueIso, dueIso, derivations: {} },
    warnings: [],
  };
}

describe('detectBottlenecks', () => {
  it('flags SL-test throughput from the planner limiting-role report', () => {
    const flags = detectBottlenecks(planResult('internalTest'), factSheet({ people: [
      { displayName: 'Dev One', accountId: 'a1', roles: ['dev'], pointsPerSprint: 8 },
      { displayName: 'Dev Two', accountId: 'a2', roles: ['dev'], pointsPerSprint: 8 },
      { displayName: 'SL A', accountId: 'a3', roles: ['internalTest'], pointsPerSprint: 8 },
      { displayName: 'SL B', accountId: 'a4', roles: ['internalTest'], pointsPerSprint: 8 },
    ] }), [], '2026-10-07');
    expect(flags.some((f) => f.kind === 'slTestThroughput')).toBe(true);
  });

  it('does not flag SL throughput when dev is the limiting role', () => {
    const flags = detectBottlenecks(planResult('dev'), factSheet(), [], '2026-10-07');
    expect(flags.some((f) => f.kind === 'slTestThroughput')).toBe(false);
  });

  it('flags a role with exactly one capable person (single SL tester)', () => {
    const flags = detectBottlenecks(planResult(null), factSheet(), [], '2026-10-07');
    const keyPerson = flags.filter((f) => f.kind === 'keyPerson');
    expect(keyPerson.some((f) => f.subjectKey === 'internalTest')).toBe(true); // one SL tester
  });

  it('flags a dependency scheduled after its dependent story', () => {
    // DENP-1 depends on DENP-2, but DENP-1 is in sprint 1 while DENP-2 is in sprint 2 → violation.
    const stories = [story('DENP-1', '26.4.1', null), story('DENP-2', '26.4.2', null)];
    const flags = detectBottlenecks(planResult(null), factSheet(), stories, '2026-10-07');
    expect(flags.some((f) => f.kind === 'dependencyOrder')).toBe(true);
  });

  it('flags a Story whose PROD date falls after the PI end (carry)', () => {
    const stories = [story('DENP-1', '26.4.2', '2026-10-20')];
    const flags = detectBottlenecks(planResult(null), factSheet(), stories, '2026-10-07');
    expect(flags.some((f) => f.kind === 'prodCarry')).toBe(true);
  });

  it('flags a Story larger than the selected per-sprint capacity (oversize)', () => {
    const big = { ...story('DENP-1', '26.4.1', null), sizePoints: 20 };
    const flags = detectBottlenecks(planResult(null), factSheet(), [big], '2026-10-07', 10);
    const oversize = flags.find((f) => f.kind === 'storyOversize');
    expect(oversize?.figures).toEqual({ sizePoints: 20, maxStorySize: 10 });
  });

  it('does not flag oversize when a Story fits the cap or no cap is given', () => {
    const fits = { ...story('DENP-1', '26.4.1', null), sizePoints: 8 };
    expect(detectBottlenecks(planResult(null), factSheet(), [fits], '2026-10-07', 10)
      .some((f) => f.kind === 'storyOversize')).toBe(false);
    // maxStorySize defaults to 0 (disabled) → even a huge Story is not flagged.
    const huge = { ...story('DENP-1', '26.4.1', null), sizePoints: 99 };
    expect(detectBottlenecks(planResult(null), factSheet(), [huge], '2026-10-07')
      .some((f) => f.kind === 'storyOversize')).toBe(false);
  });
});

describe('attachMitigations', () => {
  it('attaches a mitigation only to a matching bottleneck id', () => {
    const bottlenecks: Bottleneck[] = [
      { id: 'sl-throughput', kind: 'slTestThroughput', sprintName: null, subjectKey: null, figures: {}, statement: 'x', mitigation: null },
      { id: 'key-person-dev', kind: 'keyPerson', sprintName: null, subjectKey: 'dev', figures: {}, statement: 'y', mitigation: null },
    ];
    const attached = attachMitigations(bottlenecks, { 'sl-throughput': 'Time-box SL test', 'ghost-id': 'ignored' });
    expect(attached.find((b) => b.id === 'sl-throughput')?.mitigation).toBe('Time-box SL test');
    expect(attached.find((b) => b.id === 'key-person-dev')?.mitigation).toBeNull();
  });
});
