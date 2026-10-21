// ChooseModeStep.test.tsx — Proves the first screen recommends starting from an old change or a template, offers a new change
// or an existing one, a job to continue or restart, and the way to manage templates.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CrgTemplate } from '../../../views/SnowHub/hooks/useCrgState.ts';
import ChooseModeStep from './ChooseModeStep.tsx';

const WAITING_JOB = { jobId: 'job-1', kind: 'newChange' as const, stepId: 'details', status: 'inProgress' as const, updatedAt: Date.now(), payloadKey: 'k' };
const TEMPLATES = [{ id: 'tpl-1', name: 'Monthly' }] as CrgTemplate[];

function buildHandlers() {
  return {
    onChooseNew: vi.fn(), onChooseExisting: vi.fn(), onContinue: vi.fn(), onStartAgain: vi.fn(), onExit: vi.fn(),
    onStartFromChange: vi.fn(), onStartFreshFromChange: vi.fn(), onFinishCreatedChanges: vi.fn(), onStartFromTemplate: vi.fn(), onOpenTemplates: vi.fn(),
  };
}

describe('ChooseModeStep', () => {
  it('asks one question with three big choices, plus templates and the way home', () => {
    const handlers = buildHandlers();
    render(<ChooseModeStep resumableJobs={[]} templates={[]} {...handlers} />);
    expect(screen.getByRole('heading', { name: 'What do you want to do?' })).toBeTruthy();
    expect(screen.queryByLabelText('Change number')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^New change/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start blank' }));
    fireEvent.click(screen.getByRole('button', { name: /^Fix an existing change/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Manage templates' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(handlers.onChooseNew).toHaveBeenCalled();
    expect(handlers.onChooseExisting).toHaveBeenCalled();
    expect(handlers.onOpenTemplates).toHaveBeenCalled();
    expect(handlers.onExit).toHaveBeenCalled();
  });

  it('recommends starting from a change raised before, by its number, inside "New change"', () => {
    const handlers = buildHandlers();
    render(<ChooseModeStep resumableJobs={[]} templates={[]} {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: /^New change/ }));
    expect(screen.getByText(/Fastest: start from a change you’ve raised before/).textContent).toContain('save it as a template for next time');
    const startButton = screen.getByRole('button', { name: 'Start from an existing change' }) as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Change number'), { target: { value: ' chg0012345 ' } });
    fireEvent.click(startButton);
    expect(handlers.onStartFromChange).toHaveBeenCalledWith('CHG0012345');
    expect(screen.queryByLabelText('Your saved templates')).toBeNull();
  });

  it('offers a saved template to start from, picked from a list', () => {
    const handlers = buildHandlers();
    render(<ChooseModeStep resumableJobs={[]} templates={TEMPLATES} {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: /^New change/ }));
    fireEvent.change(screen.getByLabelText('Your saved templates'), { target: { value: 'tpl-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open template' }));
    expect(handlers.onStartFromTemplate).toHaveBeenCalledWith('tpl-1');
  });

  it('opens "Finish one I started" straight away when a job is waiting, to continue or restart it', () => {
    const handlers = buildHandlers();
    render(<ChooseModeStep resumableJobs={[WAITING_JOB]} templates={TEMPLATES} {...handlers} />);
    expect(screen.getByRole('button', { name: /^Finish one I started/ }).textContent).toContain('1 waiting');
    expect(screen.getByText(/Your new change is waiting/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(handlers.onContinue).toHaveBeenCalledWith(WAITING_JOB);
    expect(handlers.onStartAgain).toHaveBeenCalledWith(WAITING_JOB);
  });

  it('never leaves a dead quick-start button while a new change is open: copy into it, or start fresh', () => {
    const handlers = buildHandlers();
    render(<ChooseModeStep resumableJobs={[WAITING_JOB]} templates={TEMPLATES} {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: /^New change/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start blank (throws away the open one)' }));
    expect(handlers.onStartAgain).toHaveBeenCalledWith(WAITING_JOB);
    fireEvent.change(screen.getByLabelText('Change number'), { target: { value: 'CHG0052017' } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy it into my open change' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start a fresh change from it' }));
    expect(handlers.onStartFromChange).toHaveBeenCalledWith('CHG0052017');
    expect(handlers.onStartFreshFromChange).toHaveBeenCalledWith('CHG0052017');
    fireEvent.change(screen.getByLabelText('Your saved templates'), { target: { value: 'tpl-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open it in my open change' }));
    expect(handlers.onStartFromTemplate).toHaveBeenCalledWith('tpl-1');
  });

  it('finishes changes already created from their numbers, never creating new ones', () => {
    const handlers = buildHandlers();
    render(<ChooseModeStep resumableJobs={[]} templates={[]} {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: /^Finish one I started/ }));
    expect(screen.getByText('Nothing is waiting in this browser.')).toBeTruthy();
    fireEvent.click(screen.getByText('Finish changes you already created'));
    const finishButton = screen.getByRole('button', { name: 'Finish these changes' }) as HTMLButtonElement;
    expect(finishButton.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('REL change number'), { target: { value: 'chg0052017' } });
    fireEvent.change(screen.getByLabelText('PRD change number'), { target: { value: 'CHG005' } });
    fireEvent.change(screen.getByLabelText('PRD change number'), { target: { value: 'CHG0052018' } });
    fireEvent.click(finishButton);
    expect(handlers.onFinishCreatedChanges).toHaveBeenCalledWith([
      { environmentLabel: 'REL', changeNumber: 'CHG0052017' }, { environmentLabel: 'PRD', changeNumber: 'CHG0052018' },
    ]);
  });
});
