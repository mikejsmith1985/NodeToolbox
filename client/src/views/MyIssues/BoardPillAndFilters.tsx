// BoardPillAndFilters.tsx — Board selection pill and quick filter chip bar.
//
// Shows the selected board as a dismissible pill, then renders one toggle
// button per quick filter below it. Active filters are highlighted.
// Returns null when no board is selected, so the caller can omit it entirely.

import type { JiraBoardQuickFilter } from './myIssuesExtendedTypes.ts';
import styles from './BoardPillAndFilters.module.css';

// ── Props ──

export interface BoardPillAndFiltersProps {
  boardName: string | null;
  boardQuickFilters: JiraBoardQuickFilter[];
  activeQuickFilterIds: Record<number, boolean>;
  onClearBoard: () => void;
  onToggleQuickFilter: (filterId: number) => void;
}

// ── Component ──

/**
 * Renders the active board as a pill with a dismiss button, and a row of
 * quick-filter toggle chips beneath it. Returns null if no board is selected.
 */
export default function BoardPillAndFilters({
  boardName,
  boardQuickFilters,
  activeQuickFilterIds,
  onClearBoard,
  onToggleQuickFilter,
}: BoardPillAndFiltersProps) {
  if (!boardName) return null;

  return (
    <div className={styles.container}>
      <div className={styles.boardRow}>
        <span className={styles.boardPill}>
          📋 {boardName}
          <button
            aria-label="Clear board"
            className={styles.clearBoardButton}
            onClick={onClearBoard}
            title="Remove board filter"
            type="button"
          >
            ×
          </button>
        </span>
      </div>

      {boardQuickFilters.length > 0 && (
        <div className={styles.quickFilterRow}>
          {boardQuickFilters.map((quickFilter) => {
            const isActive = !!activeQuickFilterIds[quickFilter.id];
            const chipClassName = isActive
              ? `${styles.quickFilterChip} ${styles.quickFilterChipActive}`
              : styles.quickFilterChip;

            return (
              <button
                aria-pressed={isActive}
                className={chipClassName}
                key={quickFilter.id}
                onClick={() => onToggleQuickFilter(quickFilter.id)}
                title={quickFilter.jql}
                type="button"
              >
                {quickFilter.name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
