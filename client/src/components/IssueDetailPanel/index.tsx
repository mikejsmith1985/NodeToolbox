// index.tsx — Reusable inline Jira issue detail panel with status, comment, and story-point actions.

import { useEffect, useState } from 'react';

import { jiraGet, jiraPost } from '../../services/jiraApi.ts';
import type { JiraIssue, JiraTransition } from '../../types/jira.ts';
import { normalizeRichTextToPlainText } from '../../utils/richTextPlainText.ts';
import {
  readIssueStoryPointsDisplayValue,
  saveFeatureReviewStoryPoints,
} from '../../views/SprintDashboard/featureReviewFixes.ts';
import { useIssueComments } from '../../hooks/useIssueComments.ts';
import CommentThread from '../CommentThread/CommentThread.tsx';
import styles from './IssueDetailPanel.module.css';

const DESCRIPTION_PREVIEW_LENGTH = 300;
const SUCCESS_MESSAGE_TIMEOUT_MS = 3_000;
const EMPTY_META_VALUE = '—';
const UNASSIGNED_LABEL = 'Unassigned';
const TRANSITION_PLACEHOLDER_LABEL = 'Transition to…';
const NO_TRANSITIONS_LABEL = 'No transitions available';
const COMMENT_SUCCESS_LABEL = '✓ Posted';
const STORY_POINTS_SUCCESS_LABEL = '✓ Saved';
const TRANSITION_LOAD_ERROR_MESSAGE = 'Failed to load transitions';
const COMMENT_POST_ERROR_MESSAGE = 'Failed to post comment';
const STORY_POINTS_SAVE_ERROR_MESSAGE = 'Failed to save story points';
const COMMENTS_SECTION_LABEL = 'Comments';

export interface IssueDetailPanelProps {
  issue: JiraIssue;
  /** Called after a successful status transition so the parent can reload issues. */
  onIssueUpdated?: () => void;
  /** Called after a comment is successfully posted (e.g. so a Mentions report can auto-mark it addressed). */
  onCommentPosted?: () => void;
  /** When true, the panel shows without a close button so the parent controls visibility. */
  isEmbedded?: boolean;
  /**
   * Pre-resolved Acceptance Criteria plain text to show under the description. Optional because most callers
   * do not fetch the instance-specific AC field; when provided (and non-empty) an AC block is rendered.
   */
  acceptanceCriteria?: string | null;
}

/**
 * IssueDetailPanel keeps the most common single-issue Jira actions inline so teams can update work without leaving the list they are reviewing.
 */
export default function IssueDetailPanel({
  issue,
  onIssueUpdated,
  onCommentPosted,
  isEmbedded = false,
  acceptanceCriteria,
}: IssueDetailPanelProps) {
  // The seed reads whichever story-points field this project actually uses (configured, modern,
  // legacy — dropdown option objects included), so the input starts with the real current value.
  const issuePanelStateKey = `${issue.key}:${readIssueStoryPointsDisplayValue(issue)}`;

  return (
    <IssueDetailPanelContent
      key={issuePanelStateKey}
      isEmbedded={isEmbedded}
      issue={issue}
      onIssueUpdated={onIssueUpdated}
      onCommentPosted={onCommentPosted}
      acceptanceCriteria={acceptanceCriteria}
    />
  );
}

/**
 * IssueDetailPanelContent owns the live editing state for one specific issue snapshot.
 * Remounting this keyed component resets transient form state when the viewed issue changes.
 */
function IssueDetailPanelContent({
  issue,
  onIssueUpdated,
  onCommentPosted,
  isEmbedded = false,
  acceptanceCriteria,
}: IssueDetailPanelProps) {
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isLoadingTransitions, setIsLoadingTransitions] = useState(true);
  const [availableTransitions, setAvailableTransitions] = useState<JiraTransition[]>([]);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [selectedTransitionId, setSelectedTransitionId] = useState('');
  const [isApplyingTransition, setIsApplyingTransition] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);
  const [commentPostError, setCommentPostError] = useState<string | null>(null);
  const [commentPostSuccess, setCommentPostSuccess] = useState(false);
  // The full comment thread is loaded on demand and kept newest-first by the shared hook, so this
  // panel shows the same complete, ordered history as every other comment location in the app.
  const {
    comments: existingComments,
    isLoading: isLoadingComments,
    loadError: commentsLoadError,
    refresh: refreshComments,
  } = useIssueComments(issue.key);
  const [storyPointsInput, setStoryPointsInput] = useState(() => readIssueStoryPointsDisplayValue(issue));
  const [isSavingStoryPoints, setIsSavingStoryPoints] = useState(false);
  const [storyPointsSaveError, setStoryPointsSaveError] = useState<string | null>(null);
  const [storyPointsSaveSuccess, setStoryPointsSaveSuccess] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadTransitions() {
      try {
        const response = await jiraGet<{ transitions: JiraTransition[] }>(`/rest/api/2/issue/${issue.key}/transitions`);
        if (!isMounted) {
          return;
        }
        setAvailableTransitions(response.transitions);
      } catch (caughtError) {
        if (!isMounted) {
          return;
        }
        const errorMessage = caughtError instanceof Error ? caughtError.message : TRANSITION_LOAD_ERROR_MESSAGE;
        setAvailableTransitions([]);
        setTransitionError(errorMessage);
      } finally {
        if (isMounted) {
          setIsLoadingTransitions(false);
        }
      }
    }

    void loadTransitions();

    return () => {
      isMounted = false;
    };
  }, [issue.key]);

  useEffect(() => {
    if (!commentPostSuccess) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setCommentPostSuccess(false);
    }, SUCCESS_MESSAGE_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [commentPostSuccess]);

  useEffect(() => {
    if (!storyPointsSaveSuccess) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setStoryPointsSaveSuccess(false);
    }, SUCCESS_MESSAGE_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [storyPointsSaveSuccess]);

  async function applyTransition() {
    if (!selectedTransitionId) {
      return;
    }

    setIsApplyingTransition(true);
    setTransitionError(null);

    try {
      await jiraPost(`/rest/api/2/issue/${issue.key}/transitions`, {
        transition: { id: selectedTransitionId },
      });
      onIssueUpdated?.();
    } catch (caughtError) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : TRANSITION_LOAD_ERROR_MESSAGE;
      setTransitionError(errorMessage);
    } finally {
      setIsApplyingTransition(false);
    }
  }

  async function postComment() {
    if (!commentText.trim()) {
      return;
    }

    setIsPostingComment(true);
    setCommentPostError(null);

    try {
      await jiraPost(`/rest/api/2/issue/${issue.key}/comment`, { body: commentText });
      setCommentText('');
      setCommentPostSuccess(true);
      // Reload so the freshly posted comment appears (pinned at the top, newest-first).
      refreshComments();
      // Let parents react to a posted reply (e.g. the Mentions report auto-marks it addressed).
      onCommentPosted?.();
    } catch (caughtError) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : COMMENT_POST_ERROR_MESSAGE;
      setCommentPostError(errorMessage);
    } finally {
      setIsPostingComment(false);
    }
  }

  async function saveStoryPoints() {
    if (!hasValidStoryPointsInput) {
      return;
    }

    setIsSavingStoryPoints(true);
    setStoryPointsSaveError(null);

    try {
      // The shared editmeta-aware writer targets the field this issue can actually accept and
      // maps the number to a dropdown option when the project models points as a Select field —
      // a blind customfield_10016 write 400s on both counts (GH #167 / #177).
      await saveFeatureReviewStoryPoints(issue.key, storyPointsInput);
      setStoryPointsSaveSuccess(true);
      onIssueUpdated?.();
    } catch (caughtError) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : STORY_POINTS_SAVE_ERROR_MESSAGE;
      setStoryPointsSaveError(errorMessage);
    } finally {
      setIsSavingStoryPoints(false);
    }
  }

  const normalizedDescription = normalizeRichTextToPlainText(issue.fields.description);
  const descriptionPreview = normalizedDescription
    ? normalizedDescription.slice(0, DESCRIPTION_PREVIEW_LENGTH)
    : null;
  const hasTruncatedDescription = normalizedDescription.length > DESCRIPTION_PREVIEW_LENGTH;
  // Acceptance Criteria is passed in already-resolved (the AC field id is instance-specific). Shown only
  // when the caller supplied non-empty text, so callers that don't fetch AC see no empty label.
  const normalizedAcceptanceCriteria = (acceptanceCriteria ?? '').trim();
  const acceptanceCriteriaPreview = normalizedAcceptanceCriteria
    ? normalizedAcceptanceCriteria.slice(0, DESCRIPTION_PREVIEW_LENGTH)
    : null;
  const hasTruncatedAcceptanceCriteria = normalizedAcceptanceCriteria.length > DESCRIPTION_PREVIEW_LENGTH;
  const hasTransitions = availableTransitions.length > 0;
  const hasValidStoryPointsInput = storyPointsInput.trim() !== '' && !Number.isNaN(Number(storyPointsInput));
  const selectPlaceholder = isLoadingTransitions || hasTransitions
    ? TRANSITION_PLACEHOLDER_LABEL
    : NO_TRANSITIONS_LABEL;

  if (!isPanelOpen) {
    return null;
  }

  return (
    <section className={styles.detailPanel}>
      <div className={styles.headerRow}>
        <div className={styles.headerText}>
          <span className={styles.issueKey}>{issue.key}</span>
          <p className={styles.issueSummary}>{issue.fields.summary}</p>
        </div>
        {!isEmbedded && (
          <button className={styles.closeButton} onClick={() => setIsPanelOpen(false)} type="button">
            Close
          </button>
        )}
      </div>

      <div className={styles.issueMeta}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Status</span>
          <span className={styles.metaValue}>{issue.fields.status.name}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Priority</span>
          <span className={styles.metaValue}>{issue.fields.priority?.name ?? EMPTY_META_VALUE}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Assignee</span>
          <span className={styles.metaValue}>{issue.fields.assignee?.displayName ?? UNASSIGNED_LABEL}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Created</span>
          <span className={styles.metaValue}>{issue.fields.created.slice(0, 10)}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Updated</span>
          <span className={styles.metaValue}>{issue.fields.updated.slice(0, 10)}</span>
        </div>
      </div>

      {descriptionPreview && (
        <div className={styles.description}>
          Description: {descriptionPreview}{hasTruncatedDescription ? '…' : ''}
        </div>
      )}

      {acceptanceCriteriaPreview && (
        <div className={styles.description}>
          Acceptance Criteria: {acceptanceCriteriaPreview}{hasTruncatedAcceptanceCriteria ? '…' : ''}
        </div>
      )}

      <hr className={styles.divider} />

      <div className={styles.actionSection}>
        <label className={styles.actionLabel} htmlFor={`transition-select-${issue.key}`}>
          Change Status:
        </label>
        <select
          className={styles.select}
          disabled={isLoadingTransitions || isApplyingTransition || !hasTransitions}
          id={`transition-select-${issue.key}`}
          onChange={(changeEvent) => setSelectedTransitionId(changeEvent.target.value)}
          value={selectedTransitionId}
        >
          <option value="">{isLoadingTransitions ? 'Loading transitions…' : selectPlaceholder}</option>
          {availableTransitions.map((transition) => (
            <option key={transition.id} value={transition.id}>
              {transition.name}
            </option>
          ))}
        </select>
        <button
          className={styles.actionButton}
          disabled={!selectedTransitionId || isApplyingTransition}
          onClick={() => void applyTransition()}
          type="button"
        >
          {isApplyingTransition ? 'Applying…' : 'Apply'}
        </button>
        {transitionError && <span className={styles.errorMessage}>{transitionError}</span>}
      </div>

      <hr className={styles.divider} />

      <div className={styles.actionSectionBlock}>
        <span className={styles.actionLabel}>
          {COMMENTS_SECTION_LABEL}{existingComments.length > 0 ? ` (${existingComments.length})` : ''}
        </span>
        <CommentThread
          comments={existingComments}
          isLoading={isLoadingComments}
          loadError={commentsLoadError}
        />
      </div>

      <hr className={styles.divider} />

      <div className={styles.actionSectionBlock}>
        <label className={styles.actionLabel} htmlFor={`comment-textarea-${issue.key}`}>
          Add Comment:
        </label>
        <textarea
          className={styles.textarea}
          id={`comment-textarea-${issue.key}`}
          onChange={(changeEvent) => setCommentText(changeEvent.target.value)}
          rows={3}
          value={commentText}
        />
        <div className={styles.actionSection}>
          <button
            className={styles.actionButton}
            disabled={!commentText.trim() || isPostingComment}
            onClick={() => void postComment()}
            type="button"
          >
            {isPostingComment ? 'Posting…' : 'Post Comment'}
          </button>
          {commentPostSuccess && <span className={styles.successMessage}>{COMMENT_SUCCESS_LABEL}</span>}
          {commentPostError && <span className={styles.errorMessage}>{commentPostError}</span>}
        </div>
      </div>

      <hr className={styles.divider} />

      <div className={styles.actionSection}>
        <label className={styles.actionLabel} htmlFor={`story-points-${issue.key}`}>
          Story Points:
        </label>
        <input
          className={styles.pointsInput}
          id={`story-points-${issue.key}`}
          onChange={(changeEvent) => setStoryPointsInput(changeEvent.target.value)}
          type="number"
          value={storyPointsInput}
        />
        <button
          className={styles.actionButton}
          disabled={isSavingStoryPoints || !hasValidStoryPointsInput}
          onClick={() => void saveStoryPoints()}
          type="button"
        >
          {isSavingStoryPoints ? 'Saving…' : 'Save'}
        </button>
        {storyPointsSaveSuccess && <span className={styles.successMessage}>{STORY_POINTS_SUCCESS_LABEL}</span>}
        {storyPointsSaveError && <span className={styles.errorMessage}>{storyPointsSaveError}</span>}
      </div>
    </section>
  );
}
