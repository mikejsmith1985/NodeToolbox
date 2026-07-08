// PersonalFlowTab.test.tsx — Verifies the Personal Flow tab wires the pure compute
// core to Jira: it resolves the chosen person to a full IDENTITY (query machine id plus
// the set of every username / user key / display name / accountId Jira might store),
// queries by the machine id — because Jira rejects a display name in the assignee field —
// then fetches statuses + every issue that id was assigned to, and credits ownership by
// matching the changelog against the WHOLE identity set. That last part is the fix: on
// Jira Server a changelog stores a user KEY in `to`/`from` and the DISPLAY NAME in
// `toString`/`fromString`, so the username alone matches neither side. It also renders
// throughput and hands-on cycle-time cards, a per-issue row, a diagnostic line, guards an
// empty person, and surfaces friendly "no match" and fetch-failure alerts. The metric
// math itself is covered by personalFlow.test.ts.

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

// The Jira users the mock user-search knows about. Jane is a plain username person; John also carries a
// user KEY (JIRAUSER22200) — Jira Server stores that key in changelog `to`/`from`, so his fixture exercises
// the key-vs-username mismatch the fix targets. The display name is never sent to Jira — the username is.
interface FakeJiraUser { displayName: string; name: string; key?: string }
const JIRA_USERS: FakeJiraUser[] = [
  { displayName: 'Jane Dev', name: 'jane.dev' },
  { displayName: 'John QA', name: 'john.qa', key: 'JIRAUSER22200' },
];

/**
 * Answers `/rest/api/2/user/search` like Jira would: returns the users whose display name, username, or
 * key CONTAINS the typed term. Both `resolvePersonIdentity` and the live suggestion debounce hit this path.
 */
function userSearchResponseForPath(path: string): FakeJiraUser[] {
  const queryString = path.split('?')[1] ?? '';
  const params = new URLSearchParams(queryString);
  const term = (params.get('username') ?? params.get('query') ?? '').toLowerCase();
  if (term === '') {
    return [];
  }
  return JIRA_USERS.filter((user) =>
    user.displayName.toLowerCase().includes(term)
    || user.name.toLowerCase().includes(term)
    || (user.key ?? '').toLowerCase().includes(term));
}

/** The assignee-side identifiers a changelog stores for a person: the machine value and the human string. */
interface OwnershipStamp {
  machineValue: string; // `to`/`from` value — a USERNAME on Cloud, but a user KEY on Jira Server
  humanValue: string; // `toString`/`fromString` value — always the DISPLAY NAME
  assignee: { name?: string; key?: string; displayName?: string }; // the issue's current-assignee object
}

/**
 * Two issues the given person owned and finished: each is assigned to them on 2026-06-30 (moving into
 * in-progress, id 3), then reaches done (id 5). The assignee changelog carries `machineValue` in `to` and
 * `humanValue` in `toString`, mirroring how Jira Server records ownership.
 */
function buildSearchResponseFor(stamp: OwnershipStamp) {
  const assignedInProgress = {
    created: '2026-06-30T00:00:00.000Z',
    items: [
      { field: 'assignee', from: null, fromString: null, to: stamp.machineValue, toString: stamp.humanValue },
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
          assignee: stamp.assignee,
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
          assignee: stamp.assignee,
          customfield_10016: 3,
        },
        changelog: {
          histories: [assignedInProgress, { created: '2026-07-06T00:00:00.000Z', items: [{ field: 'status', from: '3', fromString: null, to: '5', toString: null }] }],
        },
      },
    ],
  };
}

// Jane's changelog uses her USERNAME on both sides — the simple case that already worked.
const JANE_STAMP: OwnershipStamp = {
  machineValue: 'jane.dev', humanValue: 'jane.dev', assignee: { name: 'jane.dev', displayName: 'jane.dev' },
};
// John's changelog uses his user KEY in `to` and his DISPLAY NAME in `toString` — the Server form the fix
// must handle, since his username 'john.qa' matches neither the key nor the display name.
const JOHN_STAMP: OwnershipStamp = {
  machineValue: 'JIRAUSER22200', humanValue: 'John QA', assignee: { key: 'JIRAUSER22200', displayName: 'John QA' },
};

/** Returns the search response for whichever RESOLVED USERNAME the JQL `assignee WAS "…"` clause names. */
function searchResponseForPath(path: string) {
  const decoded = decodeURIComponent(path);
  if (decoded.includes('john.qa')) return buildSearchResponseFor(JOHN_STAMP);
  return buildSearchResponseFor(JANE_STAMP);
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

  it('credits an issue when the changelog stores a user KEY that differs from the username (Jira Server)', async () => {
    // The live-data bug: JQL resolves the display name to username C7G2G7 (which the fetch matches), but the
    // changelog records ownership as `to: JIRAUSER10100` / `toString: "Doe, John (CTR)"`. The username alone
    // matches NEITHER the key nor the display name, so naive matching drops every issue. The identity set —
    // {C7G2G7, JIRAUSER10100, "Doe, John (CTR)"} — must still credit it via the key or the display name.
    const keyDifferingIssue = {
      key: 'TBX-9',
      fields: {
        summary: 'Server-form ownership',
        created: '2026-06-29T00:00:00.000Z',
        resolutiondate: '2026-07-03T00:00:00.000Z',
        status: { id: '5' },
        assignee: { key: 'JIRAUSER10100', displayName: 'Doe, John (CTR)' },
        customfield_10236: 8,
      },
      changelog: {
        histories: [
          {
            created: '2026-06-30T00:00:00.000Z',
            items: [
              // `to` is the user KEY (not the username); `toString` is the display name.
              { field: 'assignee', from: null, fromString: null, to: 'JIRAUSER10100', toString: 'Doe, John (CTR)' },
              { field: 'status', from: '1', fromString: null, to: '3', toString: null },
            ],
          },
          { created: '2026-07-03T00:00:00.000Z', items: [{ field: 'status', from: '3', fromString: null, to: '5', toString: null }] },
        ],
      },
    };
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      // The typed display name resolves to a user whose username, key, and display name all differ.
      if (path.startsWith('/rest/api/2/user/search')) {
        return Promise.resolve([{ name: 'C7G2G7', key: 'JIRAUSER10100', displayName: 'Doe, John (CTR)' }]);
      }
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve({ issues: [keyDifferingIssue] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    fireEvent.change(screen.getByLabelText(/person \(jira assignee\)/i), {
      target: { value: 'Doe, John (CTR)' },
    });
    fireEvent.click(screen.getByRole('button', { name: /run report/i }));

    // The issue IS credited — matching succeeded via the key or the display name, not the username.
    await waitFor(() => expect(screen.getByText('TBX-9')).toBeInTheDocument());
    expect(Number(readStatCardValue('Issues Advanced'))).toBeGreaterThanOrEqual(1);

    // JQL still queries by the machine id the fetch understands, not the key or the display name.
    const decodedSearch = decodedSearchPaths()[0] ?? '';
    expect(decodedSearch).toContain('assignee WAS "C7G2G7"');
  });

  it('shows a diagnostic line with the queried machine id and the fetched vs credited counts', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: /run report/i }));

    // The muted diagnostic names the resolved machine id, the raw fetched count, and the credited count.
    const diagnostic = await screen.findByText(/Queried Jira as/i);
    expect(diagnostic).toHaveTextContent('Queried Jira as "jane.dev"');
    expect(diagnostic).toHaveTextContent('fetched 2 issues');
    expect(diagnostic).toHaveTextContent('2 credited');
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
