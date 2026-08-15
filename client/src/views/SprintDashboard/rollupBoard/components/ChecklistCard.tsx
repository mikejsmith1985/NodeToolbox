// ChecklistCard.tsx — One Smart Checklist item, drawn as a card in the column of its own state.
//
// This is deliberately NOT a copy of ChildCard. A checklist item is not a Jira issue: it has no key,
// no permalink, no transitions and no children, so this card offers none of those. Reusing the issue
// card and disabling half of it would have produced a card that LOOKS like it can be opened in Jira,
// linked to, or given children — and every one of those would be a dead end discovered by clicking.
//
// What it does have is the three things a board needs: a state, an owner, and the issue it belongs
// to. Dragging it between the columns the team mapped writes that state back to Jira; everything else
// a card can normally do is simply absent rather than present-and-broken.

import { useDraggable } from '@dnd-kit/core';

import { buildJiraBrowseUrl } from '../../../../utils/jiraBrowseUrl.ts';
import { useConnectionStore } from '../../../../store/connectionStore.ts';

import { describeChecklistState, nextChecklistState } from '../checklistWrite.ts';
import { buildChecklistDragId, type ChecklistCard as ChecklistCardModel } from '../checklistCards.ts';
import type { ChecklistItemState } from '../checklistItems.ts';
import styles from '../RollupBoardTab.module.css';
import {
  ChecklistDoneIcon,
  ChecklistInProgressIcon,
  ChecklistOpenIcon,
  NotApplicableIcon,
} from './BoardIcons.tsx';

/** One icon per state, so the state survives anywhere colour does not. */
const STATE_ICONS: Record<ChecklistItemState, () => React.JSX.Element> = {
  open: ChecklistOpenIcon,
  'in-progress': ChecklistInProgressIcon,
  // Set aside on purpose, which is neither done nor waiting — the same glyph the board already uses
  // for "did not apply".
  skipped: NotApplicableIcon,
  done: ChecklistDoneIcon,
};

export interface ChecklistCardProps {
  card: ChecklistCardModel;
  /** Another discipline's work, or a board that cannot write this checklist: shown, never dragged. */
  isReadOnly?: boolean;
  /** True while this card's state change is still in flight. */
  isPending?: boolean;
  /** Why the last change to this item failed, said on the card rather than in a toast. */
  errorMessage?: string | null;
  /** Moves the item on without a drag. Dragging is the gesture; this is the one-click shortcut. */
  onSetState?: (card: ChecklistCardModel, nextState: ChecklistItemState) => void;
  /**
   * Opens the ISSUE this item belongs to.
   *
   * A checklist item has no detail of its own to open — no key, no description, no history. Its
   * parent has all of that, plus the whole checklist in context, so that is what a click offers
   * rather than a panel that would have almost nothing in it.
   */
  onOpenParent?: (card: ChecklistCardModel) => void;
}

/** Renders one checklist item as a draggable card. */
export function ChecklistCard({
  card,
  isReadOnly = false,
  isPending = false,
  errorMessage = null,
  onSetState,
  onOpenParent,
}: ChecklistCardProps): React.JSX.Element {
  const jiraBaseUrl = useConnectionStore((connectionState) => connectionState.proxyStatus?.jira?.baseUrl ?? '');
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: buildChecklistDragId(card),
    disabled: isReadOnly,
  });

  const StateIcon = STATE_ICONS[card.state];
  const cardClassNames = [
    styles.card,
    styles.cardChecklistItem,
    isPending ? styles.cardPending : '',
    isDragging ? styles.cardDragging : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      aria-label={`Checklist item ${card.text} — ${describeChecklistState(card.state)}`}
      className={cardClassNames}
      data-state={card.state}
      data-testid={`rollup-checklist-card-${card.id}`}
      onClick={() => { if (!isDragging) onOpenParent?.(card); }}
      ref={setNodeRef}
      title={`Checklist item on ${card.parentKey} — click to open it`}
      {...attributes}
      {...listeners}
    >
      <div className={styles.checklistCardHead}>
        {/* Both gestures reach the same write. Dragging says where it should go; clicking is for
            the overwhelmingly common case of ticking the next one off without aiming at a column. */}
        <button
          aria-label={`${card.text} — ${describeChecklistState(card.state)}. `
            + `Set to ${describeChecklistState(nextChecklistState(card.state))}`}
          className={styles.checklistCardState}
          disabled={onSetState === undefined || isReadOnly}
          onClick={(clickEvent) => {
            clickEvent.stopPropagation();
            onSetState?.(card, nextChecklistState(card.state));
          }}
          type="button"
        >
          <StateIcon />
          {describeChecklistState(card.state)}
        </button>
        {/* Says what kind of thing this is. A card that looked like a sub-task but had no key would
            be read as a broken sub-task rather than as a checklist item. */}
        <span className={styles.checklistCardKind}>Checklist</span>
      </div>

      <span className={styles.checklistCardText}>{card.text}</span>

      {card.ownerFilterId ? (
        <span
          className={styles.checklistCardOwner}
          title={card.ownerDisplayName
            ? `${card.ownerDisplayName} (@${card.ownerFilterId})`
            : `@${card.ownerFilterId} — nobody on this board holds that Jira id`}
        >
          {card.ownerDisplayName ?? `@${card.ownerFilterId}`}
        </span>
      ) : null}

      {errorMessage ? (
        <span className={styles.cardError}>
          {errorMessage}
          {/* The escape, beside the failure rather than left to be worked out. Where the board cannot
              write this checklist, Jira can — and this is the one issue that needs opening. */}
          {jiraBaseUrl ? (
            <a
              className={styles.checklistCardJiraLink}
              href={buildJiraBrowseUrl(card.parentKey, jiraBaseUrl)}
              onClick={(clickEvent) => clickEvent.stopPropagation()}
              rel="noreferrer"
              target="_blank"
            >
              Change it in {card.parentKey} ↗
            </a>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
