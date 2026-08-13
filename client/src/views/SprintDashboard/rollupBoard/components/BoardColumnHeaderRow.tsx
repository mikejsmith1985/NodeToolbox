// BoardColumnHeaderRow.tsx — The single column header row shared by every swimlane.
//
// There is one row for the whole board rather than one per lane, so a column stays in the same place
// all the way down. That alignment is what lets someone read a single column top to bottom and see
// everything in that state across every Feature — the view a per-lane board cannot give.

import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { isColumnCollapsed, type ColumnTrackStyle } from '../columnTrackLayout.ts';
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
  /** The grid tracks, computed ONCE for the whole board — see columnTrackLayout. */
  columnTracks: ColumnTrackStyle;
  /** Which columns are narrowed to a strip. */
  collapsedColumnIds?: readonly string[];
  /** Narrows this column, or opens it again. Absent hides the control. */
  onToggleCollapsed?: (columnId: string) => void;
}

/** One draggable column header. Unmapped is fixed in place — it is not the team's column to move. */
function SortableColumnHeader({
  column,
  issueCount,
  isReorderable,
  isFocused,
  isCollapsed,
  onToggleFocus,
  onToggleCollapsed,
}: {
  column: RenderedColumn;
  issueCount: number;
  isReorderable: boolean;
  isFocused: boolean;
  isCollapsed: boolean;
  onToggleFocus?: (columnId: string) => void;
  onToggleCollapsed?: (columnId: string) => void;
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
        isCollapsed ? styles.columnHeaderCollapsed : '',
      ].filter(Boolean).join(' ')}
      ref={setNodeRef}
      // Double-click opens this column to the full board width. The drag sensor needs 4px of travel
      // to engage, so a double-click that does not move never starts a reorder.
      onDoubleClick={() => onToggleFocus?.(column.id)}
      title={isCollapsed
        ? `${column.name} — ${issueCount} issue(s). Narrowed; use the chevron to open it again.`
        : isFocused
          ? 'Double-click to show every column again'
          : 'Double-click to focus this column across the whole board'}
      style={{ transform: CSS.Transform.toString(transform), transition, cursor: isReorderable ? 'grab' : 'default' }}
      {...(isReorderable ? listeners : {})}
      {...(isReorderable ? attributes : {})}
      aria-label={isReorderable ? `Drag ${column.name} to reorder the columns` : column.name}
    >
      {/* The chevron is the whole control when collapsed and a corner affordance when not. Its label
          always names the column, so a narrowed strip is never anonymous to a screen reader. */}
      {onToggleCollapsed && (
        <button
          aria-label={`${isCollapsed ? 'Open' : 'Narrow'} the ${column.name} column`}
          className={styles.columnCollapseToggle}
          onClick={(clickEvent) => { clickEvent.stopPropagation(); onToggleCollapsed(column.id); }}
          onPointerDown={(pointerEvent) => pointerEvent.stopPropagation()}
          type="button"
        >
          {isCollapsed ? '›' : '‹'}
        </button>
      )}

      {/* Collapsed, the count is all that is shown — and the count is never dropped, so a narrowed
          column still says how much work is in it rather than hiding it. */}
      {isCollapsed
        ? <span className={styles.columnHeaderMeta}>{issueCount}</span>
        : (
          <>
            <span>
              {column.name} <span className={styles.columnHeaderMeta}>{issueCount}</span>
            </span>
            {/* A Jira column stands for several statuses, so the header lists them rather than one. */}
            {column.mappings.length > 0 && <span className={styles.columnHeaderMeta}>{mappingSummary}</span>}
            {column.mappings.length === 0 && !column.isUnmappedColumn && (
              <span className={styles.columnHeaderMeta}>not mapped yet</span>
            )}
          </>
        )}
    </div>
  );
}

/** Renders the board-level column headers, draggable into the order the team wants. */
export function BoardColumnHeaderRow({
  columns,
  issueCountByColumnId = {},
  onReorderColumns,
  focusedColumnId = null,
  onToggleFocus,
  columnTracks,
  collapsedColumnIds = [],
  onToggleCollapsed,
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
            gridTemplateColumns: columnTracks.gridTemplateColumns,
            minWidth: columnTracks.minWidth,
          }}
        >
          {columns.map((column) => (
            <SortableColumnHeader
              column={column}
              isCollapsed={isColumnCollapsed(collapsedColumnIds, column.id)}
              isFocused={focusedColumnId === column.id}
              onToggleCollapsed={onToggleCollapsed}
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
