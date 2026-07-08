// PersonalFlowTab.test.tsx — Verifies the Personal Flow tab wires the pure compute
// core to Jira: it fetches statuses + every issue a person was assigned to, maps the
// changelog into status + ownership timelines, renders throughput and hands-on
// cycle-time cards plus a per-issue row, guards an empty person, and surfaces fetch
// failures as an alert. The metric math itself is covered by personalFlow.test.ts.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A single mock for the Jira client, routed by request path so one implementation can
// answer both the status lookup and the issue search.
const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
}));

import { useSettingsStore } from '../../store/settingsStore.ts';
import {
  useStandupRosterStore,
  type StandupRosterMember,
} from '../SprintDashboard/hooks/useStandupRosterStore.ts';
import { PersonalFlowTab } from './PersonalFlowTab.tsx';

// Status ids mapped to their Jira category so the changelog transitions read declaratively.
const STATUSES = [
  { id: '1', statusCategory: { key: 'new' } },
  { id: '3', statusCategory: { key: 'indeterminate' } },
  { id: '5', statusCategory: { key: 'done' } },
];

/**
 * Two issues the given person owned and finished: each is assigned to her on 2026-06-30 (moving into
 * in-progress, id 3), then reaches done (id 5). The assignee changelog carries the person's name in
 * both the machine (`to`) and display (`toString`) fields so ownership resolves regardless of form.
 */
function buildSearchResponseFor(person: string) {
  const assignedInProgress = {
    created: '2026-06-30T00:00:00.000Z',
    items: [
      { field: 'assignee', from: null, fromString: null, to: person, toString: person },
      { field: 'status', from: '1', fromString: null, to: '3', toString: null },
    ],
  };
  return {
    issues: [
      {
        key: 'TBX-1',
        fields: {
          summary: 'Build login page',
          created: '2026-06-29T00:00:00.000Z',
          resolutiondate: '2026-07-03T00:00:00.000Z',
          status: { id: '5' },
          assignee: { displayName: person, name: person },
          customfield_10236: 5,
        },
        changelog: {
          histories: [assignedInProgress, { created: '2026-07-03T00:00:00.000Z', items: [{ field: 'status', from: '3', fromString: null, to: '5', toString: null }] }],
        },
      },
      {
        key: 'TBX-2',
        fields: {
          summary: 'Fix logout defect',
          created: '2026-06-29T00:00:00.000Z',
          resolutiondate: '2026-07-06T00:00:00.000Z',
          status: { id: '5' },
          assignee: { displayName: person, name: person },
          customfield_10016: 3,
        },
        changelog: {
          histories: [assignedInProgress, { created: '2026-07-06T00:00:00.000Z', items: [{ field: 'status', from: '3', fromString: null, to: '5', toString: null }] }],
        },
      },
    ],
  };
}

/** Returns the search response for whichever person the JQL `assignee WAS "…"` clause names. */
function searchResponseForPath(path: string) {
  const decoded = decodeURIComponent(path);
  if (decoded.includes('John QA')) return buildSearchResponseFor('John QA');
  return buildSearchResponseFor('Jane Dev');
}

/** Reads the value rendered next to a stat-card label (label and value are sibling elements). */
function readStatCardValue(labelText: string): string {
  const labelNode = screen.getByText(labelText);
  return labelNode.nextElementSibling?.textContent ?? '';
}

/** Builds a minimal roster member for seeding the standup roster store in tests. */
function buildRosterMember(displayName: string, teamName: string): StandupRosterMember {
  return {
    id: `roster-member:${displayName.toLowerCase()}`,
    displayName,
    assigneeQueryValue: displayName,
    teamName,
  };
}

/** Seeds the roster store with the given members and marks the given team active. */
function seedRoster(members: StandupRosterMember[], activeTeamName: string): void {
  useStandupRosterStore.setState({ rosterMembers: members });
  useSettingsStore.setState({ sprintDashboardActiveTeam: activeTeamName });
}

/** Reads the text of every cell in the comparison-table row that names the given person. */
function readTeamRowCells(personName: string): string[] {
  const row = screen.getByText(personName).closest('tr');
  if (row === null) {
    return [];
  }
  return Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent ?? '');
}

describe('PersonalFlowTab', () => {
  beforeEach(() => {
    // Fake only Date so the injected `todayIso` is deterministic while promises/timers stay real.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-08T00:00:00.000Z'));
    mockJiraGet.mockReset();
    // Reset the shared roster + settings stores so each test starts from an empty roster
    // and no active team, keeping the single-person tests independent of roster state.
    useStandupRosterStore.setState({ rosterMembers: [] });
    useSettingsStore.setState({ sprintDashboardActiveTeam: '' });
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
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve(searchResponseForPath(path));
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
    expect(readStatCardValue('Issues Advanced')).toBe('2');
    expect(readStatCardValue('Story Points')).toBe('8'); // 5 + 3 story points
    expect(readStatCardValue('Issues With Cycle Time')).toBe('2 of 2');

    // The request used the reassignment-aware `assignee WAS`, the window, and expanded the changelog.
    const searchCall = mockJiraGet.mock.calls.find(([path]) =>
      String(path).includes('/rest/api/2/search'),
    );
    const decodedSearch = decodeURIComponent(String(searchCall?.[0]));
    expect(decodedSearch).toContain('assignee WAS "Jane Dev"');
    expect(decodedSearch).toContain('updated >= -60d');
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

  it('shows roster suggestions as you type and clicking one fills the person field', async () => {
    seedRoster(
      [buildRosterMember('Jane Dev', 'Team Rocket'), buildRosterMember('John QA', 'Team Rocket')],
      'Team Rocket',
    );

    render(<PersonalFlowTab />);
    const personInput = screen.getByLabelText(/person \(jira assignee\)/i);
    fireEvent.change(personInput, { target: { value: 'Jane' } });

    // The roster suggestion for the matching member appears instantly from the store.
    const suggestion = await screen.findByRole('option', { name: /Jane Dev/i });
    fireEvent.click(suggestion);

    // Clicking the suggestion writes that person's assignee value into the field.
    expect(personInput).toHaveValue('Jane Dev');
  });

  it('runs for the team roster and renders a comparison row per member', async () => {
    seedRoster(
      [buildRosterMember('Jane Dev', 'Team Rocket'), buildRosterMember('John QA', 'Team Rocket')],
      'Team Rocket',
    );
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve([]);
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve(searchResponseForPath(path));
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    fireEvent.click(screen.getByRole('button', { name: /run for team roster/i }));

    // One comparison row per active-team roster member, each with its computed totals.
    await waitFor(() => expect(screen.getByText('Jane Dev')).toBeInTheDocument());
    expect(screen.getByText('John QA')).toBeInTheDocument();

    // Columns: Person | Issues | Points | Issues/Wk | Points/Wk | Avg Cycle | Median Cycle.
    const janeCells = readTeamRowCells('Jane Dev');
    expect(janeCells[1]).toBe('2'); // two advanced issues in the search response
    expect(janeCells[2]).toBe('8'); // 5 + 3 story points
    const johnCells = readTeamRowCells('John QA');
    expect(johnCells[1]).toBe('2');
    expect(johnCells[2]).toBe('8');

    // Each member was searched with their own assignee value via `assignee WAS`.
    const searchedAssignees = mockJiraGet.mock.calls
      .map(([path]) => decodeURIComponent(String(path)))
      .filter((path) => path.includes('/rest/api/2/search'));
    expect(searchedAssignees.some((path) => path.includes('assignee WAS "Jane Dev"'))).toBe(true);
    expect(searchedAssignees.some((path) => path.includes('assignee WAS "John QA"'))).toBe(true);
  });

  it('records a per-person error row without aborting the whole team run', async () => {
    seedRoster(
      [buildRosterMember('Jane Dev', 'Team Rocket'), buildRosterMember('John QA', 'Team Rocket')],
      'Team Rocket',
    );
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve([]);
      if (path.includes('John%20QA') || path.includes('John QA')) {
        return Promise.reject(new Error('Jira GET search failed: 500'));
      }
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve(searchResponseForPath(path));
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    fireEvent.click(screen.getByRole('button', { name: /run for team roster/i }));

    // The healthy member still renders a full row, the failing member shows an inline error.
    await waitFor(() => expect(screen.getByText('Jane Dev')).toBeInTheDocument());
    expect(readTeamRowCells('Jane Dev')[1]).toBe('2');
    const johnRow = screen.getByText('John QA').closest('tr');
    expect(within(johnRow as HTMLElement).getByText(/500/)).toBeInTheDocument();
  });

  it('disables Run for team roster when the active-team roster is empty', () => {
    render(<PersonalFlowTab />);
    expect(screen.getByRole('button', { name: /run for team roster/i })).toBeDisabled();
  });
});
