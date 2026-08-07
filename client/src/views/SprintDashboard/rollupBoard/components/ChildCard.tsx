// ChildCard.tsx — One issue on the Roll-Up Board.
//
// The card states three things a reader would otherwise have to work out: what kind of issue it is,
// what state it is actually in, and how it rolls up to the Feature whose lane it sits in. Colour
// carries the first of those quickly, but never alone — the type icon and its text label say the
// same thing, so the card is just as readable to someone who cannot distinguish the colours.

import { useDraggable } from '@dnd-kit/core';

import { AssigneeAvatar } from '../../../../components/IssueMeta/AssigneeAvatar.tsx';
import { IssueTypeIcon } from '../../../../components/IssueMeta/IssueTypeIcon.tsx';
import { StatusChip } from '../../../../components/IssueMeta/StatusChip.tsx';
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

  if (route.precedenceRank === 'via-qa-issue') {
    return `Raised via ${routeDescription}`;
  }
  if (route.precedenceRank === 'dev-story') {
    return `Raised against ${routeDescription}`;
  }
  return `Rolls up via ${routeDescription}`;
}

/** Renders one issue card, colour-coded and labelled by type. */
export function ChildCard({
  item,
  isHighlighted = false,
  isPending = false,
  errorMessage = null,
  onOpen,
  onSelectFamily,
}: ChildCardProps) {
  // The drag listeners live on the grip alone, so everything else on the card stays clickable —
  // the same split the Todo board uses. A whole-card drag surface makes the card unopenable.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } = useDraggable({ id: item.key });

  const cardClassNames = [
    styles.card,
    CARD_CLASS_BY_TYPE_BUCKET[item.typeBucket],
    isHighlighted ? styles.cardHighlighted : '',
    isPending ? styles.cardPending : '',
  ].filter(Boolean).join(' ');

  return (
    <button
      className={cardClassNames}
      data-testid={`rollup-card-${item.key}`}
      data-type-bucket={item.typeBucket}
      onClick={() => {
        onSelectFamily?.(item);
        onOpen?.(item.key);
      }}
      ref={setNodeRef}
      type="button"
    >
      <span className={styles.cardHeaderRow}>
        <span
          className={styles.cardGrip}
          ref={setActivatorNodeRef}
          {...listeners}
          {...attributes}
          aria-label={`Drag ${item.key} to another column`}
        >
          ⠿
        </span>
        <span className={styles.cardKey}>{item.key}</span>
        <IssueTypeIcon issueTypeName={item.typeName} />
      </span>

      <span className={styles.cardSummary}>{item.summary}</span>

      <span className={styles.cardMetaRow}>
        <StatusChip statusName={item.statusName} />
        {item.subStatusValue !== null && <span className={styles.cardTypeLabel}>{item.subStatusValue}</span>}
        <AssigneeAvatar displayName={item.assigneeDisplayName} />
        {item.storyPoints !== null && <span className={styles.cardTypeLabel}>{item.storyPoints} pts</span>}
      </span>

      {/* Checklist progress only appears when the issue genuinely carries checklist data. */}
      {item.checklistCompletion !== null && (
        <span className={styles.cardChecklist}>
          Checklist {item.checklistCompletion.completedCount}/{item.checklistCompletion.totalCount}
        </span>
      )}

      <span className={styles.cardRoute}>{describeRollUpRoute(item.route)}</span>

      {/* A relationship the precedence chain did not take is still a fact about this work. */}
      {item.route.unchosenCandidates.length > 0 && (
        <span className={styles.cardRoute}>
          Also linked to {item.route.unchosenCandidates.map((candidate) => candidate.toKey).join(', ')}
        </span>
      )}

      {item.route.notes.includes('link-loop-detected') && (
        <span className={styles.cardRoute}>⚠ Its links form a loop — worth tidying in Jira</span>
      )}

      {errorMessage !== null && <span className={styles.cardError}>{errorMessage}</span>}
    </button>
  );
}
