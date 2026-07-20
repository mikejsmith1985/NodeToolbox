// RecentIssuesList.tsx — The pre-search list of recently viewed issues in the Quick Issue Lookup popup.
//
// Shown when no key has been entered yet, so re-opening a ticket you just looked at is one keystroke
// away. Each row re-opens its issue on click or Enter; ArrowUp/ArrowDown move focus between rows.

import styles from './QuickIssueLookup.module.css';
import type { RecentIssue } from '../../store/recentIssuesStore.ts';

const RECENTS_LABEL = 'Recent';

export interface RecentIssuesListProps {
  entries: RecentIssue[];
  /** Called with the chosen issue key to re-open it. */
  onSelect: (issueKey: string) => void;
}

/** Moves keyboard focus to the previous/next recent row so the list is arrow-navigable. */
function moveFocusToSibling(currentButton: HTMLButtonElement, direction: -1 | 1): void {
  const listButtons = Array.from(currentButton.closest('ul')?.querySelectorAll('button') ?? []);
  const currentIndex = listButtons.indexOf(currentButton);
  const nextIndex = Math.min(Math.max(currentIndex + direction, 0), listButtons.length - 1);
  (listButtons[nextIndex] as HTMLButtonElement | undefined)?.focus();
}

/** Renders the recents list, or nothing when there are no recents yet (blank on first-ever use). */
export function RecentIssuesList({ entries, onSelect }: RecentIssuesListProps): React.JSX.Element | null {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className={styles.recents}>
      <span className={styles.recentsLabel}>{RECENTS_LABEL}</span>
      <ul className={styles.recentsList} role="list">
        {entries.map((entry) => (
          <li key={entry.key}>
            <button
              className={styles.recentItem}
              type="button"
              onClick={() => onSelect(entry.key)}
              onKeyDown={(keyboardEvent) => {
                if (keyboardEvent.key === 'ArrowDown') {
                  keyboardEvent.preventDefault();
                  moveFocusToSibling(keyboardEvent.currentTarget, 1);
                }
                if (keyboardEvent.key === 'ArrowUp') {
                  keyboardEvent.preventDefault();
                  moveFocusToSibling(keyboardEvent.currentTarget, -1);
                }
              }}
            >
              <span className={styles.recentKey}>{entry.key}</span>
              <span className={styles.recentSummary}>{entry.summary}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
