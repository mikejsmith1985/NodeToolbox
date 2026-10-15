// ChangePlanPdfActions.test.tsx — The two ways to get the change plan PDF beside the RCP approval email.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectionStore } from '../../../store/connectionStore.ts';
import { fetchChangePlan, openChangePlanForPrinting, type ChangePlan } from './changePlanDocument.ts';
import { ChangePlanPdfActions } from './ChangePlanPdfActions.tsx';
import type { RcpChangeFacts } from './rcpChangeFacts.ts';

vi.mock('./changePlanDocument.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./changePlanDocument.ts')>()),
  fetchChangePlan: vi.fn(),
  openChangePlanForPrinting: vi.fn(),
}));

const FACTS: RcpChangeFacts = {
  changeSysId: 'chg-1', changeNumber: 'CHG0012345', shortDescription: 'Recon deploy', stateLabel: 'Scheduled',
  environmentLabel: 'PRD', isProduction: true, riskLabel: 'Moderate',
  plannedStartUtc: '2026-10-10T00:30:00Z', plannedEndUtc: '2026-10-10T08:00:00Z', totalEstimateMinutes: 150,
  requestedBy: { sysId: 'user-dir', displayName: 'Lee, Jordan' }, configItem: { sysId: 'ci-1', displayName: 'Recon Service' },
  ciOwner: null, attachmentFileNames: [], justification: '', backoutPlan: '',
};

const PLAN: ChangePlan = {
  changeNumber: 'CHG0012345', shortDescription: 'Recon deploy', environmentLabel: 'PRD', riskLabel: 'Moderate', impactLabel: '',
  configItemName: 'Recon Service', ciOwnerName: '', requestedByName: 'Lee, Jordan', assignmentGroupName: '', windowText: '',
  description: '', justification: '', implementationPlan: '', riskImpactAnalysis: '', backoutPlan: '', testPlan: '', tasks: [],
};

/** Sets the ServiceNow address the connection store reports. */
function setSnowBaseUrl(baseUrl: string | null) {
  useConnectionStore.setState({
    proxyStatus: baseUrl === null ? null : ({ snow: { baseUrl } } as never),
  });
}

describe('ChangePlanPdfActions', () => {
  beforeEach(() => {
    vi.mocked(fetchChangePlan).mockReset();
    vi.mocked(openChangePlanForPrinting).mockReset();
  });
  afterEach(() => setSnowBaseUrl(null));

  it('links to ServiceNow\'s own PDF of the change when the ServiceNow address is known', () => {
    setSnowBaseUrl('https://acme.service-now.com');
    render(<ChangePlanPdfActions facts={FACTS} />);

    expect(screen.getByRole('link', { name: /ServiceNow PDF/ }))
      .toHaveAttribute('href', 'https://acme.service-now.com/change_request.do?PDF&sys_id=chg-1');
  });

  it('hides the ServiceNow link when the address is unknown, keeping the print-ready plan', () => {
    setSnowBaseUrl(null);
    render(<ChangePlanPdfActions facts={FACTS} />);

    expect(screen.queryByRole('link', { name: /ServiceNow PDF/ })).toBeNull();
    expect(screen.getByRole('button', { name: /print-ready plan/i })).toBeInTheDocument();
  });

  it('reads the plan, opens it for printing, and explains how to save it as a PDF', async () => {
    vi.mocked(fetchChangePlan).mockResolvedValue(PLAN);
    vi.mocked(openChangePlanForPrinting).mockReturnValue(true);
    render(<ChangePlanPdfActions facts={FACTS} />);

    fireEvent.click(screen.getByRole('button', { name: /print-ready plan/i }));

    await waitFor(() => expect(openChangePlanForPrinting).toHaveBeenCalled());
    expect(await screen.findByText(/Save as PDF/)).toBeInTheDocument();
  });

  it('says so when the pop-up is blocked', async () => {
    vi.mocked(fetchChangePlan).mockResolvedValue(PLAN);
    vi.mocked(openChangePlanForPrinting).mockReturnValue(false);
    render(<ChangePlanPdfActions facts={FACTS} />);

    fireEvent.click(screen.getByRole('button', { name: /print-ready plan/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/pop-up/i);
  });

  it('shows the error when the plan cannot be read', async () => {
    vi.mocked(fetchChangePlan).mockRejectedValue(new Error('ServiceNow is unreachable'));
    render(<ChangePlanPdfActions facts={FACTS} />);

    fireEvent.click(screen.getByRole('button', { name: /print-ready plan/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ServiceNow is unreachable');
  });
});
