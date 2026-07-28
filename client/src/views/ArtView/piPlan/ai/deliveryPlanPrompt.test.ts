// deliveryPlanPrompt.test.ts — The {kind:'piDeliveryPlan'} prompt builder (spec 032, US1, contract ai-delivery-plan.md).

import { describe, expect, it } from 'vitest';

import { buildDeliveryPlanPrompt } from './deliveryPlanPrompt.ts';
import type { Bottleneck, PiPlanningFactSheet } from '../piPlanTypes.ts';

function factSheet(featureCount = 1): PiPlanningFactSheet {
  const features = Array.from({ length: featureCount }, (_unused, index) => ({
    key: `DENP-${100 + index}`, summary: `Feature ${index}`, sizePoints: 8, priorityRank: 1, priorityName: 'High',
    isCommitted: true, repoComponentNames: ['api', 'ui'], domainComponentNames: [], dependencyKeys: [],
    targetFixVersion: null, existingChildren: [],
  }));
  return {
    piName: '26.4', piStartIso: '2026-07-30', deliveryDeadlineIso: '2026-09-30', features,
    people: [{ displayName: 'Dev One', accountId: 'a1', roles: ['dev'], pointsPerSprint: 8 }],
    sprints: [], releaseSchedule: { entries: [] }, repoAllowlist: ['api', 'ui'],
    fieldConfig: { inIntStatusNames: [], slDoneStatusNames: [], doneCategoryNames: [] }, velocityByPerson: {}, notes: [],
  };
}

const bottleneck: Bottleneck = {
  id: 'sl-throughput-s2', kind: 'slTestThroughput', sprintName: '26.4.2', subjectKey: null,
  figures: { devPoints: 30, slCapacity: 16 }, statement: 'SL test is the constraint in 26.4.2', mitigation: null,
};

describe('buildDeliveryPlanPrompt', () => {
  it('embeds the fact sheet + bottlenecks and asks only for decomposition + mitigations', () => {
    const { prompts, chunkCount } = buildDeliveryPlanPrompt(factSheet(), [bottleneck]);
    expect(chunkCount).toBe(1);
    const prompt = prompts[0];
    expect(prompt).toContain('"kind": "piDeliveryPlan"');
    expect(prompt).toContain('DENP-100');
    expect(prompt).toContain('sl-throughput-s2');
    expect(prompt).toMatch(/do not return dates/i);
  });

  it('chunks when the Feature set is large', () => {
    const { chunkCount, prompts } = buildDeliveryPlanPrompt(factSheet(25), []);
    expect(chunkCount).toBeGreaterThan(1);
    expect(prompts).toHaveLength(chunkCount);
  });
});

describe('buildDeliveryPlanPrompt — carryover exclusion', () => {
  it('excludes carryover Features from the prompt (only new Features are decomposed)', () => {
    const sheet = factSheet(1);
    sheet.features.push({
      key: 'DENP-999', summary: 'In flight', sizePoints: 5, priorityRank: 2, priorityName: 'High',
      isCommitted: true, repoComponentNames: ['api'], domainComponentNames: [], dependencyKeys: [],
      targetFixVersion: null, existingChildren: [], isCarryover: true,
    });
    const { prompts, featureCount } = buildDeliveryPlanPrompt(sheet, []);
    expect(featureCount).toBe(1);                 // only the new Feature counts
    expect(prompts[0]).toContain('DENP-100');
    expect(prompts[0]).not.toContain('DENP-999'); // carryover excluded
  });
});
