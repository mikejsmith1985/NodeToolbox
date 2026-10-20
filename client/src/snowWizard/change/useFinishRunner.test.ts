// useFinishRunner.test.ts — Proves the last step creates per environment with the task plan, retries only what is missing,
// attaches evidence, and on a modify checks for remote edits before saving.

import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCrgState } from '../../views/SnowHub/hooks/useCrgState.ts';
import type { CrgDraftState, CrgHook } from './changeDraft.ts';
import { createChangeWizardSession, type ChangeWizardSession } from './changeWizardSession.ts';
import { attachAllEvidenceToChanges } from './evidenceUpload.ts';
import type { JiraEvidenceAttachment } from './jiraEvidence.ts';
import { fetchChangeSnapshot } from './modifyLoad.ts';
import { saveModifyTasks } from './modifyTasks.ts';
import { useFinishRunner } from './useFinishRunner.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));
vi.mock('./evidenceUpload.ts', () => ({ attachAllEvidenceToChanges: vi.fn(async () => ({ results: {}, problems: [] })) }));
vi.mock('./modifyLoad.ts', () => ({ fetchChangeSnapshot: vi.fn() }));
vi.mock('./modifyTasks.ts', () => ({ saveModifyTasks: vi.fn() }));

const PLAN = { 'Business Checkout': { REL: false, PRD: true, PFIX: true } };
const EVIDENCE_FILE = { name: 'results.pdf', size: 10 } as File;
const JIRA_FILE: JiraEvidenceAttachment = { issueKey: 'A-1', issueSummary: '', attachment: { attachmentId: '1', filename: 'report.pdf', sizeBytes: 5, contentUrl: '' } };

/** A REL + PRD draft from the real hook, with a staged task when asked. */
function buildDraft(hasNewTask = false): CrgDraftState {
  const draft = renderHook(() => useCrgState({ storageKey: 'snowWizard:change:runner-test' })).result.current.state;
  return {
    ...draft,
    relEnvironment: { ...draft.relEnvironment, isEnabled: true },
    prdEnvironment: { ...draft.prdEnvironment, isEnabled: true },
    changeTasks: hasNewTask ? [{ ...draft.changeTasks[0], id: 'n', name: 'New', shortDescription: 'New' } as CrgDraftState['changeTasks'][number]] : [],
  };
}

/** The runner over a draft and session the test can drive, with spy actions. */
function renderRunner(initialDraft: CrgDraftState, initialSession: ChangeWizardSession, onFinished = vi.fn(), evidenceFiles: File[] = [EVIDENCE_FILE], jiraEvidence: JiraEvidenceAttachment[] = []) {
  const actions = {
    createChg: vi.fn(async () => undefined), updateExistingChg: vi.fn(async () => undefined),
    updateEnvironment: vi.fn(),
  };
  const hookResult = renderHook(() => {
    const [draft, setDraft] = useState(initialDraft);
    const [session, setSession] = useState(initialSession);
    const crg = { state: draft, actions } as unknown as CrgHook;
    const runner = useFinishRunner({
      crg, session, updateSession: (update) => setSession((previous) => ({ ...previous, ...update })),
      ctaskEnvironmentPlan: PLAN, environmentValueByKey: { rel: 'rel-env', prd: 'prd-env' },
      evidenceFiles, jiraEvidence, editedStepIds: ['planning'], onFinished,
    });
    return { runner, session, setDraft };
  });
  return { hookResult, actions, onFinished };
}

/** Plays the hook finishing a write: submitting, then the result line. */
function finishWrite(setDraft: (update: (previous: CrgDraftState) => CrgDraftState) => void, resultText: string) {
  act(() => setDraft((previous) => ({ ...previous, isSubmitting: true, submitResult: null })));
  act(() => setDraft((previous) => ({ ...previous, isSubmitting: false, submitResult: resultText })));
}

describe('useFinishRunner — create', () => {
  beforeEach(() => vi.mocked(attachAllEvidenceToChanges).mockClear());

  it('creates with the task plan, records each change, attaches evidence and finishes', async () => {
    const { hookResult, actions, onFinished } = renderRunner(buildDraft(), createChangeWizardSession('create'));
    act(() => hookResult.result.current.runner.startCreate());
    expect(actions.createChg).toHaveBeenCalledWith({ rel: 'rel-env', prd: 'prd-env' }, { ctaskEnvironmentPlan: PLAN, reconcileAutoCtasks: true });

    finishWrite(hookResult.result.current.setDraft, '2 CHGs created: REL CHG1, PRD CHG2');

    await waitFor(() => expect(hookResult.result.current.runner.phase.kind).toBe('done'));
    expect(hookResult.result.current.session.createdChanges).toEqual([
      { environmentLabel: 'REL', changeNumber: 'CHG1' }, { environmentLabel: 'PRD', changeNumber: 'CHG2' },
    ]);
    expect(attachAllEvidenceToChanges).toHaveBeenCalledWith({ localFiles: [EVIDENCE_FILE], jiraAttachments: [] }, ['CHG1', 'CHG2'], expect.objectContaining({ onProgress: expect.any(Function) }));
    expect(onFinished).toHaveBeenCalled();
  });

  it('remembers each change’s tasks as the user built them, for the result screen', () => {
    const { hookResult } = renderRunner(buildDraft(true), createChangeWizardSession('create'));
    act(() => hookResult.result.current.runner.startCreate());
    expect(hookResult.result.current.session.taskNamesByEnvironment).toEqual({ REL: ['New'], PRD: ['New'] });
  });

  it('attaches ticked Jira files on their own, showing progress and noting a file that could not be fetched', async () => {
    vi.mocked(attachAllEvidenceToChanges).mockImplementationOnce(async (_evidence, _changeNumbers, options) => {
      options?.onProgress?.('Getting file 1 of 1 from Jira: report.pdf…');
      return { results: { CHG1: 'attached' }, problems: ['Could not get other.pdf from A-1 in Jira.'] };
    });
    const { hookResult } = renderRunner(buildDraft(), createChangeWizardSession('create'), vi.fn(), [], [JIRA_FILE]);
    act(() => hookResult.result.current.runner.startCreate());

    finishWrite(hookResult.result.current.setDraft, '1 CHG created: REL CHG1');

    await waitFor(() => expect(hookResult.result.current.runner.phase.kind).toBe('done'));
    expect(attachAllEvidenceToChanges).toHaveBeenCalledWith({ localFiles: [], jiraAttachments: [JIRA_FILE] }, ['CHG1'], expect.anything());
    expect(hookResult.result.current.session.evidenceResults).toEqual({ CHG1: 'attached' });
    expect(hookResult.result.current.session.outcomeNotes).toContain('Could not get other.pdf from A-1 in Jira.');
  });

  it('after a partial create, retries only the missing environment', async () => {
    const { hookResult, actions, onFinished } = renderRunner(buildDraft(), createChangeWizardSession('create'));
    act(() => hookResult.result.current.runner.startCreate());
    finishWrite(hookResult.result.current.setDraft, 'CHG1 created; then a later submission failed: HTTP 500');
    await waitFor(() => expect(hookResult.result.current.session.failureText).toBe('HTTP 500'));
    expect(onFinished).not.toHaveBeenCalled();

    act(() => hookResult.result.current.runner.retryMissing());
    expect(actions.updateEnvironment).toHaveBeenCalledWith('rel', { isEnabled: false });
    act(() => hookResult.result.current.setDraft((previous) => ({ ...previous, relEnvironment: { ...previous.relEnvironment, isEnabled: false } })));
    expect(actions.createChg).toHaveBeenCalledTimes(2);

    finishWrite(hookResult.result.current.setDraft, 'CHG2 created');
    await waitFor(() => expect(onFinished).toHaveBeenCalled());
    expect(hookResult.result.current.session.createdChanges.map((change) => change.changeNumber)).toEqual(['CHG1', 'CHG2']);
    expect(hookResult.result.current.session.createdChanges[1].environmentLabel).toBe('PRD');
  });
});

describe('useFinishRunner — modify', () => {
  /** A modify session loaded with one snapshot value. */
  function buildModifySession(): ChangeWizardSession {
    return {
      ...createChangeWizardSession('modify'),
      modify: { changeNumber: 'CHG9', stateLabel: 'New', loadedSnapshot: { backout_plan: 'Old' }, loadedStepValues: {}, existingTaskNames: [], changeSysId: 'chg-sys-9' },
    };
  }

  it('saves, then saves the tasks the user edited or built, when ServiceNow has not changed meanwhile', async () => {
    vi.mocked(fetchChangeSnapshot).mockResolvedValueOnce({ backout_plan: 'Old' });
    vi.mocked(saveModifyTasks).mockResolvedValueOnce('1 task added on CHG9.');
    const { hookResult, actions } = renderRunner(buildDraft(true), buildModifySession());
    act(() => hookResult.result.current.runner.startSave());
    await waitFor(() => expect(actions.updateExistingChg).toHaveBeenCalledWith('CHG9'));

    finishWrite(hookResult.result.current.setDraft, 'CHG9 updated');

    await waitFor(() => expect(hookResult.result.current.runner.phase.kind).toBe('done'));
    expect(vi.mocked(saveModifyTasks).mock.calls[0][0]).toMatchObject({ changeNumber: 'CHG9', changeSysId: 'chg-sys-9', links: [] });
    expect(vi.mocked(saveModifyTasks).mock.calls[0][0].draftTasks.map((task) => task.shortDescription)).toEqual(['New']);
    expect(hookResult.result.current.session.outcomeNotes).toEqual(['CHG9 updated', '1 task added on CHG9.']);
    expect(hookResult.result.current.session.failureText).toBeNull();
  });

  it('reports the change as saved but the tasks as not, when a task write fails', async () => {
    vi.mocked(fetchChangeSnapshot).mockResolvedValueOnce({ backout_plan: 'Old' });
    vi.mocked(saveModifyTasks).mockRejectedValueOnce(new Error('HTTP 403'));
    const { hookResult } = renderRunner(buildDraft(true), buildModifySession());
    act(() => hookResult.result.current.runner.startSave());
    await waitFor(() => expect(hookResult.result.current.runner.phase.kind).toBe('working'));
    finishWrite(hookResult.result.current.setDraft, 'CHG9 updated');

    await waitFor(() => expect(hookResult.result.current.session.failureText).toMatch(/not all of its tasks were \(HTTP 403\)/));
    expect(hookResult.result.current.session.createdChanges.map((change) => change.changeNumber)).toEqual(['CHG9']);
  });

  it('stops and shows both values when ServiceNow changed something, writing only once confirmed', async () => {
    vi.mocked(fetchChangeSnapshot).mockResolvedValueOnce({ backout_plan: 'Edited in ServiceNow' });
    const { hookResult, actions } = renderRunner(buildDraft(), buildModifySession());
    act(() => hookResult.result.current.runner.startSave());
    await waitFor(() => expect(hookResult.result.current.runner.phase.kind).toBe('conflicts'));
    expect(actions.updateExistingChg).not.toHaveBeenCalled();
    const phase = hookResult.result.current.runner.phase;
    expect(phase.kind === 'conflicts' && phase.conflicts[0]).toMatchObject({ loadedValue: 'Old', serviceNowValue: 'Edited in ServiceNow' });

    act(() => hookResult.result.current.runner.confirmSave());
    expect(actions.updateExistingChg).toHaveBeenCalledWith('CHG9');
  });

  it('writes nothing when the change cannot be re-read', async () => {
    vi.mocked(fetchChangeSnapshot).mockRejectedValueOnce(new Error('HTTP 401'));
    const { hookResult, actions } = renderRunner(buildDraft(), buildModifySession());
    act(() => hookResult.result.current.runner.startSave());
    await waitFor(() => expect(hookResult.result.current.session.failureText).toMatch(/Nothing was saved/));
    expect(actions.updateExistingChg).not.toHaveBeenCalled();
  });
});
