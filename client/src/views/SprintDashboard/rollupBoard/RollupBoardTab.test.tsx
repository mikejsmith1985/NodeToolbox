// RollupBoardTab.test.tsx — Proves the board never quietly looks smaller or healthier than reality.
//
// Every case here is one where a less careful board would render something plausible and wrong: no
// board selected, a partial load, an oversized board, or an instance with no sub-status field.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import RollupBoardTab from './RollupBoardTab.tsx';

/** Builds a board issue linked to a Feature in a different project. */
function buildIssue(key: string, featureKey: string | null = null) {
  return {
    id: key,
    key,
    fields: {
      summary: `Summary of ${key}`,
      status: { name: 'To Do', statusCategory: { name: 'To Do' } },
      issuetype: { name: 'Story', subtask: false },
      issuelinks: [],
      fixVersions: [],
      // The board's fetch asks for these, and the shared detail panel reads them unguarded.
      created: '2026-08-01T09:00:00.000Z',
      updated: '2026-08-05T09:00:00.000Z',
      customfield_10108: featureKey,
    },
  };
}

/** Answers the field discovery call, then the board and search sweeps. */
function mockJiraResponses(options: {
  boardIssues: ReturnType<typeof buildIssue>[];
  total?: number;
  hasSubStatusField?: boolean;
  shouldSubtaskSweepFail?: boolean;
}) {
  const instanceFields = options.hasSubStatusField === false
    ? [{ id: 'customfield_10108', name: 'Feature Link' }]
    : [{ id: 'customfield_10108', name: 'Feature Link' }, { id: 'customfield_10201', name: 'Sub-Status' }];

  mockJiraGet.mockImplementation((requestPath: string) => {
    if (requestPath.includes('/rest/api/2/field')) return Promise.resolve(instanceFields);
    if (requestPath.includes('/board/42/issue')) {
      return Promise.resolve({
        total: options.total ?? options.boardIssues.length,
        startAt: 0,
        maxResults: 100,
        issues: options.boardIssues,
      });
    }
    if (requestPath.includes('parent%20in')) {
      return options.shouldSubtaskSweepFail
        ? Promise.reject(new Error('sub-task sweep failed'))
        : Promise.resolve({ issues: [] });
    }
    if (requestPath.includes('key%20in')) {
      return Promise.resolve({
        issues: [{
          id: 'PORTFOLIO-9',
          key: 'PORTFOLIO-9',
          fields: { summary: 'Enrolment revamp', status: { name: 'In Progress' }, priority: { name: 'High' }, issuelinks: [] },
        }],
      });
    }
    return Promise.resolve({ issues: [] });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('RollupBoardTab — honest states', () => {
  it('says plainly that a board must be selected instead of rendering an empty board', () => {
    render(<RollupBoardTab boardId={null} teamProfileId="team-a" />);

    expect(screen.getByText(/No board is selected for this team yet/)).toBeTruthy();
    // An empty board would read as "this team has no work", which is a different claim entirely.
    expect(screen.queryByTestId('rollup-column-header-row')).toBeNull();
  });

  it('names what could not be read, rather than rendering a silently shorter board', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')], shouldSubtaskSweepFail: true });

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => {
      expect(screen.getByText(/Part of this board could not be read/)).toBeTruthy();
    });
  });

  it('warns about an oversized board while still showing all of it', async () => {
    const manyIssues = Array.from({ length: 320 }, (_ignored, issueIndex) => buildIssue(`DEV-${issueIndex + 1}`, 'PORTFOLIO-9'));
    mockJiraResponses({ boardIssues: manyIssues, total: 320 });

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => {
      expect(screen.getByText(/nothing has been dropped/)).toBeTruthy();
    });
  });

  it('states the reduced precision when this instance has no sub-status field', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')], hasSubStatusField: false });

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => {
      expect(screen.getByText(/no sub-status field/)).toBeTruthy();
    });
  });

  it('distinguishes an empty board from a filtered one', async () => {
    mockJiraResponses({ boardIssues: [] });

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => {
      expect(screen.getByText(/nothing has been filtered out/)).toBeTruthy();
    });
  });
});

describe('RollupBoardTab — roll-up', () => {
  it('renders a lane for a Feature that lives in a different Jira project', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')] });

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => {
      expect(screen.getByTestId('rollup-lane-PORTFOLIO-9')).toBeTruthy();
    });
    expect(screen.getByText('Enrolment revamp')).toBeTruthy();
  });

  it('collects unattributed work in a No Feature lane and counts it', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9'), buildIssue('DEV-2', null)] });

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => {
      expect(screen.getByText('No Feature')).toBeTruthy();
    });
    expect(screen.getAllByText(/hygiene/).length).toBeGreaterThan(0);
  });

  it('opens with every lane collapsed, so the board reads as a Feature overview first', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')] });

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => {
      expect(screen.getByTestId('rollup-lane-PORTFOLIO-9')).toBeTruthy();
    });
    expect(screen.queryByTestId('rollup-card-DEV-1')).toBeNull();
  });

  it('always renders the Unmapped column, since no team vocabulary exists yet', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')] });

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => {
      expect(screen.getByText('Unmapped')).toBeTruthy();
    });
  });
});

describe('RollupBoardTab — defining the team\'s columns', () => {
  it('keeps the column editor out of the way until it is asked for', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')] });

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => expect(screen.getByTestId('rollup-lane-PORTFOLIO-9')).toBeTruthy());
    expect(screen.queryByTestId('rollup-vocabulary-editor')).toBeNull();
  });

  it('opens the column editor on request', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')] });

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => expect(screen.getByTestId('rollup-lane-PORTFOLIO-9')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit columns' }));

    expect(screen.getByTestId('rollup-vocabulary-editor')).toBeTruthy();
  });

  it('says the columns cannot be shared when this team has no shared workspace', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')] });

    render(<RollupBoardTab boardId={42} sharedWorkspaceDatabaseId="" teamProfileId="team-a" />);

    await waitFor(() => expect(screen.getByTestId('rollup-lane-PORTFOLIO-9')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit columns' }));

    expect(screen.getByText(/no shared ART workspace configured/)).toBeTruthy();
  });

  it('offers Publish and Pull once a shared workspace exists', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')] });

    render(<RollupBoardTab boardId={42} sharedWorkspaceDatabaseId="db-123" teamProfileId="team-a" />);

    await waitFor(() => expect(screen.getByTestId('rollup-lane-PORTFOLIO-9')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit columns' }));

    expect(screen.getByRole('button', { name: 'Publish to the team' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pull the team\'s columns' })).toBeTruthy();
  });

  it('remembers a column the team defined, so the board is not rebuilt from scratch each visit', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')] });

    const { unmount } = render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);
    await waitFor(() => expect(screen.getByTestId('rollup-lane-PORTFOLIO-9')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Edit columns' }));
    fireEvent.change(screen.getByLabelText('New column name'), { target: { value: 'Waiting on SL test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add column' }));
    unmount();

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => {
      expect(screen.getByText('Waiting on SL test')).toBeTruthy();
    });
  });
});

describe('RollupBoardTab — editing a card in place', () => {
  it('keeps the detail panel closed until a card is opened', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')] });

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => expect(screen.getByTestId('rollup-lane-PORTFOLIO-9')).toBeTruthy());
    expect(screen.queryByTestId('rollup-issue-detail')).toBeNull();
  });

  it('opens the shared detail panel when a card is clicked', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')] });

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => expect(screen.getByTestId('rollup-lane-PORTFOLIO-9')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Expand PORTFOLIO-9/ }));
    fireEvent.click(screen.getByTestId('rollup-card-DEV-1'));

    await waitFor(() => {
      expect(screen.getByTestId('rollup-issue-detail')).toBeTruthy();
    });
  });

  it('closes the detail panel again on request', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')] });

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => expect(screen.getByTestId('rollup-lane-PORTFOLIO-9')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Expand PORTFOLIO-9/ }));
    fireEvent.click(screen.getByTestId('rollup-card-DEV-1'));
    await waitFor(() => expect(screen.getByTestId('rollup-issue-detail')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Close DEV-1' }));

    expect(screen.queryByTestId('rollup-issue-detail')).toBeNull();
  });
});

describe('RollupBoardTab — every drag has a keyboard equivalent', () => {
  it('offers reordering as buttons, not only as a drag', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9'), buildIssue('DEV-2', null)] });

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => expect(screen.getByTestId('rollup-lane-PORTFOLIO-9')).toBeTruthy());
    // Someone who cannot drag must still be able to order their board.
    expect(screen.getAllByRole('button', { name: 'Send to top' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Send to bottom' }).length).toBeGreaterThan(0);
  });

  it('labels every drag handle, so it is announced rather than read as a decoration', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')] });

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => expect(screen.getByTestId('rollup-lane-PORTFOLIO-9')).toBeTruthy());
    expect(screen.getByLabelText('Drag PORTFOLIO-9 to reorder it')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Expand PORTFOLIO-9/ }));
    expect(screen.getByLabelText('Drag DEV-1 to another column')).toBeTruthy();
  });
});
