// piDeliveryJira.test.ts — The delivery write-payload builders (spec 032, US2). Pure payload assertions.

import { describe, expect, it } from 'vitest';

import { buildDeliveryWriteRequests, type DeliveryWriteContext } from './piDeliveryJira.ts';
import type { PlannedStory } from './piDeliveryEngine.ts';

const context: DeliveryWriteContext = {
  projectKey: 'DENP', storyIssueTypeId: '10001', subTaskIssueTypeId: '10002',
  fieldIds: { featureLink: 'customfield_100', targetStart: 'customfield_101', targetEnd: 'customfield_102' },
  accountIdByDisplayName: { 'Dev One': 'acc-1', 'Dev Two': 'acc-2', 'SL Tester': 'acc-sl' },
};

function plannedStory(): PlannedStory {
  return {
    tempId: 'DENP-100#1', featureKey: 'DENP-100', summary: 'Enrollment', sizePoints: 10,
    codingSubtasks: [
      { repoName: 'api', repoComponentId: 'c-api', devPoints: 4, assignee: 'Dev One' },
      { repoName: 'ui', repoComponentId: 'c-ui', devPoints: 3, assignee: 'Dev Two' },
    ],
    slAssignee: 'SL Tester', sprintName: '26.4.1',
    dates: { targetStartIso: '2026-07-30', internalTestEndIso: '2026-08-05', targetEndIso: '2026-08-06', deployIntIso: '2026-08-06', deployRelIso: '2026-08-13', deployProdIso: '2026-08-28', dueIso: '2026-08-28', derivations: {} },
    warnings: [],
  };
}

describe('buildDeliveryWriteRequests', () => {
  it('builds a Story + one coding sub-task per repo + SL-test + 3 deploys', () => {
    const { storyRequest, subtaskRequests } = buildDeliveryWriteRequests(plannedStory(), context, 'DENP-500');
    expect((storyRequest.fields as Record<string, unknown>).summary).toBe('Enrollment');
    expect((storyRequest.fields as Record<string, unknown>)['customfield_100']).toBe('DENP-100');
    // 2 coding + SL + INT + REL + PROD = 6 sub-tasks
    expect(subtaskRequests).toHaveLength(6);
  });

  it('sets each coding sub-task\'s repo on the components field and its own assignee', () => {
    const { subtaskRequests } = buildDeliveryWriteRequests(plannedStory(), context, 'DENP-500');
    const apiCoding = subtaskRequests[0].fields as Record<string, unknown>;
    expect(apiCoding.summary).toBe('[api] Enrollment');
    expect(apiCoding.components).toEqual([{ id: 'c-api' }]);
    expect(apiCoding.parent).toEqual({ key: 'DENP-500' });
    expect(apiCoding.assignee).toEqual({ accountId: 'acc-1' });
  });

  it('titles the SL-test sub-task and assigns the SL tester', () => {
    const { subtaskRequests } = buildDeliveryWriteRequests(plannedStory(), context, 'DENP-500');
    const slTask = subtaskRequests.find((r) => (r.fields as Record<string, unknown>).summary === '[SL] SL Test — Enrollment');
    expect(slTask).toBeDefined();
    expect((slTask!.fields as Record<string, unknown>).assignee).toEqual({ accountId: 'acc-sl' });
  });

  it('carries the cadence dates onto the deploy checkpoints', () => {
    const { subtaskRequests } = buildDeliveryWriteRequests(plannedStory(), context, 'DENP-500');
    const relTask = subtaskRequests.find((r) => (r.fields as Record<string, unknown>).summary === '[REL] Deploy — Enrollment');
    expect((relTask!.fields as Record<string, unknown>).duedate).toBe('2026-08-13');
  });

  it('sets the Story primary owner to the first coding sub-task\'s assignee', () => {
    const { storyRequest } = buildDeliveryWriteRequests(plannedStory(), context);
    expect((storyRequest.fields as Record<string, unknown>).assignee).toEqual({ accountId: 'acc-1' });
  });
});

describe('buildGapSubtaskRequest (carryover gap-fill)', () => {
  it('builds a coding gap under the existing Story with its repo component', async () => {
    const { buildGapSubtaskRequest } = await import('./piDeliveryJira.ts');
    const request = buildGapSubtaskRequest(
      { kind: 'coding', summary: '[ui] Enrollment', repo: { repoName: 'ui', repoComponentId: 'c-ui', devPoints: 1, assignee: null } },
      'DENP-500', context,
    );
    const fields = request.fields as Record<string, unknown>;
    expect(fields.parent).toEqual({ key: 'DENP-500' });
    expect(fields.components).toEqual([{ id: 'c-ui' }]);
    expect(fields.summary).toBe('[ui] Enrollment');
  });

  it('builds a checkpoint gap with no components and no dates', async () => {
    const { buildGapSubtaskRequest } = await import('./piDeliveryJira.ts');
    const request = buildGapSubtaskRequest({ kind: 'deployRel', summary: '[REL] Deploy — Enrollment' }, 'DENP-500', context);
    const fields = request.fields as Record<string, unknown>;
    expect(fields.components).toBeUndefined();
    expect(fields.duedate).toBeUndefined();
    expect(fields.summary).toBe('[REL] Deploy — Enrollment');
  });
});

describe('buildDeliveryStoryRequest — fixVersion', () => {
  it('stamps the determined fixVersion on the Story create', async () => {
    const { buildDeliveryStoryRequest } = await import('./piDeliveryJira.ts');
    const story = { ...plannedStory(), fixVersionName: 'Aug' };
    const request = buildDeliveryStoryRequest(story, context);
    expect((request.fields as Record<string, unknown>).fixVersions).toEqual([{ name: 'Aug' }]);
  });
});
