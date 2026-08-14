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
  /** What the dashboard's own selector has scoped the board to, named so the two cannot be confused. */
  scopeDescription?: string;
  /** Every item on the board, so the pickers only offer people and versions that are actually here. */
  allItems: readonly RollupBoardItem[];
  onFiltersChange: (filters: QuickFilterState) => void;
}

/**
 * The assignees present on this board, the busiest first, each with how much they are carrying.
 *
 * Sorted by COUNT rather than by name, and labelled with it, because the board deliberately pulls in
 * every child of every Feature it draws — whatever scope those children are in — so a Feature shared
 * with another team brings that team's people with it. Alphabetical, unlabelled, that list reads like
 * a directory of the whole instance. By count, the handful of people actually working this board sit
 * at the top and the long tail is visibly a tail.
 */
function collectAssignees(
  items: readonly RollupBoardItem[],
): Array<{ accountId: string; displayName: string; issueCount: number }> {
  const countsByAccountId = new Map<string, { displayName: string; issueCount: number }>();
  for (const item of items) {
    if (!item.assigneeAccountId) continue;
    const existing = countsByAccountId.get(item.assigneeAccountId);
    countsByAccountId.set(item.assigneeAccountId, {
      displayName: existing?.displayName ?? item.assigneeDisplayName ?? item.assigneeAccountId,
      issueCount: (existing?.issueCount ?? 0) + 1,
    });
  }

  return [...countsByAccountId.entries()]
    .map(([accountId, entry]) => ({ accountId, ...entry }))
    .sort((left, right) => right.issueCount - left.issueCount
      || left.displayName.localeCompare(right.displayName));
}

/** The fix versions present on this board, the biggest first, each with how much carries it. */
function collectFixVersions(items: readonly RollupBoardItem[]): Array<{ name: string; issueCount: number }> {
  const countsByName = new Map<string, number>();
  for (const item of items) {
    for (const fixVersionName of item.fixVersionNames) {
      countsByName.set(fixVersionName, (countsByName.get(fixVersionName) ?? 0) + 1);
    }
  }

  return [...countsByName.entries()]
    .map(([name, issueCount]) => ({ name, issueCount }))
    .sort((left, right) => right.issueCount - left.issueCount || left.name.localeCompare(right.name));
}

/** Renders the type, assignee and fixVersion filters, plus a single clear action. */
export function QuickFilterBar({ filters, allItems, onFiltersChange, scopeDescription = '' }: QuickFilterBarProps) {
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
        Assignee on the board
        <select
          className={styles.inputField}
          onChange={(changeEvent) =>
            onFiltersChange({ ...filters, assigneeAccountId: changeEvent.target.value || null })}
          value={filters.assigneeAccountId ?? ANY_VALUE}
        >
          <option value={ANY_VALUE}>Anyone</option>
          {collectAssignees(allItems).map((assignee) => (
            <option key={assignee.accountId} value={assignee.accountId}>
              {assignee.displayName} ({assignee.issueCount})
            </option>
          ))}
        </select>
      </label>

      <label
        className={styles.filterLabel}
        title={scopeDescription
          ? `Narrows what is already on the board (${scopeDescription}). It does not change what is fetched.`
          : 'Narrows what is already on the board. It does not change what is fetched.'}
      >
        Fix version on the board
        <select
          className={styles.inputField}
          onChange={(changeEvent) =>
            onFiltersChange({ ...filters, fixVersionName: changeEvent.target.value || null })}
          value={filters.fixVersionName ?? ANY_VALUE}
        >
          <option value={ANY_VALUE}>Any</option>
          {collectFixVersions(allItems).map((fixVersion) => (
            <option key={fixVersion.name} value={fixVersion.name}>
              {fixVersion.name} ({fixVersion.issueCount})
            </option>
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
          {scopeDescription ? ` Scope is still ${scopeDescription}.` : ''}
        </span>
      )}
    </div>
  );
}
