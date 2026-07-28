// deliveryPlanIngest.test.ts — The delivery-plan reply parser + allowlist firewall (spec 032, US1).

import { describe, expect, it } from 'vitest';

import { parseDeliveryPlanReply } from './deliveryPlanIngest.ts';
import type { Bottleneck, PiPlanningFactSheet } from '../piPlanTypes.ts';

function factSheet(): PiPlanningFactSheet {
  return {
    piName: '26.4', piStartIso: '2026-07-30', deliveryDeadlineIso: '2026-09-30',
    features: [{
      key: 'DENP-100', summary: 'Feature', sizePoints: 8, priorityRank: 1, priorityName: 'High',
      isCommitted: true, repoComponentNames: ['api', 'ui'], domainComponentNames: [], dependencyKeys: [],
      targetFixVersion: null, existingChildren: [],
    }],
    people: [{ displayName: 'Dev One', accountId: 'a1', roles: ['dev'], pointsPerSprint: 8 }],
    sprints: [], releaseSchedule: { entries: [] }, repoAllowlist: ['api', 'ui'],
    fieldConfig: { inIntStatusNames: [], slDoneStatusNames: [], doneCategoryNames: [] }, velocityByPerson: {}, notes: [],
  };
}

const bottleneck: Bottleneck = {
  id: 'sl-throughput-s2', kind: 'slTestThroughput', sprintName: '26.4.2', subjectKey: null,
  figures: {}, statement: 'x', mitigation: null,
};

describe('parseDeliveryPlanReply', () => {
  it('accepts a valid reply and reads its Stories + mitigations', () => {
    const reply = JSON.stringify({
      kind: 'piDeliveryPlan',
      stories: [{ featureKey: 'DENP-100', summary: 'Enrollment', repos: ['api', 'ui'], acHints: ['x'] }],
      mitigations: [{ bottleneckId: 'sl-throughput-s2', mitigation: 'Time-box SL test.' }],
    });
    const result = parseDeliveryPlanReply(reply, factSheet(), [bottleneck]);
    expect(result.error).toBeNull();
    expect(result.stories).toHaveLength(1);
    expect(result.mitigationsById['sl-throughput-s2']).toBe('Time-box SL test.');
    expect(result.rejected).toHaveLength(0);
  });

  it('rejects a Story naming a repo not in the allowlist, keeping valid ones', () => {
    const reply = JSON.stringify({
      kind: 'piDeliveryPlan',
      stories: [
        { featureKey: 'DENP-100', summary: 'Good', repos: ['api'] },
        { featureKey: 'DENP-100', summary: 'Bad', repos: ['api', 'secret-repo'] },
      ],
    });
    const result = parseDeliveryPlanReply(reply, factSheet(), []);
    expect(result.stories.map((s) => s.summary)).toEqual(['Good']);
    expect(result.rejected[0].reason).toMatch(/secret-repo/);
  });

  it('rejects a Story with an unknown Feature key', () => {
    const reply = JSON.stringify({ kind: 'piDeliveryPlan', stories: [{ featureKey: 'ZZZ-1', summary: 'X', repos: ['api'] }] });
    const result = parseDeliveryPlanReply(reply, factSheet(), []);
    expect(result.stories).toHaveLength(0);
    expect(result.rejected[0].reason).toMatch(/unknown Feature key/);
  });

  it('rejects a mitigation with an unknown bottleneck id', () => {
    const reply = JSON.stringify({ kind: 'piDeliveryPlan', stories: [], mitigations: [{ bottleneckId: 'nope', mitigation: 'x' }] });
    const result = parseDeliveryPlanReply(reply, factSheet(), [bottleneck]);
    expect(result.mitigationsById).toEqual({});
    expect(result.rejected[0].reason).toMatch(/unknown bottleneck id/);
  });

  it('ignores any AI-supplied date/assignee/sprint fields', () => {
    const reply = JSON.stringify({
      kind: 'piDeliveryPlan',
      stories: [{ featureKey: 'DENP-100', summary: 'X', repos: ['api'], targetEnd: '2099-01-01', assignee: 'Ghost', sprint: 'S9' }],
    });
    const result = parseDeliveryPlanReply(reply, factSheet(), []);
    expect(result.stories[0]).toEqual({ featureKey: 'DENP-100', summary: 'X', repos: ['api'], acHints: [] });
  });

  it('repairs a prose-wrapped / lightly-malformed reply', () => {
    const reply = 'Sure!\n```json\n{"kind":"piDeliveryPlan","stories":[{"featureKey":"DENP-100","summary":"Y","repos":["ui"],},],}\n```';
    const result = parseDeliveryPlanReply(reply, factSheet(), []);
    expect(result.error).toBeNull();
    expect(result.stories).toHaveLength(1);
  });

  it('rejects a reply whose kind is a different surface', () => {
    const result = parseDeliveryPlanReply(JSON.stringify({ kind: 'piReview', items: [] }), factSheet(), []);
    expect(result.error).toMatch(/piReview/);
  });
});
