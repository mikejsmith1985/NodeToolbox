// index.tsx — Reusable inline Jira issue detail panel with status, comment, and story-point actions.

import { useEffect, useState } from 'react';

import { jiraPost } from '../../services/jiraApi.ts';
import type { JiraIssue, JiraIssueLink } from '../../types/jira.ts';
import {
  areTransitionSelectionsComplete,
  buildTransitionFieldsPayload,
  fetchFeatureReviewTransitions,
  saveFeatureReviewTransition,
  type FeatureReviewTransition,
  type TransitionFieldSelection,
} from '../../views/SprintDashboard/featureReviewFixes.ts';
import { TransitionRequiredFields } from '../TransitionRequiredFields/index.tsx';
import { IssueFieldEditingSection, type IssueFieldEditingConfig } from '../IssueFieldEditors/IssueFieldEditingSection.tsx';
import { parseStructuredText } from '../../utils/richTextStructured.ts';
import { StructuredText } from './StructuredText.tsx';
import { AgeBadge } from '../IssueMeta/AgeBadge.tsx';
import { AssigneeAvatar } from '../IssueMeta/AssigneeAvatar.tsx';
import { IssueTypeIcon } from '../IssueMeta/IssueTypeIcon.tsx';
import { PriorityBadge } from '../IssueMeta/PriorityBadge.tsx';
import { StatusChip } from '../IssueMeta/StatusChip.tsx';
import {
  readIssueStoryPointsDisplayValue,
  saveFeatureReviewStoryPoints,
} from '../../views/SprintDashboard/featureReviewFixes.ts';
import { useIssueComments } from '../../hooks/useIssueComments.ts';
import CommentThread from '../CommentThread/CommentThread.tsx';
import styles from './IssueDetailPanel.module.css';

const DESCRIPTION_PREVIEW_LENGTH = 300;
const SUCCESS_MESSAGE_TIMEOUT_MS = 3_000;
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
  /** Days since the issue last changed — shown as a graded AgeBadge when the host supplies BOTH age props. */
  ageDays?: number;
  /** The team's stale threshold the AgeBadge grades against (hygiene hosts pass their configured value). */
  staleDaysThreshold?: number;
  /** Resolved Program Increment value; rendered as a planning row only when supplied (host-resolved field). */
  programIncrement?: string | null;
  /** Resolved sprint name; rendered as a planning row only when supplied. */
  sprintName?: string | null;
  /** Resolved feature/epic link key; rendered as a planning row only when supplied. */
  featureLinkKey?: string | null;
  /**
   * Optional in-place field editing. When omitted (every current caller) the panel is unchanged and
   * read-only for these fields; when supplied (Quick Issue Lookup) the fields the issue's editmeta
   * allows become editable via the shared editors, each write delegated to featureReviewFixes.
   */
  fieldEditing?: IssueFieldEditingConfig;
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
  ageDays,
  staleDaysThreshold,
  programIncrement,
  sprintName,
  featureLinkKey,
  fieldEditing,
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
      ageDays={ageDays}
      staleDaysThreshold={staleDaysThreshold}
      programIncrement={programIncrement}
      sprintName={sprintName}
      featureLinkKey={featureLinkKey}
      fieldEditing={fieldEditing}
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
  ageDays,
  staleDaysThreshold,
  programIncrement,
  sprintName,
  featureLinkKey,
  fieldEditing,
}: IssueDetailPanelProps) {
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [isLoadingTransitions, setIsLoadingTransitions] = useState(true);
  const [availableTransitions, setAvailableTransitions] = useState<FeatureReviewTransition[]>([]);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [selectedTransitionId, setSelectedTransitionId] = useState('');
  // Answers for the fields the selected transition's workflow screen requires (GH #177 follow-up).
  const [transitionFieldSelections, setTransitionFieldSelections] = useState<Record<string, TransitionFieldSelection>>({});
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
        // The shared fetch expands each transition's required screen fields, so the panel can
        // collect them inline instead of 400ing on workflows that demand them.
        const loadedTransitions = await fetchFeatureReviewTransitions(issue.key);
        if (!isMounted) {
          return;
        }
        setAvailableTransitions(loadedTransitions);
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
      await saveFeatureReviewTransition(
        issue.key,
        selectedTransitionId,
        buildTransitionFieldsPayload(selectedTransitionRequiredFields, transitionFieldSelections),
      );
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

  // Structure-preserving description (spec 019 FR-009): headings/lists render as such; a
  // description with no recognizable structure degrades to plain paragraphs — never emptier.
  const descriptionBlocks = parseStructuredText(issue.fields.description);
  const issueLinks = issue.fields.issuelinks ?? [];
  const issueLabels = issue.fields.labels ?? [];
  const issueFixVersions = issue.fields.fixVersions ?? [];
  const hasPlanningContext = Boolean(programIncrement || sprintName || featureLinkKey);
  // Acceptance Criteria is passed in already-resolved (the AC field id is instance-specific). Shown only
  // when the caller supplied non-empty text, so callers that don't fetch AC see no empty label.
  const normalizedAcceptanceCriteria = (acceptanceCriteria ?? '').trim();
  const acceptanceCriteriaPreview = normalizedAcceptanceCriteria
    ? normalizedAcceptanceCriteria.slice(0, DESCRIPTION_PREVIEW_LENGTH)
    : null;
  const hasTruncatedAcceptanceCriteria = normalizedAcceptanceCriteria.length > DESCRIPTION_PREVIEW_LENGTH;
  const hasTransitions = availableTransitions.length > 0;
  const selectedTransitionRequiredFields = availableTransitions
    .find((availableTransition) => availableTransition.id === selectedTransitionId)?.requiredFields ?? [];
  const areTransitionAnswersComplete = selectedTransitionRequiredFields.length === 0
    || areTransitionSelectionsComplete(selectedTransitionRequiredFields, transitionFieldSelections);
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

      {/* Glanceable fact row: type, status, priority, and owner read from color + icon + text —
          no label-hunting (spec 019 US1). Dates stay as quiet secondary text below. */}
      <div className={styles.chipRow}>
        {issue.fields.issuetype?.name && <IssueTypeIcon issueTypeName={issue.fields.issuetype.name} />}
        <StatusChip
          statusName={issue.fields.status.name}
          statusCategoryKey={issue.fields.status.statusCategory?.key}
        />
        {issue.fields.priority?.name && <PriorityBadge priorityName={issue.fields.priority.name} />}
        <AssigneeAvatar displayName={issue.fields.assignee?.displayName ?? null} />
        {ageDays !== undefined && staleDaysThreshold !== undefined && (
          <AgeBadge ageDays={ageDays} staleDaysThreshold={staleDaysThreshold} />
        )}
      </div>
      <div className={styles.issueMeta}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Created</span>
          <span className={styles.metaValue}>{issue.fields.created.slice(0, 10)}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>Updated</span>
          <span className={styles.metaValue}>{issue.fields.updated.slice(0, 10)}</span>
        </div>
      </div>

      {/* Planning context rows render only when the host resolved them — no empty placeholders. */}
      {hasPlanningContext && (
        <div className={styles.issueMeta}>
          {programIncrement && (
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>PI</span>
              <span className={styles.metaValue}>{programIncrement}</span>
            </div>
          )}
          {sprintName && (
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Sprint</span>
              <span className={styles.metaValue}>{sprintName}</span>
            </div>
          )}
          {featureLinkKey && (
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Feature</span>
              <span className={styles.metaValue}>{featureLinkKey}</span>
            </div>
          )}
        </div>
      )}

      {(issueLabels.length > 0 || issueFixVersions.length > 0) && (
        <div className={styles.chipRow}>
          {issueLabels.length > 0 && (
            <span className={styles.contextChipGroup}>
              <span className={styles.metaLabel}>Labels</span>
              {issueLabels.map((issueLabel) => (
                <span className={styles.contextChip} key={issueLabel}>{issueLabel}</span>
              ))}
            </span>
          )}
          {issueFixVersions.length > 0 && (
            <span className={styles.contextChipGroup}>
              <span className={styles.metaLabel}>Fix Versions</span>
              {issueFixVersions.map((fixVersion) => (
                <span className={styles.contextChip} key={fixVersion.name}>{fixVersion.name}</span>
              ))}
            </span>
          )}
        </div>
      )}

      {descriptionBlocks.length > 0 && (
        <div className={styles.description}>
          <span className={styles.metaLabel}>Description</span>
          <StructuredText blocks={descriptionBlocks} />
        </div>
      )}

      {acceptanceCriteriaPreview && (
        <div className={styles.description}>
          Acceptance Criteria: {acceptanceCriteriaPreview}{hasTruncatedAcceptanceCriteria ? '…' : ''}
        </div>
      )}

      {/* Linked issues WITH their statuses — often the single fact that explains a stale ticket.
          Read straight off the payload; hosts that did not fetch issuelinks simply see no block. */}
      {issueLinks.length > 0 && (
        <div className={styles.linksBlock}>
          <span className={styles.metaLabel}>Linked Issues</span>
          {issueLinks.map((issueLink, linkIndex) => renderIssueLinkRow(issueLink, linkIndex))}
        </div>
      )}

      <hr className={styles.divider} />

      {/* In-place field editing, only when a host opts in (Quick Issue Lookup). Omitted elsewhere,
          so every existing caller renders exactly as before. */}
      {fieldEditing && (
        <IssueFieldEditingSection
          issue={issue}
          editMeta={fieldEditing.editMeta}
          onFieldSaved={fieldEditing.onFieldSaved}
        />
      )}

      <div className={styles.actionSection}>
        <label className={styles.actionLabel} htmlFor={`transition-select-${issue.key}`}>
          Change Status:
        </label>
        <select
          className={styles.select}
          disabled={isLoadingTransitions || isApplyingTransition || !hasTransitions}
          id={`transition-select-${issue.key}`}
          onChange={(changeEvent) => {
            setSelectedTransitionId(changeEvent.target.value);
            // A different transition has different required fields — stale answers never carry over.
            setTransitionFieldSelections({});
          }}
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
          disabled={!selectedTransitionId || isApplyingTransition || !areTransitionAnswersComplete}
          onClick={() => void applyTransition()}
          type="button"
        >
          {isApplyingTransition ? 'Applying…' : 'Apply'}
        </button>
        {transitionError && <span className={styles.errorMessage}>{transitionError}</span>}
      </div>

      {/* Fields this transition's workflow screen requires — collected here so the transition
          succeeds in one step instead of 400ing (GH #177 follow-up). */}
      <TransitionRequiredFields
        requiredFields={selectedTransitionRequiredFields}
        selectionByFieldId={transitionFieldSelections}
        isDisabled={isApplyingTransition}
        onSelectionChange={(requiredFieldId, selection) =>
          setTransitionFieldSelections((currentSelections) => ({ ...currentSelections, [requiredFieldId]: selection }))}
      />

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

/**
 * Renders one linked-issue row: the link relation in the direction it reads ("links to" vs
 * "is blocked by"), the other issue's key and summary, and that issue's own status chip —
 * often the single fact that explains why the current issue is waiting.
 */
function renderIssueLinkRow(issueLink: JiraIssueLink, linkRowIndex: number) {
  const linkedIssue = issueLink.outwardIssue ?? issueLink.inwardIssue;
  if (!linkedIssue) return null;
  const relationLabel = issueLink.outwardIssue
    ? (issueLink.type?.outward || issueLink.type?.name || 'links to')
    : (issueLink.type?.inward || issueLink.type?.name || 'linked from');
  const linkedStatus = linkedIssue.fields?.status;

  return (
    <div className={styles.linkRow} key={`${linkedIssue.key}-${linkRowIndex}`}>
      <span className={styles.linkRelation}>{relationLabel}</span>
      <span className={styles.linkKey}>{linkedIssue.key}</span>
      {linkedStatus?.name && (
        <StatusChip statusName={linkedStatus.name} statusCategoryKey={linkedStatus.statusCategory?.key} />
      )}
      {linkedIssue.fields?.summary && <span className={styles.linkSummary}>{linkedIssue.fields.summary}</span>}
    </div>
  );
}
