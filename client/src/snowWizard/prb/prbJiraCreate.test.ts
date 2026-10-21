// prbJiraCreate.test.ts — Proves the three items are created in order, put on the Epic, linked, and never duplicated on retry.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDefaultRoleChoices, buildPrbJiraDrafts, type PrbExistingIssue, type PrbRoleChoices } from './prbJiraPlan.ts';

const jiraApiMock = vi.hoisted(() => ({
  jiraGet: vi.fn(),
  createIssue: vi.fn(),
  createIssueLink: vi.fn(),
  getProjectIssueTypes: vi.fn(),
  getIssueTypeFields: vi.fn(),
  jiraPut: vi.fn(),
}));
vi.mock('../../services/jiraApi.ts', () => jiraApiMock);

import {
  buildDefectEnvironmentField,
  createPrbJiraWork,
  describeJiraRefusal,
  EMPTY_PRB_PROGRESS,
  findExistingPrbIssues,
  hasPrbWorkToDo,
} from './prbJiraCreate.ts';

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

const ALL_NEW: PrbRoleChoices = buildDefaultRoleChoices({});

const BASE_REQUEST = {
  prbNumber: 'PRB001',
  projectKey: 'ENCUC',
  epicKey: 'EPIC-7',
  drafts: DRAFTS,
  roleChoices: ALL_NEW,
  startingProgress: EMPTY_PRB_PROGRESS,
};

function buildPickedIssue(key: string, overrides: Partial<PrbExistingIssue> = {}): PrbExistingIssue {
  return { key, summary: `${key} words`, issueTypeName: 'Story', statusName: 'Open', labels: [], linkedKeys: [], ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  arrangeCreateScreens([{ fieldId: 'summary', name: 'Summary' }, { fieldId: EPIC_FIELD_ID, name: 'Epic Link' }]);
  arrangeNoExistingWork();
  jiraApiMock.createIssueLink.mockResolvedValue(undefined);
  jiraApiMock.jiraPut.mockResolvedValue(undefined);
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
    const retryResult = await createPrbJiraWork({ ...BASE_REQUEST, startingProgress: firstResult.progress });

    expect(jiraApiMock.createIssue).toHaveBeenCalledTimes(1);
    expect(readCreatedFields(0).summary).toBe('[QE] Broken login');
    expect(jiraApiMock.createIssueLink).toHaveBeenCalledTimes(1);
    expect(retryResult.isComplete).toBe(true);
  });

  it('uses a Defect already in Jira: makes only the two stories and links them to it', async () => {
    const labelledDefect = buildPickedIssue('ENCUC-9', { issueTypeName: 'Defect', labels: ['prb-prb001', 'prb-prb001-defect'] });
    arrangeCreatesInOrder('ENCUC-10', 'ENCUC-11');
    const result = await createPrbJiraWork({ ...BASE_REQUEST, roleChoices: { ...ALL_NEW, defect: { mode: 'existing', issue: labelledDefect } } });

    expect(jiraApiMock.createIssue).toHaveBeenCalledTimes(2);
    expect(readCreatedFields(0).summary).toBe('[SL] Broken login');
    expect(jiraApiMock.jiraPut).not.toHaveBeenCalled();
    expect(jiraApiMock.createIssueLink).toHaveBeenCalledWith({ type: { name: 'Relates' }, inwardIssue: { key: 'ENCUC-10' }, outwardIssue: { key: 'ENCUC-9' } });
    expect(result.isComplete).toBe(true);
  });

  it('makes only the SL story when the QE story is left out, and links it to the existing Defect', async () => {
    const defect = buildPickedIssue('ENCUC-9', { labels: ['prb-prb001-defect'] });
    arrangeCreatesInOrder('ENCUC-10');
    const result = await createPrbJiraWork({ ...BASE_REQUEST, roleChoices: { defect: { mode: 'existing', issue: defect }, sl: { mode: 'new' }, qe: { mode: 'skip' } } });

    expect(jiraApiMock.createIssue).toHaveBeenCalledTimes(1);
    expect(jiraApiMock.getProjectIssueTypes).toHaveBeenCalledTimes(1);
    expect(result.progress.createdKeys).toEqual({ defect: 'ENCUC-9', sl: 'ENCUC-10' });
    expect(jiraApiMock.createIssueLink).toHaveBeenCalledTimes(1);
    expect(result.isComplete).toBe(true);
  });

  it('uses stories made by hand: labels them for the problem, makes only the Defect, and links both to it', async () => {
    arrangeCreatesInOrder('ENCUC-1');
    const result = await createPrbJiraWork({
      ...BASE_REQUEST,
      roleChoices: { defect: { mode: 'new' }, sl: { mode: 'existing', issue: buildPickedIssue('X-2') }, qe: { mode: 'existing', issue: buildPickedIssue('X-3') } },
    });

    expect(jiraApiMock.createIssue).toHaveBeenCalledTimes(1);
    expect(readCreatedFields(0).summary).toBe('[DEV] PRB001 — Broken login');
    expect(jiraApiMock.jiraPut).toHaveBeenCalledWith('/rest/api/2/issue/X-2', { update: { labels: [{ add: 'prb-prb001' }, { add: 'prb-prb001-sl' }] } });
    expect(jiraApiMock.jiraPut).toHaveBeenCalledWith('/rest/api/2/issue/X-3', { update: { labels: [{ add: 'prb-prb001' }, { add: 'prb-prb001-qe' }] } });
    expect(jiraApiMock.createIssueLink).toHaveBeenCalledWith({ type: { name: 'Relates' }, inwardIssue: { key: 'X-3' }, outwardIssue: { key: 'ENCUC-1' } });
    expect(result.progress.labelledRoles).toEqual(['sl', 'qe']);
    expect(result.isComplete).toBe(true);
  });

  it('never re-links picked issues Jira already shows as linked', async () => {
    const defect = buildPickedIssue('D-1', { labels: ['prb-prb001-defect'] });
    const story = buildPickedIssue('S-1', { labels: ['prb-prb001-sl'], linkedKeys: ['D-1'] });
    arrangeCreatesInOrder('ENCUC-3');
    await createPrbJiraWork({ ...BASE_REQUEST, roleChoices: { defect: { mode: 'existing', issue: defect }, sl: { mode: 'existing', issue: story }, qe: { mode: 'new' } } });

    expect(jiraApiMock.createIssueLink).toHaveBeenCalledTimes(1);
    expect(jiraApiMock.createIssueLink.mock.calls[0][0].inwardIssue).toEqual({ key: 'ENCUC-3' });
  });

  it('reports a label that could not be added, and retries only that label', async () => {
    jiraApiMock.jiraPut.mockRejectedValueOnce(new Error('No edit permission'));
    const choices: PrbRoleChoices = { defect: { mode: 'skip' }, sl: { mode: 'existing', issue: buildPickedIssue('X-2') }, qe: { mode: 'skip' } };
    const firstResult = await createPrbJiraWork({ ...BASE_REQUEST, roleChoices: choices });
    expect(firstResult.failures).toEqual([{ role: 'sl', stage: 'label', message: 'No edit permission' }]);
    expect(firstResult.isComplete).toBe(false);

    const retryResult = await createPrbJiraWork({ ...BASE_REQUEST, roleChoices: choices, startingProgress: firstResult.progress });
    expect(jiraApiMock.jiraPut).toHaveBeenCalledTimes(2);
    expect(jiraApiMock.createIssue).not.toHaveBeenCalled();
    expect(retryResult.isComplete).toBe(true);
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

describe('findExistingPrbIssues', () => {
  it('searches by the problem label and says which item each issue is, with its links', async () => {
    jiraApiMock.jiraGet.mockResolvedValue({
      issues: [
        { key: 'A-1', fields: { labels: ['prb-prb001'], issuetype: { name: 'Defect' }, summary: 'PRB001 — x', issuelinks: [] } },
        { key: 'A-2', fields: { labels: ['prb-prb001'], issuetype: { name: 'Story' }, summary: 'SL: x', issuelinks: [{ outwardIssue: { key: 'A-1' } }] } },
        { key: 'A-3', fields: { labels: ['prb-prb001', 'prb-prb001-qe'], issuetype: { name: 'Story' }, summary: 'edited', issuelinks: [] } },
      ],
    });
    const foundIssues = await findExistingPrbIssues('PRB001');

    expect(decodeURIComponent(jiraApiMock.jiraGet.mock.calls[0][0])).toContain('labels = "prb-prb001"');
    expect([foundIssues.defect?.key, foundIssues.sl?.key, foundIssues.qe?.key]).toEqual(['A-1', 'A-2', 'A-3']);
    expect(foundIssues.sl?.linkedKeys).toEqual(['A-1']);
  });

  it('recognises hand-made items named with the bracketed "[SL]" / "[QE]" tags', async () => {
    jiraApiMock.jiraGet.mockResolvedValue({
      issues: [
        { key: 'B-2', fields: { labels: ['prb-prb001'], issuetype: { name: 'Story' }, summary: '[SL] x', issuelinks: [] } },
        { key: 'B-3', fields: { labels: ['prb-prb001'], issuetype: { name: 'Story' }, summary: '[QE] x', issuelinks: [] } },
      ],
    });
    const foundIssues = await findExistingPrbIssues('PRB001');
    expect(Object.keys(foundIssues)).toEqual(['sl', 'qe']);
  });
});

describe('hasPrbWorkToDo', () => {
  it('is false once every chosen item is in Jira, labelled and linked — and true while anything is left', () => {
    const defect = buildPickedIssue('D-1', { labels: ['prb-prb001-defect'] });
    const story = buildPickedIssue('S-1', { labels: ['prb-prb001-sl'], linkedKeys: ['D-1'] });
    expect(hasPrbWorkToDo('PRB001', { defect: { mode: 'existing', issue: defect }, sl: { mode: 'existing', issue: story }, qe: { mode: 'skip' } })).toBe(false);
    expect(hasPrbWorkToDo('PRB001', { defect: { mode: 'existing', issue: defect }, sl: { mode: 'existing', issue: buildPickedIssue('S-2') }, qe: { mode: 'skip' } })).toBe(true);
    expect(hasPrbWorkToDo('PRB001', ALL_NEW)).toBe(true);
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

  it('names a refused field by its name on the form when it is known', () => {
    const refusal = new Error('Jira POST /rest/api/2/issue failed: 400 — env_field_9: This field is required');
    expect(describeJiraRefusal(refusal, { env_field_9: 'Defect Environment' })).toBe('400 — Defect Environment: This field is required');
  });
});

describe('Defect Environment', () => {
  const ENVIRONMENT_FIELD = {
    fieldId: 'env_field_9', name: 'Defect Environment', required: true,
    allowedValues: [{ id: '501', value: 'Production' }, { id: '502', value: 'Non-Production - INT' }],
  };

  it('picks the Production option by name, writing only the parent of the cascading select', () => {
    expect(buildDefectEnvironmentField([ENVIRONMENT_FIELD])).toEqual({ env_field_9: { id: '501' } });
  });

  it('writes nothing when the form has no such field or no Production option', () => {
    expect(buildDefectEnvironmentField([])).toEqual({});
    expect(buildDefectEnvironmentField([{ ...ENVIRONMENT_FIELD, allowedValues: [{ id: '502', value: 'Non-Production' }] }])).toEqual({});
  });

  it('sets Production on the Defect only, never on the stories', async () => {
    jiraApiMock.getIssueTypeFields.mockResolvedValue({
      values: [{ fieldId: EPIC_FIELD_ID, name: 'Epic Link', required: false }, ENVIRONMENT_FIELD],
    });
    arrangeCreatesInOrder('ENCUC-1', 'ENCUC-2', 'ENCUC-3');
    await createPrbJiraWork(BASE_REQUEST);
    expect(readCreatedFields(0).env_field_9).toEqual({ id: '501' });
    expect(readCreatedFields(1).env_field_9).toBeUndefined();
    expect(readCreatedFields(2).env_field_9).toBeUndefined();
  });
});
