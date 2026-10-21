// ChangeWizardModify.test.tsx — Proves the modify job: "Skip — nothing to change" leaves a step unedited, a closed change is
// sent to Review, and a value changed in ServiceNow since load is shown beside the loaded one before anything is saved.

import { fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../services/snowApi.ts';
import { gatherChangeReadinessFacts } from '../../views/SnowHub/guided/changeReadinessFacts.ts';
import { useCrgState } from '../../views/SnowHub/hooks/useCrgState.ts';
import { useWizardJobStore } from '../shell/wizardJobStore.ts';
import ChangeWizard from './ChangeWizard.tsx';
import { buildChangeStorageKey, createChangeWizardSession, useChangeWizardSessionStore } from './changeWizardSession.ts';
import { listChangeWizardStepIds, type ChangeWizardStepId } from './changeWizardSteps.ts';
import { readStepValues } from './modifyDiff.ts';
import { fetchChangeSnapshot } from './modifyLoad.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn(async () => ({ result: [] })) }));
vi.mock('./modifyLoad.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./modifyLoad.ts')>()),
  fetchChangeSnapshot: vi.fn(),
}));
vi.mock('../../views/SnowHub/guided/changeReadinessFacts.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../views/SnowHub/guided/changeReadinessFacts.ts')>()),
  gatherChangeReadinessFacts: vi.fn(),
}));

const JOB_ID = 'job-modify-1';
const PERSON = { sysId: 'usr-1', displayName: 'Pat Owner' };
const BLANK_PERSON = { sysId: '', displayName: '' };
const LOADED_SNAPSHOT = { short_description: 'Payments 1.2', backout_plan: '1. Roll back' };

/** The change as the modify loaded it into the draft. */
const LOADED_DRAFT = {
  generatedShortDescription: 'Payments 1.2', generatedDescription: 'What changes', generatedJustification: 'Why now', generatedRiskImpact: 'Low',
  chgBasicInfo: {
    category: 'software', changeType: 'normal', environment: 'production', requestedBy: PERSON, configItem: { sysId: 'ci-1', displayName: 'Payments API' },
    assignmentGroup: { sysId: 'grp-1', displayName: 'Payments' }, assignedTo: PERSON, changeManager: BLANK_PERSON, tester: BLANK_PERSON,
    serviceManager: BLANK_PERSON, isExpedited: false,
  },
  chgPlanningContent: { implementationPlan: '1. Deploy', backoutPlan: '1. Roll back', testPlan: '1. Smoke test' },
  relEnvironment: { plannedStartDate: '', plannedEndDate: '' },
  prdEnvironment: { plannedStartDate: '2026-11-02T19:00', plannedEndDate: '2026-11-02T21:00' },
};

/** The loaded draft's step values, read from the real hook with its Production environment on. */
function readLoadedStepValues() {
  const loadedState = renderHook(() => useCrgState({ storageKey: buildChangeStorageKey(JOB_ID) })).result.current.state;
  return readStepValues({ ...loadedState, prdEnvironment: { ...loadedState.prdEnvironment, isEnabled: true } });
}

/** Puts a modify job of CHG0009 waiting on `stepId`, then opens the wizard and continues it. */
function openModifyAt(stepId: ChangeWizardStepId) {
  const stepIds = listChangeWizardStepIds('modify');
  localStorage.setItem(buildChangeStorageKey(JOB_ID), JSON.stringify(LOADED_DRAFT));
  useWizardJobStore.setState({ jobs: { modifyChange: { jobId: JOB_ID, kind: 'modifyChange', stepId, status: 'inProgress', updatedAt: Date.now(), payloadKey: 'draft' } } });
  useChangeWizardSessionStore.setState({ sessions: { [JOB_ID]: {
    ...createChangeWizardSession('modify'), currentStepId: stepId, reviewedStepIds: stepIds.slice(0, stepIds.indexOf(stepId)),
    enabledEnvironments: ['PRD'], areChecksAcknowledged: true,
    modify: { changeNumber: 'CHG0009', stateLabel: 'New', loadedSnapshot: LOADED_SNAPSHOT, loadedStepValues: readLoadedStepValues(), existingTaskNames: [] },
  } } });
  render(<ChangeWizard onExit={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('ChangeWizard — change an existing one', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('tbxRcpRulesEnabled', 'false');
    vi.mocked(snowFetch).mockReset();
    vi.mocked(snowFetch).mockResolvedValue({ result: [] } as never);
  });

  it('leaves a skipped step unedited, and marks a step once something in it changes', async () => {
    openModifyAt('details');
    expect(screen.getByRole('heading', { name: 'Step 3 of 10 — Tell us about the change' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Skip — nothing to change' }));
    expect(screen.getByRole('heading', { name: 'Step 4 of 10 — How will it go?' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(/\(edited\)/)).toBeNull());

    fireEvent.change(screen.getByLabelText('Backout plan'), { target: { value: '1. Restore the previous build' } });
    expect(screen.getByText('How will it go? (edited)')).toBeTruthy();
  });

  it('sends a closed change to Review instead of editing it', async () => {
    useWizardJobStore.setState({ jobs: {} });
    vi.mocked(snowFetch).mockResolvedValue({ result: [{ sys_id: { value: 'sys-9' }, number: { value: 'CHG0009' }, state: { value: '3', display_value: 'Closed' } }] } as never);
    render(<ChangeWizard onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^Fix an existing change/ }));
    fireEvent.change(screen.getByLabelText('Change number'), { target: { value: 'CHG0009' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look it up' }));
    await screen.findByText('This change is Closed, so it can no longer be changed.');
    expect(screen.getByRole('button', { name: 'Back to home to review it' })).toBeTruthy();
  });

  it('shows both values when ServiceNow changed the change since it was loaded, and saves nothing yet', async () => {
    vi.mocked(gatherChangeReadinessFacts).mockResolvedValue({
      facts: {
        change: { changeNumber: 'CHG0009', stateLabel: 'New', ownerName: 'Pat Owner', configItemName: 'Payments API' }, textFields: null, isProduction: true,
        plannedWindow: null, riskReview: null, isRcpActive: false, rcpChecks: [], outageCount: 1, ctasks: [], prbs: [], attachmentFileNames: ['proof.zip'], failureReasons: {},
      },
      changeSysId: 'sys-9', issueKeys: [],
    });
    vi.mocked(fetchChangeSnapshot).mockResolvedValueOnce({ ...LOADED_SNAPSHOT, backout_plan: 'Edited in ServiceNow' });
    openModifyAt('finish');
    expect(screen.getByRole('heading', { name: 'Step 10 of 10 — Save the change' })).toBeTruthy();

    const saveButton = await screen.findByRole('button', { name: 'Save the change' });
    await waitFor(() => expect((saveButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(saveButton);

    await screen.findByRole('alertdialog', { name: 'Changed in ServiceNow' });
    expect(screen.getByText('1. Roll back')).toBeTruthy();
    expect(screen.getByText('Edited in ServiceNow')).toBeTruthy();
    expect(vi.mocked(snowFetch).mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(false);
  });
});
