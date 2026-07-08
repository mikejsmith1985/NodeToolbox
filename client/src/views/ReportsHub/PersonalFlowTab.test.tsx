// PersonalFlowTab.test.tsx — Verifies the Personal Flow tab wires the pure compute
// core to Jira: it resolves the chosen person to a Jira MACHINE IDENTIFIER (username /
// accountId) before querying — because Jira rejects a display name in the assignee
// field — then fetches statuses + every issue that machine id was assigned to, maps the
// changelog into status + ownership timelines, renders throughput and hands-on
// cycle-time cards plus a per-issue row, guards an empty person, surfaces a friendly
// "no match" alert, and surfaces fetch failures as an alert. The metric math itself is
// covered by personalFlow.test.ts.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A single mock for the Jira client, routed by request path so one implementation can
// answer the status lookup, the user-search resolution, and the issue search.
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

// Each test person's friendly DISPLAY NAME mapped to the Jira USERNAME the resolver should return.
// The whole point of the fix: the display name is never sent to Jira — the username is.
const USERNAME_BY_DISPLAY_NAME: Record<string, string> = {
  'Jane Dev': 'jane.dev',
  'John QA': 'john.qa',
};

/**
 * Answers `/rest/api/2/user/search` like Jira would: returns the users whose display name or username
 * CONTAINS the typed term. Both `resolvePersonQueryValue` and the live suggestion debounce hit this path.
 */
function userSearchResponseForPath(path: string) {
  const queryString = path.split('?')[1] ?? '';
  const params = new URLSearchParams(queryString);
  const term = (params.get('username') ?? params.get('query') ?? '').toLowerCase();
  if (term === '') {
    return [];
  }
  return Object.entries(USERNAME_BY_DISPLAY_NAME)
    .filter(([displayName, username]) =>
      displayName.toLowerCase().includes(term) || username.toLowerCase().includes(term))
    .map(([displayName, username]) => ({ displayName, name: username }));
}

/**
 * Two issues the given machine id owned and finished: each is assigned to that username on 2026-06-30
 * (moving into in-progress, id 3), then reaches done (id 5). The assignee changelog carries the USERNAME
 * (not a display name) in both `to` and `toString` so the engine credits the resolved machine id.
 */
function buildSearchResponseFor(assigneeMachineId: string) {
  const assignedInProgress = {
    created: '2026-06-30T00:00:00.000Z',
    items: [
      { field: 'assignee', from: null, fromString: null, to: assigneeMachineId, toString: assigneeMachineId },
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
          assignee: { displayName: assigneeMachineId, name: assigneeMachineId },
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
          assignee: { displayName: assigneeMachineId, name: assigneeMachineId },
          customfield_10016: 3,
        },
        changelog: {
          histories: [assignedInProgress, { created: '2026-07-06T00:00:00.000Z', items: [{ field: 'status', from: '3', fromString: null, to: '5', toString: null }] }],
        },
      },
    ],
  };
}

/** Returns the search response for whichever RESOLVED USERNAME the JQL `assignee WAS "…"` clause names. */
function searchResponseForPath(path: string) {
  const decoded = decodeURIComponent(path);
  if (decoded.includes('john.qa')) return buildSearchResponseFor('john.qa');
  return buildSearchResponseFor('jane.dev');
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

/** Returns every `/rest/api/2/search` path the mock was called with, URL-decoded for substring assertions. */
function decodedSearchPaths(): string[] {
  return mockJiraGet.mock.calls
    .map(([path]) => decodeURIComponent(String(path)))
    .filter((path) => path.includes('/rest/api/2/search'));
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

  it('resolves the person to a username, then fetches/computes/renders cards and per-issue rows', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve(searchResponseForPath(path));
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    fireEvent.change(screen.getByLabelText(/person \(jira assignee\)/i), {
      target: { value: 'Jane Dev' },
    });
    fireEvent.change(screen.getByLabelText(/lookback window/i), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /run report/i }));

    // Per-issue rows appear once the resolve + fetch + compute completes.
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

    // The JQL carries the RESOLVED USERNAME, not the display name, plus the window and changelog expand.
    const decodedSearch = decodedSearchPaths()[0] ?? '';
    expect(decodedSearch).toContain('assignee WAS "jane.dev"');
    expect(decodedSearch).not.toContain('assignee WAS "Jane Dev"');
    expect(decodedSearch).toContain('updated >= -60d');
    expect(decodedSearch).toContain('expand=changelog');
  });

  it('resolves a free-typed display name to the username before querying', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve(searchResponseForPath(path));
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    // Type the display name and Run WITHOUT clicking a suggestion — resolution must happen at run time.
    fireEvent.change(screen.getByLabelText(/person \(jira assignee\)/i), {
      target: { value: 'Jane Dev' },
    });
    fireEvent.click(screen.getByRole('button', { name: /run report/i }));

    await waitFor(() => expect(decodedSearchPaths().length).toBeGreaterThan(0));
    expect(decodedSearchPaths()[0]).toContain('assignee WAS "jane.dev"');
  });

  it('uses a selected Jira suggestion machine id directly for the query', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve(searchResponseForPath(path));
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    // Type a partial so the debounced Jira user search offers a suggestion carrying the machine id.
    fireEvent.change(screen.getByLabelText(/person \(jira assignee\)/i), { target: { value: 'Jane' } });
    const suggestion = await screen.findByRole('option', { name: /Jane Dev/i });
    fireEvent.click(suggestion);

    fireEvent.click(screen.getByRole('button', { name: /run report/i }));

    // The picked suggestion already carried `jane.dev`, so the query uses it directly.
    await waitFor(() => expect(decodedSearchPaths().length).toBeGreaterThan(0));
    expect(decodedSearchPaths()[0]).toContain('assignee WAS "jane.dev"');
  });

  it('shows a friendly alert and never runs a search when no Jira user matches', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve([]); // nobody matches
      if (path.startsWith('/rest/api/2/search')) return Promise.reject(new Error('search should never fire'));
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    fireEvent.change(screen.getByLabelText(/person \(jira assignee\)/i), {
      target: { value: 'Nobody Here' },
    });
    fireEvent.click(screen.getByRole('button', { name: /run report/i }));

    const alertNode = await screen.findByRole('alert');
    expect(alertNode).toHaveTextContent(/No Jira user matches/i);
    // Crucially, an unresolvable name must never reach an `assignee WAS` search.
    expect(decodedSearchPaths()).toHaveLength(0);
  });

  it('shows a friendly alert when the fetch rejects', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
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
    // Any Jira call resolves to an empty list here; the roster suggestion comes straight from the store.
    mockJiraGet.mockResolvedValue([]);

    render(<PersonalFlowTab />);
    const personInput = screen.getByLabelText(/person \(jira assignee\)/i);
    fireEvent.change(personInput, { target: { value: 'Jane' } });

    // The roster suggestion for the matching member appears instantly from the store.
    const suggestion = await screen.findByRole('option', { name: /Jane Dev/i });
    fireEvent.click(suggestion);

    // Clicking the suggestion writes that person's friendly display name into the field.
    expect(personInput).toHaveValue('Jane Dev');
  });

  it('runs for the team roster and renders a comparison row per member', async () => {
    seedRoster(
      [buildRosterMember('Jane Dev', 'Team Rocket'), buildRosterMember('John QA', 'Team Rocket')],
      'Team Rocket',
    );
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
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

    // Each member was resolved to their USERNAME and searched with it via `assignee WAS`.
    const searchedAssignees = decodedSearchPaths();
    expect(searchedAssignees.some((path) => path.includes('assignee WAS "jane.dev"'))).toBe(true);
    expect(searchedAssignees.some((path) => path.includes('assignee WAS "john.qa"'))).toBe(true);
  });

  it('records a per-person error row without aborting the whole team run', async () => {
    seedRoster(
      [buildRosterMember('Jane Dev', 'Team Rocket'), buildRosterMember('John QA', 'Team Rocket')],
      'Team Rocket',
    );
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      // Only the RESOLVED search path carries the username `john.qa`; fail just that one.
      if (path.includes('john.qa')) return Promise.reject(new Error('Jira GET search failed: 500'));
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
