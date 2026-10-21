// usePrbWizardState.test.ts — Proves the problem job keeps edits across Back/Next, starts each item on what Jira
// already holds, does only what the user chose, and never re-creates what exists.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookupsMock = vi.hoisted(() => ({
  searchProblems: vi.fn(),
  loadJiraProjects: vi.fn(),
  searchOpenEpics: vi.fn(),
  searchExistingIssues: vi.fn(),
  readRememberedPrbProject: vi.fn(() => 'GONE'),
  rememberPrbProject: vi.fn(),
}));
const createMock = vi.hoisted(() => ({
  EMPTY_PRB_PROGRESS: { createdKeys: {}, linkedRoles: [], labelledRoles: [] },
  createPrbJiraWork: vi.fn(),
  findExistingPrbIssues: vi.fn(),
  hasPrbWorkToDo: vi.fn(() => true),
}));
vi.mock('./prbLookups.ts', () => lookupsMock);
vi.mock('./prbJiraCreate.ts', () => createMock);

import { SNOW_URL_STORAGE_KEY } from '../shell/wizardSettings.ts';
import { hasExistingWork, readActiveStepIds, readPrbStepGate, usePrbWizardState } from './usePrbWizardState.ts';

const PROBLEM = { sysId: 's1', number: 'PRB1', shortDescription: 'Broken', description: 'Text', stateLabel: 'Assess' };
const EPIC = { key: 'EP-1', summary: 'Epic', statusName: 'Open' };
const FOUND_DEFECT = { key: 'A-9', summary: '[DEV] PRB1 — Broken', issueTypeName: 'Defect', statusName: 'Open', labels: ['prb-prb1-defect'], linkedKeys: [] };
const HAND_MADE_STORY = { key: 'X-2', summary: 'SL work', issueTypeName: 'Story', statusName: 'Open', labels: [], linkedKeys: [] };
const PARTIAL_PROGRESS = { createdKeys: { defect: 'A-1', sl: 'A-2' }, linkedRoles: ['sl'], labelledRoles: [] };

async function walkToChoose() {
  const rendered = renderHook(() => usePrbWizardState());
  act(() => rendered.result.current.actions.chooseProblem(PROBLEM));
  act(() => rendered.result.current.actions.goNext());
  await waitFor(() => expect(rendered.result.current.state.existingWork.status).toBe('done'));
  act(() => rendered.result.current.actions.goNext());
  await waitFor(() => expect(rendered.result.current.state.projectList.status).toBe('ready'));
  return rendered;
}

async function walkToDrafts() {
  const rendered = await walkToChoose();
  act(() => rendered.result.current.actions.goNext());
  act(() => rendered.result.current.actions.chooseProject('ENCUC'));
  act(() => rendered.result.current.actions.patchState({ chosenEpic: EPIC }));
  act(() => rendered.result.current.actions.goNext());
  return rendered;
}

beforeEach(() => {
  vi.clearAllMocks();
  createMock.findExistingPrbIssues.mockResolvedValue({});
  createMock.hasPrbWorkToDo.mockReturnValue(true);
  lookupsMock.loadJiraProjects.mockResolvedValue([{ id: '1', key: 'ENCUC', name: 'Enrollment' }]);
});

describe('usePrbWizardState', () => {
  it('drops a remembered project Jira no longer lists', async () => {
    const rendered = await walkToDrafts();
    expect(rendered.result.current.state.stepId).toBe('drafts');
    expect(lookupsMock.rememberPrbProject).toHaveBeenCalledWith('ENCUC');
  });

  it('links the drafts to the problem on the ServiceNow address saved in Settings', async () => {
    localStorage.setItem(SNOW_URL_STORAGE_KEY, 'https://acme.service-now.com');
    try {
      const rendered = await walkToDrafts();
      expect(JSON.stringify(rendered.result.current.state.drafts)).toContain('https://acme.service-now.com/');
    } finally {
      localStorage.removeItem(SNOW_URL_STORAGE_KEY);
    }
  });

  it('keeps draft edits when going Back and Next again', async () => {
    const rendered = await walkToDrafts();
    act(() => rendered.result.current.actions.updateDraft('sl', { summary: 'SL: edited' }));
    act(() => rendered.result.current.actions.goBack());
    act(() => rendered.result.current.actions.goNext());
    expect(rendered.result.current.state.drafts[1].summary).toBe('SL: edited');
  });

  it('starts each item on what Jira already holds, and everything else on "make a new one"', async () => {
    createMock.findExistingPrbIssues.mockResolvedValue({ defect: FOUND_DEFECT });
    const rendered = await walkToChoose();
    expect(rendered.result.current.state.stepId).toBe('choose');
    expect(rendered.result.current.state.roleChoices).toEqual({ defect: { mode: 'existing', issue: FOUND_DEFECT }, sl: { mode: 'new' }, qe: { mode: 'new' } });
  });

  it('sends the choices on the first press, and retries from what was done', async () => {
    createMock.createPrbJiraWork.mockResolvedValue({ progress: PARTIAL_PROGRESS, failures: [{ role: 'qe', stage: 'create', message: 'x' }], isComplete: false });
    const rendered = await walkToDrafts();
    act(() => rendered.result.current.actions.goNext());
    await waitFor(() => expect(rendered.result.current.state.createResult).not.toBeNull());
    expect(createMock.createPrbJiraWork.mock.calls[0][0]).toMatchObject({ prbNumber: 'PRB1', epicKey: 'EP-1', roleChoices: { defect: { mode: 'new' } } });

    act(() => rendered.result.current.actions.retryRest());
    await waitFor(() => expect(createMock.createPrbJiraWork).toHaveBeenCalledTimes(2));
    expect(createMock.createPrbJiraWork.mock.calls[1][0]).toMatchObject({ startingProgress: PARTIAL_PROGRESS });
  });

  it('passes by the Epic and drafts screens when nothing is made new, creating straight from Choose', async () => {
    createMock.createPrbJiraWork.mockResolvedValue({ progress: PARTIAL_PROGRESS, failures: [], isComplete: true });
    const rendered = await walkToChoose();
    act(() => rendered.result.current.actions.chooseRoleMode('defect', 'skip'));
    act(() => rendered.result.current.actions.chooseRoleMode('qe', 'skip'));
    act(() => rendered.result.current.actions.chooseRoleMode('sl', 'existing'));
    act(() => rendered.result.current.actions.pickExistingIssue('sl', HAND_MADE_STORY));
    expect(readActiveStepIds(rendered.result.current.state)).toEqual(['find', 'confirm', 'choose', 'result']);

    act(() => rendered.result.current.actions.goNext());
    await waitFor(() => expect(createMock.createPrbJiraWork).toHaveBeenCalled());
    expect(rendered.result.current.state.stepId).toBe('result');
  });

  it('searches Jira for an item to use and keeps each item\'s search apart', async () => {
    lookupsMock.searchExistingIssues.mockResolvedValue([HAND_MADE_STORY]);
    const rendered = await walkToChoose();
    act(() => rendered.result.current.actions.changeRoleSearchText('sl', 'X-2'));
    await act(async () => { await rendered.result.current.actions.runRoleSearch('sl', 'X-2'); });
    expect(lookupsMock.searchExistingIssues).toHaveBeenCalledWith('X-2');
    expect(rendered.result.current.state.roleSearches.sl.results).toEqual({ status: 'ready', items: [HAND_MADE_STORY] });
    expect(rendered.result.current.state.roleSearches.qe.results.status).toBe('idle');
  });

  it('says whether Jira already holds work for the problem', () => {
    expect(hasExistingWork({ status: 'done', foundIssues: {} })).toBe(false);
    expect(hasExistingWork({ status: 'done', foundIssues: { defect: FOUND_DEFECT } })).toBe(true);
  });
});

describe('readPrbStepGate', () => {
  it('holds Next with a plain reason until each screen has its decision', async () => {
    const rendered = renderHook(() => usePrbWizardState());
    expect(readPrbStepGate(rendered.result.current.state)).toEqual({ canGoNext: false, blockedReason: 'Choose a problem from the list' });
    act(() => rendered.result.current.actions.chooseProblem(PROBLEM));
    expect(readPrbStepGate(rendered.result.current.state).canGoNext).toBe(true);

    createMock.findExistingPrbIssues.mockRejectedValue(new Error('offline'));
    act(() => rendered.result.current.actions.goNext());
    await waitFor(() => expect(rendered.result.current.state.existingWork.status).toBe('failed'));
    expect(readPrbStepGate(rendered.result.current.state).blockedReason).toMatch(/Try again/);
  });

  it('on Choose, needs every "use one already in Jira" picked, each issue used once, and something to do', async () => {
    const rendered = await walkToChoose();
    act(() => rendered.result.current.actions.chooseRoleMode('sl', 'existing'));
    expect(readPrbStepGate(rendered.result.current.state).blockedReason).toBe('Pick the SL story from the search results');

    act(() => rendered.result.current.actions.pickExistingIssue('sl', HAND_MADE_STORY));
    act(() => rendered.result.current.actions.pickExistingIssue('qe', HAND_MADE_STORY));
    expect(readPrbStepGate(rendered.result.current.state).blockedReason).toMatch(/cannot be two of the items/);

    act(() => rendered.result.current.actions.chooseRoleMode('qe', 'skip'));
    expect(readPrbStepGate(rendered.result.current.state).canGoNext).toBe(true);
    createMock.hasPrbWorkToDo.mockReturnValue(false);
    expect(readPrbStepGate(rendered.result.current.state).blockedReason).toMatch(/already in Jira and linked/);
  });

  it('needs a project and an Epic, then a summary on every new item\'s draft only', async () => {
    const rendered = await walkToDrafts();
    expect(readPrbStepGate(rendered.result.current.state).canGoNext).toBe(true);
    act(() => rendered.result.current.actions.updateDraft('qe', { summary: '  ' }));
    expect(readPrbStepGate(rendered.result.current.state).blockedReason).toBe('Give every item a summary');
    act(() => rendered.result.current.actions.chooseRoleMode('qe', 'skip'));
    expect(readPrbStepGate(rendered.result.current.state).canGoNext).toBe(true);
    act(() => rendered.result.current.actions.goBack());
    act(() => rendered.result.current.actions.patchState({ chosenEpic: null }));
    expect(readPrbStepGate(rendered.result.current.state).blockedReason).toMatch(/Epic/);
  });
});
