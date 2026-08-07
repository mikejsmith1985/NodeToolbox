// ParentContainer.tsx — The grouping label that wraps one parent's children within one column.
//
// This is deliberately NOT a card. It is a label saying "these belong to DEV-1", drawn afresh in
// every column that holds some of DEV-1's children. The parent itself is drawn as a card exactly
// once, in the column of its own status — if this were card-shaped, a reader would reasonably count
// it as an issue and every total on the board would be wrong.

import styles from '../RollupBoardTab.module.css';
import type { ParentContainer as ParentContainerModel, RollupBoardItem } from '../rollupBoardTypes.ts';
import { ChildCard } from './ChildCard.tsx';

export interface ParentContainerProps {
  container: ParentContainerModel;
  highlightedFamilyKey?: string | null;
  /** The card whose status change is still in flight. */
  pendingIssueKey?: string | null;
  /** Per-card failure reasons, shown on the card rather than in a toast that scrolls away. */
  errorMessageByIssueKey?: Record<string, string>;
  onOpenIssue?: (issueKey: string) => void;
  onSelectFamily?: (item: RollupBoardItem) => void;
}

/** Renders one parent grouping and the children of that parent present in this column. */
export function ParentContainer({
  container,
  highlightedFamilyKey = null,
  pendingIssueKey = null,
  errorMessageByIssueKey,
  onOpenIssue,
  onSelectFamily,
}: ParentContainerProps) {
  return (
    <div className={styles.parentContainer} data-testid={`rollup-container-${container.parentKey}`}>
      <div className={styles.parentContainerHeader}>
        <span className={styles.parentContainerKey}>{container.parentKey}</span>
        {container.isParentInScope
          ? <span>{container.parentSummary}</span>
          : (
            // The parent is real but not on this board, so no card for it exists anywhere. Saying so
            // is better than leaving a reader wondering why the parent is nowhere to be found.
            <span className={styles.parentContainerOutOfScope}>not on this board</span>
          )}
      </div>

      {container.items.map((item) => (
        <ChildCard
          errorMessage={errorMessageByIssueKey?.[item.key] ?? null}
          isHighlighted={highlightedFamilyKey === container.parentKey}
          isPending={pendingIssueKey === item.key}
          item={item}
          key={item.key}
          onOpen={onOpenIssue}
          onSelectFamily={onSelectFamily}
        />
      ))}
    </div>
  );
}
