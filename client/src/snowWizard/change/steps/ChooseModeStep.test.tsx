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
    onStartFromChange: vi.fn(), onStartFromTemplate: vi.fn(), onOpenTemplates: vi.fn(),
  };
}

describe('ChooseModeStep', () => {
  it('offers the two choices, your templates, and the way home', () => {
    const handlers = buildHandlers();
    render(<ChooseModeStep resumableJobs={[]} templates={[]} {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: /New change/ }));
    fireEvent.click(screen.getByRole('button', { name: /Change an existing one/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Manage templates' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(handlers.onChooseNew).toHaveBeenCalled();
    expect(handlers.onChooseExisting).toHaveBeenCalled();
    expect(handlers.onOpenTemplates).toHaveBeenCalled();
    expect(handlers.onExit).toHaveBeenCalled();
  });

  it('recommends starting from a change raised before, by its number', () => {
    const handlers = buildHandlers();
    render(<ChooseModeStep resumableJobs={[]} templates={[]} {...handlers} />);
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
    fireEvent.change(screen.getByLabelText('Your saved templates'), { target: { value: 'tpl-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start from a template' }));
    expect(handlers.onStartFromTemplate).toHaveBeenCalledWith('tpl-1');
  });

  it('offers to continue or restart a job already under way, and holds the quick starts until then', () => {
    const handlers = buildHandlers();
    render(<ChooseModeStep resumableJobs={[WAITING_JOB]} templates={TEMPLATES} {...handlers} />);
    expect(screen.getByText(/Your new change is waiting/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Start from a template' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(handlers.onContinue).toHaveBeenCalledWith(WAITING_JOB);
    expect(handlers.onStartAgain).toHaveBeenCalledWith(WAITING_JOB);
  });
});
