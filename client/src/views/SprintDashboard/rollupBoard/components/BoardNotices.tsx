// BoardNotices.tsx — Every thing the board wants to tell you, in one box instead of nine.
//
// The board is deliberately talkative: it names hidden issues, unreadable Features, work missing a PI,
// Features with nothing under them, and more. Each message earned its place, but stacked one above
// another they pushed the actual board off the screen — and buried anything else rendered among them,
// which is how the "Add work" dialog came to look like a button that did nothing.
//
// So they collapse into a single line that says how many there are, opens for the detail, and can be
// dismissed outright. Collapsed is the default: a notice you have already read and acted on should not
// cost you screen space every time the board reloads.

import { useState } from 'react';

import styles from '../RollupBoardTab.module.css';

/** One thing the board wants to say. */
export interface BoardNotice {
  /** Stable across reloads, so a dismissed notice stays dismissed while it is still true. */
  id: string;
  /** `warning` is something to act on; `info` is something to know. */
  tone: 'warning' | 'info';
  /** One line. The detail, if any, sits under it when opened. */
  summary: string;
  detail?: React.ReactNode;
}

export interface BoardNoticesProps {
  notices: readonly BoardNotice[];
  /** Opens expanded instead of collapsed — used when something genuinely blocks the board. */
  shouldStartExpanded?: boolean;
}

/**
 * The one-line headline: how many there are, and how many actually want something.
 *
 * Counting the warnings separately matters because most notices are context rather than problems —
 * "6 notices" reads as an alarm, while "6 notices · 2 need attention" reads as a status.
 */
export function describeNoticeCount(notices: readonly BoardNotice[]): string {
  const warningCount = notices.filter((notice) => notice.tone === 'warning').length;
  const noticeWord = notices.length === 1 ? 'notice' : 'notices';

  if (warningCount === 0) return `${notices.length} board ${noticeWord}`;
  return `${notices.length} board ${noticeWord} · ${warningCount} need${warningCount === 1 ? 's' : ''} attention`;
}

/** The board's messages, collapsed into one line until asked for. */
export function BoardNotices({ notices, shouldStartExpanded = false }: BoardNoticesProps) {
  const [isExpanded, setIsExpanded] = useState(shouldStartExpanded);
  // Dismissal lasts until the board is reloaded: a notice is a fact about the current data, so it
  // SHOULD come back if it is still true next time — silencing it permanently would hide a real gap.
  const [isDismissed, setIsDismissed] = useState(false);

  if (notices.length === 0 || isDismissed) {
    return null;
  }

  const hasWarning = notices.some((notice) => notice.tone === 'warning');

  return (
    <div className={styles.noticePanel} data-testid="rollup-board-notices">
      <div className={styles.noticeHeader}>
        <span className={hasWarning ? styles.noticeHeadlineWarning : styles.noticeHeadline}>
          {hasWarning ? '⚠' : 'ℹ'} {describeNoticeCount(notices)}
        </span>
        <button
          className={styles.actionButton}
          onClick={() => setIsExpanded(!isExpanded)}
          type="button"
        >
          {isExpanded ? 'Hide details' : 'Show details'}
        </button>
        <button
          className={styles.actionButton}
          onClick={() => setIsDismissed(true)}
          title="Hide these until the board is next loaded"
          type="button"
        >
          Dismiss
        </button>
      </div>

      {isExpanded && (
        <ul className={styles.noticeList}>
          {notices.map((notice) => (
            <li className={notice.tone === 'warning' ? styles.noticeItemWarning : styles.noticeItem} key={notice.id}>
              {notice.summary}
              {notice.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
