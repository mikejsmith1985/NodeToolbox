// SharePointDiagnostics.test.tsx — Covers the disabled-until-connected state, running the probes,
// and rendering each result row plus the plain-English conclusion.

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SharePointDiagnostics from './SharePointDiagnostics.tsx';
import { probeSharePoint } from '../../../services/sharepointIntakeApi.ts';

vi.mock('../../../services/sharepointIntakeApi.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/sharepointIntakeApi.ts')>();
  return { ...actual, probeSharePoint: vi.fn() };
});
const probeMock = vi.mocked(probeSharePoint);

const BASE = { siteRelativeUrl: '/sites/CleanUpCrew', listName: 'Jira-Intake', isConnected: true };

afterEach(() => { vi.clearAllMocks(); });

describe('SharePointDiagnostics', () => {
  it('disables Run diagnostics until the relay is connected', () => {
    render(<SharePointDiagnostics {...BASE} isConnected={false} />);
    expect(screen.getByRole('button', { name: /run diagnostics/i })).toBeDisabled();
  });

  it('runs the probes and renders each result row plus a conclusion', async () => {
    probeMock.mockResolvedValue([
      { label: 'Signed-in user (auth)', path: '/a', ok: true, status: 200, detail: 'OK — jo@contoso.com' },
      { label: "List read ('Jira-Intake')", path: '/b', ok: false, status: 403, detail: 'Attempted to perform an unauthorized operation.' },
      { label: 'List fields (schema)', path: '/c', ok: false, status: 403, detail: 'Attempted to perform an unauthorized operation.' },
    ]);

    render(<SharePointDiagnostics {...BASE} />);
    fireEvent.click(screen.getByRole('button', { name: /run diagnostics/i }));

    await waitFor(() => expect(screen.getByText(/Signed-in user/i)).toBeInTheDocument());
    expect(screen.getByText(/List fields \(schema\)/i)).toBeInTheDocument();
    // Auth ok + list fail → the list-permission conclusion.
    expect(screen.getByText(/shared link|Read on the list/i)).toBeInTheDocument();
    expect(probeMock).toHaveBeenCalledWith('/sites/CleanUpCrew', 'Jira-Intake');
  });
});
