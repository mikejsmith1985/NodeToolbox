// EstimateNfMigrationPanel.test.tsx — Previewing, then running, the move from story points to Estimate (NF).

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EstimateNfMigrationPanel } from './EstimateNfMigrationPanel.tsx';
import type { EstimateNfMigrationPlan } from './estimateNfMigration.ts';

const PLANS: EstimateNfMigrationPlan[] = [
  { issueKey: 'DENP-1', summary: 'Enrollment', storyPointsValue: '8', estimateNfValue: '', storyPointFieldIdsToClear: ['customfield_20001'], action: 'move' },
  { issueKey: 'DENP-2', summary: 'Letters', storyPointsValue: '5', estimateNfValue: '13', storyPointFieldIdsToClear: ['customfield_20001'], action: 'conflict' },
];

describe('EstimateNfMigrationPanel', () => {
  it('previews what will move before anything is written, then runs it and reports each Epic', async () => {
    const loadPlans = vi.fn().mockResolvedValue({ plans: PLANS, isTruncated: false });
    const runPlans = vi.fn().mockResolvedValue([
      { issueKey: 'DENP-1', outcome: 'moved', message: 'Moved 8 to Estimate (NF) and cleared story points.' },
      { issueKey: 'DENP-2', outcome: 'skipped', message: 'Estimate (NF) already holds 13 — left for you to decide.' },
    ]);
    render(<EstimateNfMigrationPanel loadPlans={loadPlans} runPlans={runPlans} />);

    fireEvent.click(screen.getByRole('button', { name: /Find Epics with story points/ }));
    expect(await screen.findByText('DENP-1')).toBeInTheDocument();
    expect(screen.getByText(/1 to move, 0 to clear, 1 conflict/)).toBeInTheDocument();
    expect(runPlans).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Move story points to Estimate \(NF\)/ }));

    expect(await screen.findByText(/Moved 8 to Estimate \(NF\)/)).toBeInTheDocument();
    expect(runPlans).toHaveBeenCalledWith(PLANS);
  });

  it('says so when no Epic has story points left', async () => {
    render(<EstimateNfMigrationPanel loadPlans={vi.fn().mockResolvedValue({ plans: [], isTruncated: false })} runPlans={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Find Epics with story points/ }));

    expect(await screen.findByText(/No Epics have story points left/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Move story points to Estimate \(NF\)/ })).toBeNull();
  });

  it('shows why the search could not run', async () => {
    render(<EstimateNfMigrationPanel loadPlans={vi.fn().mockRejectedValue(new Error('Flag a Product Owner first.'))} runPlans={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Find Epics with story points/ }));

    expect(await screen.findByText(/Flag a Product Owner first\./)).toBeInTheDocument();
  });
});
