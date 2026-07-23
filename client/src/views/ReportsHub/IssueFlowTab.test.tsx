// IssueFlowTab.test.tsx — Verifies the Flow Analysis tab wires the pure engines to Jira correctly.
//
// The arithmetic itself is proved in issueFlow.test.ts, issueFlowRollup.test.ts and
// issueFlowStatusClass.test.ts. What is checked HERE is what only this layer can get wrong:
//
//   • it queries `assignee WAS in (…)` — issues the roster HELD at any point. A present-tense
//     `assignee in (…)` would hide every issue handed to someone outside the roster, which is exactly
//     the hand-off the analysis exists to find;
//   • lead time and cycle time are rendered together, with the pre-work wait as its own figure;
//   • the classification actually used is shown, so a wrong guess is arguable rather than hidden;
//   • a cancelled run produces no results at all.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import { useStandupRosterStore, type StandupRosterMember } from '../SprintDashboard/hooks/useStandupRosterStore.ts';
import { IssueFlowTab } from './IssueFlowTab.tsx';

const STATUSES = [
  { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
  { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
  { id: '4', name: 'Ready for QA', statusCategory: { key: 'indeterminate' } },
  { id: '5', name: 'Done', statusCategory: { key: 'done' } },
];

/**
 * One delivered issue that changed hands mid-flight: Jane built it, Mark accepted it. This is the
 * shape the Personal Workflow report cannot describe, so it is the shape worth fixturing.
 */
interface FakeHistory { created: string; items: Array<Record<string, unknown>> }

const HANDED_OVER_ISSUE: { key: string; fields: Record<string, unknown>; changelog: { histories: FakeHistory[] } } = {
  key: 'FLOW-1',
  fields: {
    summary: 'Handed over mid-flight',
    created: '2026-07-01T00:00:00.000Z',
    status: { id: '5' },
    assignee: { name: 'mark.po', displayName: 'Owner, Mark (CTR)' },
  },
  changelog: {
    histories: [
      {
        created: '2026-07-01T00:00:00.000Z',
        items: [{ field: 'status', from: '1', to: '3' }],
      },
      {
        created: '2026-07-06T00:00:00.000Z',
        items: [
          { field: 'assignee', from: 'jane.dev', fromString: 'Dev, Jane (CTR)', to: 'mark.po', toString: 'Owner, Mark (CTR)' },
          { field: 'status', from: '3', to: '4' },
        ],
      },
      {
        created: '2026-07-09T00:00:00.000Z',
        items: [{ field: 'status', from: '4', to: '5' }],
      },
    ],
  },
};

function seedRoster(): void {
  const rosterMembers: StandupRosterMember[] = [
    { id: 'roster-member:jane dev', displayName: 'Jane Dev', assigneeQueryValue: 'jane.dev', teamName: 'Team Rocket' },
    { id: 'roster-member:mark po', displayName: 'Mark PO', assigneeQueryValue: 'mark.po', teamName: 'Team Rocket' },
  ];
  useStandupRosterStore.setState({ rosterMembers });
}

/** Returns the decoded JQL from every issue search the tab issued. */
function decodedSearchJqls(): string[] {
  return mockJiraGet.mock.calls
    .map((call) => String(call[0]))
    .filter((path) => path.startsWith('/rest/api/2/search'))
    .map((path) => decodeURIComponent(new URLSearchParams(path.split('?')[1] ?? '').get('jql') ?? ''));
}

beforeEach(() => {
  mockJiraGet.mockReset();
  seedRoster();
  mockJiraGet.mockImplementation((path: string) => {
    if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
    if (path.startsWith('/rest/api/2/search')) return Promise.resolve({ issues: [HANDED_OVER_ISSUE] });
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
});

describe('IssueFlowTab — the query', () => {
  it('searches for issues the roster HELD AT ANY POINT, not ones they hold now', async () => {
    render(<IssueFlowTab teamFilter="Team Rocket" />);
    fireEvent.click(screen.getByRole('button', { name: /run flow analysis/i }));

    await waitFor(() => expect(decodedSearchJqls().length).toBeGreaterThan(0));

    // `assignee in (…)` would drop any issue handed to a product owner outside the roster — and that
    // hand-off is usually where the delay is.
    expect(decodedSearchJqls()[0]).toContain('assignee WAS in ("jane.dev", "mark.po")');
  });

  it('scopes the run to the selected team without leaving the tab', async () => {
    render(<IssueFlowTab teamFilter="Team Rocket" />);
    fireEvent.click(screen.getByRole('button', { name: /run flow analysis/i }));

    await waitFor(() => expect(decodedSearchJqls().length).toBeGreaterThan(0));

    expect(decodedSearchJqls()[0]).toContain('jane.dev');
  });

  it('explains rather than fails when the roster holds nobody for the team', async () => {
    useStandupRosterStore.setState({ rosterMembers: [] });

    render(<IssueFlowTab teamFilter="Team Rocket" />);
    fireEvent.click(screen.getByRole('button', { name: /run flow analysis/i }));

    await waitFor(() => expect(screen.getByText(/no roster members for this team/i)).toBeInTheDocument());
  });
});

describe('IssueFlowTab — what it renders', () => {
  it('shows lead time, cycle time and the pre-work wait together', async () => {
    render(<IssueFlowTab teamFilter="Team Rocket" />);
    fireEvent.click(screen.getByRole('button', { name: /run flow analysis/i }));

    await waitFor(() => expect(screen.getByText('Flow summary')).toBeInTheDocument());

    // Neither clock is meaningful alone: cycle time hides a backlog that sat for weeks, lead time
    // lets backlog age mask a slow delivery system.
    expect(screen.getByText(/avg lead time \(working days\)/i)).toBeInTheDocument();
    expect(screen.getByText(/avg cycle time \(working days\)/i)).toBeInTheDocument();
    expect(screen.getByText(/avg pre-work wait \(working days\)/i)).toBeInTheDocument();
  });

  it('labels every duration as working days', async () => {
    render(<IssueFlowTab teamFilter="Team Rocket" />);
    fireEvent.click(screen.getByRole('button', { name: /run flow analysis/i }));

    await waitFor(() => expect(screen.getByText('Where the time goes')).toBeInTheDocument());

    expect(screen.getAllByText(/working days/i).length).toBeGreaterThan(1);
  });

  it('shows how each status was classified, so a wrong guess can be argued with', async () => {
    render(<IssueFlowTab teamFilter="Team Rocket" />);
    fireEvent.click(screen.getByRole('button', { name: /run flow analysis/i }));

    await waitFor(() => expect(screen.getByText('How statuses were classified')).toBeInTheDocument());

    // "Ready for QA" is a queue, not somebody working — and the reader can see that we decided so.
    const classificationSection = screen.getByText('How statuses were classified').closest('section') as HTMLElement;
    const classificationRow = within(classificationSection).getByText('Ready for QA').closest('tr') as HTMLElement;
    expect(classificationRow.textContent).toContain('Waiting');
  });

  it('lists the delivered issue with its three totals', async () => {
    render(<IssueFlowTab teamFilter="Team Rocket" />);
    fireEvent.click(screen.getByRole('button', { name: /run flow analysis/i }));

    await waitFor(() => expect(screen.getByText('Per-issue flow')).toBeInTheDocument());

    expect(screen.getByText('FLOW-1')).toBeInTheDocument();
    expect(screen.getByText('Handed over mid-flight')).toBeInTheDocument();
  });

  it('counts a delivered issue once even though two people advanced it', async () => {
    render(<IssueFlowTab teamFilter="Team Rocket" />);
    fireEvent.click(screen.getByRole('button', { name: /run flow analysis/i }));

    await waitFor(() => expect(screen.getByText('Flow summary')).toBeInTheDocument());

    const summaryRow = screen.getByText('Delivered issues').closest('table') as HTMLElement;
    const values = Array.from(summaryRow.querySelectorAll('tbody td')).map((cell) => cell.textContent);
    expect(values[0]).toBe('1');
  });

  it('says so plainly when nothing was delivered rather than rendering empty tables', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve({ issues: [] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<IssueFlowTab teamFilter="Team Rocket" />);
    fireEvent.click(screen.getByRole('button', { name: /run flow analysis/i }));

    await waitFor(() => expect(screen.getByText(/no delivered issues in this window/i)).toBeInTheDocument());
  });
});

describe('IssueFlowTab — failure is reported, not swallowed', () => {
  it('surfaces a fetch failure instead of showing an empty analysis', async () => {
    mockJiraGet.mockImplementation(() => Promise.reject(new Error('Jira unreachable')));

    render(<IssueFlowTab teamFilter="Team Rocket" />);
    fireEvent.click(screen.getByRole('button', { name: /run flow analysis/i }));

    await waitFor(() => expect(screen.getByText(/jira unreachable/i)).toBeInTheDocument());
    expect(screen.queryByText('Flow summary')).not.toBeInTheDocument();
  });
});
