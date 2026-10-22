// CreateResultStep.test.tsx — Proves the last step previews saving to each created change, reports each with a link, offers
// "Try saving again" after a failed save, and shows both values on a modify's save conflict.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CrgDraftState, CrgHook } from '../changeDraft.ts';
import { createChangeWizardSession, type ChangeWizardSession } from '../changeWizardSession.ts';
import type { FinishRunner } from '../useFinishRunner.ts';
import { useTemplateLibrary } from '../useTemplateLibrary.ts';
import { runEvidenceSweep } from '../evidenceSweep.ts';
import CreateResultStep, { type CreateResultStepProps } from './CreateResultStep.tsx';

vi.mock('../evidenceSweep.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../evidenceSweep.ts')>()),
  runEvidenceSweep: vi.fn(),
}));

const CRG = {
  state: { relEnvironment: { isEnabled: true }, prdEnvironment: { isEnabled: true }, pfixEnvironment: { isEnabled: false }, changeTasks: [], selectedIssueKeys: new Set(['ABC-1']) } as unknown as CrgDraftState,
} as CrgHook;
const TASK_NAMES = { REL: ['Deploy'], PRD: ['Deploy', 'Business Checkout'] };

function buildRunner(overrides: Partial<FinishRunner> = {}): FinishRunner {
  return { phase: { kind: 'idle' }, startCreate: vi.fn(), retryMissing: vi.fn(), startSaveCreated: vi.fn(), startSave: vi.fn(), confirmSave: vi.fn(), cancelSave: vi.fn(), retryEvidence: vi.fn(), ...overrides };
}

/** The step with one template library, as the change job hands it over. */
function Harness(props: Omit<CreateResultStepProps, 'library'>) {
  return <CreateResultStep {...props} library={useTemplateLibrary()} />;
}

function renderStep(session: ChangeWizardSession, runner: FinishRunner) {
  render(<Harness crg={CRG} session={session} updateSession={vi.fn()} goToStep={vi.fn()} runner={runner} taskNamesByEnvironment={TASK_NAMES} editedStepIds={['planning']} evidenceFileCount={1} />);
}

describe('CreateResultStep', () => {
  it('previews saving to each change already created, with only the tasks the user built for it', () => {
    const session: ChangeWizardSession = { ...createChangeWizardSession('create'), createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG1' }, { environmentLabel: 'PRD', changeNumber: 'CHG2' }] };
    renderStep(session, buildRunner());
    expect(screen.getByText('Save to CHG1 (REL)')).toBeTruthy();
    expect(screen.getByText('The text, plans, dates and tasks: deploy')).toBeTruthy();
    expect(screen.getByText('The text, plans, dates and tasks: deploy, business checkout')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Implementation|Technical Checkout|by ServiceNow/);
  });

  it('reports a failed save with links, evidence and a safe "Try saving again"', () => {
    const runner = buildRunner();
    const session: ChangeWizardSession = {
      ...createChangeWizardSession('create'),
      createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG1' }], taskNamesByEnvironment: { REL: ['Smoke test'] },
      outcomeNotes: ['PRB1 linked to CHG1'], saveFailureText: 'HTTP 500', evidenceResults: { CHG1: 'attached' },
    };
    renderStep(session, runner);
    expect((screen.getByRole('link', { name: 'CHG1' }) as HTMLAnchorElement).href).toContain('number%3DCHG1');
    expect(screen.getByText(/^Test evidence: attached as Test-Evidence_CHG/)).toBeTruthy();
    expect(screen.getByText('Tasks: Smoke test')).toBeTruthy();
    expect(screen.getByText('• PRB1 linked to CHG1')).toBeTruthy();
    expect(screen.getByText('Not everything worked: HTTP 500')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try saving again' }));
    expect(runner.startSaveCreated).toHaveBeenCalled();
  });

  it('shows both values when ServiceNow changed the change since it was loaded', () => {
    const runner = buildRunner({ phase: { kind: 'conflicts', conflicts: [{ fieldLabel: 'Backout plan', stepId: 'planning', loadedValue: 'Old', serviceNowValue: 'Theirs', isEditedHere: true }] } });
    const session = { ...createChangeWizardSession('modify'), modify: { changeNumber: 'CHG9', stateLabel: 'New', loadedSnapshot: {}, loadedStepValues: {}, existingTaskNames: [] } };
    renderStep(session, runner);
    expect(screen.getByText('Old')).toBeTruthy();
    expect(screen.getByText('Theirs')).toBeTruthy();
    expect(screen.getByText('Steps you changed: How will it go?.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save mine anyway' }));
    expect(runner.confirmSave).toHaveBeenCalled();
  });

  it('after a clean save, suggests saving it as a template for next time', () => {
    const session: ChangeWizardSession = { ...createChangeWizardSession('create'), hasSavedChanges: true, createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG1' }, { environmentLabel: 'PRD', changeNumber: 'CHG2' }] };
    renderStep(session, buildRunner({ phase: { kind: 'done' } }));
    expect(screen.getByText(/Save its picks as a template below/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Save the picks as a template (optional)' })).toBeTruthy();
  });

  it('when everything saved but the evidence, offers one button that sweeps Jira and attaches it', async () => {
    const runner = buildRunner({ phase: { kind: 'done' } });
    const session: ChangeWizardSession = {
      ...createChangeWizardSession('create'), hasSavedChanges: true,
      createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG1' }, { environmentLabel: 'PRD', changeNumber: 'CHG2' }],
      evidenceResults: { CHG1: 'attached', CHG2: 'HTTP 413' },
    };
    renderStep(session, runner);
    expect(screen.queryByText(/All done/)).toBeNull();
    expect(screen.getByText(/only the test evidence is missing/)).toBeTruthy();
    expect(screen.getByText('Test evidence is not on CHG2 yet.')).toBeTruthy();
    expect(screen.queryByLabelText(/Files from this computer/)).toBeNull();
    vi.mocked(runEvidenceSweep).mockResolvedValue({
      startingIssueKeys: ['ABC-1'], sweptIssueKeys: ['ABC-1'], foundFiles: [], leftOutForSize: [], wereLinksSkipped: false,
      zippedFileCount: 1, archiveByteSize: 10, results: { CHG2: 'attached' }, attachedFileNames: { CHG2: 'Test-Evidence_CHG2.zip' }, problems: [],
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sweep Jira and attach the test evidence' })); });
    expect(runEvidenceSweep).toHaveBeenCalledWith(['ABC-1'], ['CHG2'], expect.any(Function));
    expect(screen.getByText('✅ Attached Test-Evidence_CHG2.zip to CHG2 — ServiceNow confirmed it.')).toBeTruthy();
  });

  it('offers no evidence card once every change has its evidence', () => {
    const session: ChangeWizardSession = {
      ...createChangeWizardSession('create'), hasSavedChanges: true,
      createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG1' }], evidenceResults: { CHG1: 'attached' },
    };
    renderStep(session, buildRunner({ phase: { kind: 'done' } }));
    expect(screen.getByText(/All done/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Attach the test evidence' })).toBeNull();
  });
});
