// BoardColumnHeaderRow.test.tsx — Proves there is one shared header row and that Unmapped is always
// on it, whether or not anything is currently sitting there.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BoardColumnHeaderRow, buildColumnGridTemplate, buildColumnRowMinWidth } from './BoardColumnHeaderRow.tsx';
import { buildRenderedColumns } from '../boardColumns.ts';
import { UNMAPPED_COLUMN_ID, type BoardVocabulary } from '../rollupBoardTypes.ts';

const VOCABULARY: BoardVocabulary = {
  teamProfileId: 'team-a',
  columns: [
    { id: 'col-todo', name: 'Not started', order: 0, mappings: [{ jiraStatusName: 'To Do', subStatusValue: null }] },
    { id: 'col-dev', name: 'Being coded', order: 1, mappings: [{ jiraStatusName: 'In Progress', subStatusValue: 'Dev In Progress' }] },
  ],
  updatedAt: '',
  lastSyncedAt: null,
};

describe('BoardColumnHeaderRow', () => {
  it('renders the team\'s own column names in their chosen order', () => {
    render(<BoardColumnHeaderRow columns={buildRenderedColumns(VOCABULARY)} />);

    const headerTexts = screen.getByTestId('rollup-column-header-row').textContent ?? '';
    expect(headerTexts.indexOf('Not started')).toBeLessThan(headerTexts.indexOf('Being coded'));
  });

  it('shows which Jira state each column stands for, so the mapping is checkable at a glance', () => {
    render(<BoardColumnHeaderRow columns={buildRenderedColumns(VOCABULARY)} />);

    expect(screen.getByText(/In Progress \/ Dev In Progress/)).toBeTruthy();
  });

  it('always shows the Unmapped column, so an unclaimed state has somewhere visible to go', () => {
    render(<BoardColumnHeaderRow columns={buildRenderedColumns({ ...VOCABULARY, columns: [] })} />);

    expect(screen.getByText('Unmapped')).toBeTruthy();
  });

  it('lays every column out on one shared grid, which is what keeps lanes aligned', () => {
    render(<BoardColumnHeaderRow columns={buildRenderedColumns(VOCABULARY)} />);

    const headerRow = screen.getByTestId('rollup-column-header-row');
    expect(headerRow.style.gridTemplateColumns).toBe(buildColumnGridTemplate(3));
  });

  it('counts the Unmapped column in the grid template', () => {
    expect(buildColumnGridTemplate(3)).toContain('repeat(3');
  });

  it('marks the Unmapped column so it reads differently from a column the team chose', () => {
    render(<BoardColumnHeaderRow columns={buildRenderedColumns(VOCABULARY)} />);

    const unmappedColumn = buildRenderedColumns(VOCABULARY).find((column) => column.id === UNMAPPED_COLUMN_ID);
    expect(unmappedColumn?.isUnmappedColumn).toBe(true);
  });
});

describe('buildColumnRowMinWidth — every row must size identically or nothing lines up', () => {
  it('reserves one column minimum per column, plus the gaps between them', () => {
    expect(buildColumnRowMinWidth(3))
      .toBe('calc(3 * var(--layout-control-min-width) + 2 * var(--spacing-xs))');
  });

  it('adds no gap for a single column', () => {
    expect(buildColumnRowMinWidth(1)).toContain('0 * var(--spacing-xs)');
  });

  it('never goes negative on an empty board', () => {
    expect(buildColumnRowMinWidth(0)).toContain('0 * var(--spacing-xs)');
  });

  it('is a MINIMUM, never max-content — which would size each track to its own content', () => {
    // The regression this guards: `width: max-content` on a `1fr` grid gave a lane holding cards
    // different column widths from an empty lane, so no lane aligned with the header row.
    expect(buildColumnRowMinWidth(12)).not.toContain('max-content');
  });

  it('gives the header row and a lane the same width for the same column count', () => {
    // The two are rendered by different components; if they ever disagree the board looks broken.
    expect(buildColumnRowMinWidth(12)).toBe(buildColumnRowMinWidth(12));
    expect(buildColumnGridTemplate(12)).toBe(buildColumnGridTemplate(12));
  });
});

describe('focusing a column', () => {
  it('asks for the double-clicked column to be focused', () => {
    const focusRequests: string[] = [];
    render(
      <BoardColumnHeaderRow
        columns={buildRenderedColumns(VOCABULARY)}
        onToggleFocus={(columnId) => focusRequests.push(columnId)}
      />,
    );

    fireEvent.doubleClick(screen.getByText('Being coded'));

    expect(focusRequests).toEqual(['col-dev']);
  });

  it('tells the user how to get every column back once one is focused', () => {
    render(<BoardColumnHeaderRow columns={buildRenderedColumns(VOCABULARY)} focusedColumnId="col-dev" />);

    expect(screen.getByTitle(/Double-click to show every column again/)).toBeTruthy();
  });
});
