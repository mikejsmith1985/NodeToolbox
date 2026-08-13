// BoardColumnHeaderRow.test.tsx — Proves there is one shared header row and that Unmapped is always
// on it, whether or not anything is currently sitting there.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BoardColumnHeaderRow } from './BoardColumnHeaderRow.tsx';
import { buildRenderedColumns } from '../boardColumns.ts';
import { buildColumnTracks } from '../columnTrackLayout.ts';
import { UNMAPPED_COLUMN_ID, type BoardVocabulary } from '../rollupBoardTypes.ts';

/** The tracks the board itself builds — the header row no longer derives its own. */
function buildTracksFor(vocabulary: BoardVocabulary, collapsedColumnIds: string[] = []) {
  return buildColumnTracks(buildRenderedColumns(vocabulary), new Set(collapsedColumnIds), '136px');
}

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
    render(<BoardColumnHeaderRow columnTracks={buildTracksFor(VOCABULARY)} columns={buildRenderedColumns(VOCABULARY)} />);

    const headerTexts = screen.getByTestId('rollup-column-header-row').textContent ?? '';
    expect(headerTexts.indexOf('Not started')).toBeLessThan(headerTexts.indexOf('Being coded'));
  });

  it('shows which Jira state each column stands for, so the mapping is checkable at a glance', () => {
    render(<BoardColumnHeaderRow columnTracks={buildTracksFor(VOCABULARY)} columns={buildRenderedColumns(VOCABULARY)} />);

    expect(screen.getByText(/In Progress \/ Dev In Progress/)).toBeTruthy();
  });

  it('always shows the Unmapped column, so an unclaimed state has somewhere visible to go', () => {
    render(<BoardColumnHeaderRow
      columnTracks={buildTracksFor({ ...VOCABULARY, columns: [] })}
      columns={buildRenderedColumns({ ...VOCABULARY, columns: [] })}
    />);

    expect(screen.getByText('Unmapped')).toBeTruthy();
  });

  it('lays every column out on one shared grid, which is what keeps lanes aligned', () => {
    render(<BoardColumnHeaderRow columnTracks={buildTracksFor(VOCABULARY)} columns={buildRenderedColumns(VOCABULARY)} />);

    const headerRow = screen.getByTestId('rollup-column-header-row');
    expect(headerRow.style.gridTemplateColumns).toBe(buildTracksFor(VOCABULARY).gridTemplateColumns);
  });

  it('counts the Unmapped column in the grid template', () => {
    expect(buildTracksFor(VOCABULARY).gridTemplateColumns.split(' minmax')).toHaveLength(3);
  });

  it('marks the Unmapped column so it reads differently from a column the team chose', () => {
    render(<BoardColumnHeaderRow columnTracks={buildTracksFor(VOCABULARY)} columns={buildRenderedColumns(VOCABULARY)} />);

    const unmappedColumn = buildRenderedColumns(VOCABULARY).find((column) => column.id === UNMAPPED_COLUMN_ID);
    expect(unmappedColumn?.isUnmappedColumn).toBe(true);
  });
});

describe('the header row lays itself out from one board-wide calculation', () => {
  it('takes both grid values from the tracks it was given, never deriving its own', () => {
    // This is the board's most load-bearing property: the header row and every lane's cells must
    // line up exactly, or reading a column top to bottom stops meaning anything. Three components
    // used to derive this separately and agree by care; now they cannot disagree.
    const columnTracks = buildTracksFor(VOCABULARY, ['col-dev']);
    render(<BoardColumnHeaderRow columnTracks={columnTracks} columns={buildRenderedColumns(VOCABULARY)} />);

    const headerRow = screen.getByTestId('rollup-column-header-row');
    expect(headerRow.style.gridTemplateColumns).toBe(columnTracks.gridTemplateColumns);
    expect(headerRow.style.minWidth).toBe(columnTracks.minWidth);
  });

  it('sizes from the board own density setting, not the app form-control token', () => {
    // The regression this guards: at up to 192px per column, twelve columns needed 2,300px of screen
    // and the only way to see the whole board was to zoom the browser out to 80%.
    const columnTracks = buildTracksFor(VOCABULARY);
    expect(columnTracks.minWidth).not.toContain('--layout-control-min-width');
    expect(columnTracks.gridTemplateColumns).not.toContain('--layout-control-min-width');
  });

  it('is a MINIMUM, never max-content — which would size each track to its own content', () => {
    // The regression this guards: `width: max-content` on a `1fr` grid gave a lane holding cards
    // different column widths from an empty lane, so no lane aligned with the header row.
    expect(buildTracksFor(VOCABULARY).minWidth).not.toContain('max-content');
  });
});

describe('narrowing a column', () => {
  it('offers a control that names the column it narrows', () => {
    render(
      <BoardColumnHeaderRow
        columnTracks={buildTracksFor(VOCABULARY)}
        columns={buildRenderedColumns(VOCABULARY)}
        onToggleCollapsed={() => undefined}
      />,
    );

    expect(screen.getByRole('button', { name: 'Narrow the Being coded column' })).toBeTruthy();
  });

  it('asks for the column to be narrowed without also focusing or reordering it', () => {
    const collapseRequests: string[] = [];
    render(
      <BoardColumnHeaderRow
        columnTracks={buildTracksFor(VOCABULARY)}
        columns={buildRenderedColumns(VOCABULARY)}
        onToggleCollapsed={(columnId) => collapseRequests.push(columnId)}
        onToggleFocus={() => { throw new Error('narrowing must not focus the column'); }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Narrow the Being coded column' }));

    expect(collapseRequests).toEqual(['col-dev']);
  });

  it('keeps a narrowed column present and counted, rather than hiding its work', () => {
    render(
      <BoardColumnHeaderRow
        collapsedColumnIds={['col-dev']}
        columnTracks={buildTracksFor(VOCABULARY, ['col-dev'])}
        columns={buildRenderedColumns(VOCABULARY)}
        issueCountByColumnId={{ 'col-dev': 7 }}
        onToggleCollapsed={() => undefined}
      />,
    );

    // The name goes, the COUNT never does — a narrowed column still says how much is in it.
    expect(screen.queryByText('Being coded')).toBeNull();
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open the Being coded column' })).toBeTruthy();
  });
});

describe('focusing a column', () => {
  it('asks for the double-clicked column to be focused', () => {
    const focusRequests: string[] = [];
    render(
      <BoardColumnHeaderRow
        columnTracks={buildTracksFor(VOCABULARY)} columns={buildRenderedColumns(VOCABULARY)}
        onToggleFocus={(columnId) => focusRequests.push(columnId)}
      />,
    );

    fireEvent.doubleClick(screen.getByText('Being coded'));

    expect(focusRequests).toEqual(['col-dev']);
  });

  it('tells the user how to get every column back once one is focused', () => {
    render(<BoardColumnHeaderRow columnTracks={buildTracksFor(VOCABULARY)} columns={buildRenderedColumns(VOCABULARY)} focusedColumnId="col-dev" />);

    expect(screen.getByTitle(/Double-click to show every column again/)).toBeTruthy();
  });
});
