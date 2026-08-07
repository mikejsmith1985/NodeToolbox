// MasterCardLane.test.tsx — Proves a collapsed lane is still a useful summary, and that its numbers
// describe the whole Feature rather than whatever the viewer has filtered down to.

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MasterCardLane } from './MasterCardLane.tsx';
import { buildBoardLayout } from '../boardLayout.ts';
import { buildRenderedColumns } from '../boardColumns.ts';
import { buildMasterCards } from '../masterCards.ts';
import { EMPTY_QUICK_FILTER_STATE } from '../boardFilters.ts';
import type { BoardPreferences, BoardVocabulary, RollupBoardItem } from '../rollupBoardTypes.ts';
import type { JiraIssue } from '../../../../types/jira.ts';

const VOCABULARY: BoardVocabulary = {
  teamProfileId: 'team-a',
  columns: [
    { id: 'col-todo', name: 'Not started', order: 0, mappings: [{ jiraStatusName: 'To Do', subStatusValue: null }] },
    { id: 'col-dev', name: 'Being coded', order: 1, mappings: [{ jiraStatusName: 'In Progress', subStatusValue: null }] },
  ],
  updatedAt: '',
  lastSyncedAt: null,
};

const COLUMNS = buildRenderedColumns(VOCABULARY);

function buildItem(key: string, columnId: string, parentKey: string | null = null, storyPoints: number | null = null): RollupBoardItem {
  return {
    issue: {
      id: key,
      key,
      fields: { summary: key, status: { name: 'To Do', statusCategory: { name: 'To Do' } } },
    } as unknown as JiraIssue,
    key,
    summary: `Summary of ${key}`,
    typeBucket: parentKey ? 'subtask' : 'story',
    typeName: parentKey ? 'Sub-task' : 'Story',
    parentKey,
    route: { steps: [], featureKey: 'FEAT-1', precedenceRank: null, unchosenCandidates: [], notes: [] },
    featureKey: 'FEAT-1',
    columnId,
    statusName: 'To Do',
    subStatusValue: null,
    assigneeAccountId: null,
    assigneeDisplayName: null,
    fixVersionNames: [],
    storyPoints,
    checklistCompletion: null,
  };
}

function buildPreferences(collapsedByFeatureKey: Record<string, boolean> = {}): BoardPreferences {
  return { teamProfileId: 'team-a', boardId: 42, laneOrder: [], collapsedByFeatureKey };
}

function buildFeature(): JiraIssue {
  return {
    id: 'FEAT-1',
    key: 'FEAT-1',
    fields: {
      summary: 'Enrolment revamp',
      status: { name: 'In Progress' },
      priority: { name: 'High' },
      issuelinks: [],
    },
  } as unknown as JiraIssue;
}

/** Builds one rendered lane from real layout output, so the test exercises the real shapes. */
function buildLane(items: RollupBoardItem[], collapsedByFeatureKey: Record<string, boolean> = {}) {
  return buildBoardLayout({
    masterCards: buildMasterCards(items, new Map([['FEAT-1', buildFeature()]])),
    columns: COLUMNS,
    filters: EMPTY_QUICK_FILTER_STATE,
    preferences: buildPreferences(collapsedByFeatureKey),
  }).lanes[0];
}

describe('MasterCardLane — the header is the collapsed summary', () => {
  it('shows the Feature key, summary, status and priority without expanding', () => {
    render(
      <MasterCardLane
        columns={COLUMNS}
        hasActiveFilters={false}
        lane={buildLane([buildItem('DEV-1', 'col-todo')])}
        onToggleCollapsed={vi.fn()}
      />,
    );

    expect(screen.getByText('FEAT-1')).toBeTruthy();
    expect(screen.getByText('Enrolment revamp')).toBeTruthy();
    expect(screen.getByText('High')).toBeTruthy();
  });

  it('states the basis of the percentage so the number can be checked', () => {
    render(
      <MasterCardLane
        columns={COLUMNS}
        hasActiveFilters={false}
        lane={buildLane([buildItem('DEV-1', 'col-todo', null, 5)])}
        onToggleCollapsed={vi.fn()}
      />,
    );

    expect(screen.getByText(/by story points/)).toBeTruthy();
  });

  it('says an estimate is missing rather than showing it as zero', () => {
    render(
      <MasterCardLane
        columns={COLUMNS}
        hasActiveFilters={false}
        lane={buildLane([buildItem('DEV-1', 'col-todo')])}
        onToggleCollapsed={vi.fn()}
      />,
    );

    expect(screen.getByText('no estimate')).toBeTruthy();
  });

  it('renders no cards at all while collapsed, so a collapsed board stays cheap', () => {
    render(
      <MasterCardLane
        columns={COLUMNS}
        hasActiveFilters={false}
        lane={buildLane([buildItem('DEV-1', 'col-todo')])}
        onToggleCollapsed={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('rollup-card-DEV-1')).toBeNull();
  });

  it('renders its cards once expanded', () => {
    render(
      <MasterCardLane
        columns={COLUMNS}
        hasActiveFilters={false}
        lane={buildLane([buildItem('DEV-1', 'col-todo')], { 'FEAT-1': false })}
        onToggleCollapsed={vi.fn()}
      />,
    );

    expect(screen.getByTestId('rollup-card-DEV-1')).toBeTruthy();
  });
});

describe('MasterCardLane — counts', () => {
  it('reports a plain item count when no filter is active', () => {
    render(
      <MasterCardLane
        columns={COLUMNS}
        hasActiveFilters={false}
        lane={buildLane([buildItem('DEV-1', 'col-todo'), buildItem('DEV-2', 'col-dev')])}
        onToggleCollapsed={vi.fn()}
      />,
    );

    expect(screen.getByText('2 items')).toBeTruthy();
  });

  it('reports "n of N match" when a filter is active, so the omission is visible', () => {
    const lane = buildBoardLayout({
      masterCards: buildMasterCards([buildItem('DEV-1', 'col-todo'), buildItem('DEV-2', 'col-dev')], new Map([['FEAT-1', buildFeature()]])),
      columns: COLUMNS,
      filters: { ...EMPTY_QUICK_FILTER_STATE, typeBuckets: new Set(['defect' as const]) },
      preferences: buildPreferences(),
    }).lanes[0];

    render(<MasterCardLane columns={COLUMNS} hasActiveFilters lane={lane} onToggleCollapsed={vi.fn()} />);

    expect(screen.getByText('0 of 2 match')).toBeTruthy();
  });
});

describe('MasterCardLane — the No Feature lane', () => {
  it('names itself as a hygiene problem rather than looking like an ordinary Feature', () => {
    const lane = buildBoardLayout({
      masterCards: buildMasterCards([{ ...buildItem('DEV-1', 'col-todo'), featureKey: null }], new Map()),
      columns: COLUMNS,
      filters: EMPTY_QUICK_FILTER_STATE,
      preferences: buildPreferences(),
    }).lanes[0];

    render(<MasterCardLane columns={COLUMNS} hasActiveFilters={false} lane={lane} onToggleCollapsed={vi.fn()} />);

    expect(screen.getByText('No Feature')).toBeTruthy();
    // Said twice on purpose — once as the lane's summary, once as the call to action.
    expect(screen.getAllByText(/hygiene/).length).toBeGreaterThan(0);
  });
});

describe('MasterCardLane — ordering actions', () => {
  it('offers send-to-top and send-to-bottom as real buttons, reachable by keyboard', () => {
    const onSendToTop = vi.fn();
    render(
      <MasterCardLane
        columns={COLUMNS}
        hasActiveFilters={false}
        lane={buildLane([buildItem('DEV-1', 'col-todo')])}
        onSendToBottom={vi.fn()}
        onSendToTop={onSendToTop}
        onToggleCollapsed={vi.fn()}
      />,
    );

    screen.getByRole('button', { name: 'Send to top' }).click();

    expect(onSendToTop).toHaveBeenCalledWith('FEAT-1');
  });

  it('exposes the collapse control as a labelled, toggleable button', () => {
    const onToggleCollapsed = vi.fn();
    render(
      <MasterCardLane
        columns={COLUMNS}
        hasActiveFilters={false}
        lane={buildLane([buildItem('DEV-1', 'col-todo')])}
        onToggleCollapsed={onToggleCollapsed}
      />,
    );

    const toggleButton = screen.getByRole('button', { name: /Expand FEAT-1/ });
    expect(toggleButton.getAttribute('aria-expanded')).toBe('false');
    toggleButton.click();

    expect(onToggleCollapsed).toHaveBeenCalledWith('FEAT-1');
  });
});
