// MyIssuesView.test.tsx — Unit tests for the My Issues tabbed view component.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraIssue, JiraTransition } from '../../types/jira.ts';

import type { IssueSource, SortField, ViewMode } from './hooks/useMyIssuesState.ts';

// ── Hoisted mocks ──

const { mockUseConnectionStore, mockSnowFetch, mockJiraPost, mockJiraPut } = vi.hoisted(() => ({
  mockUseConnectionStore: vi.fn(),
  mockSnowFetch: vi.fn(),
  mockJiraPost: vi.fn(),
  mockJiraPut: vi.fn(),
}));

vi.mock('../../store/connectionStore.ts', () => ({
  useConnectionStore: mockUseConnectionStore,
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: vi.fn().mockResolvedValue({ transitions: [] }),
  jiraPost: mockJiraPost,
  jiraPut: mockJiraPut,
}));

vi.mock('../../services/snowApi.ts', () => ({
  snowFetch: mockSnowFetch,
}));

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
    // Phase 4 state fields
    selectedIssue: null as JiraIssue | null,
    isDetailPanelOpen: false,
    isTransitioning: false,
    transitionError: null as string | null,
    availableTransitions: [] as JiraTransition[],
    isLoadingTransitions: false,
    isExportMenuOpen: false,
    // Phase 5+ state fields
    isBulkModeActive: false,
    bulkSelectedKeys: {} as Record<string, boolean>,
    isBulkPostingComment: false,
    bulkCommentError: null as string | null,
    boardQuickFilters: [],
    activeQuickFilterIds: {} as Record<number, boolean>,
    collapsedSwimlanes: { done: true } as Record<string, boolean>,
  },
  mockActions: {
    setSource: vi.fn(),
    setViewMode: vi.fn(),
    setSortBy: vi.fn(),
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
    // Phase 4 actions
    openDetailPanel: vi.fn(),
    closeDetailPanel: vi.fn(),
    loadTransitions: vi.fn().mockResolvedValue(undefined),
    transitionIssue: vi.fn().mockResolvedValue(undefined),
    setExportMenuOpen: vi.fn(),
    exportAsCsv: vi.fn(),
    exportAsMarkdown: vi.fn(),
    // Phase 5+ actions
    exportAsXlsx: vi.fn(),
    exportAsTsv: vi.fn(),
    toggleBulkMode: vi.fn(),
    toggleBulkKey: vi.fn(),
    postBulkComment: vi.fn().mockResolvedValue(undefined),
    loadBoardQuickFilters: vi.fn().mockResolvedValue(undefined),
    toggleQuickFilter: vi.fn(),
    clearSelectedBoard: vi.fn(),
    toggleSwimlaneCollapsed: vi.fn(),
  },
}));

vi.mock('./hooks/useMyIssuesState.ts', () => ({
  useMyIssuesState: () => ({ state: mockState, actions: mockActions }),
}));

vi.mock('../Hygiene/HygieneView.tsx', () => ({
  default: () => <div>Mock Hygiene View</div>,
}));

vi.mock('../../components/IssueDetailPanel/index.tsx', () => ({
  default: ({ issue, onIssueUpdated }: { issue: JiraIssue; onIssueUpdated?: () => void }) => (
    <div>
      <div>Detail panel for {issue.key}</div>
      <button onClick={() => onIssueUpdated?.()} type="button">
        Refresh {issue.key}
      </button>
    </div>
  ),
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
    // Reset phase 4 state
    mockState.isDetailPanelOpen = false;
    mockState.selectedIssue = null;
    mockState.isExportMenuOpen = false;
    mockState.transitionError = null;
    mockState.availableTransitions = [];
    mockState.isLoadingTransitions = false;
    mockState.isTransitioning = false;
    // Reset phase 5+ state
    mockState.isBulkModeActive = false;
    mockState.bulkSelectedKeys = {};
    mockState.isBulkPostingComment = false;
    mockState.bulkCommentError = null;
    mockState.boardQuickFilters = [];
    mockState.activeQuickFilterIds = {};
    mockState.collapsedSwimlanes = { done: true };
    // Default connection store: SNow not ready
    mockUseConnectionStore.mockReturnValue({ isSnowReady: false });
    mockSnowFetch.mockResolvedValue({ result: [] });
    mockJiraPost.mockResolvedValue({});
    mockJiraPut.mockResolvedValue(undefined);
    vi.clearAllMocks();
    // Re-apply connection store default after clearAllMocks
    mockUseConnectionStore.mockReturnValue({ isSnowReady: false });
    mockSnowFetch.mockResolvedValue({ result: [] });
    mockJiraPost.mockResolvedValue({});
    mockJiraPut.mockResolvedValue(undefined);
  });

  it('renders the Report, Hygiene, and Settings tab buttons', () => {
    render(<MyIssuesView />);

    expect(screen.getByRole('tab', { name: 'Report' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Hygiene' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument();
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

  it('switches to the embedded Hygiene tab content when Hygiene is clicked', async () => {
    const user = userEvent.setup();
    render(<MyIssuesView />);

    await user.click(screen.getByRole('tab', { name: 'Hygiene' }));

    expect(screen.getByText('Mock Hygiene View')).toBeInTheDocument();
  });

  it('switches to Settings tab content when Settings is clicked', async () => {
    const user = userEvent.setup();
    render(<MyIssuesView />);

    await user.click(screen.getByRole('tab', { name: 'Settings' }));

    expect(screen.getByText(/default view mode/i)).toBeInTheDocument();
  });
});

// ── Phase 4: Inline detail expansion tests ──

describe('MyIssuesView — inline detail expansion', () => {
  beforeEach(() => {
    mockState.viewMode = 'cards';
    mockState.source = 'mine';
    mockState.isDetailPanelOpen = false;
    mockState.selectedIssue = null;
    vi.clearAllMocks();
  });

  it('clicking an issue card expands inline issue details', async () => {
    const user = userEvent.setup();
    mockState.issues = [createMockIssue('TBX-1', 'Build the feature')];
    render(<MyIssuesView />);

    await user.click(screen.getByText('Build the feature'));

    expect(screen.getByText('Detail panel for TBX-1')).toBeInTheDocument();
  });

  it('clicking the same issue again collapses the inline details', async () => {
    const user = userEvent.setup();
    mockState.issues = [createMockIssue('TBX-1', 'Build the feature')];
    render(<MyIssuesView />);

    await user.click(screen.getByText('Build the feature'));
    expect(screen.getByText('Detail panel for TBX-1')).toBeInTheDocument();

    await user.click(screen.getByText('Build the feature'));
    expect(screen.queryByText('Detail panel for TBX-1')).not.toBeInTheDocument();
  });

  it('renders inline detail expansion in compact mode', async () => {
    const user = userEvent.setup();
    mockState.viewMode = 'compact';
    mockState.issues = [createMockIssue('TBX-1', 'Build the feature')];
    render(<MyIssuesView />);

    await user.click(screen.getByText('TBX-1'));

    expect(screen.getByText('Detail panel for TBX-1')).toBeInTheDocument();
  });

  it('refreshes my issues after an inline detail update', async () => {
    const user = userEvent.setup();
    mockState.source = 'mine';
    mockState.issues = [createMockIssue('TBX-1', 'Build the feature')];
    render(<MyIssuesView />);

    await user.click(screen.getByText('Build the feature'));
    await user.click(screen.getByRole('button', { name: 'Refresh TBX-1' }));

    expect(mockActions.fetchMyIssues).toHaveBeenCalled();
  });

  it('refreshes the active board results after an inline detail update', async () => {
    const user = userEvent.setup();
    mockState.source = 'board';
    mockState.selectedBoardId = 42;
    mockState.issues = [createMockIssue('TBX-1', 'Build the feature')];
    render(<MyIssuesView />);

    await user.click(screen.getByText('Build the feature'));
    await user.click(screen.getByRole('button', { name: 'Refresh TBX-1' }));

    expect(mockActions.runBoardIssues).toHaveBeenCalled();
  });
});

// ── Phase 4: Export menu tests ──

describe('MyIssuesView — export menu', () => {
  beforeEach(() => {
    mockState.isDetailPanelOpen = false;
    mockState.selectedIssue = null;
    mockState.isExportMenuOpen = false;
    mockUseConnectionStore.mockReturnValue({ isSnowReady: false });
    vi.clearAllMocks();
    mockUseConnectionStore.mockReturnValue({ isSnowReady: false });
    mockSnowFetch.mockResolvedValue({ result: [] });
  });

  it('renders an Export button in the toolbar', () => {
    render(<MyIssuesView />);

    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
  });

  it('shows CSV and Markdown options when isExportMenuOpen is true', () => {
    mockState.isExportMenuOpen = true;
    render(<MyIssuesView />);

    expect(screen.getByRole('button', { name: /copy as csv/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy as markdown table/i })).toBeInTheDocument();
  });

  it('calls setExportMenuOpen when Export button is clicked', async () => {
    const user = userEvent.setup();
    render(<MyIssuesView />);

    await user.click(screen.getByRole('button', { name: /^export$/i }));

    expect(mockActions.setExportMenuOpen).toHaveBeenCalled();
  });

  it('calls exportAsCsv when "Copy as CSV" is clicked', async () => {
    const user = userEvent.setup();
    mockState.isExportMenuOpen = true;
    render(<MyIssuesView />);

    await user.click(screen.getByRole('button', { name: /copy as csv/i }));

    expect(mockActions.exportAsCsv).toHaveBeenCalled();
  });

  it('calls exportAsMarkdown when "Copy as Markdown Table" is clicked', async () => {
    const user = userEvent.setup();
    mockState.isExportMenuOpen = true;
    render(<MyIssuesView />);

    await user.click(screen.getByRole('button', { name: /copy as markdown table/i }));

    expect(mockActions.exportAsMarkdown).toHaveBeenCalled();
  });
});
