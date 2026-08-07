// RollupBoardTab.test.tsx — Proves the board never quietly looks smaller or healthier than reality.
//
// Every case here is one where a less careful board would render something plausible and wrong: no
// board selected, a partial load, an oversized board, or an instance with no sub-status field.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import RollupBoardTab from './RollupBoardTab.tsx';

/** One "relates to" link, as Jira returns it. */
interface MockIssueLink {
  type: { name: string; inward: string; outward: string };
  outwardIssue: { key: string };
}

/** Builds a board issue linked to a Feature in a different project. */
function buildIssue(key: string, featureKey: string | null = null, issueLinks: MockIssueLink[] = []) {
  return {
    id: key,
    key,
    fields: {
      summary: `Summary of ${key}`,
      status: { name: 'To Do', statusCategory: { name: 'To Do' } },
      issuetype: { name: 'Story', subtask: false },
      issuelinks: issueLinks,
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
  it('keeps board setup out of the way until it is asked for', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')] });

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => expect(screen.getByTestId('rollup-lane-PORTFOLIO-9')).toBeTruthy());
    expect(screen.queryByTestId('rollup-vocabulary-editor')).toBeNull();
  });

  it('opens board setup on request', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')] });

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => expect(screen.getByTestId('rollup-lane-PORTFOLIO-9')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Board setup' }));

    expect(screen.getByTestId('rollup-vocabulary-editor')).toBeTruthy();
  });

  it('says the columns cannot be shared when this team has no shared workspace', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')] });

    render(<RollupBoardTab boardId={42} sharedWorkspaceDatabaseId="" teamProfileId="team-a" />);

    await waitFor(() => expect(screen.getByTestId('rollup-lane-PORTFOLIO-9')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Board setup' }));

    expect(screen.getByText(/no shared ART workspace configured/)).toBeTruthy();
  });

  it('offers Publish and Pull once a shared workspace exists', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')] });

    render(<RollupBoardTab boardId={42} sharedWorkspaceDatabaseId="db-123" teamProfileId="team-a" />);

    await waitFor(() => expect(screen.getByTestId('rollup-lane-PORTFOLIO-9')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Board setup' }));

    expect(screen.getByRole('button', { name: 'Share my columns with the team' })).toBeTruthy();
    expect(screen.getByRole('button', { name: "Get the team's columns" })).toBeTruthy();
  });

  it('remembers a column the team defined, so the board is not rebuilt from scratch each visit', async () => {
    mockJiraResponses({ boardIssues: [buildIssue('DEV-1', 'PORTFOLIO-9')] });

    const { unmount } = render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);
    await waitFor(() => expect(screen.getByTestId('rollup-lane-PORTFOLIO-9')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Board setup' }));
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

describe('RollupBoardTab — showing only the Features this team owns', () => {
  /** A defect wired straight to an out-of-project Feature by a plain issue link. */
  function buildIssueLinkedDefect(key: string, featureKey: string) {
    const defect = buildIssue(key, null, [
      { type: { name: 'Relates', inward: 'relates to', outward: 'relates to' }, outwardIssue: { key: featureKey } },
    ]);
    return { ...defect, fields: { ...defect.fields, issuetype: { name: 'Defect', subtask: false } } };
  }

  /** Answers the feature sweep for whichever Feature keys get requested. */
  function mockScopedBoard(boardIssues: ReturnType<typeof buildIssue>[]) {
    mockJiraGet.mockImplementation((requestPath: string) => {
      if (requestPath.includes('/rest/api/2/field')) {
        return Promise.resolve([{ id: 'customfield_10108', name: 'Feature Link' }]);
      }
      if (requestPath.includes('/board/42/issue')) {
        return Promise.resolve({ total: boardIssues.length, startAt: 0, maxResults: 100, issues: boardIssues });
      }
      if (requestPath.includes('key%20in')) {
        const requested = decodeURIComponent(requestPath).match(/key in \(([^)]*)\)/)?.[1] ?? '';
        return Promise.resolve({
          issues: requested.split(',').map((featureKey) => featureKey.trim().replace(' ORDER BY key ASC', '')).filter(Boolean).map((featureKey) => ({
            id: featureKey,
            key: featureKey,
            fields: {
            summary: `Feature ${featureKey}`,
            // The type matters: a defect only resolves to a Feature it can recognise as one.
            issuetype: { name: 'Feature', subtask: false },
            status: { name: 'In Progress' },
            priority: { name: 'High' },
            issuelinks: [],
          },
          })),
        });
      }
      return Promise.resolve({ issues: [] });
    });
  }

  it('drops lanes for Features in projects the team does not track', async () => {
    window.localStorage.setItem('tbxRollupBoardScope', JSON.stringify({
      'team-a': { featureProjectKeys: ['ENCUC'], shouldIncludeIssueLinkedFeatures: false },
    }));
    mockScopedBoard([buildIssue('DEV-1', 'ENCUC-1'), buildIssueLinkedDefect('BUG-1', 'OTHER-9')]);

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => expect(screen.getByTestId('rollup-lane-ENCUC-1')).toBeTruthy());
    expect(screen.queryByTestId('rollup-lane-OTHER-9')).toBeNull();
  });

  it('says how many issues it held back, rather than just looking smaller', async () => {
    window.localStorage.setItem('tbxRollupBoardScope', JSON.stringify({
      'team-a': { featureProjectKeys: ['ENCUC'], shouldIncludeIssueLinkedFeatures: false },
    }));
    mockScopedBoard([buildIssue('DEV-1', 'ENCUC-1'), buildIssueLinkedDefect('BUG-1', 'OTHER-9')]);

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => {
      expect(screen.getByText(/1 issue is hidden/)).toBeTruthy();
    });
  });

  it('shows an out-of-project Feature anyway when the Feature Link field says so, and flags it', async () => {
    // "It shouldn't happen" — so when it does, the board surfaces it instead of hiding the evidence.
    window.localStorage.setItem('tbxRollupBoardScope', JSON.stringify({
      'team-a': { featureProjectKeys: ['ENCUC'], shouldIncludeIssueLinkedFeatures: false },
    }));
    mockScopedBoard([buildIssue('DEV-1', 'ENCUC-1'), buildIssue('DEV-2', 'OTHER-9')]);

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => expect(screen.getByTestId('rollup-lane-OTHER-9')).toBeTruthy());
    expect(screen.getByText(/outside this team's projects but linked by the Feature Link field/)).toBeTruthy();
  });

  it('reveals the loosely-linked ones when the team turns the toggle on', async () => {
    window.localStorage.setItem('tbxRollupBoardScope', JSON.stringify({
      'team-a': { featureProjectKeys: ['ENCUC'], shouldIncludeIssueLinkedFeatures: true },
    }));
    mockScopedBoard([buildIssue('DEV-1', 'ENCUC-1'), buildIssueLinkedDefect('BUG-1', 'OTHER-9')]);

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => expect(screen.getByTestId('rollup-lane-OTHER-9')).toBeTruthy());
    expect(screen.queryByText(/issues are hidden/)).toBeNull();
  });

  it('changes nothing for a team that has not configured any projects', async () => {
    mockScopedBoard([buildIssue('DEV-1', 'ENCUC-1'), buildIssueLinkedDefect('BUG-1', 'OTHER-9')]);

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => expect(screen.getByTestId('rollup-lane-ENCUC-1')).toBeTruthy());
    expect(screen.getByTestId('rollup-lane-OTHER-9')).toBeTruthy();
  });

  it('offers the scope controls inside board setup', async () => {
    mockScopedBoard([buildIssue('DEV-1', 'ENCUC-1')]);

    render(<RollupBoardTab boardId={42} teamProfileId="team-a" />);

    await waitFor(() => expect(screen.getByTestId('rollup-lane-ENCUC-1')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Board setup' }));

    expect(screen.getByTestId('rollup-feature-scope')).toBeTruthy();
  });
});
