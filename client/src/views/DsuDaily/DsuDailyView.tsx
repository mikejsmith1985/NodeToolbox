// DsuDailyView.tsx — Standalone DSU Daily React view for preparing and posting Jira standups.

import { useDsuDailyState } from './hooks/useDsuDailyState.ts';
import styles from './DsuDailyView.module.css';

const VIEW_TITLE = 'DSU Daily';
const VIEW_SUBTITLE = 'Prepare yesterday, today, and blocker notes from your recent Jira activity.';
const EMPTY_STATE_MESSAGE = 'No DSU draft yet — click Refresh to load your Jira activity.';

export default function DsuDailyView() {
  const dsuDailyState = useDsuDailyState();
  const hasDraftText = Boolean(
    dsuDailyState.draft.yesterday || dsuDailyState.draft.today || dsuDailyState.draft.blockers,
  );

  return (
    <section className={styles.dsuDailyView} aria-label={VIEW_TITLE}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
        <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
      </header>

      {!hasDraftText && !dsuDailyState.isLoading && !dsuDailyState.errorMessage && (
        <p className={styles.emptyState}>{EMPTY_STATE_MESSAGE}</p>
      )}
      {dsuDailyState.isLoading && (
        <p className={styles.statusMessage} aria-live="polite">
          Loading your activity…
        </p>
      )}
      {dsuDailyState.errorMessage && (
        <p className={styles.errorMessage} role="alert">
          {dsuDailyState.errorMessage}
        </p>
      )}

      <div className={styles.contentGrid}>
        <div className={styles.editorColumn}>
          <label className={styles.fieldLabel}>
            Yesterday
            <textarea
              className={styles.textarea}
              aria-label="Yesterday"
              rows={5}
              value={dsuDailyState.draft.yesterday}
              onChange={(changeEvent) => dsuDailyState.setYesterday(changeEvent.target.value)}
            />
          </label>
          <label className={styles.fieldLabel}>
            Today
            <textarea
              className={styles.textarea}
              aria-label="Today"
              rows={5}
              value={dsuDailyState.draft.today}
              onChange={(changeEvent) => dsuDailyState.setToday(changeEvent.target.value)}
            />
          </label>
          <label className={styles.fieldLabel}>
            Blockers
            <textarea
              className={styles.textarea}
              aria-label="Blockers"
              rows={3}
              placeholder="None"
              value={dsuDailyState.draft.blockers}
              onChange={(changeEvent) => dsuDailyState.setBlockers(changeEvent.target.value)}
            />
          </label>
        </div>

        <aside className={styles.previewColumn} aria-label="Standup preview">
          <div className={styles.previewPanel}>
            <h2 className={styles.previewTitle}>Standup Preview</h2>
            <pre className={styles.previewText}>{dsuDailyState.formattedText}</pre>
          </div>

          <div className={styles.actionRow}>
            <button
              type="button"
              className={styles.button}
              disabled={dsuDailyState.isLoading}
              onClick={() => {
                void dsuDailyState.refresh();
              }}
            >
              {dsuDailyState.isLoading ? 'Loading…' : '↻ Refresh'}
            </button>
            <button
              type="button"
              className={styles.buttonPrimary}
              onClick={() => {
                void dsuDailyState.copy();
              }}
            >
              📋 Copy
            </button>
          </div>

          <div className={styles.postRow}>
            <input
              className={styles.postInput}
              aria-label="Issue key for Jira comment"
              placeholder="Issue key (e.g. PROJ-123)"
              value={dsuDailyState.postKey}
              onChange={(changeEvent) => dsuDailyState.setPostKey(changeEvent.target.value)}
            />
            <button
              type="button"
              className={styles.buttonPrimary}
              disabled={dsuDailyState.postStatus === 'posting'}
              onClick={() => {
                void dsuDailyState.postComment();
              }}
            >
              {dsuDailyState.postStatus === 'posting' ? 'Posting…' : 'Post to Jira'}
            </button>
          </div>
          <PostStatusMessage status={dsuDailyState.postStatus} errorMessage={dsuDailyState.postError} />
        </aside>
      </div>
    </section>
  );
}

interface PostStatusMessageProps {
  status: 'idle' | 'posting' | 'success' | 'error';
  errorMessage: string | null;
}

function PostStatusMessage({ status, errorMessage }: PostStatusMessageProps) {
  if (status === 'idle') return null;
  if (status === 'posting') return <p className={styles.statusMessage}>Posting…</p>;
  if (status === 'success') return <p className={styles.statusMessage}>Comment posted to Jira.</p>;
  return (
    <p className={styles.errorMessage} role="alert">
      {errorMessage ?? 'Could not post comment.'}
    </p>
  );
}
