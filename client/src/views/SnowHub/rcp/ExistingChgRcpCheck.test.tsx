// ExistingChgRcpCheck.test.tsx — The RCP checklist for a change that already exists in ServiceNow (GH #415).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiAssistStore } from '../../../store/aiAssistStore.ts';
import { saveRcpChangeFix } from './rcpChangeFixes.ts';
import { fetchRcpChangeFacts, type RcpChangeFacts } from './rcpChangeFacts.ts';
import { ExistingChgRcpCheck } from './ExistingChgRcpCheck.tsx';

vi.mock('./rcpChangeFixes.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./rcpChangeFixes.ts')>()),
  saveRcpChangeFix: vi.fn(),
}));
vi.mock('./rcpChangeFacts.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./rcpChangeFacts.ts')>()),
  fetchRcpChangeFacts: vi.fn(),
}));

const PRODUCTION_FACTS: RcpChangeFacts = {
  changeSysId: 'chg-1', changeNumber: 'CHG0012345', shortDescription: 'Recon deploy', stateLabel: 'Scheduled',
  environmentLabel: 'PRD', isProduction: true, riskLabel: 'Moderate',
  plannedStartUtc: '2026-10-10T00:30:00Z', plannedEndUtc: '2026-10-10T08:00:00Z', totalEstimateMinutes: 150,
  requestedBy: { sysId: 'user-dir', displayName: 'Lee, Jordan' }, configItem: { sysId: 'ci-1', displayName: 'Recon Service' },
  ciOwner: { sysId: 'user-dir', displayName: 'Lee, Jordan' }, attachmentFileNames: [], justification: '', backoutPlan: '',
};

describe('ExistingChgRcpCheck', () => {
  beforeEach(() => {
    vi.mocked(fetchRcpChangeFacts).mockReset();
  });
  afterEach(() => localStorage.clear());

  it('checks a Production change against the RCP rules, and re-checks on request', async () => {
    vi.mocked(fetchRcpChangeFacts).mockResolvedValue(PRODUCTION_FACTS);
    render(<ExistingChgRcpCheck changeSysId="chg-1" todayIso="2026-10-05" />);

    expect(await screen.findByText(/RCP rules met/)).toBeInTheDocument();
    expect(screen.getByText(/❌ Director approval attached/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Re-check/ }));
    await waitFor(() => expect(fetchRcpChangeFacts).toHaveBeenCalledTimes(2));
  });

  it('says the rules do not apply to a non-Production change', async () => {
    vi.mocked(fetchRcpChangeFacts).mockResolvedValue({ ...PRODUCTION_FACTS, isProduction: false, environmentLabel: 'REL' });
    render(<ExistingChgRcpCheck changeSysId="chg-1" todayIso="2026-10-05" />);

    expect(await screen.findByText(/apply to Production changes only/)).toBeInTheDocument();
  });

  it('shows nothing when the RCP rules are switched off or over', () => {
    localStorage.setItem('tbxRcpRulesEnabled', 'false');
    const { container } = render(<ExistingChgRcpCheck changeSysId="chg-1" todayIso="2026-10-05" />);
    localStorage.clear();
    const { container: afterPeriod } = render(<ExistingChgRcpCheck changeSysId="chg-1" todayIso="2027-01-20" />);

    expect(container).toBeEmptyDOMElement();
    expect(afterPeriod).toBeEmptyDOMElement();
    expect(fetchRcpChangeFacts).not.toHaveBeenCalled();
  });
});

describe('ExistingChgRcpCheck fixes', () => {
  const NEEDS_FIXING: RcpChangeFacts = {
    ...PRODUCTION_FACTS,
    riskLabel: 'Low',
    plannedStartUtc: '2026-10-08T15:00:00Z',
    plannedEndUtc: '2026-10-08T17:00:00Z',
    requestedBy: { sysId: 'user-pat', displayName: 'Smith, Pat' },
    justification: 'Fixes the LIS mismatch.',
  };

  beforeEach(() => {
    vi.mocked(fetchRcpChangeFacts).mockReset();
    vi.mocked(fetchRcpChangeFacts).mockResolvedValue(NEEDS_FIXING);
    vi.mocked(saveRcpChangeFix).mockReset();
    vi.mocked(saveRcpChangeFix).mockResolvedValue(undefined);
  });
  afterEach(() => useAiAssistStore.setState({ isAiAssistUnlocked: false }));

  function renderFixable(onFixSaved = vi.fn()) {
    render(<ExistingChgRcpCheck changeSysId="chg-1" nowUtc="2026-10-08T15:00:00Z" onFixSaved={onFixSaved} todayIso="2026-10-08" />);
    return onFixSaved;
  }

  it('moves the change to the next approved window in ServiceNow, updates the form, and re-checks', async () => {
    const onFixSaved = renderFixable();

    fireEvent.click(await screen.findByRole('button', { name: /Move to the next approved window/ }));

    await waitFor(() => expect(saveRcpChangeFix).toHaveBeenCalledWith('chg-1', {
      plannedStartUtc: '2026-10-10T00:00:00Z', plannedEndUtc: '2026-10-10T02:30:00Z',
    }));
    expect(onFixSaved).toHaveBeenCalledWith({ plannedStartUtc: '2026-10-10T00:00:00Z', plannedEndUtc: '2026-10-10T02:30:00Z' });
    await waitFor(() => expect(fetchRcpChangeFacts).toHaveBeenCalledTimes(2));
  });

  it('sets Requested By to the CI owner', async () => {
    const onFixSaved = renderFixable();

    fireEvent.click(await screen.findByRole('button', { name: /Set Requested By to Lee, Jordan/ }));

    await waitFor(() => expect(saveRcpChangeFix).toHaveBeenCalledWith('chg-1', { requestedBySysId: 'user-dir' }));
    expect(onFixSaved).toHaveBeenCalledWith({ requestedBy: { sysId: 'user-dir', displayName: 'Lee, Jordan' } });
  });

  it('rewrites the justification through AI Assist and saves it', async () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: true });
    const onFixSaved = renderFixable();

    fireEvent.click(await screen.findByRole('button', { name: /Fix the justification with AI Assist/ }));
    fireEvent.change(screen.getByLabelText(/Paste the assistant/), { target: { value: 'JUSTIFICATION:\nMust ship during RCP.' } });
    fireEvent.click(screen.getByRole('button', { name: /Save this justification/ }));

    await waitFor(() => expect(saveRcpChangeFix).toHaveBeenCalledWith('chg-1', { justification: 'Must ship during RCP.' }));
    expect(onFixSaved).toHaveBeenCalledWith({ justification: 'Must ship during RCP.' });
  });
});
