// WizardHome.test.tsx — Proves Home offers the three jobs, holds them until both systems are connected, then opens them.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createChangeWizardSession, useChangeWizardSessionStore } from '../change/changeWizardSession.ts';
import WizardHome from './WizardHome.tsx';
import { useWizardJobStore } from './wizardJobStore.ts';

describe('WizardHome', () => {
  it('offers the three jobs, held until both systems are connected', () => {
    render(<WizardHome isReady={false} onOpenSettings={vi.fn()} onChooseJob={vi.fn()} />);
    expect(screen.getByText('Make or change a change')).toBeTruthy();
    expect(screen.getByText('Turn a problem into Jira work')).toBeTruthy();
    expect(screen.getByText('Review a change')).toBeTruthy();
    expect(screen.getAllByText('Connect ServiceNow and Jira first').length).toBe(3);
    expect(screen.getAllByRole('button').filter((button) => (button as HTMLButtonElement).disabled).length).toBe(3);
  });

  it('opens the chosen job once both systems are connected', () => {
    const onChooseJob = vi.fn();
    render(<WizardHome isReady onOpenSettings={vi.fn()} onChooseJob={onChooseJob} />);
    fireEvent.click(screen.getByRole('button', { name: /Make or change a change/ }));
    fireEvent.click(screen.getByRole('button', { name: /Turn a problem into Jira work/ }));
    fireEvent.click(screen.getByRole('button', { name: /Review a change/ }));
    expect(onChooseJob.mock.calls.map((call) => call[0])).toEqual(['change', 'prb', 'review']);
  });

  it('opens Settings', () => {
    const onOpenSettings = vi.fn();
    render(<WizardHome isReady onOpenSettings={onOpenSettings} onChooseJob={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(onOpenSettings).toHaveBeenCalled();
  });

  it('reminds the user of changes in ServiceNow that are not finished yet, and opens them in one click', () => {
    useWizardJobStore.setState({ jobs: { newChange: { jobId: 'job-1', kind: 'newChange', stepId: 'aiDraft', status: 'inProgress', updatedAt: Date.now(), payloadKey: 'k' } } });
    useChangeWizardSessionStore.setState({ sessions: { 'job-1': { ...createChangeWizardSession('create'), createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG1' }, { environmentLabel: 'PRD', changeNumber: 'CHG2' }] } } });
    const onChooseJob = vi.fn();
    const { unmount } = render(<WizardHome isReady onOpenSettings={vi.fn()} onChooseJob={onChooseJob} />);
    expect(screen.getByRole('note').textContent).toContain('CHG1 and CHG2 are in ServiceNow but not finished yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Finish them' }));
    expect(onChooseJob).toHaveBeenCalledWith('change');
    unmount();
    useChangeWizardSessionStore.setState({ sessions: { 'job-1': { ...createChangeWizardSession('create'), hasSavedChanges: true, createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG1' }] } } });
    render(<WizardHome isReady onOpenSettings={vi.fn()} onChooseJob={vi.fn()} />);
    expect(screen.queryByRole('note')).toBeNull();
    useWizardJobStore.setState({ jobs: {} });
  });
});
