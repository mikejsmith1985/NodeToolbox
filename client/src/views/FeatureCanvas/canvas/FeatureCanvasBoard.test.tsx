// FeatureCanvasBoard.test.tsx — Verifies the board renders exactly one node per surfaced feature.

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CanvasNode } from '../logic/canvasTypes.ts';
import { FeatureCanvasBoard } from './FeatureCanvasBoard.tsx';

// Stub React Flow with a lightweight host that renders each node through its registered node
// component, so we can assert node counts without a real canvas/viewport in jsdom.
vi.mock('@xyflow/react', async () => {
  const react = await vi.importActual<typeof import('react')>('react');
  return {
    ReactFlow: ({ nodes, nodeTypes }: { nodes: Array<{ id: string; type: string; data: unknown }>; nodeTypes: Record<string, React.ComponentType<{ data: unknown; id: string; type: string; selected: boolean }>> }) => (
      <div data-testid="rf">
        {nodes.map((canvasNode) => {
          const NodeComponent = nodeTypes[canvasNode.type];
          return (
            <div key={canvasNode.id} data-testid={`rf-${canvasNode.type}`}>
              <NodeComponent data={canvasNode.data} id={canvasNode.id} type={canvasNode.type} selected={false} />
            </div>
          );
        })}
      </div>
    ),
    Background: () => null,
    Controls: () => null,
    MiniMap: () => null,
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useNodesState: (initial: unknown) => {
      const [nodes, setNodes] = react.useState(initial);
      return [nodes, setNodes, () => {}];
    },
    useReactFlow: () => ({ getIntersectingNodes: () => [] }),
    Handle: () => null,
    Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
  };
});

function buildNode(issueKey: string): CanvasNode {
  return {
    issueKey, position: { x: 0, y: 0 }, size: null, priority: null, containerId: null,
    isExpanded: false, isParked: false, summary: `Summary ${issueKey}`, status: 'To Do',
    statusCategoryKey: 'new', assignee: null, storyPoints: null, health: 'green',
    completionPercent: 0, hygieneFlags: [], childStories: [], dependencies: [], businessValue: null, description: null, acceptanceCriteria: null, parkReason: null, storyPlacements: {}, pendingComment: "", attachments: [], effectivePoints: 0,
  };
}

describe('FeatureCanvasBoard', () => {
  it('renders exactly one feature node per surfaced feature', () => {
    render(
      <FeatureCanvasBoard
        canvasNodes={[buildNode('DENP-1'), buildNode('DENP-2'), buildNode('DENP-3')]}
        containers={[]}
        capacities={new Map()}
        onSelect={vi.fn()}
        onPositionChange={vi.fn()}
        onDropIntoContainer={vi.fn()}
        onDeleteContainer={vi.fn()}
        onDeleteNode={vi.fn()}
        onMoveContainer={vi.fn()}
        onResizeContainer={vi.fn()}
        onRenameContainer={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId('rf-feature')).toHaveLength(3);
    expect(screen.getByText('DENP-1')).toBeInTheDocument();
  });

  it('renders a 200-node backlog (SC-8 scale)', () => {
    const manyNodes = Array.from({ length: 200 }, (_unused, index) => buildNode(`DENP-${index}`));
    render(
      <FeatureCanvasBoard
        canvasNodes={manyNodes}
        containers={[]}
        capacities={new Map()}
        onSelect={vi.fn()}
        onPositionChange={vi.fn()}
        onDropIntoContainer={vi.fn()}
        onDeleteContainer={vi.fn()}
        onDeleteNode={vi.fn()}
        onMoveContainer={vi.fn()}
        onResizeContainer={vi.fn()}
        onRenameContainer={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId('rf-feature')).toHaveLength(200);
  });
});
