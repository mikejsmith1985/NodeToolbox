// StoryInspectorPanel.tsx — Read-only detail for one child story during story-level planning.
//
// Gives stories the same inspection experience the canvas gives features (NodeInspectorPanel): the
// header fields render instantly from what the board already knows, while the description and
// acceptance criteria are fetched on demand for the story, and the comment thread loads via the
// shared useIssueComments hook. It edits nothing — inspection only.

import { useEffect, useState } from 'react';

import { jiraGet } from '../../../services/jiraApi.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';
import { useIssueComments } from '../../../hooks/useIssueComments.ts';
import CommentThread from '../../../components/CommentThread/CommentThread.tsx';
import { ACCEPTANCE_CRITERIA_FIELD_ID } from '../../SprintDashboard/featureReview.ts';
import controlStyles from '../canvas/canvasControls.module.css';

/** The header facts the board already has, shown immediately while the fetch resolves. */
export interface StoryInspectorSummary {
  storyKey: string;
  summary: string;
  status: string;
  points: number | null;
  issueType: string | null;
  assignee: string | null;
  subtaskCount: number;
}

export interface StoryInspectorPanelProps {
  story: StoryInspectorSummary;
  onClose: () => void;
}

/** Remounts the content on story change so the fetch and comment thread reset cleanly. */
export function StoryInspectorPanel({ story, onClose }: StoryInspectorPanelProps): React.JSX.Element {
  return <StoryInspectorContent key={story.storyKey} story={story} onClose={onClose} />;
}

/** Owns the on-demand description/AC fetch and comment load for one specific story. */
function StoryInspectorContent({ story, onClose }: StoryInspectorPanelProps): React.JSX.Element {
  const { comments, isLoading: isLoadingComments, loadError: commentsLoadError } = useIssueComments(story.storyKey);
  const [description, setDescription] = useState<string | null>(null);
  const [acceptanceCriteria, setAcceptanceCriteria] = useState<string | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Fetch the story's rich fields once. This content is remounted per story (key=storyKey), so the
  // initial loading/empty state is already correct — no synchronous reset needed here.
  useEffect(() => {
    let isActive = true;
    jiraGet<JiraIssue>(`/rest/api/2/issue/${story.storyKey}?fields=description,${ACCEPTANCE_CRITERIA_FIELD_ID}`)
      .then((issue) => {
        if (!isActive) {
          return;
        }
        const fields = issue.fields as Record<string, unknown>;
        setDescription(normalizeRichTextToPlainText(fields.description as Parameters<typeof normalizeRichTextToPlainText>[0]));
        setAcceptanceCriteria(normalizeRichTextToPlainText(fields[ACCEPTANCE_CRITERIA_FIELD_ID] as Parameters<typeof normalizeRichTextToPlainText>[0]));
      })
      .catch(() => { if (isActive) { setDetailError('Failed to load story detail'); } })
      .finally(() => { if (isActive) { setIsLoadingDetail(false); } });
    return () => { isActive = false; };
  }, [story.storyKey]);

  return (
    <aside aria-label={`Inspector for ${story.storyKey}`} style={{ width: 320, flex: '0 0 320px', padding: 12, overflowY: 'auto', background: 'var(--color-surface-1)', borderLeft: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <strong>{story.storyKey}</strong>
        <button type="button" className={controlStyles.iconBtn} onClick={onClose} aria-label="Close story inspector">✕</button>
      </div>

      <h3 style={{ fontSize: 14, margin: '8px 0', lineHeight: 1.3 }}>{story.summary}</h3>

      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', fontSize: 12, margin: 0 }}>
        <dt style={{ opacity: 0.6 }}>Type</dt><dd style={{ margin: 0 }}>{story.issueType ?? '—'}</dd>
        <dt style={{ opacity: 0.6 }}>Status</dt><dd style={{ margin: 0 }}>{story.status || '—'}</dd>
        <dt style={{ opacity: 0.6 }}>Assignee</dt><dd style={{ margin: 0 }}>{story.assignee ?? 'Unassigned'}</dd>
        <dt style={{ opacity: 0.6 }}>Points</dt><dd style={{ margin: 0 }}>{story.points === null ? 'unpointed' : `${story.points}pt`}</dd>
        <dt style={{ opacity: 0.6 }}>Subtasks</dt><dd style={{ margin: 0 }}>{story.subtaskCount}</dd>
      </dl>

      {detailError && <p style={{ color: 'var(--color-danger)', fontSize: 12, marginTop: 8 }}>{detailError}</p>}

      <div style={{ marginTop: 8, fontSize: 12 }}>
        <div style={{ opacity: 0.6 }}>Description</div>
        {isLoadingDetail ? (
          <p style={{ opacity: 0.6, margin: '2px 0' }}>Loading…</p>
        ) : description ? (
          <p style={{ margin: '2px 0', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{description}</p>
        ) : (
          <p style={{ opacity: 0.6, margin: '2px 0' }}>No description.</p>
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: 12 }}>
        <div style={{ opacity: 0.6 }}>Acceptance criteria</div>
        {isLoadingDetail ? (
          <p style={{ opacity: 0.6, margin: '2px 0' }}>Loading…</p>
        ) : acceptanceCriteria ? (
          <p style={{ margin: '2px 0', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{acceptanceCriteria}</p>
        ) : (
          <p style={{ opacity: 0.6, margin: '2px 0' }}>No acceptance criteria.</p>
        )}
      </div>

      <div style={{ marginTop: 8, fontSize: 12 }}>
        <div style={{ opacity: 0.6 }}>Comments{comments.length > 0 ? ` (${comments.length})` : ''}</div>
        <CommentThread comments={comments} isLoading={isLoadingComments} loadError={commentsLoadError} />
      </div>
    </aside>
  );
}
