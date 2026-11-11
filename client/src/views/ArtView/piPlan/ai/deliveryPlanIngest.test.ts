// deliveryPlanIngest.test.ts — The delivery-plan reply parser + allowlist firewall (spec 032, US1).

import { describe, expect, it } from 'vitest';

import { buildDeliveryPlanFollowUpPrompt, parseDeliveryPlanReply } from './deliveryPlanIngest.ts';
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

// ── Google AI Mode replies (GH #499) ──

const AI_MODE_REPLY = [
  'Here is the PI delivery plan based on the fact sheet you provided.',
  '',
  'DELIVERY_PLAN_STORIES:',
  '| Feature key | Feature | Story | Repos | Acceptance hints |',
  '|---|---|---|---|---|',
  '| **DENP-100** | Feature | Enrollment API | api | Accepts a member, returns an id; Rejects duplicates |',
  '| DENP-100 | Feature | Enrollment screen | ui, api | Shows the new id |',
  '',
  '| Bottleneck id | Bottleneck | Mitigation |',
  '|---|---|---|',
  '| sl-throughput-s2 | x | Time-box SL test. |',
  '',
  'If you share the team calendar, I can refine the mitigations.',
].join('\n');

describe('parseDeliveryPlanReply with an AI Mode reply', () => {
  it('reads both markdown tables, wrapped in an intro and a closing offer, into the same Stories and mitigations', () => {
    const result = parseDeliveryPlanReply(AI_MODE_REPLY, factSheet(), [bottleneck]);
    expect(result.error).toBeNull();
    expect(result.stories).toEqual([
      { featureKey: 'DENP-100', summary: 'Enrollment API', repos: ['api'], acHints: ['Accepts a member, returns an id', 'Rejects duplicates'] },
      { featureKey: 'DENP-100', summary: 'Enrollment screen', repos: ['ui', 'api'], acHints: ['Shows the new id'] },
    ]);
    expect(result.mitigationsById).toEqual({ 'sl-throughput-s2': 'Time-box SL test.' });
    expect(result.rejected).toEqual([]);
  });

  it('reads a table pasted from the web page as tab-separated cells', () => {
    const tabReply = 'Feature key\tStory\tRepos\nDENP-100\tEnrollment API\tapi';
    const result = parseDeliveryPlanReply(tabReply, factSheet(), []);
    expect(result.stories).toEqual([{ featureKey: 'DENP-100', summary: 'Enrollment API', repos: ['api'], acHints: [] }]);
  });

  it('still rejects an invented repo or Feature key written into the table', () => {
    const reply = 'Feature key | Story | Repos\nDENP-100 | Bad | api, secret-repo\nZZZ-1 | Ghost | api';
    const result = parseDeliveryPlanReply(reply, factSheet(), []);
    expect(result.stories).toEqual([]);
    expect(result.rejected.map((rejection) => rejection.reason)).toEqual([
      'repo "secret-repo" is not in the fact sheet\'s repo allowlist', 'unknown Feature key "ZZZ-1"',
    ]);
  });

  it('skips a pre-filled Story row left blank rather than rejecting it', () => {
    const result = parseDeliveryPlanReply('Feature key | Feature | Story | Repos\nDENP-100 | Feature | ___ | ___', factSheet(), []);
    expect(result.error).toBeNull();
    expect(result.stories).toEqual([]);
    expect(result.rejected).toEqual([]);
  });
});

describe('buildDeliveryPlanFollowUpPrompt', () => {
  it('offers nothing when every Feature and bottleneck was answered', () => {
    const result = parseDeliveryPlanReply(AI_MODE_REPLY, factSheet(), [bottleneck]);
    expect(buildDeliveryPlanFollowUpPrompt(factSheet(), [bottleneck], result)).toBe('');
  });

  it('asks for both tables again when the reply could not be read', () => {
    const result = parseDeliveryPlanReply('DENP-100 should be two stories.', factSheet(), [bottleneck]);
    const followUp = buildDeliveryPlanFollowUpPrompt(factSheet(), [bottleneck], result);
    expect(followUp).toMatch(/^Your last reply was not in the form I need/);
    expect(followUp).toContain('DENP-100 | Feature | ___');
    expect(followUp).toContain('sl-throughput-s2 | x | ___');
  });

  it('asks for only what was left out — never guessing it', () => {
    const storiesOnly = 'Feature key | Story | Repos\nDENP-100 | Enrollment API | api';
    const result = parseDeliveryPlanReply(storiesOnly, factSheet(), [bottleneck]);
    const followUp = buildDeliveryPlanFollowUpPrompt(factSheet(), [bottleneck], result);
    expect(followUp).toContain('no usable answer for sl-throughput-s2');
    expect(followUp).toContain('sl-throughput-s2 | x | ___');
    expect(followUp).not.toContain('DELIVERY_PLAN_STORIES:');
  });
});

describe('parseDeliveryPlanReply — carryover rejection', () => {
  it('rejects an AI Story that targets a carryover Feature', () => {
    const sheet = factSheet();
    sheet.features.push({
      key: 'DENP-200', summary: 'Carryover', sizePoints: 5, priorityRank: 2, priorityName: 'High',
      isCommitted: true, repoComponentNames: ['api'], domainComponentNames: [], dependencyKeys: [],
      targetFixVersion: null, existingChildren: [], isCarryover: true,
    });
    const reply = JSON.stringify({ kind: 'piDeliveryPlan', stories: [{ featureKey: 'DENP-200', summary: 'Dup', repos: ['api'] }] });
    const result = parseDeliveryPlanReply(reply, sheet, []);
    expect(result.stories).toHaveLength(0);
    expect(result.rejected[0].reason).toMatch(/carryover/);
  });
});
