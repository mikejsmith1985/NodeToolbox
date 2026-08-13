// QuickFilterBar.tsx — The one-click narrowings a team asks for daily.
//
// Filters change which cards are shown and nothing else. The bar says so out loud, because a viewer
// who filters to one person's defects and then reads a Feature's "40% complete" needs to know that
// figure still describes the whole Feature.

import styles from '../RollupBoardTab.module.css';
import { hasActiveFilters } from '../boardFilters.ts';
import type { IssueTypeBucket, QuickFilterState, RollupBoardItem } from '../rollupBoardTypes.ts';

const TYPE_FILTER_OPTIONS: Array<{ bucket: IssueTypeBucket; label: string }> = [
  { bucket: 'story', label: 'Stories only' },
  { bucket: 'defect', label: 'Defects only' },
  { bucket: 'subtask', label: 'Sub-tasks only' },
];

const ANY_VALUE = '';

export interface QuickFilterBarProps {
  filters: QuickFilterState;
  /** Every item on the board, so the pickers only offer people and versions that are actually here. */
  allItems: readonly RollupBoardItem[];
  onFiltersChange: (filters: QuickFilterState) => void;
}

/** The distinct assignees present on this board, sorted for a stable list. */
function collectAssignees(items: readonly RollupBoardItem[]): Array<{ accountId: string; displayName: string }> {
  const assigneesByAccountId = new Map<string, string>();
  for (const item of items) {
    if (item.assigneeAccountId) {
      assigneesByAccountId.set(item.assigneeAccountId, item.assigneeDisplayName ?? item.assigneeAccountId);
    }
  }
  return [...assigneesByAccountId.entries()]
    .map(([accountId, displayName]) => ({ accountId, displayName }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

/** The distinct fix versions present on this board. */
function collectFixVersionNames(items: readonly RollupBoardItem[]): string[] {
  return [...new Set(items.flatMap((item) => item.fixVersionNames))].sort();
}

/** Renders the type, assignee and fixVersion filters, plus a single clear action. */
export function QuickFilterBar({ filters, allItems, onFiltersChange }: QuickFilterBarProps) {
  /** Turning a type filter on or off; the others are untouched, so filters combine. */
  function handleToggleTypeBucket(bucket: IssueTypeBucket): void {
    const nextTypeBuckets = new Set(filters.typeBuckets);
    if (nextTypeBuckets.has(bucket)) {
      nextTypeBuckets.delete(bucket);
    } else {
      nextTypeBuckets.add(bucket);
    }
    onFiltersChange({ ...filters, typeBuckets: nextTypeBuckets });
  }

  return (
    <div className={styles.filterBar} data-testid="rollup-filter-bar">
      {TYPE_FILTER_OPTIONS.map((typeOption) => (
        <button
          aria-pressed={filters.typeBuckets.has(typeOption.bucket)}
          className={filters.typeBuckets.has(typeOption.bucket) ? styles.filterChipActive : styles.filterChip}
          key={typeOption.bucket}
          onClick={() => handleToggleTypeBucket(typeOption.bucket)}
          type="button"
        >
          {typeOption.label}
        </button>
      ))}

      <label className={styles.filterLabel}>
        Assignee
        <select
          className={styles.inputField}
          onChange={(changeEvent) =>
            onFiltersChange({ ...filters, assigneeAccountId: changeEvent.target.value || null })}
          value={filters.assigneeAccountId ?? ANY_VALUE}
        >
          <option value={ANY_VALUE}>Anyone</option>
          {collectAssignees(allItems).map((assignee) => (
            <option key={assignee.accountId} value={assignee.accountId}>{assignee.displayName}</option>
          ))}
        </select>
      </label>

      <label className={styles.filterLabel}>
        Fix version
        <select
          className={styles.inputField}
          onChange={(changeEvent) =>
            onFiltersChange({ ...filters, fixVersionName: changeEvent.target.value || null })}
          value={filters.fixVersionName ?? ANY_VALUE}
        >
          <option value={ANY_VALUE}>Any</option>
          {collectFixVersionNames(allItems).map((fixVersionName) => (
            <option key={fixVersionName} value={fixVersionName}>{fixVersionName}</option>
          ))}
        </select>
      </label>

      {/* Offered only when there is something to clear — a permanent Clear on an unfiltered board is
          a control that does nothing. */}
      {hasActiveFilters(filters) && (
        <button
          className={styles.actionButton}
          onClick={() => onFiltersChange({ typeBuckets: new Set(), assigneeAccountId: null, fixVersionName: null })}
          type="button"
        >
          Clear filters
        </button>
      )}

      {/* Said only while it applies. As a permanent line it explained a subtlety nobody had yet met,
          and the swimlane's own MATCHING tile now makes the same point structurally. */}
      {hasActiveFilters(filters) && (
        <span className={styles.filterLabel}>
          Filters narrow the cards. Each Feature&apos;s figures still describe the whole Feature.
        </span>
      )}
    </div>
  );
}
