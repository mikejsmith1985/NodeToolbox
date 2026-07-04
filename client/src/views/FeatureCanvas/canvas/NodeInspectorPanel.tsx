// NodeInspectorPanel.tsx — Read-only side inspector for the selected feature node.
//
// Progressive disclosure for the canvas: the card stays scannable, and opening a node reveals the
// epic's full detail here, on demand. Arrangement, status, hygiene, and child records render from
// the already-loaded CanvasNode; the description and attachments come from the same live fetch, and
// the comment thread is loaded on demand via the shared useIssueComments hook. It edits nothing —
// inspection only. Exactly one node is shown at a time; it renders nothing when no node is selected.

import { useIssueComments } from '../../../hooks/useIssueComments.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';
import CommentThread from '../../../components/CommentThread/CommentThread.tsx';
import type { CanvasAttachment, CanvasNode } from '../logic/canvasTypes.ts';
import controlStyles from './canvasControls.module.css';

/** Props for the read-only node inspector. */
export interface NodeInspectorPanelProps {
  node: CanvasNode | null;
  onClose: () => void;
}

const BYTES_PER_UNIT = 1024;
const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** Formats a child story's points for display. */
function formatPoints(storyPoints: number | null): string {
  return storyPoints === null ? '—' : `${storyPoints}pt`;
}

/** Formats a byte count into a compact human-readable size (e.g. "2.0 KB") for attachment rows. */
function formatFileSize(sizeBytes: number): string {
  if (sizeBytes <= 0) {
    return '0 B';
  }
  let unitIndex = 0;
  let scaledSize = sizeBytes;
  while (scaledSize >= BYTES_PER_UNIT && unitIndex < SIZE_UNITS.length - 1) {
    scaledSize /= BYTES_PER_UNIT;
    unitIndex += 1;
  }
  const rounded = unitIndex === 0 ? String(scaledSize) : scaledSize.toFixed(1);
  return `${rounded} ${SIZE_UNITS[unitIndex]}`;
}

/** Renders the read-only attachment list, or a muted empty note when the feature has none. */
function AttachmentList({ attachments }: { attachments: CanvasAttachment[] }): React.JSX.Element {
  if (attachments.length === 0) {
    return <p style={{ opacity: 0.6, margin: '2px 0' }}>No attachments.</p>;
  }
  return (
    <ul style={{ margin: '2px 0', paddingLeft: 16 }}>
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          <a href={attachment.contentUrl} target="_blank" rel="noreferrer" style={{ color: '#93c5fd' }}>
            {attachment.filename}
          </a>
          <span style={{ opacity: 0.6 }}> · {formatFileSize(attachment.sizeBytes)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The docked, read-only inspector for the currently selected node. */
export function NodeInspectorPanel({ node, onClose }: NodeInspectorPanelProps): React.JSX.Element | null {
  if (node === null) {
    return null;
  }

  // Remount on key change so the comment fetch and any transient state reset to the new node.
  return <NodeInspectorContent key={node.issueKey} node={node} onClose={onClose} />;
}

/** Owns the on-demand comment fetch for one specific node; only mounted when a node is selected. */
function NodeInspectorContent({ node, onClose }: { node: CanvasNode; onClose: () => void }): React.JSX.Element {
  const { comments, isLoading: isLoadingComments, loadError: commentsLoadError } = useIssueComments(node.issueKey);
  const normalizedDescription = normalizeRichTextToPlainText(node.description);

  return (
    <aside aria-label={`Inspector for ${node.issueKey}`} style={{ width: 300, padding: 12, overflowY: 'auto', background: 'var(--color-surface-1)', borderLeft: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <strong>{node.issueKey}</strong>
        <button type="button" className={controlStyles.iconBtn} onClick={onClose} aria-label="Close inspector">✕</button>
      </div>

      <h3 style={{ fontSize: 14, margin: '8px 0', lineHeight: 1.3 }}>{node.summary}</h3>

      {/* Epic detail — read-only */}
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', fontSize: 12, margin: 0 }}>
        <dt style={{ opacity: 0.6 }}>Status</dt><dd style={{ margin: 0 }}>{node.status}</dd>
        <dt style={{ opacity: 0.6 }}>Assignee</dt><dd style={{ margin: 0 }}>{node.assignee ?? 'Unassigned'}</dd>
        <dt style={{ opacity: 0.6 }}>Size / points</dt><dd style={{ margin: 0 }}>{node.size ? `${node.size} · ${node.effectivePoints}pt` : formatPoints(node.storyPoints)}</dd>
        {node.businessValue !== null && (
          <>
            <dt style={{ opacity: 0.6 }}>Business value</dt><dd style={{ margin: 0 }}>{node.businessValue}</dd>
          </>
        )}
        <dt style={{ opacity: 0.6 }}>Health</dt><dd style={{ margin: 0 }}>{node.health}</dd>
        <dt style={{ opacity: 0.6 }}>Completion</dt><dd style={{ margin: 0 }}>{node.completionPercent}%</dd>
      </dl>

      {/* Description — read-only, normalized to plain text */}
      <div style={{ marginTop: 8, fontSize: 12 }}>
        <div style={{ opacity: 0.6 }}>Description</div>
        {normalizedDescription ? (
          <p style={{ margin: '2px 0', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{normalizedDescription}</p>
        ) : (
          <p style={{ opacity: 0.6, margin: '2px 0' }}>No description.</p>
        )}
      </div>

      {node.hygieneFlags.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <div style={{ opacity: 0.6 }}>Hygiene</div>
          <ul style={{ margin: '2px 0', paddingLeft: 16 }}>
            {node.hygieneFlags.map((flag) => <li key={flag.checkId}>{flag.label}</li>)}
          </ul>
        </div>
      )}

      {node.dependencies.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          <div style={{ opacity: 0.6 }}>Links</div>
          <ul style={{ margin: '2px 0', paddingLeft: 16 }}>
            {node.dependencies.map((dependency) => (
              <li key={`${dependency.type}-${dependency.targetKey}`}>{dependency.type} {dependency.targetKey}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Attachments — read-only download links */}
      <div style={{ marginTop: 8, fontSize: 12 }}>
        <div style={{ opacity: 0.6 }}>Attachments ({node.attachments.length})</div>
        <AttachmentList attachments={node.attachments} />
      </div>

      {/* Comments — loaded on demand, newest first, read-only */}
      <div style={{ marginTop: 8, fontSize: 12 }}>
        <div style={{ opacity: 0.6 }}>Comments{comments.length > 0 ? ` (${comments.length})` : ''}</div>
        <CommentThread comments={comments} isLoading={isLoadingComments} loadError={commentsLoadError} />
      </div>

      {/* Child records — read-only */}
      <div style={{ marginTop: 8, fontSize: 12 }}>
        <div style={{ opacity: 0.6 }}>Child records ({node.childStories.length})</div>
        {node.childStories.length === 0 ? (
          <p style={{ opacity: 0.6 }}>No child records.</p>
        ) : (
          <ul style={{ margin: '2px 0', paddingLeft: 16 }}>
            {node.childStories.map((child) => (
              <li key={child.key}>{child.key} — {child.summary} · {child.status} · {formatPoints(child.storyPoints)}</li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
