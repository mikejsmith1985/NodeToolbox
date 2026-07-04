// FeatureNode.tsx — Renders one feature as a card node on the canvas.
//
// The card shows everything a user needs to triage at a glance: key, summary, a status-category
// color stripe, relative size or points, feature health, priority bucket, and a hygiene-flag
// badge when the reused hygiene checks found problems. Interaction (sizing, prioritizing,
// parking) happens in the CoachPanel against the selected node, keeping this component display-only.

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import type { CanvasNode } from '../logic/canvasTypes.ts';
import { HEALTH_COLORS, STATUS_CATEGORY_COLORS } from './nodeColors.ts';

/** React Flow node data payload for a feature card. */
export interface FeatureNodeData {
  node: CanvasNode;
  /** Removes this feature from the curated canvas (overlay-only; does not touch Jira). */
  onDelete?: () => void;
  /** True when a legend focus filter is active and this card does not match — it dims back. */
  isDimmed?: boolean;
  [key: string]: unknown;
}

// How far non-matching cards fade when a legend focus filter is active.
const DIMMED_OPACITY = 0.15;
const PARKED_OPACITY = 0.6;

/** A React Flow node typed to carry feature data. */
export type FeatureRfNode = Node<FeatureNodeData, 'feature'>;

/** Formats the capacity chip: overlay size (if set) else live points else a dash. */
function formatSizeChip(node: CanvasNode): string {
  if (node.size !== null) {
    return `${node.size} · ${node.effectivePoints}pt`;
  }
  return node.storyPoints !== null ? `${node.storyPoints}pt` : '—';
}

/** Custom React Flow node: a feature triage card. */
function FeatureNodeComponent({ data, selected }: NodeProps<FeatureRfNode>): React.JSX.Element {
  const { node, onDelete, isDimmed } = data;
  const stripeColor = STATUS_CATEGORY_COLORS[node.statusCategoryKey ?? 'new'] ?? STATUS_CATEGORY_COLORS.new;
  const healthColor = HEALTH_COLORS[node.health] ?? HEALTH_COLORS.gray;
  const errorFlagCount = node.hygieneFlags.filter((flag) => flag.severity === 'error').length;
  // A legend focus filter dims non-matching cards hardest; otherwise parked cards read as muted.
  const cardOpacity = isDimmed ? DIMMED_OPACITY : node.isParked ? PARKED_OPACITY : 1;

  return (
    <div
      style={{
        width: 240,
        borderRadius: 8,
        border: `2px solid ${selected ? '#8b5cf6' : 'rgba(148,163,184,0.4)'}`,
        borderLeft: `6px solid ${stripeColor}`,
        background: 'var(--tbx-canvas-node-bg, #1e293b)',
        color: 'var(--tbx-canvas-node-fg, #e2e8f0)',
        padding: '8px 10px',
        opacity: cardOpacity,
        transition: 'opacity 150ms ease',
        fontSize: 12,
      }}
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
        <strong>{node.issueKey}</strong>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span title="Feature health" style={{ color: healthColor }}>●</span>
          {onDelete && (
            <button
              type="button"
              className="nodrag"
              aria-label={`Remove ${node.issueKey} from canvas`}
              title="Remove from canvas"
              onClick={(clickEvent) => { clickEvent.stopPropagation(); onDelete(); }}
              style={{ border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer', opacity: 0.6, padding: 0, lineHeight: 1 }}
            >
              ✕
            </button>
          )}
        </div>
      </div>
      <div style={{ margin: '4px 0', lineHeight: 1.3 }}>{node.summary}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ background: 'rgba(148,163,184,0.2)', borderRadius: 4, padding: '1px 6px' }}>{formatSizeChip(node)}</span>
        {node.priority !== null && (
          <span style={{ background: 'rgba(139,92,246,0.25)', borderRadius: 4, padding: '1px 6px' }}>{node.priority}</span>
        )}
        {node.completionPercent > 0 && <span>{node.completionPercent}%</span>}
        {node.hygieneFlags.length > 0 && (
          <span title={node.hygieneFlags.map((flag) => flag.label).join(', ')} style={{ color: errorFlagCount > 0 ? '#ef4444' : '#eab308' }}>
            ⚑ {node.hygieneFlags.length}
          </span>
        )}
        {node.isParked && <span title="Parked">⏸</span>}
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

// Memoized so React Flow only re-renders nodes whose data actually changed — keeps the canvas
// interactive at 200+ nodes (SC-8).
export const FeatureNode = memo(FeatureNodeComponent);
