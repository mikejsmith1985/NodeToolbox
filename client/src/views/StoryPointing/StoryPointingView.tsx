// StoryPointingView.tsx — Single-user Story Pointing planning deck.
//
// The render layer presents the legacy pointing workflow as a focused React view:
// load Jira issues by JQL or issue keys, estimate the current card with a planning
// poker deck, reveal the facilitator's vote, and optionally save a numeric estimate.
// Multi-user relay/WebSocket voting is deferred until NodeToolbox has shared session
// infrastructure.

import {
  POINTING_SCALE,
  type StoryPointVote,
  useStoryPointingState,
} from './hooks/useStoryPointingState.ts';
import styles from './StoryPointingView.module.css';

const VIEW_TITLE = 'Story Pointing';
const VIEW_SUBTITLE = 'Load Jira issues, point one card at a time, reveal the vote, and save final estimates.';
const QUERY_PLACEHOLDER = 'JQL or comma-separated keys (e.g. TBX-101, TBX-102)';
const EMPTY_DECK_MESSAGE = 'Load a JQL search or comma-separated issue keys to start pointing.';
const UNKNOWN_VOTE_LABEL = 'unknown';
const NO_VALUE_LABEL = '—';
const FIRST_HUMAN_POSITION = 1;

export default function StoryPointingView() {
  const pointingState = useStoryPointingState();
  const currentPosition = pointingState.deck.length > 0 ? pointingState.currentIssueIndex + FIRST_HUMAN_POSITION : 0;
  const saveButtonLabel = typeof pointingState.selectedVote === 'number'
    ? `💾 Save ${pointingState.selectedVote} points`
    : '💾 Save points';

  return (
    <section className={styles.storyPointingView} aria-label={VIEW_TITLE}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
        <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
      </header>

      <div className={styles.controlsPanel}>
        <textarea
          className={styles.queryInput}
          aria-label="Jira issue search"
          placeholder={QUERY_PLACEHOLDER}
          value={pointingState.queryText}
          onChange={(changeEvent) => pointingState.setQueryText(changeEvent.target.value)}
        />
        <div className={styles.controlButtons}>
          <button
            type="button"
            className={styles.buttonPrimary}
            disabled={pointingState.isLoading}
            onClick={() => {
              void pointingState.loadIssues();
            }}
          >
            {pointingState.isLoading ? 'Loading…' : '↻ Load Issues'}
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={pointingState.deck.length === 0}
            onClick={pointingState.clearDeck}
          >
            Clear Deck
          </button>
        </div>
      </div>

      <div className={styles.summaryBar} aria-live="polite">
        <span>
          {currentPosition} / {pointingState.deck.length} issues · {pointingState.session.pointedCount} pointed ·{' '}
          {pointingState.session.skippedCount} skipped
        </span>
        {pointingState.currentIssue && (
          <label className={styles.jumpLabel}>
            Jump to issue
            <select
              className={styles.jumpSelect}
              aria-label="Jump to issue"
              value={pointingState.currentIssueIndex}
              onChange={(changeEvent) => pointingState.goToIssue(Number(changeEvent.target.value))}
            >
              {pointingState.deck.map((deckIssue, deckIssueIndex) => (
                <option key={deckIssue.key} value={deckIssueIndex}>
                  {deckIssue.key} — {deckIssue.summary}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {pointingState.loadError && (
        <p className={styles.errorMessage} role="alert">
          ⚠ {pointingState.loadError}
        </p>
      )}
      {pointingState.saveStatusMessage && (
        <p className={styles.statusMessage} aria-live="polite">
          {pointingState.saveStatusMessage}
        </p>
      )}

      {pointingState.currentIssue ? (
        <article className={styles.issueCard}>
          <div className={styles.issueHeader}>
            <span className={styles.issueType}>{pointingState.currentIssue.issueType || 'Issue'}</span>
            <span className={styles.issueKey}>{pointingState.currentIssue.key}</span>
            <span className={styles.issueStatus}>{pointingState.currentIssue.status || NO_VALUE_LABEL}</span>
          </div>
          <h2 className={styles.issueSummary}>{pointingState.currentIssue.summary}</h2>
          <dl className={styles.metadataGrid}>
            <div>
              <dt>Priority</dt>
              <dd>{pointingState.currentIssue.priority || NO_VALUE_LABEL}</dd>
            </div>
            <div>
              <dt>Assignee</dt>
              <dd>{pointingState.currentIssue.assignee || NO_VALUE_LABEL}</dd>
            </div>
            <div>
              <dt>Current points</dt>
              <dd>{pointingState.currentIssue.storyPoints || NO_VALUE_LABEL}</dd>
            </div>
          </dl>
          <p className={styles.descriptionText}>
            {pointingState.currentIssue.description || 'No Jira description was returned for this issue.'}
          </p>

          <div className={styles.voteDeck} aria-label="Story point cards">
            {POINTING_SCALE.map((pointingValue) => (
              <button
                key={pointingValue}
                type="button"
                className={pointingState.selectedVote === pointingValue ? styles.voteCardSelected : styles.voteCard}
                aria-label={`Vote ${formatVoteLabel(pointingValue)} story points`}
                onClick={() => pointingState.selectVote(pointingValue)}
              >
                {pointingValue}
              </button>
            ))}
          </div>

          <div className={styles.revealPanel}>
            <strong>
              {pointingState.isRevealed
                ? `Revealed vote: ${pointingState.selectedVote ?? NO_VALUE_LABEL}`
                : 'Vote is hidden until you reveal it.'}
            </strong>
          </div>

          <div className={styles.navigationRow}>
            <button type="button" className={styles.button} onClick={pointingState.goToPreviousIssue}>
              ← Previous
            </button>
            <button type="button" className={styles.button} onClick={pointingState.skipIssue}>
              ? Skip
            </button>
            <button type="button" className={styles.button} onClick={pointingState.resetVote}>
              Reset Vote
            </button>
            <button
              type="button"
              className={styles.buttonPrimary}
              disabled={!pointingState.canRevealVote}
              onClick={pointingState.revealVotes}
            >
              Reveal Vote
            </button>
            <button
              type="button"
              className={styles.buttonPrimary}
              disabled={!pointingState.canPersistVote || pointingState.isSaving}
              onClick={() => {
                void pointingState.saveRevealedVote();
              }}
            >
              {pointingState.isSaving ? 'Saving…' : saveButtonLabel}
            </button>
          </div>
        </article>
      ) : (
        <div className={styles.emptyState}>{EMPTY_DECK_MESSAGE}</div>
      )}
    </section>
  );
}

function formatVoteLabel(pointingValue: StoryPointVote): string {
  return pointingValue === '?' ? UNKNOWN_VOTE_LABEL : String(pointingValue);
}
