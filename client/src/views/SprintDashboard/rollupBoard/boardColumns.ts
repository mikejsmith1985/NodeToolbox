// boardColumns.ts — Turns the team's own column names into placements, and refuses ambiguous ones.
//
// The enterprise workflow expresses an item's real state as a status PLUS a sub-status, which nobody
// can read at a glance. A team column names that combination in words the team actually uses. This
// module owns the two rules that make the naming trustworthy: one Jira state resolves to exactly one
// column, and a state no column claims is shown as unclaimed rather than filed somewhere plausible.

import {
  UNMAPPED_COLUMN_ID,
  type BoardColumn,
  type BoardVocabulary,
  type ColumnStatusMapping,
  type RenderedColumn,
  type VocabularyError,
  type VocabularyValidation,
} from './rollupBoardTypes.ts';

/** Label of the always-present column holding states no team column claims. */
const UNMAPPED_COLUMN_NAME = 'Unmapped';

/** Jira varies casing and padding between screens, so compare names normalised. */
function normalizeForComparison(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

/** The comparison key for one Jira state, so two columns claiming it are trivially detectable. */
function buildMappingComparisonKey(mapping: ColumnStatusMapping): string {
  return `${normalizeForComparison(mapping.jiraStatusName)}||${normalizeForComparison(mapping.subStatusValue)}`;
}

/** True when a column's mapping describes the state this item is actually in. */
function doesMappingMatchState(
  mapping: ColumnStatusMapping,
  statusName: string,
  subStatusValue: string | null,
  hasSubStatusField: boolean,
): boolean {
  if (normalizeForComparison(mapping.jiraStatusName) !== normalizeForComparison(statusName)) {
    return false;
  }
  // Without a sub-status field on this instance there is no second half to compare, so a status match
  // is the whole match. The board states this reduced precision rather than implying it has it.
  if (!hasSubStatusField) {
    return true;
  }
  return normalizeForComparison(mapping.subStatusValue) === normalizeForComparison(subStatusValue);
}

/**
 * Decides which board column one issue belongs in, from that issue's OWN status and sub-status.
 *
 * There is deliberately no nearest-guess: a near miss on sub-status lands in Unmapped. Guessing would
 * silently misplace exactly the items whose state the team is least sure about, which is the problem
 * this board exists to solve rather than reproduce.
 */
export function resolveColumnIdForItem(
  statusName: string,
  subStatusValue: string | null,
  vocabulary: BoardVocabulary,
  hasSubStatusField: boolean,
): string {
  const matchingColumn = vocabulary.columns.find((column) =>
    column.mappings.some((mapping) => doesMappingMatchState(mapping, statusName, subStatusValue, hasSubStatusField)),
  );
  return matchingColumn?.id ?? UNMAPPED_COLUMN_ID;
}

/** Collects the ids of every column claiming a Jira state that another column already claims. */
function findDuplicateMappingErrors(columns: readonly BoardColumn[]): VocabularyError[] {
  const columnIdsByMappingKey = new Map<string, string[]>();
  for (const column of columns) {
    for (const mapping of column.mappings) {
      const mappingKey = buildMappingComparisonKey(mapping);
      const claimingColumnIds = columnIdsByMappingKey.get(mappingKey) ?? [];
      // A column claiming one state twice is a duplicate within itself, not a clash with a neighbour.
      if (!claimingColumnIds.includes(column.id)) {
        columnIdsByMappingKey.set(mappingKey, [...claimingColumnIds, column.id]);
      }
    }
  }

  return [...columnIdsByMappingKey.entries()]
    .filter(([, columnIds]) => columnIds.length > 1)
    .map(([mappingKey, columnIds]) => ({
      kind: 'duplicate-mapping' as const,
      message:
        `${columnIds.length} columns claim the same Jira state (${mappingKey.replace('||', ' / ')}). `
        + 'One state can only mean one column.',
      columnIds,
    }));
}

/** Collects the ids of every column sharing a name with another, ignoring casing. */
function findDuplicateNameErrors(columns: readonly BoardColumn[]): VocabularyError[] {
  const columnIdsByName = new Map<string, string[]>();
  for (const column of columns) {
    const nameKey = normalizeForComparison(column.name);
    if (nameKey === '') continue;
    columnIdsByName.set(nameKey, [...(columnIdsByName.get(nameKey) ?? []), column.id]);
  }

  return [...columnIdsByName.entries()]
    .filter(([, columnIds]) => columnIds.length > 1)
    .map(([nameKey, columnIds]) => ({
      kind: 'duplicate-name' as const,
      message: `Two columns are both called "${nameKey}". Column names are how the team talks about state.`,
      columnIds,
    }));
}

/**
 * Checks a vocabulary before it is saved.
 *
 * A conflict is REFUSED rather than silently resolved, because auto-deduplicating would quietly
 * discard a column somebody deliberately created. A column with no mapping is valid — it simply
 * holds nothing until it is mapped.
 */
export function validateVocabulary(vocabulary: BoardVocabulary): VocabularyValidation {
  const blankNameErrors: VocabularyError[] = vocabulary.columns
    .filter((column) => normalizeForComparison(column.name) === '')
    .map((column) => ({
      kind: 'blank-name' as const,
      message: 'A column needs a name — that name is the whole point of the board.',
      columnIds: [column.id],
    }));

  const errors = [
    ...blankNameErrors,
    ...findDuplicateNameErrors(vocabulary.columns),
    ...findDuplicateMappingErrors(vocabulary.columns),
  ];
  return { isValid: errors.length === 0, errors };
}

/**
 * Produces the columns the board actually renders: the team's own, in their chosen order, followed
 * always by Unmapped.
 *
 * Unmapped is appended here rather than stored, so it can be neither deleted nor renamed. It is the
 * board's guarantee that an unclaimed state has somewhere visible to go.
 */
export function buildRenderedColumns(vocabulary: BoardVocabulary): RenderedColumn[] {
  const teamColumns: RenderedColumn[] = [...vocabulary.columns]
    .sort((leftColumn, rightColumn) => leftColumn.order - rightColumn.order)
    .map((column, columnIndex) => ({
      id: column.id,
      name: column.name,
      // Stored order is a preference, not user data: gaps are normalised rather than reported.
      order: columnIndex,
      mappings: column.mappings,
      isUnmappedColumn: false,
    }));

  return [
    ...teamColumns,
    {
      id: UNMAPPED_COLUMN_ID,
      name: UNMAPPED_COLUMN_NAME,
      order: teamColumns.length,
      mappings: [],
      isUnmappedColumn: true,
    },
  ];
}
