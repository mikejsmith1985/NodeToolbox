// ParentContainer.tsx — The grouping label that wraps one parent's children within one column.
//
// This is deliberately NOT a card. It is a label saying "these belong to DEV-1", drawn afresh in
// every column that holds some of DEV-1's children. The parent itself is drawn as a card exactly
// once, in the column of its own status — if this were card-shaped, a reader would reasonably count
// it as an issue and every total on the board would be wrong.

import { Fragment } from 'react';

import type { CardDetail } from '../cardDetail.ts';
import { shouldHideDraggedEntry } from '../dropPlaceholder.ts';
import styles from '../RollupBoardTab.module.css';
import type { ParentContainer as ParentContainerModel, RollupBoardItem } from '../rollupBoardTypes.ts';
import { ChecklistCard, type ChecklistCardProps } from './ChecklistCard.tsx';
import { ChildCard, type ChildCardProps } from './ChildCard.tsx';

export interface ParentContainerProps {
  container: ParentContainerModel;
  highlightedFamilyKey?: string | null;
  /** The card whose status change is still in flight. */
  pendingIssueKey?: string | null;
  /** Per-card failure reasons, shown on the card rather than in a toast that scrolls away. */
  errorMessageByIssueKey?: Record<string, string>;
  /** Extra context per issue, present only while a column is focused. */
  cardDetailByIssueKey?: Record<string, CardDetail>;
  /** Shows each card's Jira status — set only for the Unmapped column. */
  shouldShowStatus?: boolean;
  /** Passes read-only down to every card inside — used for another discipline's work. */
  isReadOnly?: boolean;
  /**
   * The card actions, threaded through to the nested cards.
   *
   * Omitting them left every sub-task inside a container with an EMPTY menu, so its right-click never
   * called preventDefault and the browser's own menu appeared instead. A container is a grouping
   * label, not a different kind of card: what a loose card can do, a contained one can do too.
   */
  onNestInto?: (issueKey: string, containerIssueKey: string) => void;
  onToggleFlag?: (issueKey: string, shouldBeFlagged: boolean) => void;
  onMoveToColumn?: ChildCardProps['onMoveToColumn'];
  moveTargetColumns?: ChildCardProps['moveTargetColumns'];
  onSetChecklistState?: ChecklistCardProps['onSetState'];
  onOpenChecklistParent?: ChecklistCardProps['onOpenParent'];
  onOpenIssue?: (issueKey: string) => void;
  onSelectFamily?: (item: RollupBoardItem) => void;
  /** Where the drop gap opens among these cards, or null when it belongs elsewhere on the board. */
  placeholderIndex?: number | null;
  /** The card in the air, lifted out of the list so its old slot does not stay open beside the new one. */
  draggedItemKey?: string | null;
  /** The checklist card whose state change is still in flight. */
  pendingChecklistCardId?: string | null;
  /** Per-checklist-card failure reasons, shown on the card exactly as an issue's are. */
  errorMessageByChecklistCardId?: Record<string, string>;
  /** The full explanation per failed checklist card, folded away on the card until asked for. */
  errorDetailByChecklistCardId?: Record<string, string>;
  /** Why this instance cannot write checklists at all, when it cannot. */
  checklistWriteBlockedReason?: string | null;
}

/** Renders one parent grouping and the children of that parent present in this column. */
export function ParentContainer({
  container,
  highlightedFamilyKey = null,
  pendingIssueKey = null,
  errorMessageByIssueKey,
  cardDetailByIssueKey,
  shouldShowStatus,
  isReadOnly,
  onNestInto,
  onToggleFlag,
  onMoveToColumn,
  moveTargetColumns,
  onSetChecklistState,
  onOpenChecklistParent,
  onOpenIssue,
  onSelectFamily,
  placeholderIndex = null,
  draggedItemKey = null,
  pendingChecklistCardId = null,
  errorMessageByChecklistCardId,
  errorDetailByChecklistCardId,
  checklistWriteBlockedReason = null,
}: ParentContainerProps) {
  // Reordering inside a container is the same gesture as reordering loose cards, so it gets the same
  // gap — the container simply happens to be where these particular cards are drawn.
  const visibleItems = container.items.filter((item) => !shouldHideDraggedEntry(draggedItemKey, item.key));

  return (
    <div className={styles.parentContainer} data-testid={`rollup-container-${container.parentKey}`}>
      <div className={styles.parentContainerHeader}>
        <span className={styles.parentContainerKey}>{container.parentKey}</span>
        {container.isParentInScope && <span>{container.parentSummary}</span>}

        {/* Two different problems, so two different sentences. A parent sitting in another lane means
            it and its children disagree about which Feature they deliver — something to fix in Jira,
            not the scope gap that "not on this board" would send a reader looking for. */}
        {!container.isParentInScope && container.parentLaneFeatureKey && (
          <span className={styles.parentContainerOutOfScope}>
            its own card is in the {container.parentLaneFeatureKey} lane — it and this work disagree
            about which Feature they deliver
          </span>
        )}

        {!container.isParentInScope && !container.parentLaneFeatureKey && (
          <span className={styles.parentContainerOutOfScope}>not on this board</span>
        )}
      </div>

      {visibleItems.map((item, itemIndex) => (
        <Fragment key={item.key}>
          {placeholderIndex === itemIndex && (
            <div className={styles.dropPlaceholder}>Move here</div>
          )}
        <ChildCard
          containerCandidates={container.items.map((candidate) => ({
            key: candidate.key, summary: candidate.summary,
          }))}
          onNestInto={onNestInto}
          onToggleFlag={onToggleFlag}
          onMoveToColumn={onMoveToColumn}
          moveTargetColumns={moveTargetColumns}
          isReadOnly={isReadOnly}
          detail={cardDetailByIssueKey?.[item.key] ?? null}
          shouldShowStatus={shouldShowStatus}
          errorMessage={errorMessageByIssueKey?.[item.key] ?? null}
          isHighlighted={highlightedFamilyKey !== null && highlightedFamilyKey === container.parentKey}
          isPending={pendingIssueKey === item.key}
          item={item}
          onOpen={onOpenIssue}
          onSelectFamily={onSelectFamily}
        />
        </Fragment>
      ))}

      {/* This parent's checklist items that belong in THIS column — the same grouping a sub-task
          gets, because it is the same relationship: work underneath the issue that owns it. They are
          drawn after the issue cards so a container always reads issues-then-checklist rather than
          interleaving two kinds of thing that are counted differently. */}
      {(container.checklistCards ?? []).map((checklistCard) => (
        <ChecklistCard
          card={checklistCard}
          errorMessage={errorMessageByChecklistCardId?.[checklistCard.id] ?? null}
          errorDetail={errorDetailByChecklistCardId?.[checklistCard.id] ?? null}
          writeBlockedReason={checklistWriteBlockedReason}
          isPending={pendingChecklistCardId === checklistCard.id}
          onSetState={onSetChecklistState}
          onOpenParent={onOpenChecklistParent}
          isReadOnly={isReadOnly}
          key={checklistCard.id}
        />
      ))}

      {/* Dropping below the last card is its own slot, and there is no card after it to hang it on. */}
      {placeholderIndex !== null && placeholderIndex >= visibleItems.length && (
        <div className={styles.dropPlaceholder}>Move here</div>
      )}
    </div>
  );
}
