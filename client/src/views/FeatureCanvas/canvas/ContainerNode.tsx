// ContainerNode.tsx — Renders a release / sprint / parking-lot box behind the feature nodes.
//
// A container is a drop target the user drags features into. Sprint and release boxes show a
// running capacity meter that turns red when the sum of member sizes exceeds the budget, so the
// user can see over-commitment without doing arithmetic. Provisional boxes (not yet in Jira) are
// drawn with a dashed border to distinguish them from real sprints/versions.

import { type Node, type NodeProps } from '@xyflow/react';

import type { ContainerCapacity } from '../logic/canvasTypes.ts';
import type { ContainerKind } from '../overlay/overlayModel.ts';

/** React Flow node data payload for a container box. */
export interface ContainerNodeData {
  kind: ContainerKind;
  title: string;
  isProvisional: boolean;
  capacity: ContainerCapacity | null;
  [key: string]: unknown;
}

/** A React Flow node typed to carry container data. */
export type ContainerRfNode = Node<ContainerNodeData, 'container'>;

const KIND_ACCENT: Record<ContainerKind, string> = {
  release: '#f59e0b',
  sprint: '#3b82f6',
  parkingLot: '#6b7280',
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
export function ContainerNode({ data }: NodeProps<ContainerRfNode>): React.JSX.Element {
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
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 600 }}>
        <span style={{ color: accent }}>
          {data.title}
          {data.isProvisional ? ' (proposed)' : ''}
        </span>
        {data.capacity && <CapacityMeter capacity={data.capacity} />}
      </div>
    </div>
  );
}
