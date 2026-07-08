// PersonalFlowTab.test.tsx — Verifies the Personal Flow tab wires the pure compute
// core to Jira: it fetches statuses + a person's closed issues, renders throughput
// and cycle-time cards plus a per-issue row, guards an empty person, and surfaces
// fetch failures as an alert. The metric math itself is covered by personalFlow.test.ts.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A single mock for the Jira client, routed by request path so one implementation can
// answer both the status lookup and the issue search.
const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
}));

import { PersonalFlowTab } from './PersonalFlowTab.tsx';

// Status ids mapped to their Jira category so the changelog transitions read declaratively.
const STATUSES = [
  { id: '1', statusCategory: { key: 'new' } },
  { id: '3', statusCategory: { key: 'indeterminate' } },
  { id: '5', statusCategory: { key: 'done' } },
];

/** Two closed issues, each moving into in-progress (id 3) then done (id 5), with story points. */
function buildSearchResponse() {
  return {
    issues: [
      {
        key: 'TBX-1',
        fields: {
          summary: 'Build login page',
          resolutiondate: '2026-07-05T12:00:00.000Z',
          customfield_10028: 5,
        },
        changelog: {
          histories: [
            { created: '2026-07-01T09:00:00.000Z', items: [{ field: 'status', to: '3' }] },
            { created: '2026-07-05T12:00:00.000Z', items: [{ field: 'status', to: '5' }] },
          ],
        },
      },
      {
        key: 'TBX-2',
        fields: {
          summary: 'Fix logout defect',
          resolutiondate: '2026-07-06T12:00:00.000Z',
          customfield_10016: 3,
        },
        changelog: {
          histories: [
            { created: '2026-07-03T09:00:00.000Z', items: [{ field: 'status', to: '3' }] },
            { created: '2026-07-06T12:00:00.000Z', items: [{ field: 'status', to: '5' }] },
          ],
        },
      },
    ],
  };
}

/** Reads the value rendered next to a stat-card label (label and value are sibling elements). */
function readStatCardValue(labelText: string): string {
  const labelNode = screen.getByText(labelText);
  return labelNode.nextElementSibling?.textContent ?? '';
}

describe('PersonalFlowTab', () => {
  beforeEach(() => {
    // Fake only Date so the injected `todayIso` is deterministic while promises/timers stay real.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-08T00:00:00.000Z'));
    mockJiraGet.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('disables Run until a person is entered (empty-person guard)', () => {
    render(<PersonalFlowTab />);
    const runButton = screen.getByRole('button', { name: /run report/i });
    expect(runButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/person \(jira assignee\)/i), {
      target: { value: 'Jane Dev' },
    });
    expect(runButton).toBeEnabled();
  });

  it('fetches, computes, and renders throughput/cycle-time cards and per-issue rows', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve(buildSearchResponse());
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    fireEvent.change(screen.getByLabelText(/person \(jira assignee\)/i), {
      target: { value: 'Jane Dev' },
    });
    fireEvent.change(screen.getByLabelText(/lookback window/i), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /run report/i }));

    // Per-issue rows appear once the fetch + compute completes.
    await waitFor(() => expect(screen.getByText('TBX-1')).toBeInTheDocument());
    expect(screen.getByText('TBX-2')).toBeInTheDocument();
    expect(screen.getByText('Build login page')).toBeInTheDocument();
    expect(screen.getByText('Fix logout defect')).toBeInTheDocument();

    // Throughput + cycle-time cards render with computed summary values.
    expect(screen.getByText('Issues / Week')).toBeInTheDocument();
    expect(screen.getByText('Points / Week')).toBeInTheDocument();
    expect(screen.getByText('Avg Cycle Time (days)')).toBeInTheDocument();
    expect(readStatCardValue('Issues Closed')).toBe('2');
    expect(readStatCardValue('Issues With Cycle Time')).toBe('2 of 2');

    // The request used the person, window, and Done filter in the JQL.
    const searchCall = mockJiraGet.mock.calls.find(([path]) =>
      String(path).includes('/rest/api/2/search'),
    );
    const decodedSearch = decodeURIComponent(String(searchCall?.[0]));
    expect(decodedSearch).toContain('assignee = "Jane Dev"');
    expect(decodedSearch).toContain('statusCategory = Done');
    expect(decodedSearch).toContain('resolved >= -60d');
    expect(decodedSearch).toContain('expand=changelog');
  });

  it('shows a friendly alert when the fetch rejects', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      return Promise.reject(new Error('Jira GET search failed: 500'));
    });

    render(<PersonalFlowTab />);
    fireEvent.change(screen.getByLabelText(/person \(jira assignee\)/i), {
      target: { value: 'Jane Dev' },
    });
    fireEvent.click(screen.getByRole('button', { name: /run report/i }));

    const alertNode = await screen.findByRole('alert');
    expect(alertNode).toHaveTextContent(/500/);
  });
});
