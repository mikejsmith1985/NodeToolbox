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

    expect(screen.getByRole('option', { name: 'Person, acct-a (CTR)' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /acct-c/ })).toBeNull();
  });

  it('only offers fix versions that appear on this board', () => {
    render(<QuickFilterBar allItems={ALL_ITEMS} filters={EMPTY_QUICK_FILTER_STATE} onFiltersChange={vi.fn()} />);

    expect(screen.getByRole('option', { name: '26.4 ENCUC' })).toBeTruthy();
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

  it('states that filtering does not change what a Feature is worth', () => {
    render(<QuickFilterBar allItems={ALL_ITEMS} filters={EMPTY_QUICK_FILTER_STATE} onFiltersChange={vi.fn()} />);

    expect(screen.getByText(/always describe the whole Feature/)).toBeTruthy();
  });
});
