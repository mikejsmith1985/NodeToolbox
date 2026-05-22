// SimpleSearchTab.test.tsx — Render-layer tests for the Business Helper Simple Search tab.

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockShowToast } = vi.hoisted(() => ({
  mockShowToast: vi.fn(),
}));

vi.mock('../hooks/useSimpleSearchState.ts', async () => {
  const actualModule = await vi.importActual<typeof import('../hooks/useSimpleSearchState.ts')>(
    '../hooks/useSimpleSearchState.ts',
  );
  return {
    ...actualModule,
    useSimpleSearchState: vi.fn(),
  };
});

vi.mock('../../../components/Toast/ToastContext.ts', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

import SimpleSearchTab from './SimpleSearchTab.tsx';
import {
  useSimpleSearchState,
  type SimpleSearchIssueDetail,
  type SimpleSearchRelationshipIssue,
  type SimpleSearchResult,
  type SimpleSearchSortOption,
  type UseSimpleSearchStateResult,
} from '../hooks/useSimpleSearchState.ts';

const mockUseSimpleSearchState = vi.mocked(useSimpleSearchState);

function buildSearchResult(overrides: Partial<SimpleSearchResult> = {}): SimpleSearchResult {
  return {
    key: overrides.key ?? 'TBX-101',
    summary: overrides.summary ?? 'Business summary match',
    issueType: overrides.issueType ?? 'Story',
    status: overrides.status ?? 'In Progress',
    assigneeName: overrides.assigneeName ?? 'Alex Analyst',
    created: overrides.created ?? '2026-05-01T00:00:00.000Z',
    updated: overrides.updated ?? '2026-05-20T00:00:00.000Z',
    hierarchyLevel: overrides.hierarchyLevel ?? 'team',
    matchLocation: overrides.matchLocation ?? 'summary',
    projectKey: overrides.projectKey ?? 'TBX',
  };
}

function buildViewState(
  overrides: Partial<UseSimpleSearchStateResult> = {},
): UseSimpleSearchStateResult {
  return {
    keyword: overrides.keyword ?? '',
    setKeyword: overrides.setKeyword ?? vi.fn(),
    sortOption: overrides.sortOption ?? 'summary-first',
    setSortOption: overrides.setSortOption ?? vi.fn(),
    isLoading: overrides.isLoading ?? false,
    errorMessage: overrides.errorMessage ?? null,
    results: overrides.results ?? [],
    rawResultCount: overrides.rawResultCount ?? 0,
    hasSearched: overrides.hasSearched ?? false,
    runSearch: overrides.runSearch ?? vi.fn(),
    detailByIssueKey: overrides.detailByIssueKey ?? {},
    detailErrorByIssueKey: overrides.detailErrorByIssueKey ?? {},
    loadingDetailKeys: overrides.loadingDetailKeys ?? [],
    loadIssueDetail: overrides.loadIssueDetail ?? vi.fn(),
  };
}

function buildRelationshipIssue(
  overrides: Partial<SimpleSearchRelationshipIssue> = {},
): SimpleSearchRelationshipIssue {
  return {
    key: overrides.key ?? 'TBX-201',
    summary: overrides.summary ?? 'Linked business work',
    issueType: overrides.issueType ?? 'Story',
    status: overrides.status ?? 'To Do',
    relationshipLabel: overrides.relationshipLabel ?? 'blocks',
    relationshipKind: overrides.relationshipKind ?? 'linked',
  };
}

function buildIssueDetail(
  overrides: Partial<SimpleSearchIssueDetail> = {},
): SimpleSearchIssueDetail {
  return {
    description: overrides.description ?? 'Expanded business description',
    childIssues: overrides.childIssues ?? [],
    linkedIssues: overrides.linkedIssues ?? [],
  };
}

beforeEach(() => {
  mockUseSimpleSearchState.mockReset();
  mockShowToast.mockReset();
  window.localStorage.clear();
});

describe('SimpleSearchTab', () => {
  it('renders the keyword and sort controls without a Jira level dropdown', () => {
    mockUseSimpleSearchState.mockReturnValue(buildViewState());

    render(<SimpleSearchTab />);

    expect(screen.getByLabelText('Search keyword')).toBeInTheDocument();
    expect(screen.getByLabelText('Sort results')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run search' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Jira level')).not.toBeInTheDocument();
  });

  it('passes control changes back to the hook actions', () => {
    const setKeyword = vi.fn();
    const setSortOption = vi.fn();
    const runSearch = vi.fn();
    mockUseSimpleSearchState.mockReturnValue(
      buildViewState({
        keyword: 'access',
        setKeyword,
        setSortOption,
        runSearch,
      }),
    );

    render(<SimpleSearchTab />);

    fireEvent.change(screen.getByLabelText('Search keyword'), { target: { value: 'billing' } });
    fireEvent.change(screen.getByLabelText('Sort results'), { target: { value: 'updated-desc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run search' }));

    expect(setKeyword).toHaveBeenCalledWith('billing');
    expect(setSortOption).toHaveBeenCalledWith('updated-desc' satisfies SimpleSearchSortOption);
    expect(runSearch).toHaveBeenCalledTimes(1);
  });

  it('runs the search when the user presses Enter in the keyword field', async () => {
    const runSearch = vi.fn();
    const user = userEvent.setup();
    mockUseSimpleSearchState.mockReturnValue(
      buildViewState({
        keyword: 'business',
        runSearch,
      }),
    );

    render(<SimpleSearchTab />);

    await user.type(screen.getByLabelText('Search keyword'), '{enter}');

    expect(runSearch).toHaveBeenCalledTimes(1);
  });

  it('groups results by Jira level and removes the Level column', () => {
    mockUseSimpleSearchState.mockReturnValue(
      buildViewState({
        keyword: 'business',
        hasSearched: true,
        rawResultCount: 2,
        results: [
          buildSearchResult({ key: 'TBX-101', hierarchyLevel: 'team', summary: 'Team result' }),
          buildSearchResult({ key: 'TBX-201', hierarchyLevel: 'art', issueType: 'Feature', summary: 'ART result' }),
        ],
      }),
    );

    render(<SimpleSearchTab />);

    expect(screen.getByText('Showing 2 of 2 matching issues across 2 Jira levels')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ART' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Team' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Level' })).not.toBeInTheDocument();
    expect(screen.getByText('Team result')).toBeInTheDocument();
    expect(screen.getByText('ART result')).toBeInTheDocument();
  });

  it('expands a row to show description, child records, and linked issues with separate visual labels', async () => {
    const user = userEvent.setup();
    const childIssue = buildRelationshipIssue({
      key: 'TBX-301',
      summary: 'Child record',
      relationshipLabel: 'Child',
      relationshipKind: 'child',
    });
    const linkedIssue = buildRelationshipIssue({
      key: 'TBX-401',
      summary: 'Linked record',
      relationshipLabel: 'blocks',
      relationshipKind: 'linked',
    });
    mockUseSimpleSearchState.mockReturnValue(
      buildViewState({
        keyword: 'business',
        hasSearched: true,
        rawResultCount: 1,
        results: [buildSearchResult()],
        detailByIssueKey: {
          'TBX-101': buildIssueDetail({
            description: 'Expanded business description',
            childIssues: [childIssue],
            linkedIssues: [linkedIssue],
          }),
        },
      }),
    );

    render(<SimpleSearchTab />);

    await user.click(screen.getByRole('button', { name: 'Toggle details for TBX-101' }));

    expect(screen.getByText('Expanded business description')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Child Records' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Linked Issues' })).toBeInTheDocument();
    expect(screen.getByText('Child', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('blocks', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Child record')).toBeInTheDocument();
    expect(screen.getByText('Linked record')).toBeInTheDocument();
  });

  it('loads issue detail when the user expands a row for the first time', async () => {
    const loadIssueDetail = vi.fn();
    const user = userEvent.setup();
    mockUseSimpleSearchState.mockReturnValue(
      buildViewState({
        keyword: 'business',
        hasSearched: true,
        rawResultCount: 1,
        results: [buildSearchResult()],
        loadIssueDetail,
      }),
    );

    render(<SimpleSearchTab />);

    await user.click(screen.getByRole('button', { name: 'Toggle details for TBX-101' }));

    expect(loadIssueDetail).toHaveBeenCalledWith('TBX-101');
  });

  it('expands a child record to show its description', async () => {
    const user = userEvent.setup();
    const childIssue = buildRelationshipIssue({
      key: 'TBX-301',
      summary: 'Child record',
      relationshipLabel: 'Child',
      relationshipKind: 'child',
    });
    mockUseSimpleSearchState.mockReturnValue(
      buildViewState({
        keyword: 'business',
        hasSearched: true,
        rawResultCount: 1,
        results: [buildSearchResult()],
        detailByIssueKey: {
          'TBX-101': buildIssueDetail({
            description: 'Expanded business description',
            childIssues: [childIssue],
          }),
          'TBX-301': buildIssueDetail({
            description: 'Child description text',
          }),
        },
      }),
    );

    render(<SimpleSearchTab />);

    await user.click(screen.getByRole('button', { name: 'Toggle details for TBX-101' }));
    await user.click(screen.getByRole('button', { name: 'Toggle description for TBX-301' }));

    expect(screen.getByText('Child description text')).toBeInTheDocument();
  });

  it('loads linked issue detail when the user expands a linked record', async () => {
    const loadIssueDetail = vi.fn();
    const user = userEvent.setup();
    const linkedIssue = buildRelationshipIssue({
      key: 'TBX-401',
      summary: 'Linked record',
      relationshipLabel: 'blocks',
      relationshipKind: 'linked',
    });
    mockUseSimpleSearchState.mockReturnValue(
      buildViewState({
        keyword: 'business',
        hasSearched: true,
        rawResultCount: 1,
        results: [buildSearchResult()],
        detailByIssueKey: {
          'TBX-101': buildIssueDetail({
            description: 'Expanded business description',
            linkedIssues: [linkedIssue],
          }),
        },
        loadIssueDetail,
      }),
    );

    render(<SimpleSearchTab />);

    await user.click(screen.getByRole('button', { name: 'Toggle details for TBX-101' }));
    await user.click(screen.getByRole('button', { name: 'Toggle description for TBX-401' }));

    expect(loadIssueDetail).toHaveBeenCalledWith('TBX-401');
  });

  it('sends a Simple Search result into the Stablization table using the configured mapping', async () => {
    const user = userEvent.setup();
    mockUseSimpleSearchState.mockReturnValue(
      buildViewState({
        keyword: 'business',
        hasSearched: true,
        rawResultCount: 1,
        results: [buildSearchResult()],
      }),
    );

    render(<SimpleSearchTab />);

    await user.click(screen.getByRole('button', { name: 'Send TBX-101 to Stablization' }));

    const storedRows = JSON.parse(window.localStorage.getItem('tbxBusinessHelperStablizationTable') ?? '[]');
    expect(storedRows[0].name).toBe('TBX-101 - Business summary match');
    expect(storedRows[0].sourceJiraBrowseUrl).toBe('/browse/TBX-101');
    expect(storedRows[0].sourceJiraIssueKey).toBe('TBX-101');
    expect(storedRows[0].sourceJiraLinkedColumns).toEqual(['name']);
    expect(mockShowToast).toHaveBeenCalledWith(
      'Added TBX-101 to Stablization using Name.',
      'success',
    );
  });

  it('warns instead of populating a dropdown-mapped column when the mapped value is not in the option list', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      'tbxBusinessHelperSettings',
      JSON.stringify({
        stablizationColumns: {
          grouping: { inputKind: 'text', dropdownOptions: [] },
          name: { inputKind: 'dropdown', dropdownOptions: ['Allowed Value'] },
          justification: { inputKind: 'text', dropdownOptions: [] },
        },
        simpleSearchMapping: {
          grouping: 'none',
          name: 'jira-key-summary',
          justification: 'none',
        },
      }),
    );
    mockUseSimpleSearchState.mockReturnValue(
      buildViewState({
        keyword: 'business',
        hasSearched: true,
        rawResultCount: 1,
        results: [buildSearchResult()],
      }),
    );

    render(<SimpleSearchTab />);

    await user.click(screen.getByRole('button', { name: 'Send TBX-101 to Stablization' }));

    expect(mockShowToast).toHaveBeenCalledWith(
      'No Stablization mapping could be applied. Review the Business Helper Settings tab.',
      'warning',
    );
  });
});
