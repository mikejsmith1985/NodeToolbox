// SubLane.tsx — One discipline's band beneath the dev Feature it is a copy of.
//
// QE and BT clone the dev Feature into their own projects and break their own work down underneath
// the clone. This is that work, drawn where it belongs: under the Feature, in the SAME columns as
// everything else, so a reader sees one board rather than three stacked.
//
// Three things this band is careful about:
//
//   • It is READ-ONLY, and says so before anybody tries. The board does not own another team's
//     workflow, and a restriction discovered by a card that silently snaps back is worse than one
//     that was never offered.
//   • Its colour never carries meaning alone. The discipline is named in text, because a board read
//     by somebody who cannot distinguish two tones must still be readable.
//   • A clone that could not be read still gets a band. An absent band must always mean "no clone",
//     never "a clone we failed to read" — the second silently restores the bug this whole feature
//     exists to fix.

import { buildColumnGridTemplate, buildColumnRowMinWidth } from './BoardColumnHeaderRow.tsx';
import { ChildCard } from './ChildCard.tsx';
import { ParentContainer } from './ParentContainer.tsx';
import styles from '../RollupBoardTab.module.css';
import type { RenderedColumn, SubLane as SubLaneModel } from '../rollupBoardTypes.ts';

export interface SubLaneProps {
  subLane: SubLaneModel;
  columns: readonly RenderedColumn[];
  columnMinWidth?: string;
  onOpenIssue?: (issueKey: string) => void;
  onToggleCollapsed: (cloneFeatureKey: string) => void;
}

/** One short line describing what this band holds, readable without opening it. */
export function describeSubLaneSummary(subLane: SubLaneModel): string {
  if (subLane.cloneFeatureIssue === null) {
    return `${subLane.discipline.name}'s copy could not be read — its work is missing from this Feature.`;
  }
  if (subLane.totalItemCount === 0) {
    return `${subLane.discipline.name} has not broken its work down yet.`;
  }

  const itemWord = subLane.totalItemCount === 1 ? 'item' : 'items';
  const isFiltered = subLane.matchedItemCount !== subLane.totalItemCount;
  return isFiltered
    ? `${subLane.matchedItemCount} of ${subLane.totalItemCount} ${itemWord} match`
    : `${subLane.totalItemCount} ${itemWord}`;
}

/** One discipline's read-only band, in the dev team's columns. */
export function SubLane({
  subLane,
  columns,
  columnMinWidth,
  onOpenIssue,
  onToggleCollapsed,
}: SubLaneProps) {
  const isUnreadable = subLane.cloneFeatureIssue === null;

  return (
    <section
      className={styles.subLane}
      data-testid={`rollup-sub-lane-${subLane.cloneFeatureKey}`}
      // The tone is an index rather than a colour, so the stylesheet owns the palette and the band
      // stays legible in both themes without this component knowing anything about either.
      data-tone={subLane.toneIndex}
    >
      <header className={styles.subLaneHeader}>
        <button
          aria-expanded={!subLane.isCollapsed}
          className={styles.actionButton}
          onClick={() => onToggleCollapsed(subLane.cloneFeatureKey)}
          type="button"
        >
          {subLane.isCollapsed ? `Expand ${subLane.discipline.name}` : `Collapse ${subLane.discipline.name}`}
        </button>

        {/* Named in text, never by colour alone. */}
        <span className={styles.subLaneDiscipline}>{subLane.discipline.name}</span>
        <span className={styles.subLaneKey}>{subLane.cloneFeatureKey}</span>
        <span className={styles.subLaneSummary}>{describeSubLaneSummary(subLane)}</span>

        {/* Announced up front, not discovered by a card that will not move. */}
        <span className={styles.subLaneReadOnly}>read-only here</span>

        {subLane.isInferredMatch && (
          <span className={styles.subLaneInferred} title="Matched by Feature name, not by a Jira clone link">
            matched by name — not a recorded clone link
          </span>
        )}
      </header>

      {isUnreadable && (
        <p className={styles.subLaneMissing}>
          This discipline&apos;s Feature could not be read, so its work is not shown. The Feature may have
          been deleted, or you may not have permission to see {subLane.cloneFeatureKey}.
        </p>
      )}

      {!subLane.isCollapsed && !isUnreadable && (
        <div
          className={styles.laneCells}
          style={{
            gridTemplateColumns: buildColumnGridTemplate(columns.length, columnMinWidth),
            minWidth: buildColumnRowMinWidth(columns.length, columnMinWidth),
          }}
        >
          {columns.map((column) => {
            const cell = subLane.cellsByColumnId[column.id];
            return (
              <div className={styles.laneCell} key={column.id}>
                {cell?.containers.map((container) => (
                  <ParentContainer
                    container={container}
                    isReadOnly
                    key={container.parentKey}
                    onOpenIssue={onOpenIssue}
                  />
                ))}
                {cell?.looseItems.map((item) => (
                  <ChildCard isReadOnly item={item} key={item.key} onOpen={onOpenIssue} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
