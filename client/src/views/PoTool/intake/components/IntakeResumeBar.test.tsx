// IntakeResumeBar.test.tsx — Lists saved intakes, disables Resume for the one already open, asks for confirmation
// before discarding, and Start a new intake calls straight through (US6).

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { EpicIntakeSummary } from '../epicIntakeStore.ts';
import IntakeResumeBar from './IntakeResumeBar.tsx';

const SAVED_INTAKES: EpicIntakeSummary[] = [
  { id: 'intake-1', name: 'Monday call — 2026-09-15', updatedAtIso: '2026-09-15T10:00:00.000Z', teamProfileId: 'team-a' },
  { id: 'intake-2', name: 'Backlog grooming — 2026-09-16', updatedAtIso: '2026-09-16T09:00:00.000Z', teamProfileId: 'team-a' },
];

describe('IntakeResumeBar', () => {
  it('lists every saved intake by name', () => {
    render(
      <IntakeResumeBar savedIntakes={SAVED_INTAKES} activeIntakeId={null} onResume={vi.fn()} onDiscard={vi.fn()} onStartNew={vi.fn()} />,
    );

    expect(screen.getByText('Monday call — 2026-09-15')).toBeInTheDocument();
    expect(screen.getByText('Backlog grooming — 2026-09-16')).toBeInTheDocument();
  });

  it('disables Resume for the intake already open, and calls onResume for the other', async () => {
    const user = userEvent.setup();
    const onResume = vi.fn();
    render(
      <IntakeResumeBar savedIntakes={SAVED_INTAKES} activeIntakeId="intake-1" onResume={onResume} onDiscard={vi.fn()} onStartNew={vi.fn()} />,
    );

    const rows = screen.getAllByRole('listitem');
    const activeRow = rows.find((row) => row.textContent?.includes('Monday call'));
    const otherRow = rows.find((row) => row.textContent?.includes('Backlog grooming'));
    expect(activeRow).toBeDefined();
    expect(otherRow).toBeDefined();

    const activeResumeButton = activeRow!.querySelector('button');
    expect(activeResumeButton).toHaveTextContent('Resume');
    expect(activeResumeButton).toBeDisabled();

    const otherResumeButton = Array.from(otherRow!.querySelectorAll('button')).find((button) => button.textContent === 'Resume');
    await user.click(otherResumeButton!);
    expect(onResume).toHaveBeenCalledWith('intake-2');
  });

  it('asks for confirmation before discarding, and only discards on "Yes, discard"', async () => {
    const user = userEvent.setup();
    const onDiscard = vi.fn();
    render(
      <IntakeResumeBar savedIntakes={SAVED_INTAKES} activeIntakeId={null} onResume={vi.fn()} onDiscard={onDiscard} onStartNew={vi.fn()} />,
    );

    const rows = screen.getAllByRole('listitem');
    const targetRow = rows.find((row) => row.textContent?.includes('Backlog grooming'))!;
    const discardButton = Array.from(targetRow.querySelectorAll('button')).find((button) => button.textContent === 'Discard')!;

    await user.click(discardButton);
    expect(screen.getByText(/Discard this saved intake\?/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(onDiscard).not.toHaveBeenCalled();
    expect(screen.queryByText(/Discard this saved intake\?/)).not.toBeInTheDocument();

    const discardAgainButton = Array.from(targetRow.querySelectorAll('button')).find((button) => button.textContent === 'Discard')!;
    await user.click(discardAgainButton);
    await user.click(screen.getByRole('button', { name: 'Yes, discard' }));
    expect(onDiscard).toHaveBeenCalledWith('intake-2');
  });

  it('calls onStartNew when "Start a new intake" is clicked', async () => {
    const user = userEvent.setup();
    const onStartNew = vi.fn();
    render(
      <IntakeResumeBar savedIntakes={[]} activeIntakeId={null} onResume={vi.fn()} onDiscard={vi.fn()} onStartNew={onStartNew} />,
    );

    await user.click(screen.getByRole('button', { name: 'Start a new intake' }));
    expect(onStartNew).toHaveBeenCalledTimes(1);
  });
});
