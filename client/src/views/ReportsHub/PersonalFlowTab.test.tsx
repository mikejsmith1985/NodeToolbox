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

// The clipboard helper the "Copy JQL" button calls; mocked so the click can be asserted without a
// real clipboard in jsdom, and so we can confirm the exact JQL string is what gets copied.
const { mockCopyToClipboard } = vi.hoisted(() => ({ mockCopyToClipboard: vi.fn() }));

vi.mock('../FeatureCanvas/ai/clipboard.ts', () => ({
  copyToClipboard: mockCopyToClipboard,
}));

// The audit report uses the RESULT-RETURNING copier, so a failed copy can be surfaced rather than
// swallowed. Mocked separately from the fire-and-forget one above.
const { mockCopyWithResult } = vi.hoisted(() => ({ mockCopyWithResult: vi.fn() }));

vi.mock('../JiraTemplateMaker/lib/copyToClipboard.ts', () => ({
  copyToClipboard: mockCopyWithResult,
}));

import { useSettingsStore } from '../../store/settingsStore.ts';
import {
  useStandupRosterStore,
  type RosterRoleCapabilities,
  type StandupRosterMember,
} from '../SprintDashboard/hooks/useStandupRosterStore.ts';
import { PersonalFlowTab } from './PersonalFlowTab.tsx';

// Status ids mapped to their Jira category so the changelog transitions read declaratively.
const STATUSES = [
  { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
  { id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate' } },
  { id: '5', name: 'Done', statusCategory: { key: 'done' } },
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
 *
 * TBX-1's story-points field is the DROPDOWN/SELECT OBJECT shape Jira returns for a select custom field
 * (`{ value: '3' }`), exercising the unwrap fix; TBX-2's is a plain number (5), proving both still read.
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
          customfield_10236: { value: '3' }, // dropdown/select object — must unwrap to 3 points
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
          customfield_10236: 5, // plain numeric value on the same configured field — still read
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

/** Builds a roster member carrying role capabilities, for the "throughput by role" rollup tests. */
function buildRosterMemberWithRoles(
  displayName: string,
  teamName: string,
  roleCapabilities: RosterRoleCapabilities,
): StandupRosterMember {
  return { ...buildRosterMember(displayName, teamName), roleCapabilities };
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
    mockCopyToClipboard.mockReset();
    // Reset the shared roster + settings stores so each test starts from an empty roster
    // and no active team, keeping the single-person tests independent of roster state.
    useStandupRosterStore.setState({ rosterMembers: [] });
    useSettingsStore.setState({ sprintDashboardActiveTeam: '' });
    // Clear any configured story-points field so tests default to customfield_10236 unless one opts in.
    localStorage.removeItem('tbxARTSettings');
    // Clear the bottleneck panel's persisted inputs so each test starts from empty scope + status fields.
    localStorage.removeItem('tbxPersonalFlowBottleneck');
  });

  afterEach(() => {
    vi.useRealTimers();
    // Remove any ART settings a test set, so a custom spFieldId never leaks into another test.
    localStorage.removeItem('tbxARTSettings');
    // Remove any bottleneck inputs a test persisted, so they never leak into another test.
    localStorage.removeItem('tbxPersonalFlowBottleneck');
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
    expect(readStatCardValue('Story Points')).toBe('8'); // 3 (dropdown object) + 5 (plain number)
    expect(readStatCardValue('Issues With Cycle Time')).toBe('2 of 2');

    // The DROPDOWN OBJECT field `{ value: '3' }` on TBX-1 is unwrapped to 3 in its per-issue Points cell
    // (columns: Issue | Summary | Last active | Hands-on | Points → index 4), proving the object is read.
    const tbx1Cells = Array.from((screen.getByText('TBX-1').closest('tr') as HTMLElement).querySelectorAll('td'))
      .map((cell) => cell.textContent ?? '');
    expect(tbx1Cells[4]).toBe('3');
    const tbx2Cells = Array.from((screen.getByText('TBX-2').closest('tr') as HTMLElement).querySelectorAll('td'))
      .map((cell) => cell.textContent ?? '');
    expect(tbx2Cells[4]).toBe('5');

    // The JQL carries the RESOLVED USERNAME, not the display name, plus the window and changelog expand.
    const decodedSearch = decodedSearchPaths()[0] ?? '';
    expect(decodedSearch).toContain('assignee WAS "jane.dev"');
    expect(decodedSearch).not.toContain('assignee WAS "Jane Dev"');
    expect(decodedSearch).toContain('updated >= -60d');
    expect(decodedSearch).toContain('expand=changelog');
    // The requested fields list names the configured story-points field id (the default here).
    expect(decodedSearch).toContain('fields=');
    expect(decodedSearch).toContain('customfield_10236');
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

  it('surfaces the exact JQL it ran, using the resolved machine id and the selected window', async () => {
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

    // The displayed JQL uses the RESOLVED machine id (jane.dev), not the typed display name, plus the
    // selected 60-day window — proving it is the same string the search actually queried.
    const jqlNode = await screen.findByText(/assignee WAS "jane.dev"/i);
    expect(jqlNode).toHaveTextContent('updated >= -60d');
  });

  it('copies the exact JQL to the clipboard when the Copy JQL button is clicked', async () => {
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

    const copyButton = await screen.findByRole('button', { name: /copy jql/i });
    fireEvent.click(copyButton);

    // The clipboard receives the same JQL the report ran — resolved id, window, and ORDER BY intact.
    expect(mockCopyToClipboard).toHaveBeenCalledWith(
      'assignee WAS "jane.dev" AND updated >= -60d ORDER BY updated DESC',
    );
  });

  it('renders the issue-audit breakdown with the excluded count and a friendly reason label', async () => {
    // A WIP issue Jane still holds and never finished: it is fetched but not credited, so the audit
    // section must list it with the "in progress, still assigned" reason alongside the credited pair.
    const wipIssue = {
      key: 'TBX-WIP',
      fields: {
        summary: 'Still in progress',
        created: '2026-07-01T00:00:00.000Z',
        status: { id: '3' },
        assignee: { name: 'jane.dev', displayName: 'jane.dev' },
        customfield_10236: 2,
      },
      changelog: {
        histories: [
          {
            created: '2026-07-01T00:00:00.000Z',
            items: [
              { field: 'assignee', from: null, fromString: null, to: 'jane.dev', toString: 'jane.dev' },
              { field: 'status', from: '1', fromString: null, to: '3', toString: null },
            ],
          },
        ],
      },
    };
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) {
        // Two credited issues (TBX-1, TBX-2) plus the not-credited WIP issue.
        const creditedPair = buildSearchResponseFor(JANE_STAMP);
        return Promise.resolve({ issues: [...creditedPair.issues, wipIssue] });
      }
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    fireEvent.change(screen.getByLabelText(/person \(jira assignee\)/i), {
      target: { value: 'Jane Dev' },
    });
    fireEvent.click(screen.getByRole('button', { name: /run report/i }));

    await waitFor(() => expect(screen.getByText('TBX-1')).toBeInTheDocument());
    // The audit header, the credited-vs-excluded counts, and the excluded row with its reason label.
    expect(screen.getByText('Issue audit')).toBeInTheDocument();
    expect(screen.getByText(/Credited 2 · Excluded 1/)).toBeInTheDocument();
    expect(screen.getByText('TBX-WIP')).toBeInTheDocument();
    expect(screen.getByText('In progress, still assigned (WIP)')).toBeInTheDocument();
  });

  it('credits a zero-hands-on completion: renders "—", counts it Advanced, keeps it out of cycle time', async () => {
    // Jane moved this issue straight from To-Do (id 1) to Done (id 5) with no in-progress phase, so no
    // hands-on time can be measured. It must still count as advanced, with an em-dash hands-on cell, and
    // must NOT inflate the "Issues With Cycle Time" count that the two measured issues make up.
    const jumpToDoneIssue = {
      key: 'TBX-JUMP',
      fields: {
        summary: 'Straight to done',
        created: '2026-06-29T00:00:00.000Z',
        resolutiondate: '2026-07-03T00:00:00.000Z',
        status: { id: '5' },
        assignee: { name: 'jane.dev', displayName: 'jane.dev' },
        customfield_10236: 4,
      },
      changelog: {
        histories: [
          {
            created: '2026-06-30T00:00:00.000Z',
            items: [
              { field: 'assignee', from: null, fromString: null, to: 'jane.dev', toString: 'jane.dev' },
              { field: 'status', from: '1', fromString: null, to: '5', toString: null }, // To-Do → Done directly
            ],
          },
        ],
      },
    };
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) {
        // Two measured credited issues (TBX-1, TBX-2) plus the zero-hands-on completion.
        const measuredPair = buildSearchResponseFor(JANE_STAMP);
        return Promise.resolve({ issues: [...measuredPair.issues, jumpToDoneIssue] });
      }
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    fireEvent.change(screen.getByLabelText(/person \(jira assignee\)/i), {
      target: { value: 'Jane Dev' },
    });
    fireEvent.click(screen.getByRole('button', { name: /run report/i }));

    await waitFor(() => expect(screen.getByText('TBX-JUMP')).toBeInTheDocument());
    // The unmeasured completion still counts as advanced, but only the two measured issues have a cycle time.
    expect(readStatCardValue('Issues Advanced')).toBe('3');
    expect(readStatCardValue('Issues With Cycle Time')).toBe('2 of 3');

    // Its hands-on cell (column index 3: Issue | Summary | Last active | Hands-on | Points) reads "—".
    const jumpRow = screen.getByText('TBX-JUMP').closest('tr');
    const jumpCells = Array.from((jumpRow as HTMLElement).querySelectorAll('td')).map((cell) => cell.textContent ?? '');
    expect(jumpCells[3]).toBe('—');
  });

  it('renders the hands-on-by-status breakdown, resolving the status id to its human NAME', async () => {
    // Both credited issues sat in status id 3 ("In Progress"): TBX-1 for 3 business days, TBX-2 for 4, so
    // the diagnostic must show the NAME "In Progress" (never the raw id "3") with the summed 7 hands-on days.
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

    await waitFor(() => expect(screen.getByText('TBX-1')).toBeInTheDocument());
    const heading = screen.getByText('Hands-on time by status');
    const section = heading.closest('section') as HTMLElement;
    // The human status name is shown, resolved from /rest/api/2/status — not the numeric status id.
    expect(within(section).getByText('In Progress')).toBeInTheDocument();
    expect(within(section).queryByText('3')).not.toBeInTheDocument();
    // Its day total (3 + 4 business days across the two credited issues) renders next to the name.
    const statusRow = within(section).getByText('In Progress').closest('tr') as HTMLElement;
    expect(within(statusRow).getByText('7')).toBeInTheDocument();
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

  // ── Sub-task exclusion (feature 027) ──────────────────────────────────────
  //
  // Sub-tasks look like ordinary issues to a Jira search, so they were counted as peers of the story
  // they belong to — inflating issue counts and, being short-lived, dragging cycle times down.

  it('requests the issue type, without which a sub-task cannot be told from a story', async () => {
    seedRoster([buildRosterMember('Jane Dev', 'Team Rocket')], 'Team Rocket');
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve(searchResponseForPath(path));
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab teamFilter="" />);
    fireEvent.click(screen.getByRole('button', { name: /run for team roster/i }));
    await waitFor(() => expect(screen.getByText('Jane Dev')).toBeInTheDocument());

    expect(decodedSearchPaths()[0]).toContain('issuetype');
  });

  it('excludes a sub-task from the figures and says so beside the person', async () => {
    seedRoster([buildRosterMember('Jane Dev', 'Team Rocket')], 'Team Rocket');
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) {
        const response = searchResponseForPath(path);
        // Mark the second of the two fixture issues as a sub-task.
        return Promise.resolve({
          issues: response.issues.map((issue, index) => (index === 1
            ? { ...issue, fields: { ...issue.fields, issuetype: { subtask: true, name: 'Sub-task' } } }
            : { ...issue, fields: { ...issue.fields, issuetype: { subtask: false, name: 'Story' } } })),
        });
      }
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab teamFilter="" />);
    fireEvent.click(screen.getByRole('button', { name: /run for team roster/i }));
    await waitFor(() => expect(screen.getByText('Jane Dev')).toBeInTheDocument());

    // One of the two issues is credited, not both.
    expect(readTeamRowCells('Jane Dev')[2]).toBe('1');
    expect(screen.getByText(/1 sub-task excluded/i)).toBeInTheDocument();
  });

  it('names a person whose only work was sub-tasks rather than showing them as idle', async () => {
    // The guard against repeating the "real work scores nothing" failure fixed in feature 026.
    seedRoster([buildRosterMember('Jane Dev', 'Team Rocket')], 'Team Rocket');
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) {
        const response = searchResponseForPath(path);
        return Promise.resolve({
          issues: response.issues.map((issue) => ({
            ...issue,
            fields: { ...issue.fields, issuetype: { subtask: true, name: 'Sub-task' } },
          })),
        });
      }
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab teamFilter="" />);
    fireEvent.click(screen.getByRole('button', { name: /run for team roster/i }));
    await waitFor(() => expect(screen.getByText('Jane Dev')).toBeInTheDocument());

    expect(readTeamRowCells('Jane Dev')[2]).toBe('0');
    expect(screen.getByText(/all 2 of their issues here were sub-tasks/i)).toBeInTheDocument();
  });

  it('does not label the report with a team it never scoped to', async () => {
    // The reported bug. When the roster carries NO team metadata, the member filter returns the WHOLE
    // roster — and the heading used to fall back to whatever team the user had asked for. The result
    // was one team's name over everyone's figures, with nothing on the page to reveal the swap.
    mockCopyWithResult.mockReset();
    mockCopyWithResult.mockResolvedValue(true);
    const teamlessMember: StandupRosterMember = {
      id: 'roster-member:jane dev', displayName: 'Jane Dev', assigneeQueryValue: 'jane.dev',
    };
    seedRoster([teamlessMember], 'Transformers');
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve(searchResponseForPath(path));
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab teamFilter="Transformers" />);
    fireEvent.click(screen.getByRole('button', { name: /run for team roster/i }));
    await waitFor(() => expect(screen.getByText('Jane Dev')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /copy audit report/i }));

    await waitFor(() => expect(mockCopyWithResult).toHaveBeenCalled());
    const copiedDocument = String(mockCopyWithResult.mock.calls[0][0]);
    expect(copiedDocument).not.toContain('Transformers');
    expect(copiedDocument).toContain('All roster members (no team assigned)');
  });

  it('builds the audit report fetch query from the machine id, not the display name', async () => {
    // Jira rejects a display name in the assignee field, so a link built from one errors on click.
    mockCopyWithResult.mockResolvedValue(true);
    seedRoster([buildRosterMember('Jane Dev', 'Team Rocket')], 'Team Rocket');
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve(searchResponseForPath(path));
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab teamFilter="" />);
    fireEvent.click(screen.getByRole('button', { name: /run for team roster/i }));
    await waitFor(() => expect(screen.getByText('Jane Dev')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /copy audit report/i }));

    await waitFor(() => expect(mockCopyWithResult).toHaveBeenCalled());
    const copiedDocument = String(mockCopyWithResult.mock.calls[0][0]);
    expect(copiedDocument).toContain('assignee WAS "jane.dev"');
    expect(copiedDocument).not.toContain('assignee WAS "Jane Dev"');
  });

  it('offers an audit report once a team run has produced rows', async () => {
    seedRoster([buildRosterMember('Jane Dev', 'Team Rocket')], 'Team Rocket');
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve(searchResponseForPath(path));
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    fireEvent.click(screen.getByRole('button', { name: /run for team roster/i }));
    await waitFor(() => expect(screen.getByText('Jane Dev')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /copy audit report/i })).toBeInTheDocument();
  });

  it('copies a document that explains the numbers and names the people', async () => {
    mockCopyWithResult.mockResolvedValue(true);
    seedRoster([buildRosterMember('Jane Dev', 'Team Rocket')], 'Team Rocket');
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve(searchResponseForPath(path));
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    fireEvent.click(screen.getByRole('button', { name: /run for team roster/i }));
    await waitFor(() => expect(screen.getByText('Jane Dev')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /copy audit report/i }));

    await waitFor(() => expect(mockCopyWithResult).toHaveBeenCalled());
    const copiedDocument = String(mockCopyWithResult.mock.calls[0][0]);
    expect(copiedDocument).toContain('Jane Dev');
    expect(copiedDocument).toContain('How these numbers are calculated');
    expect(copiedDocument).toContain('What was counted and what was not');
  });

  it('says so when the copy fails, rather than letting the user paste stale content', async () => {
    mockCopyWithResult.mockResolvedValue(false);
    seedRoster([buildRosterMember('Jane Dev', 'Team Rocket')], 'Team Rocket');
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve(searchResponseForPath(path));
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    fireEvent.click(screen.getByRole('button', { name: /run for team roster/i }));
    await waitFor(() => expect(screen.getByText('Jane Dev')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /copy audit report/i }));

    expect(await screen.findByText(/copy failed/i)).toBeInTheDocument();
  });

  it('pages the issue search rather than taking a single capped page', async () => {
    seedRoster([buildRosterMember('Jane Dev', 'Team Rocket')], 'Team Rocket');
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve(searchResponseForPath(path));
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    fireEvent.click(screen.getByRole('button', { name: /run for team roster/i }));
    await waitFor(() => expect(screen.getByText('Jane Dev')).toBeInTheDocument());

    // The old single-page fetch had no offset at all; paging requires one.
    expect(decodedSearchPaths().some((path) => path.includes('startAt='))).toBe(true);
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

    // Columns: Person | Role(s) | Issues | Points | Issues/Wk | Points/Wk | Avg Cycle | Median Cycle.
    const janeCells = readTeamRowCells('Jane Dev');
    expect(janeCells[2]).toBe('2'); // two advanced issues in the search response
    expect(janeCells[3]).toBe('8'); // 5 + 3 story points
    const johnCells = readTeamRowCells('John QA');
    expect(johnCells[2]).toBe('2');
    expect(johnCells[3]).toBe('8');

    // Each member was resolved to their USERNAME and searched with it via `assignee WAS`.
    const searchedAssignees = decodedSearchPaths();
    expect(searchedAssignees.some((path) => path.includes('assignee WAS "jane.dev"'))).toBe(true);
    expect(searchedAssignees.some((path) => path.includes('assignee WAS "john.qa"'))).toBe(true);
  });

  it('surfaces each resolved person\'s exact JQL with a per-row Copy button in the team comparison', async () => {
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

    await waitFor(() => expect(screen.getByText('Jane Dev')).toBeInTheDocument());

    // The resolved machine id (not the display name) renders in each person's Query cell.
    const janeRow = screen.getByText('Jane Dev').closest('tr') as HTMLElement;
    expect(within(janeRow).getByText('jane.dev')).toBeInTheDocument();
    const johnRow = screen.getByText('John QA').closest('tr') as HTMLElement;
    expect(within(johnRow).getByText('john.qa')).toBeInTheDocument();

    // Clicking a person's Copy button copies THAT person's exact JQL — same id + default 90-day window the
    // search ran with, ORDER BY intact — so it can be pasted straight into Jira to validate the row.
    fireEvent.click(within(janeRow).getByRole('button', { name: /copy jql for jane dev/i }));
    expect(mockCopyToClipboard).toHaveBeenCalledWith(
      'assignee WAS "jane.dev" AND updated >= -90d ORDER BY updated DESC',
    );

    fireEvent.click(within(johnRow).getByRole('button', { name: /copy jql for john qa/i }));
    expect(mockCopyToClipboard).toHaveBeenCalledWith(
      'assignee WAS "john.qa" AND updated >= -90d ORDER BY updated DESC',
    );
  });

  it('shows a muted dash and no Copy button for a team member that resolves to no queryable id', async () => {
    // A roster member with no accountId and a BLANK assignee value has nothing to query by, so it becomes a
    // "No matching Jira user" row: its Query cell must read "—" with no Copy button, never a bogus JQL.
    const unqueryableMember: StandupRosterMember = {
      id: 'roster-member:ghost', displayName: 'Ghost Member', assigneeQueryValue: '', teamName: 'Team Rocket',
    };
    seedRoster([buildRosterMember('Jane Dev', 'Team Rocket'), unqueryableMember], 'Team Rocket');
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve(searchResponseForPath(path));
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    fireEvent.click(screen.getByRole('button', { name: /run for team roster/i }));

    await waitFor(() => expect(screen.getByText('Ghost Member')).toBeInTheDocument());
    const ghostRow = screen.getByText('Ghost Member').closest('tr') as HTMLElement;
    expect(within(ghostRow).getByText('No matching Jira user')).toBeInTheDocument();
    // No Copy button for the unresolved member; the resolved member still has one.
    expect(within(ghostRow).queryByRole('button', { name: /copy jql for/i })).toBeNull();
    const janeRow = screen.getByText('Jane Dev').closest('tr') as HTMLElement;
    expect(within(janeRow).getByRole('button', { name: /copy jql for jane dev/i })).toBeInTheDocument();
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
    // Columns shifted by the new Role(s) column: Issues is now at index 2 (Person | Role(s) | Issues | …).
    expect(readTeamRowCells('Jane Dev')[2]).toBe('2');
    const johnRow = screen.getByText('John QA').closest('tr');
    expect(within(johnRow as HTMLElement).getByText(/500/)).toBeInTheDocument();
  });

  it('renders "—" and adds no points for an issue whose story-points field is absent', async () => {
    // Jane finished this issue but it carries no story-points field at all, so its Points cell must read
    // "—" and it must not add to the Story Points total the two pointed issues (3 + 5 = 8) already make up.
    const unpointedIssue = {
      key: 'TBX-NOPTS',
      fields: {
        summary: 'No points set',
        created: '2026-06-29T00:00:00.000Z',
        resolutiondate: '2026-07-03T00:00:00.000Z',
        status: { id: '5' },
        assignee: { name: 'jane.dev', displayName: 'jane.dev' },
        // No customfield_10236 key at all — reads as null.
      },
      changelog: {
        histories: [
          {
            created: '2026-06-30T00:00:00.000Z',
            items: [
              { field: 'assignee', from: null, fromString: null, to: 'jane.dev', toString: 'jane.dev' },
              { field: 'status', from: '1', fromString: null, to: '3', toString: null },
            ],
          },
          { created: '2026-07-03T00:00:00.000Z', items: [{ field: 'status', from: '3', fromString: null, to: '5', toString: null }] },
        ],
      },
    };
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) {
        const pointedPair = buildSearchResponseFor(JANE_STAMP);
        return Promise.resolve({ issues: [...pointedPair.issues, unpointedIssue] });
      }
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    fireEvent.change(screen.getByLabelText(/person \(jira assignee\)/i), {
      target: { value: 'Jane Dev' },
    });
    fireEvent.click(screen.getByRole('button', { name: /run report/i }));

    await waitFor(() => expect(screen.getByText('TBX-NOPTS')).toBeInTheDocument());
    // The unpointed issue's Points cell (column index 4) reads "—" and totals stay at the pointed pair's 8.
    const noPtsCells = Array.from((screen.getByText('TBX-NOPTS').closest('tr') as HTMLElement).querySelectorAll('td'))
      .map((cell) => cell.textContent ?? '');
    expect(noPtsCells[4]).toBe('—');
    expect(readStatCardValue('Story Points')).toBe('8');
  });

  it('reads and requests the custom spFieldId configured in the ART settings (tbxARTSettings)', async () => {
    // The Team Dashboard/ART settings can point on a different field; here it is customfield_99999. The
    // report must request THAT field in the search and read its dropdown object value, ignoring the default.
    localStorage.setItem('tbxARTSettings', JSON.stringify({ spFieldId: 'customfield_99999' }));
    const customFieldIssue = {
      key: 'TBX-CFG',
      fields: {
        summary: 'Custom points field',
        created: '2026-06-29T00:00:00.000Z',
        resolutiondate: '2026-07-03T00:00:00.000Z',
        status: { id: '5' },
        assignee: { name: 'jane.dev', displayName: 'jane.dev' },
        customfield_99999: { value: '7' }, // dropdown object on the CONFIGURED field
        customfield_10236: 2, // the default field is present but must be ignored
      },
      changelog: {
        histories: [
          {
            created: '2026-06-30T00:00:00.000Z',
            items: [
              { field: 'assignee', from: null, fromString: null, to: 'jane.dev', toString: 'jane.dev' },
              { field: 'status', from: '1', fromString: null, to: '3', toString: null },
            ],
          },
          { created: '2026-07-03T00:00:00.000Z', items: [{ field: 'status', from: '3', fromString: null, to: '5', toString: null }] },
        ],
      },
    };
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve({ issues: [customFieldIssue] });
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    fireEvent.change(screen.getByLabelText(/person \(jira assignee\)/i), {
      target: { value: 'Jane Dev' },
    });
    fireEvent.click(screen.getByRole('button', { name: /run report/i }));

    await waitFor(() => expect(screen.getByText('TBX-CFG')).toBeInTheDocument());
    // The configured field's value (7) is credited, not the default field's 2.
    expect(readStatCardValue('Story Points')).toBe('7');
    const cfgCells = Array.from((screen.getByText('TBX-CFG').closest('tr') as HTMLElement).querySelectorAll('td'))
      .map((cell) => cell.textContent ?? '');
    expect(cfgCells[4]).toBe('7');
    // The search requested the configured field id, not the default one.
    const decodedSearch = decodedSearchPaths()[0] ?? '';
    expect(decodedSearch).toContain('customfield_99999');
    expect(decodedSearch).not.toContain('customfield_10236');
  });

  it('labels the non-summable columns and shows the honest team total beside them', async () => {
    // Both people advanced the SAME two issues, so summing the Issues column reports 4. The team
    // delivered 2. The label alone would not survive a copy into a document, so the number the reader
    // was reaching for is supplied.
    const developerCapabilities: RosterRoleCapabilities = {
      canDevelop: true, canInternalTest: false, canExternalTest: false,
    };
    seedRoster(
      [
        buildRosterMemberWithRoles('Jane Dev', 'Team Rocket', developerCapabilities),
        buildRosterMemberWithRoles('John QA', 'Team Rocket', developerCapabilities),
      ],
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

    await waitFor(() => expect(screen.getByText('Jane Dev')).toBeInTheDocument());

    expect(screen.getByText(/cannot be summed down this table/i)).toBeInTheDocument();
    // Two people each credited with the same two issues; counted once, the team delivered two.
    const totalsNote = screen.getByText(/cannot be summed down this table/i).closest('p') as HTMLElement;
    expect(totalsNote.textContent).toMatch(/delivered\s*2\s*issues/i);
  });

  it('renders the Role(s) column and the "Throughput by role" rollup for a team run', async () => {
    // Jane can Develop, John can Internal Test. Each advances the two issues the search response carries,
    // so the Developer role and the Internal Tester role each roll up to 2 issues — the contrast the
    // rollup exists to surface (many developers feeding a single tester) in miniature.
    const developerCapabilities: RosterRoleCapabilities = {
      canDevelop: true, canInternalTest: false, canExternalTest: false,
    };
    const internalTesterCapabilities: RosterRoleCapabilities = {
      canDevelop: false, canInternalTest: true, canExternalTest: false,
    };
    seedRoster(
      [
        buildRosterMemberWithRoles('Jane Dev', 'Team Rocket', developerCapabilities),
        buildRosterMemberWithRoles('John QA', 'Team Rocket', internalTesterCapabilities),
      ],
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

    await waitFor(() => expect(screen.getByText('Jane Dev')).toBeInTheDocument());

    // The per-person comparison row shows Jane's role label in the new "Role(s)" column.
    expect(readTeamRowCells('Jane Dev').some((cell) => cell.includes('Developer'))).toBe(true);

    // The "Throughput by role" rollup section renders a Developer row summing Jane's 2 advanced issues.
    const rollupHeading = screen.getByText('Throughput by role');
    const rollupSection = rollupHeading.closest('section') as HTMLElement;
    const developerRow = within(rollupSection).getByText('Developer').closest('tr') as HTMLElement;
    const developerCells = Array.from(developerRow.querySelectorAll('td')).map((cell) => cell.textContent ?? '');
    // Columns: Role | People | Issues | Story Points | Issues/Wk | Points/Wk | Avg Cycle | Median Cycle.
    expect(developerCells[1]).toBe('1'); // one developer
    expect(developerCells[2]).toBe('2'); // two issues advanced
    // The Internal Tester role also rolls up, so the bottleneck contrast is visible side by side.
    expect(within(rollupSection).getByText('Internal Tester')).toBeInTheDocument();
  });

  it('disables Run for team roster when the active-team roster is empty', () => {
    render(<PersonalFlowTab />);
    expect(screen.getByRole('button', { name: /run for team roster/i })).toBeDisabled();
  });

  // ── Internal Testing Bottleneck panel ──────────────────────────────────────

  // The instance's real Jira statuses the bottleneck picker loads on mount. Includes two internal-testing
  // statuses ("Testing", "Ready for Testing") so the multi-select can offer valid, typo-proof choices.
  const BOTTLENECK_STATUSES = [
    { id: '3', name: 'Testing', statusCategory: { key: 'indeterminate' } },
    { id: '7', name: 'Ready for Testing', statusCategory: { key: 'indeterminate' } },
    { id: '1', name: 'To Do', statusCategory: { key: 'new' } },
  ];

  // Two issues currently sitting in the Testing status, both held by one tester — the bottleneck. Each
  // entered testing from an In Progress dev status, so the panel measures the wait from the testing entry.
  const BOTTLENECK_SEARCH_RESPONSE = {
    issues: [
      {
        key: 'ENC-1',
        fields: {
          summary: 'Awaiting internal test',
          created: '2026-06-20T00:00:00.000Z',
          status: { id: '3', name: 'Testing' },
          assignee: { displayName: 'Tester One' },
        },
        changelog: {
          histories: [
            { created: '2026-06-25T00:00:00.000Z', items: [{ field: 'status', from: '1', to: '3', toString: 'In Progress' }] },
            { created: '2026-07-01T00:00:00.000Z', items: [{ field: 'status', from: '3', to: '5', toString: 'Testing' }] },
          ],
        },
      },
      {
        key: 'ENC-2',
        fields: {
          summary: 'Also waiting on test',
          created: '2026-06-22T00:00:00.000Z',
          status: { id: '3', name: 'Testing' },
          assignee: { displayName: 'Tester One' },
        },
        changelog: {
          histories: [
            { created: '2026-06-26T00:00:00.000Z', items: [{ field: 'status', from: '1', to: '3', toString: 'In Progress' }] },
            { created: '2026-07-03T00:00:00.000Z', items: [{ field: 'status', from: '3', to: '5', toString: 'Testing' }] },
          ],
        },
      },
    ],
  };

  it('runs the bottleneck: picks statuses from the fetched list and queries the exact JQL', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      // The picker loads the instance's real statuses on mount so the user can only pick valid names.
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(BOTTLENECK_STATUSES);
      // The bottleneck search is the only path carrying a `status in (...)` clause.
      if (path.includes('/rest/api/2/search') && decodeURIComponent(path).includes('status in')) {
        return Promise.resolve(BOTTLENECK_SEARCH_RESPONSE);
      }
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    // Wait for the status checkboxes to appear once /rest/api/2/status resolves, then pick two of them.
    const testingCheckbox = await screen.findByRole('checkbox', { name: 'Testing' });
    const readyForTestingCheckbox = screen.getByRole('checkbox', { name: 'Ready for Testing' });
    fireEvent.change(screen.getByLabelText(/scope jql/i), { target: { value: 'project = ENCUC' } });
    fireEvent.click(testingCheckbox);
    fireEvent.click(readyForTestingCheckbox);
    fireEvent.click(screen.getByRole('button', { name: /run bottleneck/i }));

    // The headline names the backlog count of two issues stuck in internal testing.
    await waitFor(() => expect(screen.getByText(/2 issues in Internal Testing/i)).toBeInTheDocument());
    // The by-assignee rollup surfaces the single tester holding both issues — the bottleneck punchline.
    // The name appears in both the by-assignee rollup and the oldest-issues table, so match all of them.
    expect(screen.getAllByText('Tester One').length).toBeGreaterThan(0);
    expect(screen.getByText('ENC-1')).toBeInTheDocument();

    // The fetched search JQL names BOTH selected statuses (alphabetical build order) and the scope.
    const bottleneckSearch = decodedSearchPaths().find((path) => path.includes('status in')) ?? '';
    expect(bottleneckSearch).toContain('status in ("Ready for Testing","Testing")');
    expect(bottleneckSearch).toContain('project = ENCUC');

    // The displayed JQL mirrors the exact string that ran.
    const jqlNode = await screen.findByText(/status in \("Ready for Testing","Testing"\)/i);
    expect(jqlNode).toHaveTextContent('project = ENCUC');
  });

  it('persists the selected statuses to localStorage as a statusNames array', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(BOTTLENECK_STATUSES);
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    fireEvent.change(screen.getByLabelText(/scope jql/i), { target: { value: 'project = ENCUC' } });
    const testingCheckbox = await screen.findByRole('checkbox', { name: 'Testing' });
    fireEvent.click(testingCheckbox);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ready for Testing' }));

    // Persisted under the SAME key, now as a `statusNames` array (not the old comma text).
    const persisted = JSON.parse(localStorage.getItem('tbxPersonalFlowBottleneck') ?? '{}');
    expect(persisted.scopeJql).toBe('project = ENCUC');
    expect(persisted.statusNames).toEqual(['Ready for Testing', 'Testing']);
  });

  it('hydrates the scope and pre-selects persisted statusNames from the localStorage key on mount', async () => {
    localStorage.setItem(
      'tbxPersonalFlowBottleneck',
      JSON.stringify({ scopeJql: 'project = SAVED', statusNames: ['Testing'] }),
    );
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(BOTTLENECK_STATUSES);
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);

    expect(screen.getByLabelText(/scope jql/i)).toHaveValue('project = SAVED');
    const testingCheckbox = await screen.findByRole('checkbox', { name: 'Testing' });
    expect(testingCheckbox).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Ready for Testing' })).not.toBeChecked();
  });

  it('migrates an older statusNamesText value into a pre-selected status on mount', async () => {
    // A user who saved inputs before the multi-select existed has the old comma text form. Their selection
    // must survive: the comma-split names become pre-checked once the status list loads.
    localStorage.setItem(
      'tbxPersonalFlowBottleneck',
      JSON.stringify({ scopeJql: 'project = OLD', statusNamesText: 'Testing' }),
    );
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(BOTTLENECK_STATUSES);
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);

    const testingCheckbox = await screen.findByRole('checkbox', { name: 'Testing' });
    expect(testingCheckbox).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Ready for Testing' })).not.toBeChecked();
  });

  it('disables Run bottleneck until both a scope and at least one status are selected', async () => {
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(BOTTLENECK_STATUSES);
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab />);
    const runButton = screen.getByRole('button', { name: /run bottleneck/i });
    expect(runButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/scope jql/i), { target: { value: 'project = ENCUC' } });
    expect(runButton).toBeDisabled(); // still no statuses selected
    const testingCheckbox = await screen.findByRole('checkbox', { name: 'Testing' });
    fireEvent.click(testingCheckbox);
    expect(runButton).toBeEnabled();
  });
});

describe('PersonalFlowTab — in-tab team scope', () => {
  beforeEach(() => {
    useStandupRosterStore.setState({ rosterMembers: [] });
    useSettingsStore.setState({ sprintDashboardActiveTeam: '' });
    mockJiraGet.mockReset();
    // Reset the clipboard spy too: without this, mock.calls[0] would be an earlier test's copy and
    // this suite would assert against a document it never produced.
    mockCopyWithResult.mockReset();
  });

  /** Two teams in one roster, so a scope change is observable in who gets a row. */
  function seedTwoTeamRoster(): void {
    useStandupRosterStore.setState({
      rosterMembers: [
        buildRosterMember('Jane Dev', 'Team Rocket'),
        buildRosterMember('John QA', 'Team Falcon'),
      ],
    });
    useSettingsStore.setState({ sprintDashboardActiveTeam: 'Team Rocket' });
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve(searchResponseForPath(path));
      return Promise.reject(new Error(`unexpected path ${path}`));
    });
  }

  it('runs the team chosen in the Reports Hub filter, not the one stored in Agile Hub', async () => {
    seedTwoTeamRoster();

    render(<PersonalFlowTab teamFilter="Team Falcon" />);
    fireEvent.click(screen.getByRole('button', { name: /run for team roster/i }));

    // The stored active team is Team Rocket; the in-tab filter must win.
    await waitFor(() => expect(screen.getByText('John QA')).toBeInTheDocument());
    expect(screen.queryByText('Jane Dev')).not.toBeInTheDocument();
  });

  it('falls back to the Agile Hub team when no filter is chosen', async () => {
    seedTwoTeamRoster();

    render(<PersonalFlowTab teamFilter="" />);
    fireEvent.click(screen.getByRole('button', { name: /run for team roster/i }));

    await waitFor(() => expect(screen.getByText('Jane Dev')).toBeInTheDocument());
  });

  it('says so when the chosen filter is not a roster team, rather than silently running another', async () => {
    // The Reports Hub filter is populated from Jira/ART team names, which need not match the roster's.
    // Silently falling back to the first roster team would look like it worked while being wrong.
    seedTwoTeamRoster();

    render(<PersonalFlowTab teamFilter="Some ART Team" />);

    expect(screen.getByText(/not a team on your roster/i)).toBeInTheDocument();
  });

  it('still runs the Agile Hub team when the filter does not match', async () => {
    seedTwoTeamRoster();

    render(<PersonalFlowTab teamFilter="Some ART Team" />);
    fireEvent.click(screen.getByRole('button', { name: /run for team roster/i }));

    await waitFor(() => expect(screen.getByText('Jane Dev')).toBeInTheDocument());
    expect(screen.queryByText('John QA')).not.toBeInTheDocument();
  });

  it('labels the report with the team whose data it actually ran, not the one requested', async () => {
    // The reported symptom: the header said "Transformers" while the rows were Cleanup Crew's people.
    // filterRosterMembersByActiveTeam falls back to the FIRST roster team when the requested name is
    // not a roster team, so the data moved and the label did not.
    mockCopyWithResult.mockResolvedValue(true);
    useStandupRosterStore.setState({
      rosterMembers: [
        buildRosterMember('Jane Dev', 'Cleanup Crew'),
        buildRosterMember('John QA', 'Zebra Squad'),
      ],
    });
    useSettingsStore.setState({ sprintDashboardActiveTeam: 'Transformers' });
    mockJiraGet.mockImplementation((path: string) => {
      if (path.startsWith('/rest/api/2/status')) return Promise.resolve(STATUSES);
      if (path.startsWith('/rest/api/2/user/search')) return Promise.resolve(userSearchResponseForPath(path));
      if (path.startsWith('/rest/api/2/search')) return Promise.resolve(searchResponseForPath(path));
      return Promise.reject(new Error(`unexpected path ${path}`));
    });

    render(<PersonalFlowTab teamFilter="" />);
    fireEvent.click(screen.getByRole('button', { name: /run for team roster/i }));
    await waitFor(() => expect(screen.getByText('Jane Dev')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /copy audit report/i }));

    await waitFor(() => expect(mockCopyWithResult).toHaveBeenCalled());
    const copiedDocument = String(mockCopyWithResult.mock.calls[0][0]);
    expect(copiedDocument).toContain('Cleanup Crew');
    expect(copiedDocument).not.toContain('Transformers');
  });

  it('warns on screen when the requested team is not on the roster at all', async () => {
    useStandupRosterStore.setState({
      rosterMembers: [buildRosterMember('Jane Dev', 'Cleanup Crew')],
    });
    useSettingsStore.setState({ sprintDashboardActiveTeam: 'Transformers' });

    render(<PersonalFlowTab teamFilter="" />);

    expect(screen.getByText(/Cleanup Crew/)).toBeInTheDocument();
  });

  it('names the scoped team in the audit report it copies', async () => {
    mockCopyWithResult.mockResolvedValue(true);
    seedTwoTeamRoster();

    render(<PersonalFlowTab teamFilter="Team Falcon" />);
    fireEvent.click(screen.getByRole('button', { name: /run for team roster/i }));
    await waitFor(() => expect(screen.getByText('John QA')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /copy audit report/i }));

    await waitFor(() => expect(mockCopyWithResult).toHaveBeenCalled());
    expect(String(mockCopyWithResult.mock.calls[0][0])).toContain('Team Falcon');
  });
});
