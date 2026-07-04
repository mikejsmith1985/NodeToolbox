// NodeInspectorPanel.tsx — Read-only side inspector for the selected feature node.
//
// Progressive disclosure for the canvas: the card stays scannable, and opening a node reveals the
// epic's full detail plus its child records here, on demand. It renders entirely from the already-
// loaded CanvasNode (no new fetch) and edits nothing — inspection only. Exactly one node is shown at
// a time; it renders nothing when no node is selected.

import type { CanvasNode } from '../logic/canvasTypes.ts';

/** Props for the read-only node inspector. */
export interface NodeInspectorPanelProps {
  node: CanvasNode | null;
  onClose: () => void;
}

/** Formats a child story's points for display. */
function formatPoints(storyPoints: number | null): string {
  return storyPoints === null ? '—' : `${storyPoints}pt`;
}

/** The docked, read-only inspector for the currently selected node. */
export function NodeInspectorPanel({ node, onClose }: NodeInspectorPanelProps): React.JSX.Element | null {
  if (node === null) {
    return null;
  }

  return (
    <aside aria-label={`Inspector for ${node.issueKey}`} style={{ width: 300, padding: 12, overflowY: 'auto', background: '#0f172a', borderLeft: '1px solid #334155', color: '#e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
        <strong>{node.issueKey}</strong>
        <button type="button" onClick={onClose} aria-label="Close inspector">✕</button>
      </div>

      <h3 style={{ fontSize: 14, margin: '8px 0', lineHeight: 1.3 }}>{node.summary}</h3>

      {/* Epic detail — read-only */}
      <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', fontSize: 12, margin: 0 }}>
        <dt style={{ opacity: 0.6 }}>Status</dt><dd style={{ margin: 0 }}>{node.status}</dd>
        <dt style={{ opacity: 0.6 }}>Assignee</dt><dd style={{ margin: 0 }}>{node.assignee ?? 'Unassigned'}</dd>
        <dt style={{ opacity: 0.6 }}>Size / points</dt><dd style={{ margin: 0 }}>{node.size ? `${node.size} · ${node.effectivePoints}pt` : formatPoints(node.storyPoints)}</dd>
        <dt style={{ opacity: 0.6 }}>Health</dt><dd style={{ margin: 0 }}>{node.health}</dd>
        <dt style={{ opacity: 0.6 }}>Completion</dt><dd style={{ margin: 0 }}>{node.completionPercent}%</dd>
      </dl>

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
