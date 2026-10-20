// usePrbWizardState.test.ts — Proves the problem job keeps edits across Back/Next and never re-creates what exists.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lookupsMock = vi.hoisted(() => ({
  searchProblems: vi.fn(),
  loadJiraProjects: vi.fn(),
  searchOpenEpics: vi.fn(),
  readRememberedPrbProject: vi.fn(() => 'GONE'),
  rememberPrbProject: vi.fn(),
  readSnowInstanceOrigin: vi.fn(() => 'https://snow.example.com'),
}));
const createMock = vi.hoisted(() => ({
  EMPTY_PRB_PROGRESS: { createdKeys: {}, linkedRoles: [] },
  createPrbJiraWork: vi.fn(),
  findExistingPrbWork: vi.fn(),
}));
vi.mock('./prbLookups.ts', () => lookupsMock);
vi.mock('./prbJiraCreate.ts', () => createMock);

import { hasExistingWork, readPrbStepGate, usePrbWizardState } from './usePrbWizardState.ts';

const PROBLEM = { sysId: 's1', number: 'PRB1', shortDescription: 'Broken', description: 'Text', stateLabel: 'Assess' };
const EPIC = { key: 'EP-1', summary: 'Epic', statusName: 'Open' };
const PARTIAL_PROGRESS = { createdKeys: { defect: 'A-1', sl: 'A-2' }, linkedRoles: ['sl'] };

async function walkToDrafts() {
  const rendered = renderHook(() => usePrbWizardState());
  act(() => rendered.result.current.actions.chooseProblem(PROBLEM));
  act(() => rendered.result.current.actions.goNext());
  await waitFor(() => expect(rendered.result.current.state.existingWork.status).toBe('done'));
  act(() => rendered.result.current.actions.goNext());
  await waitFor(() => expect(rendered.result.current.state.projectList.status).toBe('ready'));
  act(() => rendered.result.current.actions.chooseProject('ENCUC'));
  act(() => rendered.result.current.actions.patchState({ chosenEpic: EPIC }));
  act(() => rendered.result.current.actions.goNext());
  return rendered;
}

beforeEach(() => {
  vi.clearAllMocks();
  createMock.findExistingPrbWork.mockResolvedValue({ createdKeys: {}, linkedRoles: [] });
  lookupsMock.loadJiraProjects.mockResolvedValue([{ id: '1', key: 'ENCUC', name: 'Enrollment' }]);
});

describe('usePrbWizardState', () => {
  it('drops a remembered project Jira no longer lists', async () => {
    const rendered = await walkToDrafts();
    expect(rendered.result.current.state.stepId).toBe('drafts');
    expect(lookupsMock.rememberPrbProject).toHaveBeenCalledWith('ENCUC');
  });

  it('keeps draft edits when going Back and Next again', async () => {
    const rendered = await walkToDrafts();
    act(() => rendered.result.current.actions.updateDraft('sl', { summary: 'SL: edited' }));
    act(() => rendered.result.current.actions.goBack());
    act(() => rendered.result.current.actions.goNext());
    expect(rendered.result.current.state.drafts[1].summary).toBe('SL: edited');
  });

  it('reuses existing work on the first press, and retries from what was made without re-reading Jira', async () => {
    createMock.createPrbJiraWork.mockResolvedValue({ progress: PARTIAL_PROGRESS, failures: [{ role: 'qe', stage: 'create', message: 'x' }], isComplete: false });
    const rendered = await walkToDrafts();
    act(() => rendered.result.current.actions.goNext());
    await waitFor(() => expect(rendered.result.current.state.createResult).not.toBeNull());
    expect(createMock.createPrbJiraWork.mock.calls[0][0]).toMatchObject({ shouldReuseExisting: true, prbNumber: 'PRB1', epicKey: 'EP-1' });

    act(() => rendered.result.current.actions.retryRest());
    await waitFor(() => expect(createMock.createPrbJiraWork).toHaveBeenCalledTimes(2));
    expect(createMock.createPrbJiraWork.mock.calls[1][0]).toMatchObject({ shouldReuseExisting: false, startingProgress: PARTIAL_PROGRESS });
  });

  it('makes a fresh set only after the user confirms it', async () => {
    createMock.createPrbJiraWork.mockResolvedValue({ progress: PARTIAL_PROGRESS, failures: [], isComplete: true });
    const rendered = await walkToDrafts();
    act(() => rendered.result.current.actions.patchState({ isNewSetConfirmed: true }));
    act(() => rendered.result.current.actions.goNext());
    await waitFor(() => expect(createMock.createPrbJiraWork).toHaveBeenCalled());
    expect(createMock.createPrbJiraWork.mock.calls[0][0].shouldReuseExisting).toBe(false);
  });

  it('says whether Jira already holds work for the problem', () => {
    expect(hasExistingWork({ status: 'done', progress: { createdKeys: {}, linkedRoles: [] } })).toBe(false);
    expect(hasExistingWork({ status: 'done', progress: { createdKeys: { defect: 'A-1' }, linkedRoles: [] } })).toBe(true);
  });
});

describe('readPrbStepGate', () => {
  it('holds Next with a plain reason until each screen has its decision', async () => {
    const rendered = renderHook(() => usePrbWizardState());
    expect(readPrbStepGate(rendered.result.current.state)).toEqual({ canGoNext: false, blockedReason: 'Choose a problem from the list' });
    act(() => rendered.result.current.actions.chooseProblem(PROBLEM));
    expect(readPrbStepGate(rendered.result.current.state).canGoNext).toBe(true);

    createMock.findExistingPrbWork.mockRejectedValue(new Error('offline'));
    act(() => rendered.result.current.actions.goNext());
    await waitFor(() => expect(rendered.result.current.state.existingWork.status).toBe('failed'));
    expect(readPrbStepGate(rendered.result.current.state).blockedReason).toMatch(/Try again/);
  });

  it('needs a project and an Epic, then a summary on every draft', async () => {
    const rendered = await walkToDrafts();
    expect(readPrbStepGate(rendered.result.current.state).canGoNext).toBe(true);
    act(() => rendered.result.current.actions.updateDraft('qe', { summary: '  ' }));
    expect(readPrbStepGate(rendered.result.current.state).blockedReason).toBe('Give every item a summary');
    act(() => rendered.result.current.actions.goBack());
    act(() => rendered.result.current.actions.patchState({ chosenEpic: null }));
    expect(readPrbStepGate(rendered.result.current.state).blockedReason).toMatch(/Epic/);
  });
});
