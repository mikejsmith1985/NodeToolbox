// ImpactAnalysisView.test.tsx — Render and interaction tests for the standalone Impact Analysis view.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./hooks/useImpactAnalysisState.ts', async () => {
  const actualModule = await vi.importActual<typeof import('./hooks/useImpactAnalysisState.ts')>('./hooks/useImpactAnalysisState.ts');
  return { ...actualModule, useImpactAnalysisState: vi.fn() };
});

import ImpactAnalysisView from './ImpactAnalysisView.tsx';
import { useImpactAnalysisState } from './hooks/useImpactAnalysisState.ts';
import type { BlastChild, BlastLink, BlastStats } from './utils/blastRadius.ts';

const mockUseImpactAnalysisState = vi.mocked(useImpactAnalysisState);

interface OverrideHookState {
  issueKey?: string;
  isLoading?: boolean;
  errorMessage?: string | null;
  root?: ReturnType<typeof useImpactAnalysisState>['root'];
  inward?: BlastLink[];
  outward?: BlastLink[];
  children?: BlastChild[];
  stats?: BlastStats;
}

function buildStats(overrides: Partial<BlastStats> = {}): BlastStats {
  return { totalRelated: 0, blockerCount: 0, openCount: 0, doneCount: 0, ...overrides };
}

function buildLink(issueKey: string, direction: 'inward' | 'outward', linkType: string): BlastLink {
  return {
    direction,
    linkType,
    related: { key: issueKey, summary: `${issueKey} summary`, statusName: 'In Progress', statusCategoryKey: 'indeterminate' },
    isBlocker: linkType.includes('block'),
  };
}

function buildHookState(overrides: OverrideHookState = {}): ReturnType<typeof useImpactAnalysisState> {
  return {
    issueKey: overrides.issueKey ?? '',
    setIssueKey: vi.fn(),
    isLoading: overrides.isLoading ?? false,
    errorMessage: overrides.errorMessage ?? null,
    root: overrides.root ?? null,
    inward: overrides.inward ?? [],
    outward: overrides.outward ?? [],
    children: overrides.children ?? [],
    stats: overrides.stats ?? buildStats(),
    search: vi.fn(),
  };
}

beforeEach(() => {
  mockUseImpactAnalysisState.mockReset();
});

describe('ImpactAnalysisView', () => {
  it('renders the empty state guidance before a search', () => {
    mockUseImpactAnalysisState.mockReturnValue(buildHookState());

    render(<ImpactAnalysisView />);

    expect(screen.getByRole('heading', { name: 'Impact Analysis' })).toBeInTheDocument();
    expect(screen.getByLabelText('Issue key')).toBeInTheDocument();
    expect(screen.getByText('Enter an issue key to analyze its blast radius.')).toBeInTheDocument();
  });

  it('passes input edits and search clicks to the hook', () => {
    const hookState = buildHookState({ issueKey: 'TBX-1' });
    mockUseImpactAnalysisState.mockReturnValue(hookState);

    render(<ImpactAnalysisView />);
    fireEvent.change(screen.getByLabelText('Issue key'), { target: { value: 'TBX-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(hookState.setIssueKey).toHaveBeenCalledWith('TBX-2');
    expect(hookState.search).toHaveBeenCalledTimes(1);
  });

  it('searches when Enter is pressed in the issue key input', () => {
    const hookState = buildHookState({ issueKey: 'TBX-1' });
    mockUseImpactAnalysisState.mockReturnValue(hookState);

    render(<ImpactAnalysisView />);
    fireEvent.keyDown(screen.getByLabelText('Issue key'), { key: 'Enter' });

    expect(hookState.search).toHaveBeenCalledTimes(1);
  });

  it('shows a loading state while Jira data is loading', () => {
    mockUseImpactAnalysisState.mockReturnValue(buildHookState({ issueKey: 'TBX-1', isLoading: true }));

    render(<ImpactAnalysisView />);

    expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
    expect(screen.getByText('Loading Impact Analysis…')).toBeInTheDocument();
  });

  it('renders error state messages as alerts', () => {
    mockUseImpactAnalysisState.mockReturnValue(buildHookState({ issueKey: 'TBX-1', errorMessage: 'Jira unavailable' }));

    render(<ImpactAnalysisView />);

    expect(screen.getByRole('alert')).toHaveTextContent('Jira unavailable');
  });

  it('renders the root issue card with key, summary, status, type, priority, and assignee', () => {
    mockUseImpactAnalysisState.mockReturnValue(buildHookState({
      root: { key: 'TBX-1', summary: 'Root summary', statusName: 'In Progress', typeName: 'Story', priorityName: 'High', assigneeName: 'Alex', isEpic: false },
    }));

    render(<ImpactAnalysisView />);

    expect(screen.getByLabelText('Root issue')).toHaveTextContent('TBX-1');
    expect(screen.getByText('Root summary')).toBeInTheDocument();
    expect(screen.getByText('Story')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Alex')).toBeInTheDocument();
  });

  it('renders grouped inward and outward links in the required text format', () => {
    mockUseImpactAnalysisState.mockReturnValue(buildHookState({
      root: { key: 'TBX-1', summary: 'Root summary', statusName: 'In Progress', typeName: 'Story', priorityName: 'High', assigneeName: null, isEpic: false },
      outward: [buildLink('TBX-2', 'outward', 'blocks')],
      inward: [buildLink('TBX-3', 'inward', 'is blocked by')],
    }));

    render(<ImpactAnalysisView />);

    expect(screen.getByLabelText('Outward links')).toHaveTextContent('blocks: TBX-2 - TBX-2 summary [In Progress]');
    expect(screen.getByLabelText('Inward links')).toHaveTextContent('is blocked by: TBX-3 - TBX-3 summary [In Progress]');
  });

  it('renders Epic children with status pills', () => {
    mockUseImpactAnalysisState.mockReturnValue(buildHookState({
      root: { key: 'TBX-1', summary: 'Root summary', statusName: 'In Progress', typeName: 'Epic', priorityName: 'High', assigneeName: null, isEpic: true },
      children: [{ key: 'TBX-4', summary: 'Child summary', statusName: 'Done', statusCategoryKey: 'done' }],
    }));

    render(<ImpactAnalysisView />);

    expect(screen.getByLabelText('Children')).toHaveTextContent('TBX-4 - Child summary');
    expect(screen.getByLabelText('Children')).toHaveTextContent('Done');
  });

  it('renders stats footer counts', () => {
    mockUseImpactAnalysisState.mockReturnValue(buildHookState({
      root: { key: 'TBX-1', summary: 'Root summary', statusName: 'In Progress', typeName: 'Story', priorityName: 'High', assigneeName: null, isEpic: false },
      stats: buildStats({ totalRelated: 4, blockerCount: 2, openCount: 3, doneCount: 1 }),
    }));

    render(<ImpactAnalysisView />);

    expect(screen.getByLabelText('Impact stats')).toHaveTextContent('4Total related');
    expect(screen.getByLabelText('Impact stats')).toHaveTextContent('2Blockers');
    expect(screen.getByLabelText('Impact stats')).toHaveTextContent('3Open');
    expect(screen.getByLabelText('Impact stats')).toHaveTextContent('1Done');
  });
});
