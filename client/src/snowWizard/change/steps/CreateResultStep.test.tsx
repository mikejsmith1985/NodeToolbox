// CreateResultStep.test.tsx — Proves the last step previews per-environment tasks, reports each change with a link, offers
// "Retry what's missing" after a partial create, and shows both values on a save conflict.

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
  return { phase: { kind: 'idle' }, startCreate: vi.fn(), retryMissing: vi.fn(), startSave: vi.fn(), confirmSave: vi.fn(), cancelSave: vi.fn(), ...overrides };
}

function renderStep(session: ChangeWizardSession, runner: FinishRunner) {
  render(<CreateResultStep crg={CRG} session={session} updateSession={vi.fn()} goToStep={vi.fn()} runner={runner} taskNamesByEnvironment={TASK_NAMES} editedStepIds={['planning']} evidenceFileCount={1} />);
}

describe('CreateResultStep', () => {
  it('previews each environment\'s change with only the tasks the user built for it', () => {
    renderStep(createChangeWizardSession('create'), buildRunner());
    expect(screen.getByText('Tasks: Deploy')).toBeTruthy();
    expect(screen.getByText('Tasks: Deploy, Business Checkout')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Implementation|Technical Checkout|by ServiceNow/);
  });

  it('reports a partial create with links, evidence and a retry of only what is missing', () => {
    const runner = buildRunner();
    const session: ChangeWizardSession = {
      ...createChangeWizardSession('create'),
      createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG1' }], taskNamesByEnvironment: { REL: ['Smoke test'] },
      outcomeNotes: ['PRB1 linked to CHG1'], failureText: 'HTTP 500', evidenceResults: { CHG1: 'attached' },
    };
    renderStep(session, runner);
    expect((screen.getByRole('link', { name: 'CHG1' }) as HTMLAnchorElement).href).toContain('number%3DCHG1');
    expect(screen.getByText(/^Test evidence: attached as Test-Evidence_CHG/)).toBeTruthy();
    expect(screen.getByText('Tasks: Smoke test')).toBeTruthy();
    expect(screen.getByText('• PRB1 linked to CHG1')).toBeTruthy();
    expect(screen.getByText('Not everything worked: HTTP 500')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry what\'s missing' }));
    expect(runner.retryMissing).toHaveBeenCalled();
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

  it('after a clean create, suggests saving it as a template for next time', () => {
    const session: ChangeWizardSession = { ...createChangeWizardSession('create'), createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG1' }, { environmentLabel: 'PRD', changeNumber: 'CHG2' }] };
    renderStep(session, buildRunner({ phase: { kind: 'done' } }));
    expect(screen.getByText(/Press “Save as template” at the top/)).toBeTruthy();
  });
});
