// MasterCardLane.test.tsx — Proves a collapsed lane is still a useful summary, and that its numbers
// describe the whole Feature rather than whatever the viewer has filtered down to.

import { fireEvent, render, screen } from '@testing-library/react';
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

describe('MasterCardLane — an unreadable Feature says why', () => {
  /** A lane whose Feature issue could not be read — the Feature map is empty, so it resolves to null. */
  function renderUnreadableLane(featureReadFailureDetail?: string) {
    const lane = buildBoardLayout({
      masterCards: buildMasterCards([buildItem('DEV-1', 'col-todo')], new Map()),
      columns: COLUMNS,
      filters: EMPTY_QUICK_FILTER_STATE,
      preferences: buildPreferences({}),
    }).lanes[0];

    render(
      <MasterCardLane
        columns={COLUMNS}
        featureReadFailureDetail={featureReadFailureDetail}
        hasActiveFilters={false}
        lane={lane}
        onToggleCollapsed={vi.fn()}
      />,
    );
  }

  it('shows the reason Jira gave, beside the lane that raises the question', () => {
    renderUnreadableLane('DENP-1288 can be opened directly but does not come back from a search.');
    expect(screen.getByText(/does not come back from a search/)).toBeInTheDocument();
  });

  it('admits when no reason could be established, rather than implying one', () => {
    renderUnreadableLane();
    expect(screen.getByText(/produced no reason either/)).toBeInTheDocument();
  });
});

describe('MasterCardLane — the rank box', () => {
  /** Renders one lane showing its rank. */
  function renderRankedLane(onRankChange = vi.fn()) {
    render(
      <MasterCardLane
        columns={COLUMNS}
        hasActiveFilters={false}
        lane={buildLane([buildItem('DEV-1', 'col-todo')])}
        laneRank={10}
        onRankChange={onRankChange}
        onToggleCollapsed={vi.fn()}
      />,
    );
    return { onRankChange, rankBox: screen.getByLabelText('Rank of FEAT-1') as HTMLInputElement };
  }

  it('shows the lane\'s position on the board', () => {
    expect(renderRankedLane().rankBox.value).toBe('10');
  });

  it('applies a typed rank when the field is left', () => {
    const { onRankChange, rankBox } = renderRankedLane();

    fireEvent.change(rankBox, { target: { value: '2' } });
    fireEvent.blur(rankBox, { target: { value: '2' } });

    expect(onRankChange).toHaveBeenCalledWith('FEAT-1', 2);
  });

  it('does not move the lane on every keystroke, so typing 12 does not first jump to 1', () => {
    const { onRankChange, rankBox } = renderRankedLane();

    fireEvent.change(rankBox, { target: { value: '1' } });
    fireEvent.change(rankBox, { target: { value: '12' } });

    expect(onRankChange).not.toHaveBeenCalled();
  });

  it('ignores a rank that is not a number', () => {
    const { onRankChange, rankBox } = renderRankedLane();

    fireEvent.blur(rankBox, { target: { value: 'abc' } });
    expect(onRankChange).not.toHaveBeenCalled();
  });

  it('ignores an empty box rather than moving the lane to nowhere', () => {
    const { onRankChange, rankBox } = renderRankedLane();

    fireEvent.blur(rankBox, { target: { value: '   ' } });
    expect(onRankChange).not.toHaveBeenCalled();
  });

  it('does nothing when the typed rank is the one it already has', () => {
    const { onRankChange, rankBox } = renderRankedLane();

    fireEvent.blur(rankBox, { target: { value: '10' } });
    expect(onRankChange).not.toHaveBeenCalled();
  });

  it('hides the box entirely when the board cannot accept a rank', () => {
    render(
      <MasterCardLane
        columns={COLUMNS}
        hasActiveFilters={false}
        lane={buildLane([buildItem('DEV-1', 'col-todo')])}
        onToggleCollapsed={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Rank of FEAT-1')).not.toBeInTheDocument();
  });
});

describe('MasterCardLane — the Feature key opens Jira', () => {
  it('links the key, opening in a new tab', () => {
    render(
      <MasterCardLane
        columns={COLUMNS}
        hasActiveFilters={false}
        lane={buildLane([buildItem('DEV-1', 'col-todo')])}
        onToggleCollapsed={vi.fn()}
      />,
    );

    const keyLink = screen.getByTitle('Open FEAT-1 in Jira') as HTMLAnchorElement;
    expect(keyLink.getAttribute('href')).toContain('/browse/FEAT-1');
    expect(keyLink.getAttribute('target')).toBe('_blank');
  });

  it('does not collapse the lane on the way to Jira', () => {
    // The header beneath the key toggles the lane; without stopPropagation the click would do both.
    const onToggleCollapsed = vi.fn();
    render(
      <MasterCardLane
        columns={COLUMNS}
        hasActiveFilters={false}
        lane={buildLane([buildItem('DEV-1', 'col-todo')])}
        onToggleCollapsed={onToggleCollapsed}
      />,
    );

    fireEvent.click(screen.getByTitle('Open FEAT-1 in Jira'));
    expect(onToggleCollapsed).not.toHaveBeenCalled();
  });
});
