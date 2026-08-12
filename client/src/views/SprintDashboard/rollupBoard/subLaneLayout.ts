// subLaneLayout.ts — Arranging one discipline's work as a band beneath the dev Feature.
//
// A sub-lane is not a new kind of thing. It is the same row of the same columns that every lane has,
// holding a different team's work — which is exactly why it uses the SAME cell builder the primary
// lane uses. A second implementation would place a QE card by rules that agree with the dev rules
// only until one of them is edited.
//
// Two decisions worth stating because neither is obvious from the code alone:
//
//   • Sub-lane cards sit in the DEV team's columns, not the discipline's own. The alternative — each
//     band carrying its own headers — reads as three boards stacked rather than one board, and
//     nothing lines up vertically. A discipline status no column claims lands in Unmapped, which is
//     the normal case here rather than an error, and the existing unmapped-states notice already says
//     precisely which mapping to add.
//
//   • Every band is built even when its clone could not be read. An absent sub-lane must always mean
//     "no clone" and never "a clone we failed to read", because the second one silently returns the
//     board to reporting a Feature as finished when only dev is finished.

import { buildCellsByColumnId } from './boardLayout.ts';
import { selectMatchingItems } from './boardFilters.ts';
import { readDisciplineToneIndex } from './cloneFamily.ts';
import type {
  BoardPreferences,
  CloneClassification,
  DisciplineProjects,
  QuickFilterState,
  RenderedColumn,
  RollupBoardItem,
  SubLane,
} from './rollupBoardTypes.ts';
import type { JiraIssue } from '../../../types/jira.ts';

export interface BuildSubLanesInput {
  /** Every clone found on this Feature, already judged. Only 'discipline' ones become bands. */
  classifications: readonly CloneClassification[];
  /** The clone Features themselves, by key. A missing entry means unreadable, not absent. */
  cloneFeatureIssuesByKey: ReadonlyMap<string, JiraIssue>;
  /** Every discipline's work, by the clone Feature key it rolls up to. */
  itemsByCloneFeatureKey: ReadonlyMap<string, RollupBoardItem[]>;
  /** The dev team's columns — the whole board reads as one board. */
  columns: readonly RenderedColumn[];
  filters: QuickFilterState;
  preferences: BoardPreferences;
  /** The full configured list, which decides each discipline's colour by position. */
  disciplineProjects: readonly DisciplineProjects[];
}

/**
 * The sub-lane's own cell-order key.
 *
 * Keyed on the CLONE's Feature key rather than the dev Feature's, so two disciplines under one
 * Feature cannot overwrite each other's card order.
 */
function readSubLaneCollapsed(preferences: BoardPreferences, cloneFeatureKey: string): boolean {
  // Collapsed until the viewer opens it: three disciplines expanded by default would make the board
  // roughly three times taller, which is the complaint this board has already had twice.
  return preferences.collapsedByFeatureKey[cloneFeatureKey] ?? true;
}

/** Builds every discipline band for one dev Feature, in the dev team's own columns. */
export function buildSubLanes(input: BuildSubLanesInput): SubLane[] {
  const disciplineClones = (input.classifications ?? [])
    .filter((classification): classification is Extract<CloneClassification, { kind: 'discipline' }> =>
      classification.kind === 'discipline');

  return disciplineClones.map((classification) => {
    const items = input.itemsByCloneFeatureKey.get(classification.cloneIssueKey) ?? [];
    const matchedItems = selectMatchingItems(items, input.filters);

    return {
      discipline: classification.discipline,
      cloneFeatureKey: classification.cloneIssueKey,
      // Absent means the clone could not be read. The band still renders and says so.
      cloneFeatureIssue: input.cloneFeatureIssuesByKey.get(classification.cloneIssueKey) ?? null,
      toneIndex: readDisciplineToneIndex(classification.discipline, input.disciplineProjects),
      isInferredMatch: classification.evidence === 'feature-name-match',
      cellsByColumnId: buildCellsByColumnId({
        laneKey: classification.cloneIssueKey,
        items,
        matchedItems,
        columns: input.columns,
        preferences: input.preferences,
        // A sub-lane's parent containers resolve within the sub-lane: a QE story's parent is another
        // QE issue, never a dev one.
        laneKeyByIssueKey: new Map(items.map((item) => [item.key, classification.cloneIssueKey])),
      }),
      items,
      isCollapsed: readSubLaneCollapsed(input.preferences, classification.cloneIssueKey),
      matchedItemCount: matchedItems.length,
      // Counts everything, filtered or not — "3 of 11 match" is two counts of two sets.
      totalItemCount: items.length,
    };
  });
}

/** Every sub-lane's items, in the shape the family figure wants. */
export function readSubLaneItemLists(subLanes: readonly SubLane[]): RollupBoardItem[][] {
  return (subLanes ?? []).map((subLane) => subLane.items);
}
