// StartingPointNotice.test.tsx — Proves the job says plainly how its starting point went, and offers retry or a blank start.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import StartingPointNotice from './StartingPointNotice.tsx';
import type { StartingPointHandle, StartingPointStatus } from './useStartingPoint.ts';

function renderNotice(status: StartingPointStatus) {
  const handle: StartingPointHandle = { status, retry: vi.fn(), dismiss: vi.fn() };
  render(<StartingPointNotice startingPoint={handle} />);
  return handle;
}

describe('StartingPointNotice', () => {
  it('shows nothing for a blank change', () => {
    const { container } = render(<StartingPointNotice startingPoint={{ status: { kind: 'none' }, retry: vi.fn(), dismiss: vi.fn() }} />);
    expect(container.textContent).toBe('');
  });

  it('says it is copying, then what to do once copied', () => {
    renderNotice({ kind: 'copying', changeNumber: 'CHG0001234' });
    expect(screen.getByRole('status').textContent).toContain('Copying CHG0001234');
  });

  it('after a copy, points to the Jira issues and to saving a template', () => {
    const handle = renderNotice({ kind: 'copied', changeNumber: 'CHG0001234' });
    expect(screen.getByText(/Copied CHG0001234/).textContent).toContain('Save as template');
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(handle.dismiss).toHaveBeenCalled();
  });

  it('offers to try again or carry on blank when the copy failed', () => {
    const handle = renderNotice({ kind: 'failed', changeNumber: 'CHG0000404', message: 'No CHG found with number: CHG0000404' });
    expect(screen.getByText(/could not copy CHG0000404/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Carry on with a blank change' }));
    expect(handle.retry).toHaveBeenCalled();
    expect(handle.dismiss).toHaveBeenCalled();
  });

  it('names the template a change was filled in from', () => {
    renderNotice({ kind: 'applied', templateName: 'Monthly' });
    expect(screen.getByText(/Filled in from your template “Monthly”/)).toBeTruthy();
  });
});
