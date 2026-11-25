// DashboardApiProbePanel.test.tsx — Proves the #511 probe only reads and reports every endpoint's outcome.
//
// The probe runs against production Jira, so it must be GET-only by construction (the panel never imports a
// write helper) and must turn a failed endpoint into a report line rather than stopping the run. It must also
// say how it reached Jira and as whom, so a report is never read on a guess.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardApiProbePanel } from './DashboardApiProbePanel.tsx';
import type { JiraProbeReply } from '../../services/jiraApi.ts';

const probeJiraPathMock = vi.fn();

vi.mock('../../services/jiraApi.ts', () => ({
  probeJiraPath: (...args: unknown[]) => probeJiraPathMock(...args),
}));

/** One fake proxy reply, through the Jira tab unless said otherwise. */
function reply(status: number, body: unknown, upstreamLocation: string | null = null): JiraProbeReply {
  return { status, route: 'relay', upstreamLocation, body, bodyText: typeof body === 'string' ? body : JSON.stringify(body) };
}

const DASHBOARD_PAGE = '<script>{"id":"501","title":"Team","gadgetSpecUrl":"rest/gadgets/1.0/g/com.qotilabs.jira.rich-filters-plugin:rf-gadget/g.xml"}</script>';

beforeEach(() => {
  vi.clearAllMocks();
  probeJiraPathMock.mockImplementation((path: string) => {
    const replies: Record<string, JiraProbeReply> = {
      '/rest/api/2/myself': reply(200, { name: 'U564974', displayName: 'Smith, Mike' }),
      '/rest/api/2/dashboard?filter=my': reply(200, { dashboards: [{ id: '42', name: 'Enrollment' }] }),
      '/rest/api/2/serverInfo': reply(200, { version: '11.3.12' }),
      '/rest/plugins/1.0/': reply(200, { plugins: [{ key: 'com.qotilabs.rich-filters', name: 'Rich Filters for Jira Dashboards' }] }),
      '/rest/rich-filters/1.0/rich-filters': reply(302, '', 'https://jira.example/rest/rich-filters/2.0/filters'),
      '/rest/rich-filters/2.0/filters': reply(200, [{ id: 7, name: 'Enrollment rich filter' }]),
      '/rest/richfilters/1.0/filters': reply(200, '<html><title>Log in</title></html>', 'https://jira.example/login.jsp?os_destination=x'),
      '/secure/Dashboard.jspa?selectPageId=42': reply(200, DASHBOARD_PAGE),
    };
    return Promise.resolve(replies[path] ?? reply(404, { errorMessages: ['Not Found'] }));
  });
});

/** Runs the probe and returns the report text. */
async function runProbeAndReadReport(): Promise<string> {
  render(<DashboardApiProbePanel />);
  await userEvent.click(screen.getByRole('button', { name: /run probe/i }));
  await waitFor(() => expect(screen.getByText(/Probe complete/i)).toBeInTheDocument());
  return screen.getByText(/API probe \(read-only\)/).textContent ?? '';
}

describe('DashboardApiProbePanel', () => {
  it('says who it was signed in as and through which route', async () => {
    const report = await runProbeAndReadReport();
    expect(report).toContain('Signed in to Jira as U564974 (Smith, Mike) — through your Jira tab (your own session)');
  });

  it('reports each endpoint, probes the found dashboard, and names the Rich Filters app', async () => {
    const report = await runProbeAndReadReport();
    expect(report).toContain('200  /rest/api/2/serverInfo');
    expect(report).toContain('404  /rest/api/2/dashboard/42');
    expect(report).toContain('com.qotilabs.rich-filters — Rich Filters for Jira Dashboards');
    expect(report).toContain('↳ 302 → https://jira.example/rest/rich-filters/2.0/filters');
    expect(report).toContain('↳ 200  /rest/rich-filters/2.0/filters');
    expect(report).toMatch(/↳ redirected → https:\/\/jira\.example\/login\.jsp\?os_destination=x \(login page/);
    expect(probeJiraPathMock.mock.calls.filter(([path]) => path === '/rest/api/2/dashboard?filter=my')).toHaveLength(1);
  });

  it('scans each dashboard page for its gadgets and Rich Filters addresses', async () => {
    const report = await runProbeAndReadReport();
    expect(report).toContain('Dashboard 42 page (200)');
    expect(report).toContain('gadget 501');
    expect(report).toContain('com.qotilabs.jira.rich-filters-plugin:rf-gadget');
  });
});
