// QuickFilterBar.test.tsx — Proves the filters combine, clear in one action, and say what they do
// and do not affect.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { QuickFilterBar } from './QuickFilterBar.tsx';
import { EMPTY_QUICK_FILTER_STATE } from '../boardFilters.ts';
import type { RollupBoardItem } from '../rollupBoardTypes.ts';
import type { JiraIssue } from '../../../../types/jira.ts';

function buildItem(key: string, assigneeAccountId: string | null, fixVersionNames: string[]): RollupBoardItem {
  return {
    issue: { id: key, key, fields: { summary: key } } as unknown as JiraIssue,
    key,
    summary: key,
    typeBucket: 'story',
    typeName: 'Story',
    parentKey: null,
    route: { steps: [], featureKey: 'FEAT-1', precedenceRank: null, unchosenCandidates: [], notes: [] },
    featureKey: 'FEAT-1',
    columnId: 'col-todo',
    statusName: 'To Do',
    subStatusValue: null,
    assigneeAccountId,
    assigneeDisplayName: assigneeAccountId ? `Person, ${assigneeAccountId} (CTR)` : null,
    fixVersionNames,
    storyPoints: null,
    checklistCompletion: null,
    checklistItems: [],
    isFlagged: false,
  };
}

const ALL_ITEMS = [
  buildItem('DEV-1', 'acct-a', ['26.4 ENCUC']),
  buildItem('DEV-2', 'acct-b', ['26.5 ENCUC']),
  buildItem('DEV-3', null, []),
];

describe('QuickFilterBar', () => {
  it('offers exactly the three type filters the team asked for', () => {
    render(<QuickFilterBar allItems={ALL_ITEMS} filters={EMPTY_QUICK_FILTER_STATE} onFiltersChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Stories only' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Defects only' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sub-tasks only' })).toBeTruthy();
  });

  it('turns a type filter on without disturbing the others, so filters combine', () => {
    const onFiltersChange = vi.fn();
    render(
      <QuickFilterBar
        allItems={ALL_ITEMS}
        filters={{ ...EMPTY_QUICK_FILTER_STATE, assigneeAccountId: 'acct-a' }}
        onFiltersChange={onFiltersChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Defects only' }));

    const [nextFilters] = onFiltersChange.mock.calls[0];
    expect([...nextFilters.typeBuckets]).toEqual(['defect']);
    expect(nextFilters.assigneeAccountId).toBe('acct-a');
  });

  it('turns a type filter back off when it is pressed again', () => {
    const onFiltersChange = vi.fn();
    render(
      <QuickFilterBar
        allItems={ALL_ITEMS}
        filters={{ ...EMPTY_QUICK_FILTER_STATE, typeBuckets: new Set(['defect' as const]) }}
        onFiltersChange={onFiltersChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Defects only' }));

    expect([...onFiltersChange.mock.calls[0][0].typeBuckets]).toEqual([]);
  });

  it('only offers people who actually have work on this board', () => {
    render(<QuickFilterBar allItems={ALL_ITEMS} filters={EMPTY_QUICK_FILTER_STATE} onFiltersChange={vi.fn()} />);

    expect(screen.getByRole('option', { name: /^Person, acct-a \(CTR\) \(\d+\)$/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /acct-c/ })).toBeNull();
  });

  it('only offers fix versions that appear on this board', () => {
    render(<QuickFilterBar allItems={ALL_ITEMS} filters={EMPTY_QUICK_FILTER_STATE} onFiltersChange={vi.fn()} />);

    expect(screen.getByRole('option', { name: /^26\.4 ENCUC \(\d+\)$/ })).toBeTruthy();
  });

  it('clears every filter in one action', () => {
    const onFiltersChange = vi.fn();
    render(
      <QuickFilterBar
        allItems={ALL_ITEMS}
        filters={{ typeBuckets: new Set(['defect' as const]), assigneeAccountId: 'acct-a', fixVersionName: '26.4 ENCUC' }}
        onFiltersChange={onFiltersChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    const [clearedFilters] = onFiltersChange.mock.calls[0];
    expect(clearedFilters.typeBuckets.size).toBe(0);
    expect(clearedFilters.assigneeAccountId).toBeNull();
    expect(clearedFilters.fixVersionName).toBeNull();
  });

  it('stays quiet about filtering until something is actually filtered', () => {
    render(<QuickFilterBar allItems={ALL_ITEMS} filters={EMPTY_QUICK_FILTER_STATE} onFiltersChange={vi.fn()} />);

    expect(screen.queryByText(/describe the whole Feature/)).toBeNull();
    // Nothing to clear either, so the control that would do nothing is not offered.
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });

  it('states that filtering does not change what a Feature is worth, once one is on', () => {
    render(<QuickFilterBar
      allItems={ALL_ITEMS}
      filters={{ ...EMPTY_QUICK_FILTER_STATE, typeBuckets: new Set(['defect' as const]) }}
      onFiltersChange={vi.fn()}
    />);

    expect(screen.getByText(/describe the whole Feature/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
  });
});

describe('QuickFilterBar — people on a Jira Data Center instance', () => {
  it('offers everyone with work on the board, however Jira identifies them', () => {
    // On Data Center a user has no accountId, so the identifier is their username. The filter must
    // still list them — it was showing only "Anyone" because nobody resolved.
    const dataCentreItems = [
      buildItem('DEV-1', 'jsmith', []),
      buildItem('DEV-2', 'JIRAUSER99', []),
    ];

    render(<QuickFilterBar allItems={dataCentreItems} filters={EMPTY_QUICK_FILTER_STATE} onFiltersChange={vi.fn()} />);

    expect(screen.getByRole('option', { name: /^Person, jsmith \(CTR\) \(\d+\)$/ })).toBeTruthy();
    expect(screen.getByRole('option', { name: /^Person, JIRAUSER99 \(CTR\) \(\d+\)$/ })).toBeTruthy();
  });

  it('offers only Anyone when nothing on the board is assigned', () => {
    render(
      <QuickFilterBar
        allItems={[buildItem('DEV-1', null, [])]}
        filters={EMPTY_QUICK_FILTER_STATE}
        onFiltersChange={vi.fn()}
      />,
    );

    const assigneeOptions = screen.getAllByRole('option').filter((option) => /Anyone|Person/.test(option.textContent ?? ''));
    expect(assigneeOptions.map((option) => option.textContent)).toEqual(['Anyone']);
  });
});

describe('QuickFilterBar — telling the two fix-version controls apart', () => {
  /** Three items: two carry the release the scope named, one carries a version from outside it. */
  const MIXED_ITEMS = [
    buildItem('DEV-1', 'acct-a', ['08/27/2026']),
    buildItem('DEV-2', 'acct-a', ['08/27/2026']),
    buildItem('DEV-3', 'acct-b', ['4/29/2025']),
  ];

  it('puts the busiest first, so the long tail reads as a tail', () => {
    // The board deliberately pulls in every child of every Feature it draws, whatever scope those
    // children are in — so a shared Feature brings other teams' versions and people with it.
    // Alphabetical that reads like a directory of the instance; by count it reads like a board.
    render(<QuickFilterBar allItems={MIXED_ITEMS} filters={EMPTY_QUICK_FILTER_STATE} onFiltersChange={vi.fn()} />);

    const versionOptions = screen.getAllByRole('option').map((option) => option.textContent?.trim());
    expect(versionOptions).toContain('08/27/2026 (2)');
    expect(versionOptions.indexOf('08/27/2026 (2)')).toBeLessThan(versionOptions.indexOf('4/29/2025 (1)'));
  });

  it('names itself for what it does, so it cannot be read as a second scope', () => {
    render(
      <QuickFilterBar
        allItems={MIXED_ITEMS}
        filters={EMPTY_QUICK_FILTER_STATE}
        onFiltersChange={vi.fn()}
        scopeDescription="PI 26.4"
      />,
    );

    expect(screen.getByTitle(/Narrows what is already on the board \(PI 26\.4\)/)).toBeTruthy();
    expect(screen.getByText(/Fix version on the board/)).toBeTruthy();
  });

  it('says what the scope still is while a filter is on', () => {
    render(
      <QuickFilterBar
        allItems={MIXED_ITEMS}
        filters={{ ...EMPTY_QUICK_FILTER_STATE, fixVersionName: '4/29/2025' }}
        onFiltersChange={vi.fn()}
        scopeDescription="PI 26.4"
      />,
    );

    expect(screen.getByText(/Scope is still PI 26\.4/)).toBeTruthy();
  });
});
