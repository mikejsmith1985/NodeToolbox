// RcpInFlightSweep.test.tsx — Checking every in-flight Production change against the RCP rules at once (GH #415).

import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchMyInFlightProductionChanges, fetchRcpChangeFacts, type RcpChangeFacts } from './rcpChangeFacts.ts';
import { RcpInFlightSweep } from './RcpInFlightSweep.tsx';

vi.mock('./rcpChangeFacts.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./rcpChangeFacts.ts')>()),
  fetchMyInFlightProductionChanges: vi.fn(),
  fetchRcpChangeFacts: vi.fn(),
}));

const BASE_FACTS: RcpChangeFacts = {
  changeSysId: 'a', changeNumber: 'CHG0000001', shortDescription: 'Recon deploy', stateLabel: 'Scheduled',
  environmentLabel: 'PRD', isProduction: true, riskLabel: 'Low',
  plannedStartUtc: '2026-10-10T00:30:00Z', plannedEndUtc: '2026-10-10T08:00:00Z', totalEstimateMinutes: 60,
  requestedBy: { sysId: 'dir', displayName: 'Lee, Jordan' }, configItem: { sysId: 'ci', displayName: 'Recon' },
  ciOwner: { sysId: 'dir', displayName: 'Lee, Jordan' }, attachmentFileNames: ['approval.msg'],
  justification: 'Must deploy during RCP; delaying until after Jan 19 misses the Nov 1 regulatory deadline.', backoutPlan: '',
};

describe('RcpInFlightSweep', () => {
  beforeEach(() => {
    vi.mocked(fetchMyInFlightProductionChanges).mockReset();
    vi.mocked(fetchRcpChangeFacts).mockReset();
  });
  afterEach(() => localStorage.clear());

  it('checks each in-flight Production change and lists what is still open, with a way to open it', async () => {
    vi.mocked(fetchMyInFlightProductionChanges).mockResolvedValue([
      { changeSysId: 'a', changeNumber: 'CHG0000001', stateLabel: 'Scheduled' },
      { changeSysId: 'b', changeNumber: 'CHG0000002', stateLabel: 'Assess' },
    ]);
    vi.mocked(fetchRcpChangeFacts).mockImplementation(async (changeSysId) => (changeSysId === 'a'
      ? BASE_FACTS
      : { ...BASE_FACTS, changeSysId: 'b', changeNumber: 'CHG0000002', attachmentFileNames: [] }));
    const onOpenChange = vi.fn();
    render(<RcpInFlightSweep onOpenChange={onOpenChange} todayIso="2026-10-05" />);

    fireEvent.click(screen.getByRole('button', { name: /Check my in-flight Production changes/ }));

    const readyRow = await screen.findByRole('row', { name: /CHG0000001/ });
    expect(within(readyRow).getByText('5 of 5')).toBeInTheDocument();
    const openRow = screen.getByRole('row', { name: /CHG0000002/ });
    expect(within(openRow).getByText('4 of 5')).toBeInTheDocument();
    expect(within(openRow).getByText(/Director approval attached/)).toBeInTheDocument();

    fireEvent.click(within(openRow).getByRole('button', { name: /Open/ }));
    expect(onOpenChange).toHaveBeenCalledWith('CHG0000002');
  });

  it('says so when no in-flight Production change is found', async () => {
    vi.mocked(fetchMyInFlightProductionChanges).mockResolvedValue([]);
    render(<RcpInFlightSweep onOpenChange={vi.fn()} todayIso="2026-10-05" />);

    fireEvent.click(screen.getByRole('button', { name: /Check my in-flight Production changes/ }));

    expect(await screen.findByText(/No Production changes of yours are in Assess, Authorize or Scheduled/)).toBeInTheDocument();
  });

  it('is hidden while the RCP rules are switched off', () => {
    localStorage.setItem('tbxRcpRulesEnabled', 'false');
    const { container } = render(<RcpInFlightSweep onOpenChange={vi.fn()} todayIso="2026-10-05" />);

    expect(container).toBeEmptyDOMElement();
  });
});
