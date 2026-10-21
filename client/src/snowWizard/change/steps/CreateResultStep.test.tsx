// CreateResultStep.test.tsx — Proves the last step previews saving to each created change, reports each with a link, offers
// "Try saving again" after a failed save, and shows both values on a modify's save conflict.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CrgDraftState, CrgHook } from '../changeDraft.ts';
import { createChangeWizardSession, type ChangeWizardSession } from '../changeWizardSession.ts';
import type { FinishRunner } from '../useFinishRunner.ts';
import CreateResultStep from './CreateResultStep.tsx';

const CRG = {
  state: { relEnvironment: { isEnabled: true }, prdEnvironment: { isEnabled: true }, pfixEnvironment: { isEnabled: false }, changeTasks: [] } as unknown as CrgDraftState,
} as CrgHook;
const TASK_NAMES = { REL: ['Deploy'], PRD: ['Deploy', 'Business Checkout'] };

function buildRunner(overrides: Partial<FinishRunner> = {}): FinishRunner {
  return { phase: { kind: 'idle' }, startCreate: vi.fn(), retryMissing: vi.fn(), startSaveCreated: vi.fn(), startSave: vi.fn(), confirmSave: vi.fn(), cancelSave: vi.fn(), ...overrides };
}

function renderStep(session: ChangeWizardSession, runner: FinishRunner) {
  render(<CreateResultStep crg={CRG} session={session} updateSession={vi.fn()} goToStep={vi.fn()} runner={runner} taskNamesByEnvironment={TASK_NAMES} editedStepIds={['planning']} evidenceFileCount={1} />);
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
    expect(screen.getByText(/Press “Save as template” at the top/)).toBeTruthy();
  });
});
