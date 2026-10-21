// prbJiraCreate.test.ts — Proves the three items are created in order, put on the Epic, linked, and never duplicated on retry.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildPrbJiraDrafts } from './prbJiraPlan.ts';

const jiraApiMock = vi.hoisted(() => ({
  jiraGet: vi.fn(),
  createIssue: vi.fn(),
  createIssueLink: vi.fn(),
  getProjectIssueTypes: vi.fn(),
  getIssueTypeFields: vi.fn(),
}));
vi.mock('../../services/jiraApi.ts', () => jiraApiMock);

import { createPrbJiraWork, describeJiraRefusal, EMPTY_PRB_PROGRESS, findExistingPrbWork } from './prbJiraCreate.ts';

const EPIC_FIELD_ID = 'cf-epic-link';
const DRAFTS = buildPrbJiraDrafts(
  { number: 'PRB001', shortDescription: 'Broken login', description: 'Details', link: 'https://snow/x' },
  'EPIC-7',
  'ENCUC',
);

function arrangeCreateScreens(fieldNames: Array<{ fieldId: string; name: string }>): void {
  jiraApiMock.getProjectIssueTypes.mockResolvedValue({
    values: [
      { id: '10', name: 'Defect', subtask: false },
      { id: '20', name: 'Story', subtask: false },
      { id: '30', name: 'Sub-task', subtask: true },
    ],
  });
  jiraApiMock.getIssueTypeFields.mockResolvedValue({
    values: fieldNames.map((field) => ({ ...field, required: false })),
  });
}

function arrangeNoExistingWork(): void {
  jiraApiMock.jiraGet.mockResolvedValue({ issues: [] });
}

function arrangeCreatesInOrder(...keys: Array<string | Error>): void {
  for (const outcome of keys) {
    if (outcome instanceof Error) jiraApiMock.createIssue.mockRejectedValueOnce(outcome);
    else jiraApiMock.createIssue.mockResolvedValueOnce({ id: '1', key: outcome, self: '' });
  }
}

function readCreatedFields(callIndex: number): Record<string, unknown> {
  return jiraApiMock.createIssue.mock.calls[callIndex][0].fields;
}

const BASE_REQUEST = {
  prbNumber: 'PRB001',
  projectKey: 'ENCUC',
  epicKey: 'EPIC-7',
  drafts: DRAFTS,
  startingProgress: EMPTY_PRB_PROGRESS,
  shouldReuseExisting: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  arrangeCreateScreens([{ fieldId: 'summary', name: 'Summary' }, { fieldId: EPIC_FIELD_ID, name: 'Epic Link' }]);
  arrangeNoExistingWork();
  jiraApiMock.createIssueLink.mockResolvedValue(undefined);
});

describe('createPrbJiraWork', () => {
  it('creates the Defect, then SL, then QE, each with the live issue type and the Epic found by field name', async () => {
    arrangeCreatesInOrder('ENCUC-1', 'ENCUC-2', 'ENCUC-3');
    const result = await createPrbJiraWork(BASE_REQUEST);

    expect(result.isComplete).toBe(true);
    expect(result.progress.createdKeys).toEqual({ defect: 'ENCUC-1', sl: 'ENCUC-2', qe: 'ENCUC-3' });
    expect(readCreatedFields(0).issuetype).toEqual({ id: '10' });
    expect(readCreatedFields(1).summary).toBe('[SL] Broken login');
    expect(readCreatedFields(2).summary).toBe('[QE] Broken login');
    for (const callIndex of [0, 1, 2]) {
      expect(readCreatedFields(callIndex)[EPIC_FIELD_ID]).toBe('EPIC-7');
      expect(readCreatedFields(callIndex).project).toEqual({ key: 'ENCUC' });
    }
  });

  it('links each story to the Defect with a Relates link', async () => {
    arrangeCreatesInOrder('ENCUC-1', 'ENCUC-2', 'ENCUC-3');
    const result = await createPrbJiraWork(BASE_REQUEST);

    expect(jiraApiMock.createIssueLink).toHaveBeenCalledWith({ type: { name: 'Relates' }, inwardIssue: { key: 'ENCUC-2' }, outwardIssue: { key: 'ENCUC-1' } });
    expect(jiraApiMock.createIssueLink).toHaveBeenCalledWith({ type: { name: 'Relates' }, inwardIssue: { key: 'ENCUC-3' }, outwardIssue: { key: 'ENCUC-1' } });
    expect(result.progress.linkedRoles).toEqual(['sl', 'qe']);
  });

  it('reports a failed story and, on retry, creates only that story and its link', async () => {
    arrangeCreatesInOrder('ENCUC-1', 'ENCUC-2', new Error('No permission'));
    const firstResult = await createPrbJiraWork(BASE_REQUEST);
    expect(firstResult.isComplete).toBe(false);
    expect(firstResult.failures).toEqual([{ role: 'qe', stage: 'create', message: 'No permission' }]);

    vi.clearAllMocks();
    arrangeCreatesInOrder('ENCUC-3');
    const retryResult = await createPrbJiraWork({ ...BASE_REQUEST, startingProgress: firstResult.progress, shouldReuseExisting: false });

    expect(jiraApiMock.createIssue).toHaveBeenCalledTimes(1);
    expect(readCreatedFields(0).summary).toBe('[QE] Broken login');
    expect(jiraApiMock.createIssueLink).toHaveBeenCalledTimes(1);
    expect(retryResult.isComplete).toBe(true);
  });

  it('reuses items Jira already holds for this problem instead of making a second Defect', async () => {
    jiraApiMock.jiraGet.mockResolvedValue({
      issues: [{ key: 'ENCUC-9', fields: { labels: ['prb-prb001', 'prb-prb001-defect'], issuetype: { name: 'Defect' }, summary: 'x', issuelinks: [] } }],
    });
    arrangeCreatesInOrder('ENCUC-10', 'ENCUC-11');
    const result = await createPrbJiraWork(BASE_REQUEST);

    expect(jiraApiMock.createIssue).toHaveBeenCalledTimes(2);
    expect(readCreatedFields(0).summary).toBe('[SL] Broken login');
    expect(result.progress.createdKeys.defect).toBe('ENCUC-9');
  });

  it('makes a fresh set only when told to, ignoring what already exists', async () => {
    arrangeCreatesInOrder('ENCUC-1', 'ENCUC-2', 'ENCUC-3');
    await createPrbJiraWork({ ...BASE_REQUEST, shouldReuseExisting: false });
    expect(jiraApiMock.jiraGet).not.toHaveBeenCalled();
    expect(jiraApiMock.createIssue).toHaveBeenCalledTimes(3);
  });

  it('creates nothing when Jira cannot be checked for existing items', async () => {
    jiraApiMock.jiraGet.mockRejectedValue(new Error('offline'));
    const result = await createPrbJiraWork(BASE_REQUEST);
    expect(jiraApiMock.createIssue).not.toHaveBeenCalled();
    expect(result.failures[0].stage).toBe('prepare');
  });

  it('creates nothing when the create screen has no Epic Link, and says so plainly', async () => {
    arrangeCreateScreens([{ fieldId: 'summary', name: 'Summary' }]);
    const result = await createPrbJiraWork(BASE_REQUEST);
    expect(jiraApiMock.createIssue).not.toHaveBeenCalled();
    expect(result.failures).toHaveLength(3);
    expect(result.failures[0].message).toMatch(/Epic/);
  });

  it('uses the parent field when the project links Epics that way', async () => {
    arrangeCreateScreens([{ fieldId: 'parent', name: 'Parent' }]);
    arrangeCreatesInOrder('ENCUC-1', 'ENCUC-2', 'ENCUC-3');
    await createPrbJiraWork(BASE_REQUEST);
    expect(readCreatedFields(0).parent).toEqual({ key: 'EPIC-7' });
  });

  it('reports a failed link per story, and retries only the link', async () => {
    arrangeCreatesInOrder('ENCUC-1', 'ENCUC-2', 'ENCUC-3');
    jiraApiMock.createIssueLink.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Link refused'));
    const result = await createPrbJiraWork(BASE_REQUEST);
    expect(result.failures).toEqual([{ role: 'qe', stage: 'link', message: 'Link refused' }]);
    expect(result.progress.linkedRoles).toEqual(['sl']);
  });
});

describe('findExistingPrbWork', () => {
  it('searches by the problem label and reads roles and links', async () => {
    jiraApiMock.jiraGet.mockResolvedValue({
      issues: [
        { key: 'A-1', fields: { labels: ['prb-prb001'], issuetype: { name: 'Defect' }, summary: 'PRB001 — x', issuelinks: [] } },
        { key: 'A-2', fields: { labels: ['prb-prb001'], issuetype: { name: 'Story' }, summary: 'SL: x', issuelinks: [{ outwardIssue: { key: 'A-1' } }] } },
        { key: 'A-3', fields: { labels: ['prb-prb001', 'prb-prb001-qe'], issuetype: { name: 'Story' }, summary: 'edited', issuelinks: [] } },
      ],
    });
    const existing = await findExistingPrbWork('PRB001');

    expect(decodeURIComponent(jiraApiMock.jiraGet.mock.calls[0][0])).toContain('labels = "prb-prb001"');
    expect(existing.createdKeys).toEqual({ defect: 'A-1', sl: 'A-2', qe: 'A-3' });
    expect(existing.linkedRoles).toEqual(['sl']);
  });

  it('recognises hand-made items named with the bracketed "[SL]" / "[QE]" tags', async () => {
    jiraApiMock.jiraGet.mockResolvedValue({
      issues: [
        { key: 'B-2', fields: { labels: ['prb-prb001'], issuetype: { name: 'Story' }, summary: '[SL] x', issuelinks: [] } },
        { key: 'B-3', fields: { labels: ['prb-prb001'], issuetype: { name: 'Story' }, summary: '[QE] x', issuelinks: [] } },
      ],
    });
    const existing = await findExistingPrbWork('PRB001');
    expect(existing.createdKeys).toEqual({ sl: 'B-2', qe: 'B-3' });
  });
});

describe('describeJiraRefusal', () => {
  it('drops the request line and internal field ids, keeping the words Jira used', () => {
    const refusal = new Error('Jira POST /rest/api/2/issue failed: 400 — cf_field_123: Team is required');
    expect(describeJiraRefusal(refusal)).toBe('400 — Team is required');
  });

  it('falls back to a plain sentence when there is nothing to show', () => {
    expect(describeJiraRefusal('odd')).toBe('Jira refused the request');
  });
});
