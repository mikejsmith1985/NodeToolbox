// WorkLogView.tsx — Work Log timer view: per-issue stopwatches + Jira worklog post.

import { useMemo, useState } from 'react';

import { PrimaryTabs } from '../../components/PrimaryTabs/PrimaryTabs';
import { useWorkLogState, type WorkLogTimer } from './hooks/useWorkLogState.ts';
import styles from './WorkLogView.module.css';

const VIEW_TITLE = 'Work Log';
const VIEW_SUBTITLE =
  'Track time per Jira issue with running stopwatches, then post the elapsed time as a worklog entry.';

const TODAY_TAB = 'today';
const HISTORY_TAB = 'history';
type ActiveTabName = typeof TODAY_TAB | typeof HISTORY_TAB;

interface PostDialogState {
  issueKey: string;
  initialSeconds: number;
}

export default function WorkLogView() {
  const workLogState = useWorkLogState();

  const [activeTabName, setActiveTabName] = useState<ActiveTabName>(TODAY_TAB);
  const [postDialogState, setPostDialogState] = useState<PostDialogState | null>(null);
  const [dialogTimeText, setDialogTimeText] = useState('');
  const [dialogCommentText, setDialogCommentText] = useState('');

  const todayHistory = useMemo(() => {
    const todayDateString = new Date().toDateString();
    return workLogState.history.filter(
      (historyEntry) => new Date(historyEntry.postedAtIso).toDateString() === todayDateString,
    );
  }, [workLogState.history]);

  const historyTabOptions = useMemo(
    () => [
      { key: TODAY_TAB, label: `Today (${todayHistory.length})` },
      { key: HISTORY_TAB, label: `History (${workLogState.history.length})` },
    ] as const,
    [todayHistory.length, workLogState.history.length],
  );

  function renderHistoryTable(entries: typeof workLogState.history, emptyMessage: string): React.ReactNode {
    if (entries.length === 0) {
      return <p className={styles.emptyState}>{emptyMessage}</p>;
    }

    return (
      <table className={styles.historyTable}>
        <thead>
          <tr>
            <th>Posted</th>
            <th>Issue</th>
            <th>Duration</th>
            <th>Comment</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((historyEntry, historyIndex) => (
            <tr key={`${historyEntry.issueKey}-${historyEntry.postedAtIso}-${historyIndex}`}>
              <td>{new Date(historyEntry.postedAtIso).toLocaleString()}</td>
              <td>{historyEntry.issueKey}</td>
              <td>{workLogState.formatDuration(historyEntry.durationSeconds)}</td>
              <td>{historyEntry.comment || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function openPostDialogForTimer(timer: WorkLogTimer): void {
    const seconds = workLogState.computeElapsedSeconds(timer);
    setPostDialogState({ issueKey: timer.issueKey, initialSeconds: seconds });
    setDialogTimeText(workLogState.formatDuration(seconds));
    setDialogCommentText('');
  }

  async function handleConfirmPostDialog(): Promise<void> {
    if (!postDialogState) return;
    const parsedSeconds = workLogState.parseTimeInput(dialogTimeText) || postDialogState.initialSeconds;
    await workLogState.postWorkLog(postDialogState.issueKey, parsedSeconds, dialogCommentText.trim());
    setPostDialogState(null);
  }

  return (
    <section className={styles.workLogView} aria-label={VIEW_TITLE}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
        <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
      </header>

      <div className={styles.searchRow}>
        <input
          className={styles.searchInput}
          aria-label="Issue key to track"
          placeholder="Issue key (e.g. TBX-123)"
          value={workLogState.searchKey}
          onChange={(changeEvent) => workLogState.setSearchKey(changeEvent.target.value)}
          onKeyDown={(keyEvent) => {
            if (keyEvent.key === 'Enter') {
              void workLogState.addTimerByIssueKey();
            }
          }}
        />
        <button
          type="button"
          className={styles.buttonPrimary}
          onClick={() => {
            void workLogState.addTimerByIssueKey();
          }}
        >
          ➕ Add Timer
        </button>
      </div>
      {workLogState.searchStatus && (
        <p className={styles.searchStatus} aria-live="polite">
          {workLogState.searchStatus}
        </p>
      )}

      {workLogState.timers.length === 0 ? (
        <p className={styles.emptyState}>No active timers — add an issue key to start tracking.</p>
      ) : (
        <div className={styles.timersGrid}>
          {workLogState.timers.map((existingTimer) => {
            const elapsedSeconds = workLogState.computeElapsedSeconds(existingTimer);
            return (
              <article key={existingTimer.issueKey} className={styles.timerCard}>
                <span className={styles.timerKey}>{existingTimer.issueKey}</span>
                <span className={styles.timerSummary} title={existingTimer.summary}>
                  {existingTimer.summary || '—'}
                </span>
                <span className={styles.timerElapsed} aria-label={`Elapsed time for ${existingTimer.issueKey}`}>
                  {workLogState.formatDuration(elapsedSeconds)}
                </span>
                <div className={styles.timerControls}>
                  {existingTimer.isRunning ? (
                    <button
                      type="button"
                      className={styles.button}
                      onClick={() => workLogState.pauseTimer(existingTimer.issueKey)}
                    >
                      ⏸ Pause
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.button}
                      onClick={() => workLogState.startTimer(existingTimer.issueKey)}
                    >
                      ▶ Start
                    </button>
                  )}
                  <button
                    type="button"
                    className={styles.buttonPrimary}
                    onClick={() => openPostDialogForTimer(existingTimer)}
                  >
                    📝 Log
                  </button>
                  <button
                    type="button"
                    className={styles.buttonDanger}
                    onClick={() => workLogState.removeTimer(existingTimer.issueKey)}
                    aria-label={`Remove timer for ${existingTimer.issueKey}`}
                  >
                    ✕
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <PrimaryTabs
        tabs={historyTabOptions}
        activeTab={activeTabName}
        onChange={setActiveTabName}
        ariaLabel="Work log history tabs"
        idPrefix="work-log-history"
      />

      <section
        id="work-log-history-today-panel"
        role="tabpanel"
        aria-labelledby="work-log-history-today-tab"
        hidden={activeTabName !== TODAY_TAB}
      >
        {renderHistoryTable(todayHistory, 'No work logged today.')}
      </section>

      <section
        id="work-log-history-history-panel"
        role="tabpanel"
        aria-labelledby="work-log-history-history-tab"
        hidden={activeTabName !== HISTORY_TAB}
      >
        {renderHistoryTable([...workLogState.history].reverse(), 'No work logged yet.')}
      </section>

      {postDialogState && (
        <div className={styles.dialogBackdrop} role="dialog" aria-modal="true" aria-label="Log work">
          <div className={styles.dialogPanel}>
            <h2>Log work for {postDialogState.issueKey}</h2>
            <label>
              Time (e.g. 1h 30m, 45m)
              <input
                className={styles.searchInput}
                value={dialogTimeText}
                onChange={(changeEvent) => setDialogTimeText(changeEvent.target.value)}
                aria-label="Worklog duration"
              />
            </label>
            <label>
              Comment (optional)
              <input
                className={styles.searchInput}
                value={dialogCommentText}
                onChange={(changeEvent) => setDialogCommentText(changeEvent.target.value)}
                aria-label="Worklog comment"
              />
            </label>
            {workLogState.postError && (
              <p className={styles.errorMessage} role="alert">
                {workLogState.postError}
              </p>
            )}
            <div className={styles.dialogActions}>
              <button type="button" className={styles.button} onClick={() => setPostDialogState(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={styles.buttonPrimary}
                disabled={workLogState.isPosting}
                onClick={() => {
                  void handleConfirmPostDialog();
                }}
              >
                {workLogState.isPosting ? 'Posting…' : 'Post Worklog'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
