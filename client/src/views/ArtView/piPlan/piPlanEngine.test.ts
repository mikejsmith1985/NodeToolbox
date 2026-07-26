// piPlanEngine.test.ts — The orchestrator: composition with the reused planner, dates, honest states,
// and determinism (spec 028, US1, contract planning-engine.md).

import { describe, expect, it } from 'vitest';

import { buildPiPlanProposal } from './piPlanEngine.ts';
import type { PiPlanEngineInput } from './piPlanEngine.ts';
import type { PersonCapacity } from '../../FeatureCanvas/planner/capacityTypes.ts';
import type { FeatureInput, StorySuggestion, WorkingCalendar } from './piPlanTypes.ts';

const CAL: WorkingCalendar = { weekendDays: [0, 6], holidayIsoDates: [] };
const TODAY = '2026-05-21';

const PEOPLE: PersonCapacity[] = [
  { displayName: 'Dev One', roles: ['dev'], pointsPerSprint: 10 },
  { displayName: 'QA One', roles: ['internalTest'], pointsPerSprint: 10 },
];

function feature(overrides: Partial<FeatureInput>): FeatureInput {
  return {
    key: 'ABC-1', summary: 'Feature', sizePoints: 8, priorityRank: 1, priorityName: 'High',
    isCommitted: true, dependencyKeys: [], targetFixVersion: null, existingChildren: [], ...overrides,
  };
}

function story(overrides: Partial<StorySuggestion>): StorySuggestion {
  return { summary: 'Story A', sizePoints: 8, hasTestableOutput: true, matchExistingKey: null, ...overrides };
}

function input(overrides: Partial<PiPlanEngineInput>): PiPlanEngineInput {
  return {
    piName: 'PI 26.3 (05/21/26 - 07/29/26)',
    piStartIso: '2026-05-21',
    piEndIso: '2026-07-29',
    features: [feature({})],
    acceptedByFeature: { 'ABC-1': [story({})] },
    people: PEOPLE,
    releaseSchedule: { entries: [{ name: 'R1', releaseDateIso: '2026-06-15', isSuggested: false }] },
    workingCalendar: CAL,
    sprintLengthDays: 14,
    ...overrides,
  };
}

describe('buildPiPlanProposal', () => {
  it('produces a Story proposal plus its sub-tasks, each with computed dates', () => {
    const proposal = buildPiPlanProposal(input({}), TODAY);
    const storyItems = proposal.items.filter((item) => item.kind === 'story');
    expect(storyItems).toHaveLength(1);
    expect(storyItems[0].dates?.targetStartIso).toBeTruthy();
    // A testable story gets internal-test + INT/REL/PROD = 4 sub-tasks.
    const subtasks = proposal.items.filter((item) => item.kind !== 'story');
    expect(subtasks.map((item) => item.kind).sort()).toEqual(['deployInt', 'deployProd', 'deployRel', 'internalTest']);
  });

  it('drops the internal-test sub-task for a non-testable story', () => {
    const proposal = buildPiPlanProposal(
      input({ acceptedByFeature: { 'ABC-1': [story({ hasTestableOutput: false, internalTestPoints: 0 } as never)] } }),
      TODAY,
    );
    expect(proposal.items.some((item) => item.kind === 'internalTest')).toBe(false);
  });

  it('surfaces an unsized Feature as an honest state', () => {
    const proposal = buildPiPlanProposal(
      input({ features: [feature({ sizePoints: null })], acceptedByFeature: {} }),
      TODAY,
    );
    expect(proposal.honestStates.some((state) => /not sized/i.test(state))).toBe(true);
  });

  it('flags a missing internal-test capability when a testable story exists', () => {
    const proposal = buildPiPlanProposal(
      input({ people: [{ displayName: 'Dev One', roles: ['dev'], pointsPerSprint: 10 }] }),
      TODAY,
    );
    expect(proposal.honestStates.some((state) => /internal-test capability/i.test(state))).toBe(true);
  });

  it('warns when a Story’s code-in-INT (Target End) falls after the PI end (FR-036 boundary)', () => {
    // Force an early PI end so the computed Target End necessarily lands beyond it.
    const proposal = buildPiPlanProposal(input({ piEndIso: '2026-05-20' }), TODAY);
    const storyItem = proposal.items.find((item) => item.kind === 'story');
    expect(storyItem?.warnings.some((warning) => /after the PI end/i.test(warning))).toBe(true);
  });

  it('is deterministic — identical input and clock produce an identical proposal', () => {
    const a = buildPiPlanProposal(input({}), TODAY);
    const b = buildPiPlanProposal(input({}), TODAY);
    expect(a).toEqual(b);
  });

  it('marks a Story that matched an existing child as existing (idempotency, US6)', () => {
    const proposal = buildPiPlanProposal(
      input({ acceptedByFeature: { 'ABC-1': [story({ matchExistingKey: 'ABC-9' })] } }),
      TODAY,
    );
    const storyItem = proposal.items.find((item) => item.kind === 'story');
    expect(storyItem?.status).toBe('existing');
  });

  it('shares one PlanResult so the capacity map and schedule agree by construction', () => {
    const proposal = buildPiPlanProposal(input({}), TODAY);
    expect(proposal.planResult.sprints.length).toBeGreaterThan(0);
  });
});
