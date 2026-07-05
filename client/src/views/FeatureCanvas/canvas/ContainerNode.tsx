// ContainerNode.tsx — Renders a release / sprint / parking-lot box behind the feature nodes.
//
// A container is a drop target the user drags features into. Sprint and release boxes show a
// running capacity meter that turns red when the sum of member sizes exceeds the budget, so the
// user can see over-commitment without doing arithmetic. Provisional boxes (not yet in Jira) are
// drawn with a dashed border to distinguish them from real sprints/versions.

import { memo } from 'react';
import { NodeResizer, type Node, type NodeProps } from '@xyflow/react';

import type { ContainerCapacity } from '../logic/canvasTypes.ts';
import type { ContainerKind } from '../overlay/overlayModel.ts';

// Minimum box size so a resized box never collapses below a card's footprint.
const MIN_BOX_WIDTH = 260;
const MIN_BOX_HEIGHT = 140;

/** React Flow node data payload for a container box. */
export interface ContainerNodeData {
  kind: ContainerKind;
  title: string;
  isProvisional: boolean;
  capacity: ContainerCapacity | null;
  onDelete?: () => void;
  /** Persists a resize: called with the box's new bounds when the user finishes dragging a handle. */
  onResize?: (bounds: { x: number; y: number; width: number; height: number }) => void;
  [key: string]: unknown;
}

/** A React Flow node typed to carry container data. */
export type ContainerRfNode = Node<ContainerNodeData, 'container'>;

const KIND_ACCENT: Record<ContainerKind, string> = {
  release: '#f59e0b',
  sprint: '#3b82f6',
  parkingLot: '#6b7280',
  complete: '#22c55e',
  later: '#a78bfa',
};

/** Renders the capacity meter text and color for a sprint/release box. */
function CapacityMeter({ capacity }: { capacity: ContainerCapacity }): React.JSX.Element {
  const isOver = capacity.status === 'over';
  const budgetLabel = capacity.budget === null ? '∞' : String(capacity.budget);
  return (
    <span style={{ color: isOver ? '#ef4444' : 'inherit', fontWeight: isOver ? 700 : 400 }}>
      {capacity.total} / {budgetLabel} pt{isOver ? ` · ${capacity.overBy} over` : ''}
    </span>
  );
}

/** Custom React Flow node: a container box that features are dropped into. */
function ContainerNodeComponent({ data, selected }: NodeProps<ContainerRfNode>): React.JSX.Element {
  const accent = KIND_ACCENT[data.kind];
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 10,
        border: `2px ${data.isProvisional ? 'dashed' : 'solid'} ${accent}`,
        background: 'rgba(148,163,184,0.06)',
        color: 'var(--tbx-canvas-node-fg, #e2e8f0)',
        padding: 8,
        boxSizing: 'border-box',
      }}
    >
      {/* Resize handles appear when the box is selected; on release we persist the new bounds. */}
      <NodeResizer
        color={accent}
        isVisible={selected}
        minWidth={MIN_BOX_WIDTH}
        minHeight={MIN_BOX_HEIGHT}
        onResizeEnd={(_event, params) => data.onResize?.({ x: params.x, y: params.y, width: params.width, height: params.height })}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600 }}>
        <span style={{ color: accent }}>
          {data.title}
          {data.isProvisional ? ' (proposed)' : ''}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {data.capacity && <CapacityMeter capacity={data.capacity} />}
          {data.onDelete && (
            <button
              type="button"
              // `nodrag` stops React Flow from starting a pan/drag when the button is pressed.
              className="nodrag"
              aria-label={`Delete ${data.title}`}
              title="Delete box"
              onClick={(clickEvent) => {
                clickEvent.stopPropagation();
                data.onDelete?.();
              }}
              style={{ cursor: 'pointer', border: 'none', background: 'transparent', color: 'inherit', fontSize: 14, lineHeight: 1 }}
            >
              ✕
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

// Memoized so a container only re-renders when its own data changes (SC-8 scale).
export const ContainerNode = memo(ContainerNodeComponent);
