// piDeliveryEngine.test.ts — The delivery orchestrator (spec 032, US2/US3): parallel per-repo assignment,
// SL-test as its own stream, and rule-derived dates. Reuses buildCapacityPlan + computeItemDates.

import { describe, expect, it } from 'vitest';

import { buildDeliveryPlan, type DeliveryEngineInput } from './piDeliveryEngine.ts';
import type { PiPlanningFactSheet } from './piPlanTypes.ts';

function factSheet(overrides: Partial<PiPlanningFactSheet> = {}): PiPlanningFactSheet {
  return {
    piName: '26.4', piStartIso: '2026-07-30', deliveryDeadlineIso: '2026-09-30',
    features: [{
      key: 'DENP-100', summary: 'Enrollment', sizePoints: 10, priorityRank: 1, priorityName: 'High',
      isCommitted: true, repoComponentNames: ['api', 'ui'], domainComponentNames: [], dependencyKeys: [],
      targetFixVersion: null, existingChildren: [],
    }],
    people: [
      { displayName: 'Dev One', accountId: 'a1', roles: ['dev'], pointsPerSprint: 8 },
      { displayName: 'Dev Two', accountId: 'a2', roles: ['dev'], pointsPerSprint: 8 },
      { displayName: 'SL Tester', accountId: 'a3', roles: ['internalTest'], pointsPerSprint: 8 },
    ],
    sprints: [
      { name: '26.4.1', startIso: '2026-07-30', endIso: '2026-08-12' },
      { name: '26.4.2', startIso: '2026-08-13', endIso: '2026-08-26' },
    ],
    releaseSchedule: { entries: [{ name: 'Aug', releaseDateIso: '2026-08-28', isSuggested: false }] },
    repoAllowlist: ['api', 'ui'], fieldConfig: { inIntStatusNames: [], slDoneStatusNames: [], doneCategoryNames: [] },
    velocityByPerson: { 'Dev One': 10, 'Dev Two': 10, 'SL Tester': 10 }, notes: [],
    ...overrides,
  };
}

const CALENDAR = { weekendDays: [0, 6], holidayIsoDates: [] };
const resolveId = (repoName: string) => ({ api: 'c-api', ui: 'c-ui' }[repoName] ?? null);

function baseInput(sheet = factSheet()): DeliveryEngineInput {
  return {
    factSheet: sheet,
    stories: [{ featureKey: 'DENP-100', summary: 'Enrollment enhancement', sizePoints: 10, repoNames: ['api', 'ui'] }],
    resolveComponentId: resolveId, workingCalendar: CALENDAR, piEndIso: '2026-10-07', todayIso: '2026-07-30',
  };
}

describe('buildDeliveryPlan', () => {
  it('creates one coding sub-task per repo, each carrying its resolved component id', () => {
    const plan = buildDeliveryPlan(baseInput());
    const story = plan.stories[0];
    expect(story.codingSubtasks.map((s) => s.repoName)).toEqual(['api', 'ui']);
    expect(story.codingSubtasks.map((s) => s.repoComponentId)).toEqual(['c-api', 'c-ui']);
  });

  it('assigns different repos to different developers (parallel work)', () => {
    const plan = buildDeliveryPlan(baseInput());
    const assignees = plan.stories[0].codingSubtasks.map((s) => s.assignee);
    expect(assignees.every((a) => a !== null)).toBe(true);
    expect(new Set(assignees).size).toBe(2); // two repos → two distinct developers
  });

  it('routes SL test to an SL-capable person, separate from the coders', () => {
    const plan = buildDeliveryPlan(baseInput());
    expect(plan.stories[0].slAssignee).toBe('SL Tester');
  });

  it('computes rule-derived dates: Target End = code-in-INT, REL = INT + 5 working days', () => {
    const plan = buildDeliveryPlan(baseInput());
    const { dates } = plan.stories[0];
    expect(dates.targetEndIso).toBe(dates.deployIntIso);
    expect(dates.deployRelIso > dates.deployIntIso).toBe(true);
    expect(dates.dueIso).not.toBeNull(); // a release covers it
  });

  it('warns when a Story\'s Target End falls after the Sprint-5 Week-1 delivery deadline', () => {
    const tightSheet = factSheet({ deliveryDeadlineIso: '2026-07-31' }); // deadline before any work can finish
    const plan = buildDeliveryPlan(baseInput(tightSheet));
    expect(plan.stories[0].warnings.some((w) => /delivery deadline/i.test(w))).toBe(true);
  });

  it('surfaces a "map repos first" honest state for a Story with no repos', () => {
    const input = baseInput();
    input.stories = [{ featureKey: 'DENP-100', summary: 'No repos', sizePoints: 5, repoNames: [] }];
    const plan = buildDeliveryPlan(input);
    expect(plan.stories[0].codingSubtasks).toHaveLength(0);
    expect(plan.honestStates.some((s) => /map repos first/i.test(s))).toBe(true);
  });
});
