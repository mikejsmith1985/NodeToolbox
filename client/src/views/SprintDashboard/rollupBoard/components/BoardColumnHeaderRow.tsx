// BoardColumnHeaderRow.tsx — The single column header row shared by every swimlane.
//
// There is one row for the whole board rather than one per lane, so a column stays in the same place
// all the way down. That alignment is what lets someone read a single column top to bottom and see
// everything in that state across every Feature — the view a per-lane board cannot give.

import styles from '../RollupBoardTab.module.css';
import type { RenderedColumn } from '../rollupBoardTypes.ts';

export interface BoardColumnHeaderRowProps {
  columns: readonly RenderedColumn[];
  /** How many issues each column is currently holding, keyed by column id. */
  issueCountByColumnId?: Record<string, number>;
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

/** Renders the board-level column headers in the team's chosen order, Unmapped always last. */
export function BoardColumnHeaderRow({ columns, issueCountByColumnId = {} }: BoardColumnHeaderRowProps) {
  return (
    <div
      className={styles.columnHeaderRow}
      data-testid="rollup-column-header-row"
      style={{ gridTemplateColumns: buildColumnGridTemplate(columns.length) }}
    >
      {columns.map((column) => (
        <div
          className={column.isUnmappedColumn ? `${styles.columnHeader} ${styles.columnHeaderUnmapped}` : styles.columnHeader}
          key={column.id}
        >
          <span>
            {column.name} <span className={styles.columnHeaderMeta}>{issueCountByColumnId[column.id] ?? 0}</span>
          </span>
          {/* A Jira column stands for several statuses, so the header lists them rather than one. */}
          {column.mappings.length > 0 && (
            <span className={styles.columnHeaderMeta}>
              {column.mappings
                .map((mapping) => mapping.subStatusValue
                  ? `${mapping.jiraStatusName} / ${mapping.subStatusValue}`
                  : mapping.jiraStatusName)
                .join(' · ')}
            </span>
          )}
          {column.mappings.length === 0 && !column.isUnmappedColumn && (
            <span className={styles.columnHeaderMeta}>not mapped yet</span>
          )}
        </div>
      ))}
    </div>
  );
}
