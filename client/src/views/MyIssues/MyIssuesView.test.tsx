// MyIssuesView.test.tsx — Unit tests for the My Issues tabbed view component.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraIssue } from '../../types/jira.ts';

import type { IssueSource, Persona, SortField, ViewMode } from './hooks/useMyIssuesState.ts';

function createMockIssue(issueKey: string, summary: string): JiraIssue {
  return {
    id: issueKey,
    key: issueKey,
    fields: {
      summary,
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: { name: 'High', iconUrl: 'priority.png' },
      assignee: {
        accountId: 'user-1',
        displayName: 'Alice Dev',
        emailAddress: 'alice@example.com',
        avatarUrls: {},
      },
      reporter: null,
      issuetype: { name: 'Story', iconUrl: 'story.png' },
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-02T00:00:00.000Z',
      description: null,
    },
  };
}

const { mockState, mockActions } = vi.hoisted(() => ({
  mockState: {
    source: 'mine' as IssueSource,
    viewMode: 'cards' as ViewMode,
    sortBy: 'updated' as SortField,
    persona: 'dev' as Persona,
    jqlQuery: '',
    jqlHistory: [] as string[],
    activeStatusZone: null as string | null,
    issues: [
      createMockIssue('TBX-1', 'Build the feature'),
      createMockIssue('TBX-2', 'Write unit tests'),
    ],
    isFetching: false,
    fetchError: null as string | null,
    availableBoards: [],
    selectedBoardId: null as number | null,
    savedFilters: [],
    selectedFilterId: null as string | null,
  },
  mockActions: {
    setSource: vi.fn(),
    setViewMode: vi.fn(),
    setSortBy: vi.fn(),
    setPersona: vi.fn(),
    setJqlQuery: vi.fn(),
    setActiveStatusZone: vi.fn(),
    setSelectedBoardId: vi.fn(),
    setSelectedFilterId: vi.fn(),
    fetchMyIssues: vi.fn().mockResolvedValue(undefined),
    runJqlQuery: vi.fn().mockResolvedValue(undefined),
    loadBoards: vi.fn().mockResolvedValue(undefined),
    loadSavedFilters: vi.fn().mockResolvedValue(undefined),
    runSavedFilter: vi.fn().mockResolvedValue(undefined),
    runBoardIssues: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./hooks/useMyIssuesState.ts', () => ({
  useMyIssuesState: () => ({ state: mockState, actions: mockActions }),
}));

import MyIssuesView from './MyIssuesView.tsx';

describe('MyIssuesView', () => {
  beforeEach(() => {
    mockState.source = 'mine';
    mockState.viewMode = 'cards';
    mockState.activeStatusZone = null;
    mockState.issues = [
      createMockIssue('TBX-1', 'Build the feature'),
      createMockIssue('TBX-2', 'Write unit tests'),
    ];
    vi.clearAllMocks();
  });

  it('renders the Report and Settings tab buttons', () => {
    render(<MyIssuesView />);

    expect(screen.getByRole('tab', { name: 'Report' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument();
  });

  it('shows the persona strip with Dev/QA/SM/PO buttons', () => {
    render(<MyIssuesView />);

    expect(screen.getByRole('button', { name: 'Dev' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'QA' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'SM' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PO' })).toBeInTheDocument();
  });

  it('shows the source strip with My Issues/JQL/Saved Filter/Board buttons', () => {
    render(<MyIssuesView />);

    expect(screen.getByRole('button', { name: 'My Issues' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'JQL' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saved Filter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Board' })).toBeInTheDocument();
  });

  it('shows the JQL textarea when JQL source is selected', () => {
    mockState.source = 'jql';
    render(<MyIssuesView />);

    expect(screen.getByRole('textbox', { name: /jql query/i })).toBeInTheDocument();
  });

  it('shows issue count label when issues are present', () => {
    render(<MyIssuesView />);

    expect(screen.getByText(/2 issues/i)).toBeInTheDocument();
  });

  it('renders issue cards in card view mode', () => {
    mockState.viewMode = 'cards';
    render(<MyIssuesView />);

    expect(screen.getByText('TBX-1')).toBeInTheDocument();
    expect(screen.getByText('Build the feature')).toBeInTheDocument();
  });

  it('renders compact rows in compact view mode', () => {
    mockState.viewMode = 'compact';
    render(<MyIssuesView />);

    expect(screen.getByText('TBX-1')).toBeInTheDocument();
    expect(screen.getByText('TBX-2')).toBeInTheDocument();
  });

  it('switches to Settings tab content when Settings is clicked', async () => {
    const user = userEvent.setup();
    render(<MyIssuesView />);

    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    expect(screen.getByText(/default persona/i)).toBeInTheDocument();
  });
});
