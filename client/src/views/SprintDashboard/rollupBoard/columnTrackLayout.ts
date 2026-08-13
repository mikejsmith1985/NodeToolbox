// columnTrackLayout.ts — How wide each column is, worked out once for the whole board.
//
// The board's most load-bearing property is that the single column header row and every lane's cells
// line up exactly. Break that and the view stops being worth having: reading one column top to bottom
// across every Feature is the whole reason this board exists.
//
// Until now three components each built their own grid template from the same inputs and were
// expected to agree. They did — but only because the inputs were simple. Collapsible columns makes
// the calculation per-column, and three copies of a per-column calculation is three chances to
// disagree. So it is done ONCE here and the result is handed to all three, which makes them agree by
// construction rather than by care.
//
// A collapsed column is NARROWED, never removed. Twelve columns is what forces horizontal scrolling,
// and several of them routinely hold nothing — but a column that vanished when it emptied would break
// the alignment above, and hide work the moment somebody moved an issue into it.

/** How wide a collapsed column is: enough for its count and a chevron, and nothing else. */
export const COLLAPSED_COLUMN_WIDTH = '40px';

/** The two values that must always be derived together, or the header stops lining up with its cells. */
export interface ColumnTrackStyle {
  /** The grid template shared by the header row and every lane. */
  gridTemplateColumns: string;
  /** The width the board needs before its columns start being squeezed. */
  minWidth: string;
}

/** Whether this column is currently narrowed. An absent list means nothing is. */
export function isColumnCollapsed(collapsedColumnIds: readonly string[] | undefined, columnId: string): boolean {
  return (collapsedColumnIds ?? []).includes(columnId);
}

/** Narrows an open column, or opens a narrowed one, leaving every other column alone. */
export function toggleColumnCollapsed(
  collapsedColumnIds: readonly string[] | undefined,
  columnId: string,
): string[] {
  const current = collapsedColumnIds ?? [];
  return current.includes(columnId)
    ? current.filter((existingId) => existingId !== columnId)
    : [...current, columnId];
}

/**
 * The grid template and minimum width for this set of columns.
 *
 * `minWidth` must never be `width: max-content`: with `1fr` tracks that sizes each track to ITS OWN
 * content, so a lane holding cards gets wide columns, an empty lane gets narrow ones, and no lane
 * lines up with the header. It is a plain minimum instead — and it must be stated, or the tracks
 * quietly compress to fit the window and the last column becomes unreachable, because the scroller
 * has nothing wider than itself to scroll.
 *
 * The gap count follows the COLUMN count, not the expanded count: a collapsed column still sits in
 * the grid with a gap on either side of it. It is narrower, not absent.
 */
export function buildColumnTracks(
  columns: readonly { id: string }[],
  collapsedColumnIds: ReadonlySet<string>,
  columnMinWidth: string,
): ColumnTrackStyle {
  const columnList = columns ?? [];
  const isCollapsed = (columnId: string): boolean => collapsedColumnIds?.has(columnId) ?? false;

  const gridTemplateColumns = columnList
    .map((column) => (isCollapsed(column.id) ? COLLAPSED_COLUMN_WIDTH : `minmax(${columnMinWidth}, 1fr)`))
    .join(' ');

  const collapsedCount = columnList.filter((column) => isCollapsed(column.id)).length;
  const expandedCount = columnList.length - collapsedCount;
  const gapCount = Math.max(columnList.length - 1, 0);

  return {
    gridTemplateColumns,
    minWidth: `calc(${expandedCount} * ${columnMinWidth}`
      + ` + ${collapsedCount} * ${COLLAPSED_COLUMN_WIDTH}`
      + ` + ${gapCount} * var(--spacing-xs))`,
  };
}
