// BoardColumnHeaderRow.tsx — The single column header row shared by every swimlane.
//
// There is one row for the whole board rather than one per lane, so a column stays in the same place
// all the way down. That alignment is what lets someone read a single column top to bottom and see
// everything in that state across every Feature — the view a per-lane board cannot give.

import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { DEFAULT_COLUMN_DENSITY, readColumnMinWidth } from '../columnDensity.ts';
import styles from '../RollupBoardTab.module.css';
import { UNMAPPED_COLUMN_ID, type RenderedColumn } from '../rollupBoardTypes.ts';

export interface BoardColumnHeaderRowProps {
  columns: readonly RenderedColumn[];
  /** How many issues each column is currently holding, keyed by column id. */
  issueCountByColumnId?: Record<string, number>;
  /** Reorders the team's columns by dragging their headers. Omitted on a read-only board. */
  onReorderColumns?: (orderedColumnIds: string[]) => void;
  /** The column currently opened to the full board width, or null when every column is shown. */
  focusedColumnId?: string | null;
  /** Double-clicking a header focuses that column, or restores every column when it already is. */
  onToggleFocus?: (columnId: string) => void;
  /** The CSS width one column may shrink to, from the team's density setting. */
  columnMinWidth?: string;
}

/** One draggable column header. Unmapped is fixed in place — it is not the team's column to move. */
function SortableColumnHeader({
  column,
  issueCount,
  isReorderable,
  isFocused,
  onToggleFocus,
}: {
  column: RenderedColumn;
  issueCount: number;
  isReorderable: boolean;
  isFocused: boolean;
  onToggleFocus?: (columnId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: column.id,
    disabled: !isReorderable,
  });

  const mappingSummary = column.mappings
    .map((mapping) => mapping.subStatusValue
      ? `${mapping.jiraStatusName} / ${mapping.subStatusValue}`
      : mapping.jiraStatusName)
    .join(' · ');

  return (
    <div
      className={[
        styles.columnHeader,
        column.isUnmappedColumn ? styles.columnHeaderUnmapped : '',
        isFocused ? styles.columnHeaderFocused : '',
      ].filter(Boolean).join(' ')}
      ref={setNodeRef}
      // Double-click opens this column to the full board width. The drag sensor needs 4px of travel
      // to engage, so a double-click that does not move never starts a reorder.
      onDoubleClick={() => onToggleFocus?.(column.id)}
      title={isFocused
        ? 'Double-click to show every column again'
        : 'Double-click to focus this column across the whole board'}
      style={{ transform: CSS.Transform.toString(transform), transition, cursor: isReorderable ? 'grab' : 'default' }}
      {...(isReorderable ? listeners : {})}
      {...(isReorderable ? attributes : {})}
      aria-label={isReorderable ? `Drag ${column.name} to reorder the columns` : column.name}
    >
      <span>
        {column.name} <span className={styles.columnHeaderMeta}>{issueCount}</span>
      </span>
      {/* A Jira column stands for several statuses, so the header lists them rather than one. */}
      {column.mappings.length > 0 && <span className={styles.columnHeaderMeta}>{mappingSummary}</span>}
      {column.mappings.length === 0 && !column.isUnmappedColumn && (
        <span className={styles.columnHeaderMeta}>not mapped yet</span>
      )}
    </div>
  );
}

/**
 * Builds the shared grid template so headers and every lane's cells line up exactly.
 *
 * The width comes from the board's OWN density setting. It used to borrow the app's form-control
 * token, which at up to 192px a column meant twelve columns needed 2,300px of screen — and the only
 * way to see the whole board was to zoom the browser out to 80%.
 */
/** Used when a caller does not pass a width — the same default the density setting starts at. */
const DEFAULT_COLUMN_MIN_WIDTH = readColumnMinWidth(DEFAULT_COLUMN_DENSITY);

export function buildColumnGridTemplate(columnCount: number, columnMinWidth: string = DEFAULT_COLUMN_MIN_WIDTH): string {
  return `repeat(${columnCount}, minmax(${columnMinWidth}, 1fr))`;
}

/**
 * The width the board needs before its columns start being squeezed.
 *
 * Set on the header row AND on every lane's cells so all of them overflow together and stay aligned.
 * Without it the tracks quietly compress to fit the window and the last column becomes unreachable,
 * because the scroller has nothing wider than itself to scroll.
 *
 * It must be a plain minimum, never `width: max-content`: with `1fr` tracks that sizes each track to
 * its own content, so a lane holding cards and an empty lane end up with different column widths.
 */
export function buildColumnRowMinWidth(columnCount: number, columnMinWidth: string = DEFAULT_COLUMN_MIN_WIDTH): string {
  return `calc(${columnCount} * ${columnMinWidth}`
    + ` + ${Math.max(columnCount - 1, 0)} * var(--spacing-xs))`;
}

/** Renders the board-level column headers, draggable into the order the team wants. */
export function BoardColumnHeaderRow({
  columns,
  issueCountByColumnId = {},
  onReorderColumns,
  focusedColumnId = null,
  onToggleFocus,
  columnMinWidth = DEFAULT_COLUMN_MIN_WIDTH,
}: BoardColumnHeaderRowProps) {
  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const teamColumnIds = columns.filter((column) => !column.isUnmappedColumn).map((column) => column.id);

  /** Moves the dragged column to where the one it was dropped on currently sits. */
  function handleDragEnd(dragEndEvent: DragEndEvent): void {
    const draggedId = String(dragEndEvent.active.id);
    const targetId = dragEndEvent.over ? String(dragEndEvent.over.id) : null;
    if (!onReorderColumns || targetId === null || draggedId === targetId) return;
    if (targetId === UNMAPPED_COLUMN_ID) return;

    const withoutDragged = teamColumnIds.filter((columnId) => columnId !== draggedId);
    const targetIndex = withoutDragged.indexOf(targetId);
    if (targetIndex < 0) return;

    onReorderColumns([
      ...withoutDragged.slice(0, targetIndex),
      draggedId,
      ...withoutDragged.slice(targetIndex),
    ]);
  }

  return (
    <DndContext onDragEnd={handleDragEnd} sensors={dragSensors}>
      <SortableContext items={teamColumnIds} strategy={horizontalListSortingStrategy}>
        <div
          className={styles.columnHeaderRow}
          data-testid="rollup-column-header-row"
          style={{
            gridTemplateColumns: buildColumnGridTemplate(columns.length, columnMinWidth),
            minWidth: buildColumnRowMinWidth(columns.length, columnMinWidth),
          }}
        >
          {columns.map((column) => (
            <SortableColumnHeader
              column={column}
              isFocused={focusedColumnId === column.id}
              isReorderable={Boolean(onReorderColumns) && !column.isUnmappedColumn}
              issueCount={issueCountByColumnId[column.id] ?? 0}
              key={column.id}
              onToggleFocus={onToggleFocus}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
