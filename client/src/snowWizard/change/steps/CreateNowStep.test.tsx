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

const JIRA_FILES = [{ issueKey: 'ENCUC-1', issueSummary: '', attachment: { attachmentId: 'a1', filename: 'results.xlsx', sizeBytes: 10, contentUrl: '' } }];

function renderStep(session: ChangeWizardSession, runner = buildRunner()) {
  render(<CreateNowStep crg={CRG} session={session} updateSession={vi.fn()} goToStep={vi.fn()} runner={runner} taskNamesByEnvironment={{ REL: ['Deploy'], PRD: ['Deploy', 'Business Checkout'] }} jiraEvidence={JIRA_FILES} />);
  return runner;
}

describe('CreateNowStep', () => {
  it('lists each environment\'s change and its tasks before anything is made', () => {
    renderStep(createChangeWizardSession('create'));
    expect(screen.getByText('PRD change')).toBeTruthy();
    expect(screen.getByText('Tasks: Deploy, Business Checkout')).toBeTruthy();
    expect(screen.getByText(/This makes 2 changes and 3 tasks in ServiceNow, each with the test-evidence zip/)).toBeTruthy();
    expect(screen.getByText(/with all 1 file\(s\) from your Jira issues — attached as each change is created/)).toBeTruthy();
    expect(screen.getByText('ENCUC-1: results.xlsx')).toBeTruthy();
  });

  it('shows each change made, with its task numbers, and says what comes next', () => {
    renderStep({
      ...createChangeWizardSession('create'),
      createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG1' }, { environmentLabel: 'PRD', changeNumber: 'CHG2' }],
      createdTasks: { CHG1: [{ sysId: 't1', number: 'CTASK1', shortDescription: 'Deploy' }], CHG2: [] },
      evidenceResults: { CHG1: 'attached', CHG2: 'HTTP 413' },
    });
    expect(screen.getByText(/^Test evidence: ✓ attached as Test-Evidence_CHG1_/)).toBeTruthy();
    expect(screen.getByText('Test evidence: ✗ not attached — HTTP 413. Saving on the last step tries again.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'CHG1' })).toBeTruthy();
    expect(screen.getByText('Tasks: CTASK1 Deploy')).toBeTruthy();
    expect(screen.getByText('Tasks: none')).toBeTruthy();
    expect(screen.getByText(/Press Next to run the Risk Check on the real ticket/)).toBeTruthy();
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
