// ParentContainer.test.tsx — Proves the grouping label reads as a label, not as another issue.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ParentContainer } from './ParentContainer.tsx';
import type { ParentContainer as ParentContainerModel, RollupBoardItem } from '../rollupBoardTypes.ts';
import type { JiraIssue } from '../../../../types/jira.ts';

function buildItem(key: string): RollupBoardItem {
  return {
    issue: { id: key, key, fields: { summary: key } } as unknown as JiraIssue,
    key,
    summary: `Summary of ${key}`,
    typeBucket: 'subtask',
    typeName: 'Sub-task',
    parentKey: 'DEV-1',
    route: { steps: [{ kind: 'parent', toKey: 'DEV-1' }], featureKey: 'FEAT-1', precedenceRank: null, unchosenCandidates: [], notes: [] },
    featureKey: 'FEAT-1',
    columnId: 'col-todo',
    statusName: 'To Do',
    subStatusValue: null,
    assigneeAccountId: null,
    assigneeDisplayName: null,
    fixVersionNames: [],
    storyPoints: null,
    checklistCompletion: null,
    checklistItems: [],
    isFlagged: false,
    impedimentReasons: [],
  };
}

function buildContainer(overrides: Partial<ParentContainerModel> = {}): ParentContainerModel {
  return {
    parentKey: 'DEV-1',
    parentSummary: 'Add the eligibility rule',
    isParentInScope: true,
    items: [buildItem('DEV-1-1')],
    ...overrides,
  };
}

describe('ParentContainer', () => {
  it('heads the group with the parent key and summary', () => {
    render(<ParentContainer container={buildContainer()} />);

    expect(screen.getByText('DEV-1')).toBeTruthy();
    expect(screen.getByText('Add the eligibility rule')).toBeTruthy();
  });

  it('renders the children that fall in this column', () => {
    render(<ParentContainer container={buildContainer({ items: [buildItem('DEV-1-1'), buildItem('DEV-1-2')] })} />);

    expect(screen.getByTestId('rollup-card-DEV-1-1')).toBeTruthy();
    expect(screen.getByTestId('rollup-card-DEV-1-2')).toBeTruthy();
  });

  it('is not itself a card, so a reader cannot mistake the header for an extra issue', () => {
    render(<ParentContainer container={buildContainer()} />);

    // Exactly one card is rendered here — the child. The parent header is a label.
    expect(screen.getAllByTestId(/^rollup-card-/)).toHaveLength(1);
    expect(screen.queryByTestId('rollup-card-DEV-1')).toBeNull();
  });

  it('says plainly when the parent is not on this board', () => {
    render(<ParentContainer container={buildContainer({ isParentInScope: false })} />);

    expect(screen.getByText('not on this board')).toBeTruthy();
  });
});

describe('ParentContainer — a contained card is still a card', () => {
  it('gives its nested cards the same right-click menu a loose card gets', () => {
    // The bug this pins: the container rendered its cards without the action props, so every
    // sub-task inside one had an EMPTY menu — its right-click never called preventDefault and the
    // BROWSER's context menu appeared instead. A container is a grouping label, not a kind of card.
    render(
      <ParentContainer
        container={buildContainer()}
        onToggleFlag={vi.fn()}
      />,
    );

    fireEvent.contextMenu(screen.getByTestId('rollup-card-DEV-1-1'));

    expect(screen.getByRole('menuitem', { name: /Flag as an impediment/ })).toBeTruthy();
  });

  it('lets the browser have the menu only when there is genuinely nothing to offer', () => {
    render(<ParentContainer container={buildContainer()} />);

    fireEvent.contextMenu(screen.getByTestId('rollup-card-DEV-1-1'));

    expect(screen.queryByRole('menu')).toBeNull();
  });
});
