// DashboardApiProbePanel.test.tsx — Proves the #511 probe only reads and reports every endpoint's outcome.
//
// The probe runs against production Jira, so it must be GET-only by construction (the panel never imports a
// write helper) and must turn a failed endpoint into a report line rather than stopping the run.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardApiProbePanel } from './DashboardApiProbePanel.tsx';

const jiraGetMock = vi.fn();
const readJiraRedirectTargetMock = vi.fn();

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: (...args: unknown[]) => jiraGetMock(...args),
  readJiraRedirectTarget: (...args: unknown[]) => readJiraRedirectTargetMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  jiraGetMock.mockImplementation((path: string) => {
    if (path === '/rest/api/2/dashboard?filter=my') return Promise.resolve({ dashboards: [{ id: '42', name: 'Enrollment' }] });
    if (path === '/rest/api/2/serverInfo') return Promise.resolve({ version: '9.12.0' });
    if (path === '/rest/plugins/1.0/') {
      return Promise.resolve({ plugins: [{ key: 'com.qotilabs.rich-filters', name: 'Rich Filters for Jira Dashboards' }] });
    }
    if (path === '/rest/rich-filters/1.0/rich-filters') return Promise.reject(new Error(`Jira GET ${path} failed: 302`));
    if (path === '/rest/rich-filters/2.0/filters') return Promise.resolve([{ id: 7, name: 'Enrollment rich filter' }]);
    if (path === '/rest/richfilters/1.0/filters') return Promise.reject(new Error(`Jira GET ${path} failed: 302`));
    return Promise.reject(new Error(`Jira GET ${path} failed: 404 — Not Found`));
  });
  readJiraRedirectTargetMock.mockImplementation((path: string) => {
    if (path === '/rest/rich-filters/1.0/rich-filters') return Promise.resolve('https://jira.example/rest/rich-filters/2.0/filters');
    if (path === '/rest/richfilters/1.0/filters') return Promise.resolve('https://jira.example/login.jsp?os_destination=x');
    return Promise.resolve(null);
  });
});

describe('DashboardApiProbePanel', () => {
  it('reports each endpoint, probes the found dashboard, and names the Rich Filters app', async () => {
    render(<DashboardApiProbePanel />);
    await userEvent.click(screen.getByRole('button', { name: /run probe/i }));
    await waitFor(() => expect(screen.getByText(/Probe complete/i)).toBeInTheDocument());

    const report = screen.getByText(/API probe \(read-only\)/).textContent ?? '';
    expect(report).toContain('200  /rest/api/2/serverInfo');
    expect(report).toContain('404  /rest/api/2/dashboard/42');
    expect(report).toContain('com.qotilabs.rich-filters — Rich Filters for Jira Dashboards');
    expect(report).toContain('↳ 302 → https://jira.example/rest/rich-filters/2.0/filters');
    expect(report).toContain('↳ 200  /rest/rich-filters/2.0/filters');
    expect(report).toMatch(/↳ 302 → https:\/\/jira\.example\/login\.jsp\?os_destination=x \(login page/);
    expect(readJiraRedirectTargetMock).not.toHaveBeenCalledWith('/rest/api/2/dashboard/42');
    expect(jiraGetMock.mock.calls.filter(([path]) => path === '/rest/api/2/dashboard?filter=my')).toHaveLength(1);
  });
});
