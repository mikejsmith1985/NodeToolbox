// ChooseModeStep.test.tsx — Proves the first screen asks one thing: create a new change, or modify one in ServiceNow —
// each button saying when it picks up a job already under way — plus templates and the way home.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ChooseModeStep from './ChooseModeStep.tsx';

const WAITING_JOB = { jobId: 'job-1', kind: 'newChange' as const, stepId: 'details', status: 'inProgress' as const, updatedAt: Date.now(), payloadKey: 'k' };

function buildHandlers() {
  return { onCreate: vi.fn(), onModify: vi.fn(), onOpenTemplates: vi.fn(), onExit: vi.fn() };
}

describe('ChooseModeStep', () => {
  it('offers three choices — create, start from a template, modify — plus the way home', () => {
    const handlers = buildHandlers();
    render(<ChooseModeStep resumableJobs={[]} {...handlers} />);
    expect(screen.getByRole('heading', { name: 'What do you want to do?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Create a new change/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Modify a change in ServiceNow/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Start from a template/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to home' }));
    expect(handlers.onCreate).toHaveBeenCalled();
    expect(handlers.onModify).toHaveBeenCalled();
    expect(handlers.onOpenTemplates).toHaveBeenCalled();
    expect(handlers.onExit).toHaveBeenCalled();
    expect(screen.queryByText(/Finish one I started|Use them in my open change/)).toBeNull();
  });

  it('says when "Create" picks up the change already under way', () => {
    render(<ChooseModeStep resumableJobs={[WAITING_JOB]} {...buildHandlers()} />);
    expect(screen.getByRole('button', { name: /^Create a new change/ }).textContent).toMatch(/Picks up the one you started 0 minute\(s\) ago\./);
    expect(screen.getByRole('button', { name: /^Modify a change in ServiceNow/ }).textContent).not.toMatch(/Picks up/);
  });
});
