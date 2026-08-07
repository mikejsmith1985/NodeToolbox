// BoardColumnHeaderRow.test.tsx — Proves there is one shared header row and that Unmapped is always
// on it, whether or not anything is currently sitting there.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BoardColumnHeaderRow, buildColumnGridTemplate } from './BoardColumnHeaderRow.tsx';
import { buildRenderedColumns } from '../boardColumns.ts';
import { UNMAPPED_COLUMN_ID, type BoardVocabulary } from '../rollupBoardTypes.ts';

const VOCABULARY: BoardVocabulary = {
  teamProfileId: 'team-a',
  columns: [
    { id: 'col-todo', name: 'Not started', order: 0, mapping: { jiraStatusName: 'To Do', subStatusValue: null } },
    { id: 'col-dev', name: 'Being coded', order: 1, mapping: { jiraStatusName: 'In Progress', subStatusValue: 'Dev In Progress' } },
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
