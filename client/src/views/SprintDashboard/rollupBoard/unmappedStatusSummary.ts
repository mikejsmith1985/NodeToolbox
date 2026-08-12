// unmappedStatusSummary.ts — What is actually sitting in the Unmapped column, and what would claim it.
//
// A card lands in Unmapped when no column claims the state it is in. Until now the card said nothing
// about that state: the board shows a sub-status in the card footer, and leaves the STATUS to be
// implied by the column the card is sitting in — which works everywhere except the one column whose
// whole meaning is "no column claims this".
//
// So an Unmapped card shows its status outright. And because the reason is nearly always a near miss
// rather than a mystery — a column claims "In Progress" but with a different sub-status, or claims the
// status with no sub-status at all — the board also names the column that came closest. That turns
// "47 unmapped" from a number into a short list of specific mappings to add.

import type { RenderedColumn, RollupBoardItem } from './rollupBoardTypes.ts';

/** One state found in the Unmapped column, and how many issues are sitting in it. */
export interface UnmappedStatusGroup {
  statusName: string;
  subStatusValue: string | null;
  issueCount: number;
  /** A few keys, so the group can be recognised without opening anything. */
  exampleIssueKeys: string[];
  /**
   * The column that already claims this STATUS under a different sub-status, if there is one.
   *
   * Named because it is almost always the answer: the column exists, it is simply missing one
   * status/sub-status pair.
   */
  nearestColumnName: string | null;
}

/** How many keys to name per group before the list stops being a list. */
const MAX_EXAMPLE_KEYS = 3;

/** Compares Jira names the way Jira presents them: trimmed, and casing is not a real distinction. */
function normalizeName(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

/** Reads one state as a single line: "In Progress / Code Review", or just the status when there is no sub-status. */
export function describeStatusPair(statusName: string, subStatusValue: string | null): string {
  const trimmedSubStatus = (subStatusValue ?? '').trim();
  return trimmedSubStatus === '' ? statusName : `${statusName} / ${trimmedSubStatus}`;
}

/** Finds a column that claims this status name under some other sub-status. */
function findNearestColumnName(columns: readonly RenderedColumn[], statusName: string): string | null {
  const nearestColumn = columns.find((column) => !column.isUnmappedColumn
    && column.mappings.some((mapping) => normalizeName(mapping.jiraStatusName) === normalizeName(statusName)));
  return nearestColumn ? nearestColumn.name : null;
}

/**
 * Groups everything sitting in Unmapped by the state it is actually in.
 *
 * Grouped rather than listed per issue because the fix is per STATE, not per issue: one missing
 * mapping usually explains dozens of cards at once, and forty-seven lines would hide that.
 */
export function summarizeUnmappedStatuses(
  items: readonly RollupBoardItem[],
  unmappedColumnId: string,
  columns: readonly RenderedColumn[],
): UnmappedStatusGroup[] {
  const groupsByState = new Map<string, UnmappedStatusGroup>();

  for (const item of items) {
    if (item.columnId !== unmappedColumnId) continue;

    const subStatusValue = (item.subStatusValue ?? '').trim() === '' ? null : item.subStatusValue;
    const stateKey = `${normalizeName(item.statusName)}::${normalizeName(subStatusValue)}`;
    const existingGroup = groupsByState.get(stateKey);

    if (existingGroup) {
      existingGroup.issueCount += 1;
      if (existingGroup.exampleIssueKeys.length < MAX_EXAMPLE_KEYS) existingGroup.exampleIssueKeys.push(item.key);
      continue;
    }

    groupsByState.set(stateKey, {
      statusName: item.statusName,
      subStatusValue,
      issueCount: 1,
      exampleIssueKeys: [item.key],
      nearestColumnName: findNearestColumnName(columns, item.statusName),
    });
  }

  // Biggest first: the mapping that clears the most cards is the one worth adding first.
  return [...groupsByState.values()].sort((left, right) => right.issueCount - left.issueCount);
}

/** One line per group, saying what is unclaimed and what would most likely claim it. */
export function describeUnmappedStatusGroup(group: UnmappedStatusGroup): string {
  const issueWord = group.issueCount === 1 ? 'issue' : 'issues';
  const state = describeStatusPair(group.statusName, group.subStatusValue);
  const examples = group.exampleIssueKeys.join(', ');

  const advice = group.nearestColumnName === null
    ? 'No column claims this status at all — add it to one in Board setup.'
    : `Your “${group.nearestColumnName}” column already claims “${group.statusName}”`
      + ' — add this sub-status to it in Board setup.';

  return `${group.issueCount} ${issueWord} in “${state}” (${examples}). ${advice}`;
}
