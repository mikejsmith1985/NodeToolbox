// ChangeOutagePanel.test.tsx — Seeing and creating a change's outage record from Modify's Review & Save.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPlannedOutage, fetchChangeOutages } from './changeOutageRecord.ts';
import { ChangeOutagePanel } from './ChangeOutagePanel.tsx';

vi.mock('./changeOutageRecord.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./changeOutageRecord.ts')>()),
  fetchChangeOutages: vi.fn(),
  createPlannedOutage: vi.fn(),
}));

const OUTAGE_INPUT = {
  changeSysId: 'chg-1',
  configItemSysId: 'ci-recon',
  shortDescription: 'Recon | deploy v1.5 | PROD',
  plannedStartUtc: '2026-10-10T05:00',
  plannedEndUtc: '2026-10-10T07:00',
};
const LINKED_OUTAGE = { sysId: 'out-1', number: 'OUT0005678', typeLabel: 'Planned', beginLabel: '2026-10-10 00:00:00', endLabel: '2026-10-10 02:00:00' };

describe('ChangeOutagePanel', () => {
  beforeEach(() => {
    vi.mocked(fetchChangeOutages).mockReset();
    vi.mocked(createPlannedOutage).mockReset();
  });

  it('warns that a Production change has no outage record, and creates the planned one in one click', async () => {
    vi.mocked(fetchChangeOutages).mockResolvedValueOnce([]).mockResolvedValueOnce([LINKED_OUTAGE]);
    vi.mocked(createPlannedOutage).mockResolvedValue('OUT0005678');
    render(<ChangeOutagePanel isProduction outageInput={OUTAGE_INPUT} />);

    expect(await screen.findByText(/This Production change has no outage record/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create planned outage record' }));

    await waitFor(() => expect(createPlannedOutage).toHaveBeenCalledWith(OUTAGE_INPUT));
    expect(await screen.findByText(/Created OUT0005678/)).toBeInTheDocument();
    expect(screen.getByText(/OUT0005678 · Planned/)).toBeInTheDocument();
  });

  it('lists the outage already linked, with no create button', async () => {
    vi.mocked(fetchChangeOutages).mockResolvedValue([LINKED_OUTAGE]);
    render(<ChangeOutagePanel isProduction outageInput={OUTAGE_INPUT} />);

    expect(await screen.findByText(/OUT0005678 · Planned/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create planned outage record' })).not.toBeInTheDocument();
  });

  it('shows why a create was refused', async () => {
    vi.mocked(fetchChangeOutages).mockResolvedValue([]);
    vi.mocked(createPlannedOutage).mockRejectedValue(new Error('Set the change\'s planned start and end first — the outage covers that window.'));
    render(<ChangeOutagePanel isProduction outageInput={OUTAGE_INPUT} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create planned outage record' }));

    expect(await screen.findByText(/Set the change's planned start and end first/)).toBeInTheDocument();
  });
});
