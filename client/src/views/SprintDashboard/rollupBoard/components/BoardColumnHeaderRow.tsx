// BoardColumnHeaderRow.tsx — The single column header row shared by every swimlane.
//
// There is one row for the whole board rather than one per lane, so a column stays in the same place
// all the way down. That alignment is what lets someone read a single column top to bottom and see
// everything in that state across every Feature — the view a per-lane board cannot give.

import { DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import styles from '../RollupBoardTab.module.css';
import { UNMAPPED_COLUMN_ID, type RenderedColumn } from '../rollupBoardTypes.ts';

export interface BoardColumnHeaderRowProps {
  columns: readonly RenderedColumn[];
  /** How many issues each column is currently holding, keyed by column id. */
  issueCountByColumnId?: Record<string, number>;
  /** Reorders the team's columns by dragging their headers. Omitted on a read-only board. */
  onReorderColumns?: (orderedColumnIds: string[]) => void;
}

/** One draggable column header. Unmapped is fixed in place — it is not the team's column to move. */
function SortableColumnHeader({
  column,
  issueCount,
  isReorderable,
}: {
  column: RenderedColumn;
  issueCount: number;
  isReorderable: boolean;
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
      className={column.isUnmappedColumn ? `${styles.columnHeader} ${styles.columnHeaderUnmapped}` : styles.columnHeader}
      ref={setNodeRef}
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
 * The minimum comes from the app's own layout token rather than a fixed pixel value, so the board
 * scales with the standardised zoom instead of fighting it.
 */
export function buildColumnGridTemplate(columnCount: number): string {
  return `repeat(${columnCount}, minmax(var(--layout-control-min-width), 1fr))`;
}

/** Renders the board-level column headers, draggable into the order the team wants. */
export function BoardColumnHeaderRow({
  columns,
  issueCountByColumnId = {},
  onReorderColumns,
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
          style={{ gridTemplateColumns: buildColumnGridTemplate(columns.length) }}
        >
          {columns.map((column) => (
            <SortableColumnHeader
              column={column}
              isReorderable={Boolean(onReorderColumns) && !column.isUnmappedColumn}
              issueCount={issueCountByColumnId[column.id] ?? 0}
              key={column.id}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
