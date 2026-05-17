// DevPanelView.test.tsx — Verifies the Dev Panel renders Jira API activity and Server Logs tabs.

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DevPanelView from './DevPanelView.tsx';

const API_EVENT_NAME = 'toolbox:api';

function dispatchApiEvent(apiEventDetail: { method: string; url: string; status: number | null; durationMs: number; errorMessage?: string | null }): void {
  act(() => {
    window.dispatchEvent(new CustomEvent(API_EVENT_NAME, { detail: apiEventDetail }));
  });
}

function renderDevPanelView() {
  return render(<DevPanelView />);
}

beforeEach(() => {
  // Default fetch mock handles requests to endpoints that expect array responses
  // Other endpoints set up specific mocks in their tests
  vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const endpointUrl = String(input);
    // For scheduler endpoints, return minimal response structure to avoid errors
    if (endpointUrl.includes('/api/scheduler')) {
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    }
    // For server logs, return empty array
    return {
      ok: true,
      json: async () => [],
    } as Response;
  })
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DevPanelView — Jira API tab', () => {
  it('shows an empty state when no API calls have been recorded', () => {
    renderDevPanelView();

    expect(screen.getByText(/No Jira API calls recorded yet/i)).toBeInTheDocument();
  });

  it('renders dispatched API events with method, status, url, and duration', () => {
    renderDevPanelView();

    dispatchApiEvent({ method: 'GET', url: '/rest/api/3/search', status: 200, durationMs: 87 });

    const activityTable = screen.getByRole('table', { name: /Jira API activity log/i });
    expect(within(activityTable).getByText('GET')).toBeInTheDocument();
    expect(within(activityTable).getByText('/rest/api/3/search')).toBeInTheDocument();
    expect(within(activityTable).getByText('200')).toBeInTheDocument();
    expect(activityTable).toHaveTextContent('87 ms');
  });

  it('renders network errors with a readable status label and error detail', () => {
    renderDevPanelView();

    dispatchApiEvent({ method: 'GET', url: '/rest/api/3/myself', status: null, durationMs: 12, errorMessage: 'Network unavailable' });

    expect(screen.getByText('Network error')).toBeInTheDocument();
    expect(screen.getByText('Network unavailable')).toBeInTheDocument();
  });

  it('drops new events while paused and resumes with later events', async () => {
    const user = userEvent.setup();
    renderDevPanelView();

    await user.click(screen.getByRole('button', { name: /Pause logging/i }));
    dispatchApiEvent({ method: 'GET', url: '/ignored', status: 200, durationMs: 1 });
    await user.click(screen.getByRole('button', { name: /Resume logging/i }));
    dispatchApiEvent({ method: 'POST', url: '/recorded', status: 201, durationMs: 2 });

    expect(screen.queryByText('/ignored')).not.toBeInTheDocument();
    expect(screen.getByText('/recorded')).toBeInTheDocument();
  });

  it('clears the activity table when the Clear button is clicked', async () => {
    const user = userEvent.setup();
    renderDevPanelView();

    dispatchApiEvent({ method: 'PUT', url: '/rest/api/3/issue/TBX-1', status: 204, durationMs: 33 });
    await user.click(screen.getByRole('button', { name: /Clear log/i }));

    expect(screen.queryByText('/rest/api/3/issue/TBX-1')).not.toBeInTheDocument();
    expect(screen.getByText(/No Jira API calls recorded yet/i)).toBeInTheDocument();
  });

  it('exports CSV by creating an object URL and clicking a download link', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:dev-panel-csv');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    renderDevPanelView();

    dispatchApiEvent({ method: 'GET', url: '/rest/api/3/search', status: 200, durationMs: 87 });
    await user.click(screen.getByRole('button', { name: /Export CSV/i }));

    expect(createObjectUrlSpy).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:dev-panel-csv');
  });

  it('disables CSV export while the log is empty', () => {
    renderDevPanelView();

    expect(screen.getByRole('button', { name: /Export CSV/i })).toBeDisabled();
  });

  it('shows counter pills for total calls, errors, and average duration', () => {
    renderDevPanelView();

    dispatchApiEvent({ method: 'GET', url: '/ok', status: 200, durationMs: 100 });
    dispatchApiEvent({ method: 'POST', url: '/bad', status: 500, durationMs: 300, errorMessage: 'boom' });

    expect(screen.getByText('Total calls')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Errors')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Avg duration')).toBeInTheDocument();
    expect(screen.getByText('200 ms')).toBeInTheDocument();
  });

  it('formats the timestamp column as HH:MM:SS', () => {
    renderDevPanelView();

    dispatchApiEvent({ method: 'DELETE', url: '/rest/api/3/issue/TBX-2', status: 204, durationMs: 8 });

    expect(screen.getByText(/^\d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
  });
});

describe('DevPanelView — Server Logs tab', () => {
  it('switches to the Server Logs tab when that button is clicked', async () => {
    const user = userEvent.setup();
    renderDevPanelView();

    await user.click(screen.getByRole('tab', { name: /Server Logs/i }));

    expect(screen.getByRole('tabpanel', { name: /Server Logs/i })).toBeInTheDocument();
  });

  it('shows an empty state when the server returns no log entries', async () => {
    const user = userEvent.setup();
    renderDevPanelView();

    await user.click(screen.getByRole('tab', { name: /Server Logs/i }));

    // Wait for the loading state to resolve.
    expect(await screen.findByText(/No server log entries captured yet/i)).toBeInTheDocument();
  });

  it('renders server log entries in the table after fetch resolves', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 1, timestamp: new Date().toISOString(), level: 'info', message: 'Server started OK' },
      ],
    } as Response)

    const user = userEvent.setup();
    renderDevPanelView();

    await user.click(screen.getByRole('tab', { name: /Server Logs/i }));

    expect(await screen.findByText('Server started OK')).toBeInTheDocument();
    expect(screen.getByText('INFO')).toBeInTheDocument();
  });

  it('shows an error banner when the log fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Server unreachable'))

    const user = userEvent.setup();
    renderDevPanelView();

    await user.click(screen.getByRole('tab', { name: /Server Logs/i }));

    expect(await screen.findByText(/Could not fetch server logs/i)).toBeInTheDocument();
  });
});

describe('DevPanelView — Repo Monitor Validation tab', () => {
  it('loads scheduler status data and displays monitor validation counters', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const endpointUrl = String(input);
      if (endpointUrl.includes('/api/scheduler/config')) {
        return {
          ok: true,
          json: async () => ({
            repoMonitor: {
              enabled: true,
              repos: ['mikejsmith1985/NodeToolbox'],
              branchPattern: 'main',
              intervalMin: 15,
              transitions: {
                branchCreated: 'Backlog',
                commitPushed: 'In Progress',
                prOpened: 'In Review',
                prMerged: 'Done',
              },
            },
          }),
        } as Response;
      }
      if (endpointUrl.includes('/api/scheduler/status')) {
        return {
          ok: true,
          json: async () => ({
            repoMonitor: {
              enabled: true,
              repos: ['mikejsmith1985/NodeToolbox'],
              intervalMin: 15,
              lastRunAt: '2026-01-01T00:00:00.000Z',
              nextRunAt: '2026-01-01T00:15:00.000Z',
              eventCount: 3,
            },
          }),
        } as Response;
      }
      if (endpointUrl.includes('/api/scheduler/results')) {
        return {
          ok: true,
          json: async () => ({
            repoMonitor: {
              lastRunAt: '2026-01-01T00:00:00.000Z',
              nextRunAt: '2026-01-01T00:15:00.000Z',
              eventCount: 3,
              events: [
                {
                  repo: 'mikejsmith1985/NodeToolbox',
                  eventType: 'prOpened',
                  jiraKey: 'TBX-123',
                  message: 'Transitioned issue',
                  isSuccess: true,
                  timestamp: '2026-01-01T00:00:00.000Z',
                  source: 'server',
                },
              ],
            },
          }),
        } as Response;
      }
      if (endpointUrl.includes('/api/scheduler/validate')) {
        return {
          ok: true,
          json: async () => ({
            repoMonitor: {
              checkedAt: '2026-01-01T00:00:00.000Z',
              isGitHubConfigured: true,
              isGitHubReachable: true,
              configuredRepoCount: 1,
              reachableRepoCount: 1,
              unreachableRepoCount: 0,
              probeErrorMessage: null,
              validationMode: 'read-only-github-probe',
              repos: [
                {
                  repo: 'mikejsmith1985/NodeToolbox',
                  isReachable: true,
                  branchesHttpStatus: 200,
                  pullsHttpStatus: 200,
                  branchProbeCount: 1,
                  pullRequestProbeCount: 1,
                  probeErrorMessage: null,
                },
              ],
            },
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({ entries: [] }) } as Response;
    });

    const user = userEvent.setup();
    renderDevPanelView();
    await user.click(screen.getByRole('tab', { name: /Repo Monitor Validation/i }));

    expect(await screen.findByText('Configured repos')).toBeInTheDocument();
    expect(screen.getByText('Event count')).toBeInTheDocument();
    expect(screen.getByText('GitHub probe')).toBeInTheDocument();
    expect(screen.getByText('Reachable repos:')).toBeInTheDocument();
    expect(screen.getAllByText(/mikejsmith1985\/NodeToolbox/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/TBX-123/i)).toBeInTheDocument();
  });
});

describe('DevPanelView — GitHub Debug tab', () => {
  it('switches to the GitHub Debug tab when that button is clicked', async () => {
    const user = userEvent.setup();
    renderDevPanelView();

    await user.click(screen.getByRole('tab', { name: /GitHub Debug/i }));

    // The tab should be visible even if data isn't loaded yet
    expect(screen.getByRole('tabpanel', { name: /GitHub Debug/i })).toBeInTheDocument();
  });

  it('displays GitHub debug info when the fetch button is clicked', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const endpointUrl = String(input);
      if (endpointUrl.includes('/api/scheduler/github-debug')) {
        return {
          ok: true,
          json: async () => ({
            isConfigured: true,
            timestamp: '2026-01-01T00:00:00.000Z',
            debugInfo: {
              pat: 'ghp_...***',
              baseUrl: 'https://api.github.com',
              authHeaderFormat: 'token <PAT>',
              sentHeader: 'Authorization: token ghp_...***',
            },
            probeResult: {
              endpoint: 'https://api.github.com/repos/mikejsmith1985/NodeToolbox/branches',
              method: 'GET',
              statusCode: 200,
              statusText: 'OK',
              responseTime: 245,
              success: true,
            },
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    const user = userEvent.setup();
    renderDevPanelView();
    await user.click(screen.getByRole('tab', { name: /GitHub Debug/i }));
    await user.click(screen.getByRole('button', { name: /Fetch GitHub Debug Info/i }));

    expect(await screen.findByText(/Configuration Status/i)).toBeInTheDocument();
    expect(screen.getByText('✓ Connected')).toBeInTheDocument();
    expect(screen.getByText('ghp_...***')).toBeInTheDocument();
    expect(screen.getByText('token <PAT>')).toBeInTheDocument();
    expect(screen.getByText(/Probe Result/i)).toBeInTheDocument();
    expect(screen.getByText('GET')).toBeInTheDocument();
  });

  it('shows an error banner when the debug fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const endpointUrl = String(input);
      if (endpointUrl.includes('/api/scheduler/github-debug')) {
        throw new Error('GitHub debug fetch failed');
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    const user = userEvent.setup();
    renderDevPanelView();
    await user.click(screen.getByRole('tab', { name: /GitHub Debug/i }));
    await user.click(screen.getByRole('button', { name: /Fetch GitHub Debug Info/i }));

    expect(await screen.findByText(/GitHub debug fetch failed/i)).toBeInTheDocument();
  });

  it('displays unconfigured status when GitHub PAT is not configured', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const endpointUrl = String(input);
      if (endpointUrl.includes('/api/scheduler/github-debug')) {
        return {
          ok: true,
          json: async () => ({
            isConfigured: false,
            message: 'GitHub PAT not configured in Admin Hub',
            debugInfo: {
              pat: null,
              baseUrl: 'https://api.github.com',
              authHeaderFormat: 'token <PAT>',
              expectedHeader: 'Authorization: token ghp_*** (masked for security)',
            },
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    });

    const user = userEvent.setup();
    renderDevPanelView();
    await user.click(screen.getByRole('tab', { name: /GitHub Debug/i }));
    await user.click(screen.getByRole('button', { name: /Fetch GitHub Debug Info/i }));

    expect(await screen.findByText(/Configuration Status/i)).toBeInTheDocument();
    expect(screen.getByText('✗ Not Configured')).toBeInTheDocument();
    expect(screen.getByText(/GitHub PAT not configured/i)).toBeInTheDocument();
    expect(screen.getByText('Not configured')).toBeInTheDocument();
  });

  it('shows connected status and authenticated user when the probe succeeds', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const endpointUrl = String(input);
      if (endpointUrl.includes('/api/scheduler/github-debug')) {
        return {
          ok: true,
          json: async () => ({
            isConfigured: true,
            timestamp: '2026-01-01T12:00:00.000Z',
            debugInfo: {
              pat: 'ghp_...tDg3',
              baseUrl: 'https://api.github.com',
              authHeaderFormat: 'token <PAT>',
              sentHeader: 'Authorization: token ghp_...tDg3',
            },
            probeResult: {
              endpoint: '/user (authenticated user info)',
              method: 'GET',
              statusCode: 200,
              statusText: 'OK',
              responseTime: 312,
              success: true,
              authenticatedAs: 'mikejsmith1985',
            },
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    const user = userEvent.setup();
    renderDevPanelView();
    await user.click(screen.getByRole('tab', { name: /GitHub Debug/i }));
    await user.click(screen.getByRole('button', { name: /Fetch GitHub Debug Info/i }));

    // Status header must say "Connected" — not just "Configured" — when the probe passed
    expect(await screen.findByText('✓ Connected')).toBeInTheDocument();
    // The actual status code + method must be visible (may appear in span + parent containers)
    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.getAllByText(/200.*OK/).length).toBeGreaterThan(0);
    // Authenticated-as must be displayed
    expect(screen.getByText('mikejsmith1985')).toBeInTheDocument();
    // No error banner
    expect(screen.queryByText(/probe failed/i)).not.toBeInTheDocument();
  });

  it('shows a red failure status and the actual HTTP error when the probe fails', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
      const endpointUrl = String(input);
      if (endpointUrl.includes('/api/scheduler/github-debug')) {
        return {
          ok: true,
          json: async () => ({
            isConfigured: true,
            timestamp: '2026-01-01T12:00:00.000Z',
            debugInfo: {
              pat: 'ghp_...tDg3',
              baseUrl: 'https://api.github.com',
              authHeaderFormat: 'token <PAT>',
              sentHeader: 'Authorization: token ghp_...tDg3',
            },
            probeResult: {
              endpoint: '/user (authenticated user info)',
              method: 'GET',
              statusCode: 401,
              statusText: 'Unauthorized',
              responseTime: 198,
              success: false,
              errorMessage: 'HTTP 401 Unauthorized — Bad credentials',
            },
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    const user = userEvent.setup();
    renderDevPanelView();
    await user.click(screen.getByRole('tab', { name: /GitHub Debug/i }));
    await user.click(screen.getByRole('button', { name: /Fetch GitHub Debug Info/i }));

    // Status header must say "failed" — not the misleading green "Configured"
    expect(await screen.findByText('✗ PAT configured but probe failed')).toBeInTheDocument();
    // The actual error must appear at least once (it shows in both the prominent banner
    // and the probe result table — both rendering it is correct behaviour)
    expect(screen.getAllByText(/HTTP 401 Unauthorized — Bad credentials/).length).toBeGreaterThan(0);
    // The probe details show the real status code — appears in both the span and parent containers
    expect(screen.getAllByText(/401.*Unauthorized/).length).toBeGreaterThan(0);
    // Success flag shows ✗
    expect(screen.getByText('✗ No')).toBeInTheDocument();
  });
});
