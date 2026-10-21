// CreateNowStep.test.tsx — Proves "Create in ServiceNow" lists what it will make, then each change with its task numbers,
// and offers "Retry what's missing" when one environment's change was not made.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CrgDraftState, CrgHook } from '../changeDraft.ts';
import { createChangeWizardSession, type ChangeWizardSession } from '../changeWizardSession.ts';
import type { FinishRunner } from '../useFinishRunner.ts';
import CreateNowStep from './CreateNowStep.tsx';

const CRG = {
  state: { relEnvironment: { isEnabled: true }, prdEnvironment: { isEnabled: true }, pfixEnvironment: { isEnabled: false }, changeTasks: [] } as unknown as CrgDraftState,
} as CrgHook;

function buildRunner(overrides: Partial<FinishRunner> = {}): FinishRunner {
  return { phase: { kind: 'idle' }, startCreate: vi.fn(), retryMissing: vi.fn(), startSaveCreated: vi.fn(), adoptExistingChanges: vi.fn(), startSave: vi.fn(), confirmSave: vi.fn(), cancelSave: vi.fn(), ...overrides };
}

function renderStep(session: ChangeWizardSession, runner = buildRunner()) {
  render(<CreateNowStep crg={CRG} session={session} updateSession={vi.fn()} goToStep={vi.fn()} runner={runner} taskNamesByEnvironment={{ REL: ['Deploy'], PRD: ['Deploy', 'Business Checkout'] }} />);
  return runner;
}

describe('CreateNowStep', () => {
  it('lists each environment\'s change and its tasks before anything is made', () => {
    renderStep(createChangeWizardSession('create'));
    expect(screen.getByText('PRD change')).toBeTruthy();
    expect(screen.getByText('Tasks: Deploy, Business Checkout')).toBeTruthy();
    expect(screen.getByText(/so the text can name their real change and task numbers/)).toBeTruthy();
  });

  it('shows each change made, with its task numbers, and says what comes next', () => {
    renderStep({
      ...createChangeWizardSession('create'),
      createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG1' }, { environmentLabel: 'PRD', changeNumber: 'CHG2' }],
      createdTasks: { CHG1: [{ sysId: 't1', number: 'CTASK1', shortDescription: 'Deploy' }], CHG2: [] },
    });
    expect(screen.getByRole('link', { name: 'CHG1' })).toBeTruthy();
    expect(screen.getByText('Tasks: CTASK1 Deploy')).toBeTruthy();
    expect(screen.getByText('Tasks: none')).toBeTruthy();
    expect(screen.getByText(/the AI writes the text next, using these numbers/)).toBeTruthy();
  });

  it('uses changes already in ServiceNow instead of creating duplicates', () => {
    const runner = renderStep(createChangeWizardSession('create'));
    fireEvent.click(screen.getByText('Already created these changes? Use them instead'));
    fireEvent.change(screen.getByLabelText('REL change number'), { target: { value: 'chg0052017' } });
    expect((screen.getByRole('button', { name: 'Use these changes' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('PRD change number'), { target: { value: 'CHG0052018 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use these changes' }));
    expect(runner.adoptExistingChanges).toHaveBeenCalledWith([{ environmentLabel: 'REL', changeNumber: 'CHG0052017' }, { environmentLabel: 'PRD', changeNumber: 'CHG0052018' }]);
  });

  it('offers to retry only what is missing after a partial create', () => {
    const runner = renderStep({ ...createChangeWizardSession('create'), createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG1' }], failureText: 'HTTP 500' });
    expect(screen.getByText('Not everything was created: HTTP 500')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry what\'s missing' }));
    expect(runner.retryMissing).toHaveBeenCalled();
  });
});
