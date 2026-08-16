// BoardHintPopup.tsx — A one-line note at the pointer, for something that did not work and does not
// need a paragraph about it.
//
// The board already had one way to report a failure: a message pinned to the card, with the long
// version folded behind it and a board notice besides. That is right for a configuration problem
// somebody has to go and fix. It was badly wrong for "the checklist will not jump two steps at once",
// which needs a sentence and then to go away — pinning that to a card left a permanent red mark on
// work that was fine, about an action nobody was going to retry.

import { useEffect } from 'react';

import styles from '../RollupBoardTab.module.css';

/** How long a hint stays before it clears itself. Long enough to read twice, short enough to forget. */
const HINT_VISIBLE_MS = 4500;

export interface BoardHintPopupProps {
  /** Where it was raised, in viewport coordinates. Null means nothing to say. */
  position: { xPx: number; yPx: number } | null;
  message: string;
  onDismiss: () => void;
}

/** Shows one short message where the thing happened, then gets out of the way. */
export function BoardHintPopup({ position, message, onDismiss }: BoardHintPopupProps): React.JSX.Element | null {
  useEffect(() => {
    if (position === null) return undefined;
    const timeoutId = window.setTimeout(onDismiss, HINT_VISIBLE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [position, message, onDismiss]);

  if (position === null) return null;

  return (
    <div
      className={styles.boardHint}
      data-testid="rollup-board-hint"
      // Announced, because somebody who cannot see where the pointer was still needs to be told the
      // drop did nothing.
      role="status"
      style={{ left: `${position.xPx}px`, top: `${position.yPx}px` }}
    >
      {message}
      <button aria-label="Dismiss" className={styles.boardHintClose} onClick={onDismiss} type="button">×</button>
    </div>
  );
}
