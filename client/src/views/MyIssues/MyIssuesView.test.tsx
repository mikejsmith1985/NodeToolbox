// MyIssuesView.test.tsx — Unit tests for the My Issues tabbed view component.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JiraIssue, JiraTransition } from '../../types/jira.ts';

import type { IssueSource, Persona, SortField, ViewMode } from './hooks/useMyIssuesState.ts';

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

    expect(screen.getByText(/default persona/i)).toBeInTheDocument();
  });
});

// ── Phase 4: Detail Panel tests ──

describe('MyIssuesView — detail panel', () => {
  beforeEach(() => {
    mockState.viewMode = 'cards';
    mockState.isDetailPanelOpen = false;
    mockState.selectedIssue = null;
    mockUseConnectionStore.mockReturnValue({ isSnowReady: false });
    mockSnowFetch.mockResolvedValue({ result: [] });
    vi.clearAllMocks();
    mockUseConnectionStore.mockReturnValue({ isSnowReady: false });
    mockSnowFetch.mockResolvedValue({ result: [] });
    mockActions.loadTransitions.mockResolvedValue(undefined);
  });

  it('clicking an issue card calls openDetailPanel with that issue', async () => {
    const user = userEvent.setup();
    mockState.issues = [createMockIssue('TBX-1', 'Build the feature')];
    render(<MyIssuesView />);

    await user.click(screen.getByText('Build the feature'));

    expect(mockActions.openDetailPanel).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'TBX-1' }),
    );
  });

  it('renders the detail panel overlay when isDetailPanelOpen is true', () => {
    mockState.isDetailPanelOpen = true;
    mockState.selectedIssue = createMockIssue('TBX-1', 'Build the feature');
    render(<MyIssuesView />);

    expect(screen.getByRole('complementary')).toBeInTheDocument();
  });

  it('detail panel shows the issue key and summary', () => {
    mockState.isDetailPanelOpen = true;
    mockState.selectedIssue = createMockIssue('TBX-1', 'Build the feature');
    render(<MyIssuesView />);

    // Both appear in the list and in the panel; getAllByText asserts at least one
    expect(screen.getAllByText('TBX-1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Build the feature').length).toBeGreaterThan(0);
  });

  it('detail panel shows status, assignee, and dates', () => {
    mockState.isDetailPanelOpen = true;
    mockState.selectedIssue = createMockIssue('TBX-1', 'Build the feature');
    render(<MyIssuesView />);

    expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0);
    expect(screen.getByText('Alice Dev')).toBeInTheDocument();
    expect(screen.getByText('2025-01-01')).toBeInTheDocument();
  });

  it('close button in the detail panel calls closeDetailPanel', async () => {
    const user = userEvent.setup();
    mockState.isDetailPanelOpen = true;
    mockState.selectedIssue = createMockIssue('TBX-1', 'Build the feature');
    render(<MyIssuesView />);

    await user.click(screen.getByRole('button', { name: /close detail panel/i }));

    expect(mockActions.closeDetailPanel).toHaveBeenCalled();
  });

  it('detail panel calls loadTransitions when it opens', async () => {
    mockState.isDetailPanelOpen = true;
    mockState.selectedIssue = createMockIssue('TBX-1', 'Build the feature');
    render(<MyIssuesView />);

    await waitFor(() => {
      expect(mockActions.loadTransitions).toHaveBeenCalledWith('TBX-1');
    });
  });

  it('detail panel shows transition dropdown when transitions are available', () => {
    mockState.isDetailPanelOpen = true;
    mockState.selectedIssue = createMockIssue('TBX-1', 'Build the feature');
    mockState.availableTransitions = [
      { id: '21', name: 'In Review', to: { name: 'In Review', statusCategory: { name: 'In Progress' } } },
    ];
    render(<MyIssuesView />);

    expect(screen.getByRole('combobox', { name: /change status/i })).toBeInTheDocument();
  });

  it('detail panel shows transition error when transitionError is set', () => {
    mockState.isDetailPanelOpen = true;
    mockState.selectedIssue = createMockIssue('TBX-1', 'Build the feature');
    mockState.transitionError = 'Transition failed: 400';
    render(<MyIssuesView />);

    expect(screen.getByText('Transition failed: 400')).toBeInTheDocument();
  });

  it('detail panel shows the single-issue comment textarea', () => {
    mockState.isDetailPanelOpen = true;
    mockState.selectedIssue = createMockIssue('TBX-1', 'Build the feature');
    render(<MyIssuesView />);

    expect(screen.getByLabelText(/add comment/i)).toBeInTheDocument();
  });
});

// ── Phase 4: SNow cross-reference tests ──

describe('MyIssuesView — SNow cross-reference', () => {
  beforeEach(() => {
    mockState.isDetailPanelOpen = true;
    mockState.selectedIssue = createMockIssue('TBX-1', 'Build the feature');
    mockActions.loadTransitions.mockResolvedValue(undefined);
    vi.clearAllMocks();
    mockActions.loadTransitions.mockResolvedValue(undefined);
  });

  it('does not show SNow section when isSnowReady is false', () => {
    mockUseConnectionStore.mockReturnValue({ isSnowReady: false });
    render(<MyIssuesView />);

    expect(screen.queryByText(/snow tickets/i)).not.toBeInTheDocument();
  });

  it('shows "No SNow tickets found" when SNow returns empty results', async () => {
    mockUseConnectionStore.mockReturnValue({ isSnowReady: true });
    mockSnowFetch.mockResolvedValue({ result: [] });
    render(<MyIssuesView />);

    await waitFor(() => {
      expect(screen.getByText(/no snow tickets found/i)).toBeInTheDocument();
    });
  });

  it('shows SNow ticket number and description when results are found', async () => {
    mockUseConnectionStore.mockReturnValue({ isSnowReady: true });
    mockSnowFetch.mockResolvedValue({
      result: [{ sys_id: 'abc1', number: 'INC0012345', short_description: 'Related to TBX-1' }],
    });
    render(<MyIssuesView />);

    await waitFor(() => {
      expect(screen.getByText('INC0012345')).toBeInTheDocument();
      expect(screen.getByText(/related to tbx-1/i)).toBeInTheDocument();
    });
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
