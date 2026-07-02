// MentionsTab.tsx — "Mentions" report: comments where the current user was @-tagged.
//
// Lists every comment that mentions the user within a chosen business-day window,
// lets them open the full ticket to reply inline, and lets them mark a mention
// "addressed" so it falls off the list. Posting a reply auto-marks it addressed;
// a manual button covers mentions handled elsewhere.

import { useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

import IssueDetailPanel from '../../components/IssueDetailPanel/index.tsx';
import { buildJiraBrowseUrl } from '../../utils/jiraBrowseUrl.ts';
import type { JiraMention } from '../../utils/jiraMentions.ts';
import { MENTION_WINDOW_OPTIONS, useMentionsState } from './hooks/useMentionsState.ts';
import styles from './MentionsTab.module.css';

const ISO_DATE_LENGTH = 10;

/** Renders the Mentions report inside the My Issues view. */
export default function MentionsTab() {
  const mentions = useMentionsState();

  return (
    <div className={styles.mentionsPanel}>
      <div className={styles.toolbar}>
        <div className={styles.windowSelector}>
          <span className={styles.toolbarLabel}>Tagged in the last</span>
          {MENTION_WINDOW_OPTIONS.map((windowOption) => (
            <button
              className={`${styles.windowPill} ${mentions.windowBusinessDays === windowOption ? styles.windowPillActive : ''}`}
              key={windowOption}
              onClick={() => mentions.setWindowBusinessDays(windowOption)}
              type="button"
            >
              {windowOption}
            </button>
          ))}
          <span className={styles.toolbarLabel}>business days</span>
        </div>

        <label className={styles.showAddressedToggle}>
          <input checked={mentions.showAddressed} onChange={mentions.toggleShowAddressed} type="checkbox" />
          Show addressed
        </label>

        <button className={styles.refreshButton} onClick={mentions.reload} type="button">
          {mentions.isLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <MentionsBody mentions={mentions} />
    </div>
  );
}

/** Chooses between the loading, error, empty, and populated states for the report body. */
function MentionsBody({ mentions }: { mentions: ReturnType<typeof useMentionsState> }) {
  if (mentions.isLoading) {
    return <p className={styles.statusMessage}>Scanning your recent mentions…</p>;
  }
  if (mentions.loadError) {
    return <p className={styles.errorMessage}>{mentions.loadError}</p>;
  }
  if (mentions.visibleMentions.length === 0) {
    return (
      <p className={styles.statusMessage}>
        No outstanding mentions in this window. Nice and clear. 🎉
      </p>
    );
  }

  return (
    <ul className={styles.mentionList}>
      {mentions.visibleMentions.map((mention) => (
        <MentionCard
          isAddressed={Boolean(mentions.addressedMap[mention.mentionKey])}
          jiraBaseUrl={mentions.jiraBaseUrl}
          key={mention.mentionKey}
          mention={mention}
          onMarkAddressed={mentions.markAddressed}
        />
      ))}
    </ul>
  );
}

interface MentionCardProps {
  mention: JiraMention;
  isAddressed: boolean;
  jiraBaseUrl: string;
  onMarkAddressed: (mention: JiraMention, isAddressed: boolean) => Promise<void>;
}

/** A single mention row with an excerpt and an expandable full-ticket reply panel. */
function MentionCard({ mention, isAddressed, jiraBaseUrl, onMarkAddressed }: MentionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpanded = () => setIsExpanded((open) => !open);

  // Interactive children (the Jira link and action buttons) must not also toggle
  // the row when clicked, so they stop the click from reaching the row handler.
  const stopRowToggle = (clickEvent: ReactMouseEvent) => clickEvent.stopPropagation();

  return (
    <li className={styles.mentionCard}>
      {/* Whole summary bar (header + excerpt) toggles the reply panel;
          the "Reply / details" button below stays as an explicit affordance. */}
      <div
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} details for ${mention.issueKey}`}
        onClick={toggleExpanded}
        onKeyDown={(keyEvent) => {
          if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
            keyEvent.preventDefault();
            toggleExpanded();
          }
        }}
        role="button"
        style={{ cursor: 'pointer', userSelect: 'none' }}
        tabIndex={0}
      >
        <div className={styles.mentionHeader}>
          <div className={styles.mentionHeaderText}>
            {/* The key opens the real Jira issue in a new tab so the user can @-mention others in a reply. */}
            <a
              className={styles.issueKeyLink}
              href={buildJiraBrowseUrl(mention.issueKey, jiraBaseUrl)}
              onClick={stopRowToggle}
              rel="noopener noreferrer"
              target="_blank"
              title="Open in Jira (to reply with @mentions)"
            >
              {mention.issueKey}
              <span aria-hidden="true" className={styles.externalLinkIcon}> ↗</span>
            </a>
            <span className={styles.issueSummary}>{mention.issueSummary}</span>
            <span className={styles.mentionMeta}>
              Tagged by {mention.authorDisplayName} · {mention.createdIso.slice(0, ISO_DATE_LENGTH)}
            </span>
          </div>
          <div className={styles.mentionActions}>
            <button
              className={styles.linkButton}
              onClick={(clickEvent) => { stopRowToggle(clickEvent); toggleExpanded(); }}
              type="button"
            >
              {isExpanded ? 'Hide details' : 'Reply / details'}
            </button>
            {isAddressed ? (
              <button
                className={styles.undoButton}
                onClick={(clickEvent) => { stopRowToggle(clickEvent); void onMarkAddressed(mention, false); }}
                type="button"
              >
                ↩ Undo
              </button>
            ) : (
              <button
                className={styles.addressedButton}
                onClick={(clickEvent) => { stopRowToggle(clickEvent); void onMarkAddressed(mention, true); }}
                type="button"
              >
                ✓ Mark addressed
              </button>
            )}
          </div>
        </div>

        <p className={styles.mentionExcerpt}>{mention.excerpt}</p>
      </div>

      {isExpanded && (
        <IssueDetailPanel
          isEmbedded
          issue={mention.issue}
          // Replying from the panel counts as addressing the mention (the "both" behaviour).
          onCommentPosted={() => void onMarkAddressed(mention, true)}
        />
      )}
    </li>
  );
}
