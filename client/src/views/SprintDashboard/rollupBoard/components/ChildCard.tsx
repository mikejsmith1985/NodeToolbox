// ChildCard.tsx — One issue on the Roll-Up Board, shaped like a Jira board card.
//
// The whole card is the drag handle, the way it is on a Jira board: you pick a card up by touching
// it, not by finding a grip. An earlier version made the card a <button> with the drag listeners on
// a nested grip — a button inside a button, so the outer click fired on release and every drag
// attempt opened the detail panel instead of moving the card.
//
// Click and drag are told apart by the drag sensor's activation distance: a press that never moves
// is a click and opens the issue; a press that travels is a drag.

import { useDraggable } from '@dnd-kit/core';

import { AssigneeAvatar } from '../../../../components/IssueMeta/AssigneeAvatar.tsx';
import { IssueTypeIcon } from '../../../../components/IssueMeta/IssueTypeIcon.tsx';
import { PriorityBadge } from '../../../../components/IssueMeta/PriorityBadge.tsx';
import styles from '../RollupBoardTab.module.css';
import type { IssueTypeBucket, RollUpRoute, RollupBoardItem } from '../rollupBoardTypes.ts';

/** Which colour class carries each visual family. Text always says the same thing (FR-028). */
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
}: ChildCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.key });

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
      onKeyDown={(keyboardEvent) => {
        if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
          keyboardEvent.preventDefault();
          handleOpen();
        }
      }}
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
    >
      {/* Top row, as on a Jira card: the key on the left, who owns it on the right. */}
      <div className={styles.cardTopRow}>
        <span className={styles.cardKey}>{item.key}</span>
        <AssigneeAvatar displayName={item.assigneeDisplayName} />
      </div>

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

      <div className={styles.cardRoute}>{describeRollUpRoute(item.route)}</div>

      {/* A relationship the precedence chain did not take is still a fact about this work. */}
      {item.route.unchosenCandidates.length > 0 && (
        <div className={styles.cardRoute}>
          Also linked to {item.route.unchosenCandidates.map((candidate) => candidate.toKey).join(', ')}
        </div>
      )}

      {item.route.notes.includes('link-loop-detected') && (
        <div className={styles.cardRoute}>⚠ Its links form a loop — worth tidying in Jira</div>
      )}

      {errorMessage !== null && <div className={styles.cardError}>{errorMessage}</div>}
    </div>
  );
}
