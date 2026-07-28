// piPlanFields.test.ts — Resolves plan-write field ids from the reused hygiene discovery.

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loadHygieneFieldConfig: vi.fn() }));
vi.mock('../../Hygiene/checks/hygieneFieldConfig.ts', () => ({ loadHygieneFieldConfig: mocks.loadHygieneFieldConfig }));
vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn() }));

import { resolvePiPlanFieldIds, pickDeliveryIssueTypeIds, type JiraIssueTypeSummary } from './piPlanFields.ts';

describe('resolvePiPlanFieldIds', () => {
  it('takes the first discovered id per concept, Due is native duedate', async () => {
    mocks.loadHygieneFieldConfig.mockResolvedValue({
      targetStartFieldIds: ['customfield_20001', 'customfield_10101'],
      targetEndFieldIds: ['customfield_20002'],
      featureLinkFieldIds: ['customfield_20003'],
      programIncrementFieldIds: ['customfield_20004'],
    });
    const ids = await resolvePiPlanFieldIds();
    expect(ids.targetStart).toBe('customfield_20001');
    expect(ids.featureLink).toBe('customfield_20003');
    expect(ids.due).toBe('duedate');
  });

  it('falls back to platform defaults when a list is empty', async () => {
    mocks.loadHygieneFieldConfig.mockResolvedValue({
      targetStartFieldIds: [], targetEndFieldIds: [], featureLinkFieldIds: [], programIncrementFieldIds: [],
    });
    const ids = await resolvePiPlanFieldIds();
    expect(ids.targetStart).toBe('customfield_10101');
    expect(ids.targetEnd).toBe('customfield_10102');
    expect(ids.featureLink).toBe('customfield_10108');
    expect(ids.programIncrement).toBe('customfield_10301');
  });
});

describe('pickDeliveryIssueTypeIds', () => {
  const types: JiraIssueTypeSummary[] = [
    { id: '1', name: 'Epic', subtask: false },
    { id: '2', name: 'Story', subtask: false },
    { id: '3', name: 'Sub-task', subtask: true },
    { id: '4', name: 'Bug', subtask: false },
  ];

  it('picks the Story id and the Sub-task id by name/flag', () => {
    expect(pickDeliveryIssueTypeIds(types)).toEqual({ storyIssueTypeId: '2', subTaskIssueTypeId: '3' });
  });

  it('falls back to the first non-subtask / first subtask when names are non-standard', () => {
    const odd: JiraIssueTypeSummary[] = [
      { id: '9', name: 'Deliverable', subtask: false },
      { id: '8', name: 'Child', subtask: true },
    ];
    expect(pickDeliveryIssueTypeIds(odd)).toEqual({ storyIssueTypeId: '9', subTaskIssueTypeId: '8' });
  });

  it('yields empty ids when a category is absent', () => {
    expect(pickDeliveryIssueTypeIds([{ id: '1', name: 'Story', subtask: false }])).toEqual({ storyIssueTypeId: '1', subTaskIssueTypeId: '' });
  });
});
