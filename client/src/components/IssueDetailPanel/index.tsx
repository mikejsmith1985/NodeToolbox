// index.tsx — Reusable inline Jira issue detail panel with status, comment, and story-point actions.

import { useEffect, useState } from 'react';

import { jiraGet, jiraPost, jiraPut } from '../../services/jiraApi.ts';
import type { JiraIssue, JiraTransition } from '../../types/jira.ts';
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

export interface IssueDetailPanelProps {
  issue: JiraIssue;
  /** Called after a successful status transition so the parent can reload issues. */
  onIssueUpdated?: () => void;
  /** When true, the panel shows without a close button so the parent controls visibility. */
  isEmbedded?: boolean;
}

/**
 * IssueDetailPanel keeps the most common single-issue Jira actions inline so teams can update work without leaving the list they are reviewing.
 */
export default function IssueDetailPanel({
  issue,
  onIssueUpdated,
  isEmbedded = false,
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
  const [storyPointsInput, setStoryPointsInput] = useState(String(issue.fields.customfield_10016 ?? ''));
  const [isSavingStoryPoints, setIsSavingStoryPoints] = useState(false);
  const [storyPointsSaveError, setStoryPointsSaveError] = useState<string | null>(null);
  const [storyPointsSaveSuccess, setStoryPointsSaveSuccess] = useState(false);

  useEffect(() => {
    setIsPanelOpen(true);
  }, [issue.key]);

  useEffect(() => {
    let isMounted = true;

    async function loadTransitions() {
      setIsLoadingTransitions(true);
      setTransitionError(null);
      setSelectedTransitionId('');

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

    setCommentText('');
    setCommentPostError(null);
    setCommentPostSuccess(false);
    setStoryPointsInput(String(issue.fields.customfield_10016 ?? ''));
    setStoryPointsSaveError(null);
    setStoryPointsSaveSuccess(false);
    void loadTransitions();

    return () => {
      isMounted = false;
    };
  }, [issue.fields.customfield_10016, issue.key]);

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
      await jiraPut(`/rest/api/2/issue/${issue.key}`, {
        fields: { customfield_10016: Number(storyPointsInput) },
      });
      setStoryPointsSaveSuccess(true);
      onIssueUpdated?.();
    } catch (caughtError) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : STORY_POINTS_SAVE_ERROR_MESSAGE;
      setStoryPointsSaveError(errorMessage);
    } finally {
      setIsSavingStoryPoints(false);
    }
  }

  const descriptionPreview = issue.fields.description
    ? issue.fields.description.slice(0, DESCRIPTION_PREVIEW_LENGTH)
    : null;
  const hasTruncatedDescription = (issue.fields.description?.length ?? 0) > DESCRIPTION_PREVIEW_LENGTH;
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
