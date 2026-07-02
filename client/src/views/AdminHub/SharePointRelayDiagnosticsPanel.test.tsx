// SharePointRelayDiagnosticsPanel.test.tsx — Covers the not-configured state, the connected/run
// flow, and rendering the probe rows plus the plain-English conclusion.

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SharePointRelayDiagnosticsPanel from './SharePointRelayDiagnosticsPanel.tsx';
import { probeSharePoint } from '../../services/sharepointIntakeApi.ts';
import { saveSharePointListName, saveSharePointSiteUrl } from '../../services/sharePointSiteUrl.ts';
import { useConnectionStore } from '../../store/connectionStore.ts';

vi.mock('../../services/sharepointIntakeApi.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/sharepointIntakeApi.ts')>();
  return { ...actual, probeSharePoint: vi.fn() };
});
const probeMock = vi.mocked(probeSharePoint);

function setConnected(isConnected: boolean): void {
  useConnectionStore.setState({
    relayStatusBySystem: { sharepoint: { system: 'sharepoint', isConnected, lastPingAt: null, version: null } },
  });
}

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useConnectionStore.setState({ relayStatusBySystem: {} });
});

describe('SharePointRelayDiagnosticsPanel', () => {
  it('prompts to configure when no site/list is bridged', () => {
    render(<SharePointRelayDiagnosticsPanel />);
    expect(screen.getByText(/no sharepoint site\/list configured/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run sharepoint diagnostics/i })).toBeDisabled();
  });

  it('disables Run until the relay is connected', () => {
    saveSharePointSiteUrl('https://contoso.sharepoint.com/sites/CleanUpCrew');
    saveSharePointListName('Jira-Intake');
    render(<SharePointRelayDiagnosticsPanel />);
    expect(screen.getByRole('button', { name: /run sharepoint diagnostics/i })).toBeDisabled();
    expect(screen.getByText(/relay not connected/i)).toBeInTheDocument();
  });

  it('runs the probes and renders each row plus a conclusion when configured + connected', async () => {
    saveSharePointSiteUrl('https://contoso.sharepoint.com/sites/CleanUpCrew');
    saveSharePointListName('Jira-Intake');
    setConnected(true);
    probeMock.mockResolvedValue([
      { label: 'Signed-in user (auth)', path: '/a', ok: true, status: 200, detail: 'OK — jo@contoso.com' },
      { label: "List read ('Jira-Intake')", path: '/b', ok: false, status: 403, detail: 'Attempted to perform an unauthorized operation.' },
      { label: 'List fields (schema)', path: '/c', ok: false, status: 403, detail: 'Attempted to perform an unauthorized operation.' },
    ]);

    render(<SharePointRelayDiagnosticsPanel />);
    fireEvent.click(screen.getByRole('button', { name: /run sharepoint diagnostics/i }));

    await waitFor(() => expect(screen.getByText(/Signed-in user/i)).toBeInTheDocument());
    expect(screen.getByText(/shared link|Read on the list/i)).toBeInTheDocument();
    expect(probeMock).toHaveBeenCalledWith('https://contoso.sharepoint.com/sites/CleanUpCrew', 'Jira-Intake');
  });
});
