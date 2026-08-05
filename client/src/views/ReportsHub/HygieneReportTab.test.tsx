// HygieneReportTab.test.tsx — Unit tests for the Reports Hub hygiene scan tab, which must offer
// exactly the teams configured in the Admin Hub Hygiene Monitor (the only teams the scan endpoint
// knows), never the unrelated ART team names from the Reports Hub global filter.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HygieneReportTab } from './HygieneReportTab.tsx';

/** Builds a fetch mock serving the hygiene monitor config plus an optional scan response. */
function mockHygieneApi(configTeams: Array<{ teamName: string }>, scanResult?: object) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = String(input);
    if (requestUrl.includes('/api/hygiene-monitor/config')) {
      return new Response(JSON.stringify({ teams: configTeams }), { status: 200 });
    }
    if (requestUrl.includes('/api/hygiene-monitor/scan')) {
      const requestedTeam = JSON.parse(String(init?.body)) as { teamName: string };
      const isKnownTeam = configTeams.some((team) => team.teamName === requestedTeam.teamName);
      if (!isKnownTeam) {
        return new Response(JSON.stringify({ error: `Team not found: ${requestedTeam.teamName}` }), { status: 404 });
      }
      return new Response(JSON.stringify(scanResult ?? {}), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${requestUrl}`);
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockHygieneApi([]));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HygieneReportTab', () => {
  it('offers the hygiene-monitor-configured teams, not the passed ART filter name', async () => {
    vi.stubGlobal('fetch', mockHygieneApi([{ teamName: 'Transformers' }, { teamName: 'Autobots' }]));
    render(<HygieneReportTab teamName="Some ART Team" />);

    const teamSelect = await screen.findByLabelText(/hygiene team/i);
    expect(teamSelect).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Transformers' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Autobots' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Some ART Team' })).not.toBeInTheDocument();
  });

  it('preselects the global filter team when it matches a configured team', async () => {
    vi.stubGlobal('fetch', mockHygieneApi([{ teamName: 'Transformers' }, { teamName: 'Autobots' }]));
    render(<HygieneReportTab teamName="Autobots" />);

    expect(await screen.findByLabelText(/hygiene team/i)).toHaveValue('Autobots');
  });

  it('explains where to configure teams when none exist yet', async () => {
    render(<HygieneReportTab teamName="Transformers" />);

    expect(await screen.findByText(/no hygiene monitor teams configured/i)).toBeInTheDocument();
    expect(screen.getByText(/admin hub/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /run hygiene scan/i })).not.toBeInTheDocument();
  });

  it('runs the scan against the selected configured team and renders the result counts', async () => {
    const fetchMock = mockHygieneApi([{ teamName: 'Transformers' }], {
      teamName: 'Transformers',
      issuesScanned: 42,
      violationsFound: 7,
      fixesApplied: 3,
      actionsRequired: 4,
      failures: [],
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<HygieneReportTab teamName="" />);

    await user.click(await screen.findByRole('button', { name: /run hygiene scan/i }));

    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());
    expect(screen.getByText(/issues scanned/i)).toBeInTheDocument();
    const scanCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/scan'));
    expect(JSON.parse(String((scanCall?.[1] as RequestInit).body))).toEqual({ teamName: 'Transformers' });
  });

  it('surfaces a scan error message inline', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const requestUrl = String(input);
      if (requestUrl.includes('/config')) {
        return new Response(JSON.stringify({ teams: [{ teamName: 'Transformers' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'Scan service unavailable.' }), { status: 503 });
    }));
    const user = userEvent.setup();
    render(<HygieneReportTab teamName="" />);

    await user.click(await screen.findByRole('button', { name: /run hygiene scan/i }));

    expect(await screen.findByText(/scan service unavailable/i)).toBeInTheDocument();
  });
});
