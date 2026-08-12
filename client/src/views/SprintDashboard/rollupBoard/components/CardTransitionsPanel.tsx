// CardTransitionsPanel.tsx — "Where can this go from here?", answered on the open card.
//
// Every other way of finding this out on a board is a guess: drag a card at a column and learn whether
// the workflow allows it from whether it fails. For a card in Unmapped there is not even a guess
// available, because no column claims the state it is in.
//
// Jira knows exactly, so the open card asks and shows the answer — each destination named with the
// COLUMN it lands in rather than only the Jira status, since the column is the thing a board user was
// picturing. Each is a button, because having been told where a card can go, the next thing anybody
// wants is to send it there.

import {
  describeCardTransitionOption,
  NO_TRANSITIONS_MESSAGE,
  type CardTransitionOption,
} from '../cardTransitions.ts';
import styles from '../RollupBoardTab.module.css';

export interface CardTransitionsPanelProps {
  options: readonly CardTransitionOption[];
  /** True while Jira is being asked; an empty list means something different before and after. */
  isLoading: boolean;
  /** The transition currently being applied, so only that button reads as busy. */
  pendingTransitionId: string | null;
  onApply: (option: CardTransitionOption) => void;
}

/** The moves Jira will accept from where this issue is now, each one clickable. */
export function CardTransitionsPanel({
  options,
  isLoading,
  pendingTransitionId,
  onApply,
}: CardTransitionsPanelProps) {
  return (
    <section className={styles.transitionsPanel} data-testid="rollup-card-transitions">
      <h4 className={styles.transitionsHeading}>Where this can go from here</h4>

      {isLoading && <p className={styles.transitionsNote}>Asking Jira…</p>}

      {/* Only once the read has finished: an empty list mid-flight is not yet an answer. */}
      {!isLoading && options.length === 0 && (
        <p className={styles.transitionsNote}>{NO_TRANSITIONS_MESSAGE}</p>
      )}

      {options.map((option) => (
        <button
          className={styles.transitionOption}
          disabled={pendingTransitionId !== null}
          key={option.transitionId}
          onClick={() => onApply(option)}
          type="button"
        >
          <span className={styles.transitionOptionName}>
            {option.transitionName} → {option.toStatusName}
          </span>
          <span className={styles.transitionOptionDetail}>
            {pendingTransitionId === option.transitionId ? 'Moving…' : describeCardTransitionOption(option)}
          </span>
        </button>
      ))}
    </section>
  );
}
