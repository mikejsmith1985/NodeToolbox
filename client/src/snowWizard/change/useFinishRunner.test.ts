// useFinishRunner.test.ts — Proves a new change is created first (per environment, task numbers read back), then saved and
// given its evidence at the end, retries only what is missing, and on a modify checks for remote edits before saving.

import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCrgState } from '../../views/SnowHub/hooks/useCrgState.ts';
import type { CrgDraftState, CrgHook } from './changeDraft.ts';
import { createChangeWizardSession, type ChangeWizardSession } from './changeWizardSession.ts';
import { saveCreatedChange } from './createdChanges.ts';
import { attachAllEvidenceToChanges } from './evidenceUpload.ts';
import { resolveJiraEvidenceAtFinish, type JiraEvidenceAttachment } from './jiraEvidence.ts';
import { fetchChangeSnapshot } from './modifyLoad.ts';
import { saveModifyTasks } from './modifyTasks.ts';
import { useFinishRunner } from './useFinishRunner.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));
vi.mock('./evidenceUpload.ts', () => ({ EVIDENCE_ATTACHED: 'attached', attachAllEvidenceToChanges: vi.fn(async () => ({ results: {}, problems: [] })) }));
vi.mock('./modifyLoad.ts', () => ({ fetchChangeSnapshot: vi.fn() }));
vi.mock('./jiraEvidence.ts', () => ({
  resolveJiraEvidenceAtFinish: vi.fn(async (input: { hasChoice: boolean; tickedEvidence: unknown[] }) => (input.hasChoice ? input.tickedEvidence : [])),
}));
vi.mock('./modifyTasks.ts', () => ({ saveModifyTasks: vi.fn() }));
vi.mock('./createdChanges.ts', () => ({ listCreatedChangeTasks: vi.fn(async () => [TASK_RECORD]), saveCreatedChange: vi.fn() }));

const PLAN = { 'Business Checkout': { REL: false, PRD: true, PFIX: true } };
const TASK_RECORD = vi.hoisted(() => ({ sysId: 't1', number: 'CTASK1', shortDescription: 'Deploy' }));
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
function renderRunner(initialDraft: CrgDraftState, initialSession: ChangeWizardSession, onFinished = vi.fn(), evidenceFiles: File[] = [EVIDENCE_FILE], jiraEvidence: JiraEvidenceAttachment[] = [], hasJiraEvidenceChoice = true) {
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
      evidenceFiles, jiraEvidence, hasJiraEvidenceChoice, selectedIssueKeys: ['A-1'], editedStepIds: ['planning'], onFinished,
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

describe('useFinishRunner — create first, then save', () => {
  beforeEach(() => {
    vi.mocked(attachAllEvidenceToChanges).mockClear();
    vi.mocked(saveCreatedChange).mockReset().mockImplementation(async ({ createdChange }) => `${createdChange.changeNumber} saved, with 1 task updated.`);
  });

  /** A create session whose REL and PRD changes already exist. */
  function buildCreatedSession(): ChangeWizardSession {
    return { ...createChangeWizardSession('create'), createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG1' }, { environmentLabel: 'PRD', changeNumber: 'CHG2' }] };
  }

  it('creates with the task plan, reads back the task numbers and attaches the evidence zip at once — job not finished yet', async () => {
    const { hookResult, actions, onFinished } = renderRunner(buildDraft(), createChangeWizardSession('create'));
    act(() => hookResult.result.current.runner.startCreate());
    expect(actions.createChg).toHaveBeenCalledWith({ rel: 'rel-env', prd: 'prd-env' }, { ctaskEnvironmentPlan: PLAN, reconcileAutoCtasks: true, shouldKeepDraft: true });

    finishWrite(hookResult.result.current.setDraft, '2 CHGs created: REL CHG1, PRD CHG2');

    await waitFor(() => expect(hookResult.result.current.runner.phase.kind).toBe('done'));
    expect(hookResult.result.current.session.createdChanges).toEqual([
      { environmentLabel: 'REL', changeNumber: 'CHG1' }, { environmentLabel: 'PRD', changeNumber: 'CHG2' },
    ]);
    expect(hookResult.result.current.session.createdTasks).toEqual({ CHG1: [TASK_RECORD], CHG2: [TASK_RECORD] });
    // The evidence goes on as the changes are created, so the risk check sees the real ticket with it.
    await waitFor(() => expect(attachAllEvidenceToChanges).toHaveBeenCalledWith({ localFiles: [EVIDENCE_FILE], jiraAttachments: [] }, ['CHG1', 'CHG2'], expect.anything()));
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('remembers each change’s tasks as the user built them, for the result screen', () => {
    const { hookResult } = renderRunner(buildDraft(true), createChangeWizardSession('create'));
    act(() => hookResult.result.current.runner.startCreate());
    expect(hookResult.result.current.session.taskNamesByEnvironment).toEqual({ REL: ['New'], PRD: ['New'] });
  });

  it('after a partial create, retries only the missing environment and switches the made one back on', async () => {
    const { hookResult, actions, onFinished } = renderRunner(buildDraft(), createChangeWizardSession('create'));
    act(() => hookResult.result.current.runner.startCreate());
    finishWrite(hookResult.result.current.setDraft, 'CHG1 created; then a later submission failed: HTTP 500');
    await waitFor(() => expect(hookResult.result.current.session.failureText).toBe('HTTP 500'));

    act(() => hookResult.result.current.runner.retryMissing());
    expect(actions.updateEnvironment).toHaveBeenCalledWith('rel', { isEnabled: false });
    act(() => hookResult.result.current.setDraft((previous) => ({ ...previous, relEnvironment: { ...previous.relEnvironment, isEnabled: false } })));
    expect(actions.createChg).toHaveBeenCalledTimes(2);

    finishWrite(hookResult.result.current.setDraft, 'CHG2 created');
    await waitFor(() => expect(hookResult.result.current.session.createdChanges.map((change) => change.changeNumber)).toEqual(['CHG1', 'CHG2']));
    expect(hookResult.result.current.session.createdChanges[1].environmentLabel).toBe('PRD');
    expect(actions.updateEnvironment).toHaveBeenCalledWith('rel', { isEnabled: true });
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('saves the finished work to every created change, then attaches the evidence and finishes', async () => {
    const { hookResult, onFinished } = renderRunner(buildDraft(), buildCreatedSession());
    act(() => hookResult.result.current.runner.startSaveCreated());
    await waitFor(() => expect(onFinished).toHaveBeenCalled());
    expect(saveCreatedChange).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveCreatedChange).mock.calls[1][0]).toEqual(expect.objectContaining({
      createdChange: { environmentLabel: 'PRD', changeNumber: 'CHG2' }, environmentValueByKey: { rel: 'rel-env', prd: 'prd-env' }, ctaskEnvironmentPlan: PLAN,
    }));
    expect(attachAllEvidenceToChanges).toHaveBeenCalledWith({ localFiles: [EVIDENCE_FILE], jiraAttachments: [] }, ['CHG1', 'CHG2'], expect.objectContaining({ onProgress: expect.any(Function) }));
    expect(hookResult.result.current.session.hasSavedChanges).toBe(true);
    expect(hookResult.result.current.session.outcomeNotes).toContain('CHG2 saved, with 1 task updated.');
  });

  it('does not attach the evidence twice: a change whose zip went on at create gets none at save', async () => {
    const { hookResult, onFinished } = renderRunner(buildDraft(), { ...buildCreatedSession(), evidenceResults: { CHG1: 'attached', CHG2: 'attached' } });
    act(() => hookResult.result.current.runner.startSaveCreated());
    await waitFor(() => expect(onFinished).toHaveBeenCalled());
    expect(attachAllEvidenceToChanges).not.toHaveBeenCalled();
  });

  it('says what failed and attaches nothing when a save fails, so pressing Save again is safe', async () => {
    vi.mocked(saveCreatedChange).mockRejectedValueOnce(new Error('HTTP 403'));
    const { hookResult, onFinished } = renderRunner(buildDraft(), buildCreatedSession());
    act(() => hookResult.result.current.runner.startSaveCreated());
    await waitFor(() => expect(hookResult.result.current.session.saveFailureText).toMatch(/HTTP 403/));
    expect(attachAllEvidenceToChanges).not.toHaveBeenCalled();
    expect(onFinished).not.toHaveBeenCalled();
    expect(hookResult.result.current.session.hasSavedChanges).toBeFalsy();
  });

  it('attaches ticked Jira files on their own, showing progress and noting a file that could not be fetched', async () => {
    vi.mocked(attachAllEvidenceToChanges).mockImplementationOnce(async (_evidence, _changeNumbers, options) => {
      options?.onProgress?.('Getting file 1 of 1 from Jira: report.pdf…');
      return { results: { CHG1: 'attached' }, problems: ['Could not get other.pdf from A-1 in Jira.'] };
    });
    const session = { ...createChangeWizardSession('create'), createdChanges: [{ environmentLabel: 'REL' as const, changeNumber: 'CHG1' }] };
    const { hookResult } = renderRunner(buildDraft(), session, vi.fn(), [], [JIRA_FILE]);
    act(() => hookResult.result.current.runner.startSaveCreated());

    await waitFor(() => expect(hookResult.result.current.runner.phase.kind).toBe('done'));
    expect(attachAllEvidenceToChanges).toHaveBeenCalledWith({ localFiles: [], jiraAttachments: [JIRA_FILE] }, ['CHG1'], expect.anything());
    expect(hookResult.result.current.session.evidenceResults).toEqual({ CHG1: 'attached' });
    expect(hookResult.result.current.session.outcomeNotes).toContain('Could not get other.pdf from A-1 in Jira.');
  });

  it('zips every Jira file like Toolbox when the evidence step was never opened', async () => {
    vi.mocked(resolveJiraEvidenceAtFinish).mockResolvedValueOnce([JIRA_FILE]);
    const session = { ...createChangeWizardSession('create'), createdChanges: [{ environmentLabel: 'REL' as const, changeNumber: 'CHG1' }] };
    const { hookResult } = renderRunner(buildDraft(), session, vi.fn(), [], [], false);
    act(() => hookResult.result.current.runner.startSaveCreated());

    await waitFor(() => expect(hookResult.result.current.runner.phase.kind).toBe('done'));
    expect(resolveJiraEvidenceAtFinish).toHaveBeenCalledWith(expect.objectContaining({ hasChoice: false, issueKeys: ['A-1'] }));
    expect(attachAllEvidenceToChanges).toHaveBeenCalledWith({ localFiles: [], jiraAttachments: [JIRA_FILE] }, ['CHG1'], expect.anything());
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

describe('useFinishRunner — putting the evidence on afterwards', () => {
  beforeEach(() => {
    vi.mocked(attachAllEvidenceToChanges).mockReset().mockImplementation(async (_evidence, changeNumbers) => ({ results: Object.fromEntries(changeNumbers.map((changeNumber) => [changeNumber, 'attached'])), problems: [] }));
    vi.mocked(resolveJiraEvidenceAtFinish).mockClear();
  });

  function buildSavedSession(): ChangeWizardSession {
    return {
      ...createChangeWizardSession('create'), hasSavedChanges: true,
      createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG1' }, { environmentLabel: 'PRD', changeNumber: 'CHG2' }],
      evidenceResults: { CHG1: 'attached', CHG2: 'HTTP 413' },
    };
  }

  it('lists the Jira files afresh and attaches them, with chosen files, only to the change without evidence', async () => {
    vi.mocked(resolveJiraEvidenceAtFinish).mockResolvedValueOnce([JIRA_FILE]);
    const { hookResult, onFinished } = renderRunner(buildDraft(), buildSavedSession(), vi.fn(), [], [], true);
    act(() => hookResult.result.current.runner.retryEvidence([EVIDENCE_FILE]));
    await waitFor(() => expect(hookResult.result.current.session.evidenceResults.CHG2).toBe('attached'));
    expect(vi.mocked(resolveJiraEvidenceAtFinish).mock.calls[0][0].hasChoice).toBe(false);
    expect(attachAllEvidenceToChanges).toHaveBeenCalledWith({ localFiles: [EVIDENCE_FILE], jiraAttachments: [JIRA_FILE] }, ['CHG2'], expect.anything());
    expect(onFinished).not.toHaveBeenCalled();
  });

  it('says there is still nothing to attach when Jira has no files and none were chosen', async () => {
    const { hookResult } = renderRunner(buildDraft(), buildSavedSession(), vi.fn(), [], [], true);
    act(() => hookResult.result.current.runner.retryEvidence([]));
    await waitFor(() => expect(hookResult.result.current.session.evidenceResults.CHG2).toMatch(/still nothing to attach/));
    expect(attachAllEvidenceToChanges).not.toHaveBeenCalled();
  });
});

