// ChildCard.tsx — One issue on the Roll-Up Board, shaped like a Jira board card.
//
// The whole card is the drag handle, the way it is on a Jira board: you pick a card up by touching
// it, not by finding a grip. An earlier version made the card a <button> with the drag listeners on
// a nested grip — a button inside a button, so the outer click fired on release and every drag
// attempt opened the detail panel instead of moving the card.
//
// Click and drag are told apart by the drag sensor's activation distance: a press that never moves
// is a click and opens the issue; a press that travels is a drag.

import { useState } from 'react';

import { useDraggable, useDroppable } from '@dnd-kit/core';

import { AssigneeAvatar } from '../../../../components/IssueMeta/AssigneeAvatar.tsx';
import { IssueTypeIcon } from '../../../../components/IssueMeta/IssueTypeIcon.tsx';
import { PriorityBadge } from '../../../../components/IssueMeta/PriorityBadge.tsx';
import { buildCardTargetId } from '../cardDropRouting.ts';
import { formatCommentDate, type CardDetail } from '../cardDetail.ts';
import { describeStatusPair } from '../unmappedStatusSummary.ts';
import type { ChecklistItemState } from '../checklistItems.ts';
import { describeChecklistState, nextChecklistState } from '../checklistWrite.ts';
import styles from '../RollupBoardTab.module.css';
import { BoardContextMenu, type BoardMenuAction } from './BoardContextMenu.tsx';
import {
  AttachmentIcon,
  BlockedIcon,
  ChecklistDoneIcon,
  ChecklistInProgressIcon,
  ChecklistOpenIcon,
  FlagIcon,
  WarningIcon,
} from './BoardIcons.tsx';
import type { IssueTypeBucket, RollUpRoute, RollupBoardItem } from '../rollupBoardTypes.ts';

/** Which colour class carries each visual family. Text always says the same thing (FR-028). */
/** An icon per checklist state, so the state survives even where colour does not. */
const CHECKLIST_STATE_ICONS: Record<ChecklistItemState, () => React.JSX.Element> = {
  open: ChecklistOpenIcon,
  'in-progress': ChecklistInProgressIcon,
  done: ChecklistDoneIcon,
};

/**
 * How many checklist items a card shows before it starts counting the rest.
 *
 * Three fits under a card without doubling its height, which is what a ten-item checklist was doing
 * to a lane. A focused column shows them all — it has the board's whole width for one status.
 */
const MAX_COMPACT_CHECKLIST_ITEMS = 3;

/**
 * What each impediment is called on a card.
 *
 * Named apart because they are not the same thing and cannot be undone the same way. Only the flag
 * can be cleared from here; a blocking link is cleared by resolving the issue that blocks it, and a
 * blocked STATUS by moving the card. Calling all three "Flagged" — which this briefly did — offered
 * to remove a flag that was never set, and removing it changed nothing.
 */
const IMPEDIMENT_LABELS: Record<string, { Icon: () => React.JSX.Element; label: string }> = {
  Flagged: { Icon: FlagIcon, label: 'Flagged' },
  'Blocked Link': { Icon: BlockedIcon, label: 'Blocked by a link' },
  'Blocked Status': { Icon: BlockedIcon, label: 'Blocked status' },
  Label: { Icon: BlockedIcon, label: 'Blocked label' },
};

const CARD_CLASS_BY_TYPE_BUCKET: Record<IssueTypeBucket, string> = {
  story: styles.cardStory,
  defect: styles.cardDefect,
  subtask: styles.cardSubtask,
  other: styles.cardOther,
};

export interface ChildCardProps {
  item: RollupBoardItem;
  /** True when this card belongs to the family the viewer currently has selected. */
  isHighlighted?: boolean;
  /** True while a status move for this card is still being applied. */
  isPending?: boolean;
  /** Set when the last action on this card failed, so the reason can be shown in place. */
  errorMessage?: string | null;
  onOpen?: (issueKey: string) => void;
  onSelectFamily?: (item: RollupBoardItem) => void;
  /**
   * Extra context, shown only while this card's column is focused.
   *
   * Absent means the terse card: with a dozen columns on screen there is no room for a description,
   * and reading one for every issue would be a large payload nobody is looking at.
   */
  detail?: CardDetail | null;
  /**
   * Shows the issue's actual Jira status on the card.
   *
   * Set only for the Unmapped column. Everywhere else the column IS the status, so printing it on
   * every card would be noise; in Unmapped there is nothing to imply it from, which left the one
   * column that most needs explaining as the only one saying nothing.
   */
  shouldShowStatus?: boolean;
  /**
   * Makes the card readable but immovable — used for another discipline's work in a sub-lane.
   *
   * The board does not own another team's workflow, so it must not offer a move it has no business
   * making. Gating at the HOOK rather than filtering the drop matters: a filtered drop still lets the
   * drag start and the card lift, so the restriction gets discovered by a card that silently snaps
   * back, which is worse than never having offered it.
   */
  isReadOnly?: boolean;
  /**
   * The other cards in this card's column, offered as containers in its right-click menu.
   *
   * Containment used to be a DRAG: dropping onto the middle of a card meant "put this inside that
   * one". It shared a gesture with sequencing, so it happened by accident — and since nesting writes
   * to Jira and sequencing writes nothing, that was the wrong pair to conflate. It is asked for
   * explicitly now, from a menu that names the container it is about to record.
   */
  containerCandidates?: readonly { key: string; summary: string }[];
  onNestInto?: (issueKey: string, containerIssueKey: string) => void;
  /**
   * Raises or clears Jira's impediment flag on this issue.
   *
   * In the menu rather than on the chip: it writes to Jira, and a click target sitting on the card
   * would compete with clicking the card itself to open it.
   */
  onToggleFlag?: (issueKey: string, shouldBeFlagged: boolean) => void;
  /** Ticks one Smart Checklist line on, off, or into "working". Absent leaves the markers read-only. */
  onToggleChecklistItem?: (issueKey: string, checklistItemId: string, nextState: ChecklistItemState) => void;
}

/** Turns a resolved route into one readable sentence, so parentage is never inferred. */
export function describeRollUpRoute(route: RollUpRoute): string {
  if (route.featureKey === null) {
    return 'Does not roll up to any Feature';
  }

  const routeDescription = route.steps
    .map((step) => {
      if (step.kind === 'parent') return `parent ${step.toKey}`;
      if (step.kind === 'issueLink') return `${step.linkTypeName} ${step.toKey}`;
      return step.toKey;
    })
    .join(' → ');

  // Worth distinguishing: somebody SET this, rather than the board deducing it from a chain of links.
  if (route.precedenceRank === 'own-feature-link') return `Linked directly to ${routeDescription}`;
  if (route.precedenceRank === 'via-qa-issue') return `Raised via ${routeDescription}`;
  if (route.precedenceRank === 'dev-story') return `Raised against ${routeDescription}`;
  return `Rolls up via ${routeDescription}`;
}

/** Renders one issue card, colour-coded and labelled by type, draggable as a whole. */
export function ChildCard({
  item,
  isHighlighted = false,
  isPending = false,
  errorMessage = null,
  onOpen,
  onSelectFamily,
  detail = null,
  shouldShowStatus = false,
  isReadOnly = false,
  containerCandidates = [],
  onNestInto,
  onToggleFlag,
  onToggleChecklistItem,
}: ChildCardProps) {
  const [menuPosition, setMenuPosition] = useState<{ xPx: number; yPx: number } | null>(null);

  // Only the cards beside this one in the same column can contain it, and only when the board can
  // actually write the link. No candidates means no menu at all, rather than a menu of nothing.
  const containmentActions: BoardMenuAction[] = onNestInto && !isReadOnly
    ? containerCandidates
      .filter((candidate) => candidate.key !== item.key)
      .map((candidate) => ({
        id: `nest-${candidate.key}`,
        label: `Contain within ${candidate.key} — ${candidate.summary}`,
        onSelect: () => onNestInto(item.key, candidate.key),
      }))
    : [];

  // Named for what it will DO, not for the state it is in, so a right-click never writes something
  // other than what the entry said.
  const flagActions: BoardMenuAction[] = onToggleFlag && !isReadOnly
    ? [{
      id: 'toggle-flag',
      label: item.isFlagged ? 'Remove the flag in Jira' : 'Flag as an impediment in Jira',
      onSelect: () => onToggleFlag(item.key, !item.isFlagged),
    }]
    : [];

  const menuActions: BoardMenuAction[] = [...flagActions, ...containmentActions];
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.key, disabled: isReadOnly });
  // Also a drop target, so one card can be dropped onto another to sequence the work in a column.
  // Disabled alongside the drag: a card nothing may be dragged FROM should not accept a drop either.
  const { setNodeRef: setDropRef } = useDroppable({
    id: buildCardTargetId(item.key),
    disabled: isReadOnly,
  });

  /** One element is both the drag source and the drop target. */
  function attachBothRefs(element: HTMLDivElement | null): void {
    setNodeRef(element);
    setDropRef(element);
  }

  // A focused column has the whole board width to itself, so it can afford the full list; twelve
  // columns side by side cannot.
  const isDetailed = detail !== null;
  const visibleChecklistItems = isDetailed
    ? item.checklistItems
    : item.checklistItems.slice(0, MAX_COMPACT_CHECKLIST_ITEMS);
  const hiddenChecklistItemCount = item.checklistItems.length - visibleChecklistItems.length;

  const cardClassNames = [
    styles.card,
    CARD_CLASS_BY_TYPE_BUCKET[item.typeBucket],
    isHighlighted ? styles.cardHighlighted : '',
    isPending ? styles.cardPending : '',
    isDragging ? styles.cardDragging : '',
  ].filter(Boolean).join(' ');

  /** Opens the issue. Never fires mid-drag, since a travelling press is not a click. */
  function handleOpen(): void {
    if (isDragging) return;
    onSelectFamily?.(item);
    onOpen?.(item.key);
  }

  return (
    <div
      aria-label={`${item.typeName} ${item.key}: ${item.summary}`}
      className={cardClassNames}
      data-testid={`rollup-card-${item.key}`}
      data-type-bucket={item.typeBucket}
      onClick={handleOpen}
      onContextMenu={(contextEvent) => {
        if (menuActions.length === 0) return;
        contextEvent.preventDefault();
        setMenuPosition({ xPx: contextEvent.clientX, yPx: contextEvent.clientY });
      }}
      onKeyDown={(keyboardEvent) => {
        if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
          keyboardEvent.preventDefault();
          handleOpen();
        }
      }}
      ref={attachBothRefs}
      // Withheld as well as disabled: the hook's `disabled` stops the drag, but the attributes it
      // returns still advertise a draggable element to assistive technology.
      {...(isReadOnly ? {} : listeners)}
      {...(isReadOnly ? {} : attributes)}
      role="button"
      tabIndex={0}
    >
      {/* Top row, as on a Jira card: the key on the left, who owns it on the right. */}
      <div className={styles.cardTopRow}>
        <span className={styles.cardKey}>{item.key}</span>
        {/* Beside the key rather than in the footer: a blocked card is the one thing on this board
            somebody must not scroll past, and the words are there as well as the colour. Each reason
            is named, because "flagged" and "blocked by a link" are undone in completely different
            places and a card that says the wrong one sends somebody to the wrong place. */}
        {(item.impedimentReasons ?? []).map((reason) => {
          const { Icon, label } = IMPEDIMENT_LABELS[reason] ?? { Icon: BlockedIcon, label: reason };
          return (
            <span className={styles.cardFlag} key={reason}><Icon /> {label}</span>
          );
        })}
        <AssigneeAvatar displayName={item.assigneeDisplayName} />
      </div>

      {shouldShowStatus && (
        <div className={styles.cardStatusBadge}>
          {describeStatusPair(item.statusName, item.subStatusValue)}
        </div>
      )}

      <div className={styles.cardSummary}>{item.summary}</div>

      {item.fixVersionNames.length > 0 && (
        <div className={styles.cardChipRow}>
          {item.fixVersionNames.map((fixVersionName) => (
            <span className={styles.cardChip} key={fixVersionName}>{fixVersionName}</span>
          ))}
        </div>
      )}

      {/* Footer, as on a Jira card: type, priority, points. Type is text as well as colour. */}
      <div className={styles.cardFooterRow}>
        <IssueTypeIcon issueTypeName={item.typeName} />
        <PriorityBadge priorityName={item.issue.fields.priority?.name ?? 'None'} />
        {item.subStatusValue !== null && <span className={styles.cardSubStatus}>{item.subStatusValue}</span>}
        {item.storyPoints !== null && <span className={styles.cardPoints}>{item.storyPoints}</span>}
      </div>

      {item.checklistCompletion !== null && (
        <div className={styles.cardChecklist}>
          Checklist {item.checklistCompletion.completedCount}/{item.checklistCompletion.totalCount}
        </div>
      )}

      {/* The checklist's own items, nested inside the card they belong to. A third way teams break
          work down — and the only one the board used to reduce to a bare count, so the breakdown that
          costs nothing to create was the one you had to open Jira to read.

          Capped on a compact card rather than hidden: a ten-item checklist filled a whole lane on its
          own, but showing none of it would put back the bare count this was built to replace. The
          remainder is COUNTED, so a truncated list never passes for a complete one. */}
      {visibleChecklistItems.length > 0 && (
        <ul className={styles.checklistItemList}>
          {visibleChecklistItems.map((checklistItem) => (
            <li className={styles.checklistItemCard} data-state={checklistItem.state} key={checklistItem.id}>
              {/* A button, not a decoration: a checklist line is work somebody has to finish, and
                  finishing it meant leaving for Jira. The state is spelled out beside the marker
                  because "not ticked" covers both not-started and being-worked-on-right-now, which
                  is the distinction a standup actually turns on. */}
              <button
                aria-label={`${checklistItem.text} — ${describeChecklistState(checklistItem.state)}. `
                  + `Set to ${describeChecklistState(nextChecklistState(checklistItem.state))}`}
                className={styles.checklistItemMarker}
                disabled={onToggleChecklistItem === undefined || isReadOnly}
                onClick={(clickEvent) => {
                  // The card opens the detail view on click, and ticking a box is not asking for that.
                  clickEvent.stopPropagation();
                  onToggleChecklistItem?.(item.key, checklistItem.id, nextChecklistState(checklistItem.state));
                }}
                type="button"
              >
                {(() => {
                  const StateIcon = CHECKLIST_STATE_ICONS[checklistItem.state];
                  return <StateIcon />;
                })()}
                <span className={styles.checklistItemState}>{describeChecklistState(checklistItem.state)}</span>
              </button>
              <span className={styles.checklistItemText}>{checklistItem.text}</span>
              {checklistItem.assigneeUserId && (
                <span
                  className={styles.checklistItemAssignee}
                  // The raw id stays reachable, because it is what is written in Jira and what
                  // somebody editing the checklist by hand will have to type.
                  title={checklistItem.ownerDisplayName
                    ? `${checklistItem.ownerDisplayName} (@${checklistItem.assigneeUserId})`
                    : `@${checklistItem.assigneeUserId} — nobody on this board holds that Jira id`}
                >
                  {checklistItem.ownerDisplayName ?? `@${checklistItem.assigneeUserId}`}
                </span>
              )}
            </li>
          ))}
          {hiddenChecklistItemCount > 0 && (
            <li className={styles.checklistItemMore}>
              +{hiddenChecklistItemCount} more — open the card or focus this column to read them
            </li>
          )}
        </ul>
      )}

      {/* Only present in a focused column, where one status has the whole board width to itself. */}
      {detail?.descriptionExcerpt && (
        <div className={styles.cardDescription}>{detail.descriptionExcerpt}</div>
      )}

      {detail !== null && detail.attachmentCount > 0 && (
        <div className={styles.cardAttachments}>
          <AttachmentIcon /> {detail.attachmentCount} attachment{detail.attachmentCount === 1 ? '' : 's'}
        </div>
      )}

      {detail?.lastComment && (
        <div className={styles.cardLastComment}>
          <span className={styles.cardLastCommentAuthor}>{detail.lastComment.authorDisplayName}</span>
          {' '}· {formatCommentDate(detail.lastComment.createdAt)}
          <div>{detail.lastComment.excerpt}</div>
        </div>
      )}

      <div className={styles.cardRoute}>{describeRollUpRoute(item.route)}</div>

      {/* A relationship the precedence chain did not take is still a fact about this work. */}
      {item.route.unchosenCandidates.length > 0 && (
        <div className={styles.cardRoute}>
          Also linked to {item.route.unchosenCandidates.map((candidate) => candidate.toKey).join(', ')}
        </div>
      )}

      {/* The one case where the route taken is NOT the highest-ranked one, so it is worth saying. */}
      {item.route.notes.includes('preferred-unfinished-feature') && (
        <div className={styles.cardRoute}>
          Filed under the Feature still in flight — the stronger link reaches one that has shipped
        </div>
      )}

      {item.route.notes.includes('link-loop-detected') && (
        <div className={styles.cardRoute}><WarningIcon /> Its links form a loop — worth tidying in Jira</div>
      )}

      {errorMessage !== null && <div className={styles.cardError}>{errorMessage}</div>}

      <BoardContextMenu
        actions={menuActions}
        onClose={() => setMenuPosition(null)}
        ownerKey={item.key}
        position={menuPosition}
      />
    </div>
  );
}
