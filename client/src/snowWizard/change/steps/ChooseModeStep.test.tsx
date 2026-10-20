// ChooseModeStep.test.tsx — Proves the first screen offers a new change or an existing one, and a job to continue or restart.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ChooseModeStep from './ChooseModeStep.tsx';

const WAITING_JOB = { jobId: 'job-1', kind: 'newChange' as const, stepId: 'details', status: 'inProgress' as const, updatedAt: Date.now(), payloadKey: 'k' };

describe('ChooseModeStep', () => {
  it('offers the two choices and the way home', () => {
    const handlers = { onChooseNew: vi.fn(), onChooseExisting: vi.fn(), onContinue: vi.fn(), onStartAgain: vi.fn(), onExit: vi.fn() };
    render(<ChooseModeStep resumableJobs={[]} {...handlers} />);
    fireEvent.click(screen.getByRole('button', { name: /New change/ }));
    fireEvent.click(screen.getByRole('button', { name: /Change an existing one/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(handlers.onChooseNew).toHaveBeenCalled();
    expect(handlers.onChooseExisting).toHaveBeenCalled();
    expect(handlers.onExit).toHaveBeenCalled();
  });

  it('offers to continue or restart a job already under way', () => {
    const handlers = { onChooseNew: vi.fn(), onChooseExisting: vi.fn(), onContinue: vi.fn(), onStartAgain: vi.fn(), onExit: vi.fn() };
    render(<ChooseModeStep resumableJobs={[WAITING_JOB]} {...handlers} />);
    expect(screen.getByText(/Your new change is waiting/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }));
    expect(handlers.onContinue).toHaveBeenCalledWith(WAITING_JOB);
    expect(handlers.onStartAgain).toHaveBeenCalledWith(WAITING_JOB);
  });
});
