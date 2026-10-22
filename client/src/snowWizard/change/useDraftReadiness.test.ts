// useDraftReadiness.test.ts — Proves the checklist waits until it matters, reads PRBs for a new change, and the gatherer for a modify.

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { gatherChangeReadinessFacts } from '../../views/SnowHub/guided/changeReadinessFacts.ts';
import { scanIssuesForProblems } from '../../views/SnowHub/problems/changeProblems.ts';
import { useCrgState } from '../../views/SnowHub/hooks/useCrgState.ts';
import type { CrgDraftState } from './changeDraft.ts';
import { createChangeWizardSession } from './changeWizardSession.ts';
import type { JiraEvidenceAttachment } from './jiraEvidence.ts';
import { useDraftReadiness } from './useDraftReadiness.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));
vi.mock('../../views/SnowHub/problems/changeProblems.ts', () => ({ scanIssuesForProblems: vi.fn() }));
vi.mock('../../views/SnowHub/guided/changeReadinessFacts.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../views/SnowHub/guided/changeReadinessFacts.ts')>()),
  gatherChangeReadinessFacts: vi.fn(),
}));

function buildEvidence(issueKey: string, filename: string): JiraEvidenceAttachment {
  return { issueKey, issueSummary: '', attachment: { filename } } as unknown as JiraEvidenceAttachment;
}

function readDraftWithIssue(): CrgDraftState {
  const draft = renderHook(() => useCrgState({ storageKey: 'snowWizard:change:readiness-test' })).result.current.state;
  return { ...draft, selectedIssueKeys: new Set(['ABC-1']) };
}

describe('useDraftReadiness', () => {
  it('reads nothing until the checks matter', () => {
    const draft = readDraftWithIssue();
    const session = createChangeWizardSession('create');
    const { result } = renderHook(() => useDraftReadiness(draft, session, false));
    expect(result.current.items).toBeNull();
    expect(scanIssuesForProblems).not.toHaveBeenCalled();
  });

  it('builds a new change\'s checklist from the draft, with no problem-record check — ServiceNow links those itself', async () => {
    vi.mocked(scanIssuesForProblems).mockClear();
    const draft = readDraftWithIssue();
    const session = createChangeWizardSession('create');
    const { result } = renderHook(() => useDraftReadiness(draft, session, true));
    await waitFor(() => expect(result.current.items).not.toBeNull());
    expect(scanIssuesForProblems).not.toHaveBeenCalled();
    expect(result.current.items?.find((item) => item.id === 'prbs')).toBeUndefined();
    expect(result.current.items?.find((item) => item.id === 'riskCheck')).toBeUndefined();
  });

  it('counts the Jira files ticked on "Add proof" as test evidence (GH #468)', async () => {
    vi.mocked(scanIssuesForProblems).mockResolvedValue([]);
    const issueDraft = readDraftWithIssue();
    // Test evidence is only asked of a Production change.
    const draft = {
      ...issueDraft, prdEnvironment: { ...issueDraft.prdEnvironment, isEnabled: true },
      chgPlanningContent: { ...issueDraft.chgPlanningContent, testPlan: 'ABC-1: execution results attached.' },
    };
    const session = createChangeWizardSession('create');
    const withoutJira = renderHook(() => useDraftReadiness(draft, session, true));
    await waitFor(() => expect(withoutJira.result.current.items).not.toBeNull());
    expect(withoutJira.result.current.items?.find((item) => item.id === 'testEvidence')?.state).toBe('needsAction');
    const withJira = renderHook(() => useDraftReadiness(draft, session, true, [buildEvidence('ABC-1', 'ENCUC_2082_execution.xlsx')]));
    await waitFor(() => expect(withJira.result.current.items).not.toBeNull());
    expect(withJira.result.current.items?.find((item) => item.id === 'testEvidence')?.state).toBe('done');
  });

  it('judges the evidence by the issues it covers: every issue needs a file, and the test plan must name each', async () => {
    const issueDraft = readDraftWithIssue();
    const draft = { ...issueDraft, selectedIssueKeys: new Set(['ABC-1', 'ABC-2']), prdEnvironment: { ...issueDraft.prdEnvironment, isEnabled: true } };
    const session = createChangeWizardSession('create');
    const evidence = [buildEvidence('ABC-1', 'results.xlsx')];
    const missingIssue = renderHook(() => useDraftReadiness(draft, session, true, evidence));
    await waitFor(() => expect(missingIssue.result.current.items).not.toBeNull());
    expect(missingIssue.result.current.items?.find((item) => item.id === 'testEvidence')?.reason).toBe('1 file is attached, but ABC-2 has no test evidence file.');
    const oneIssueDraft = { ...draft, selectedIssueKeys: new Set(['ABC-1']) };
    const unnamed = renderHook(() => useDraftReadiness(oneIssueDraft, session, true, evidence));
    await waitFor(() => expect(unnamed.result.current.items).not.toBeNull());
    expect(unnamed.result.current.items?.find((item) => item.id === 'testEvidence')).toMatchObject({
      state: 'needsAction', action: { kind: 'openStep', stepId: 'changeText', focusField: 'testPlan' },
    });
  });

  it('reads what ServiceNow holds for a change being modified', async () => {
    vi.mocked(gatherChangeReadinessFacts).mockResolvedValueOnce({
      facts: {
        change: { changeNumber: 'CHG9', stateLabel: 'New', ownerName: 'Pat', configItemName: 'CI' }, textFields: null, isProduction: false,
        plannedWindow: null, riskReview: null, isRcpActive: false, rcpChecks: [], outageCount: 0, ctasks: [], prbs: [], attachmentFileNames: [], failureReasons: {},
      },
      changeSysId: 'sys-9', issueKeys: [],
    });
    const session = { ...createChangeWizardSession('modify'), modify: { changeNumber: 'CHG9', stateLabel: 'New', loadedSnapshot: {}, loadedStepValues: {}, existingTaskNames: [] } };
    const draft = readDraftWithIssue();
    const { result } = renderHook(() => useDraftReadiness(draft, session, true));
    await waitFor(() => expect(result.current.items).not.toBeNull());
    expect(gatherChangeReadinessFacts).toHaveBeenCalledWith('CHG9', expect.objectContaining({ riskReview: null }));
    expect(result.current.items?.find((item) => item.id === 'outage')?.state).toBe('notApplicable');
  });
});
