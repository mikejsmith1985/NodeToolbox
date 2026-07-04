// FeatureCanvasBoard.tsx — The pan/zoom spatial canvas that hosts feature and container nodes.
//
// FRAMEWORK-FIRST (Constitution Article VII) — documented gap justification:
//   The feature's core capability is an interactive pan/zoom node canvas with container grouping
//   at 200+ nodes. The repo's sanctioned drag primitive (@dnd-kit) provides sortable lists only:
//   there is no free x/y drag, no multi-container drop, and — critically — no pan/zoom, and its
//   collision math breaks under a scaled viewport. Hand-rolling that substance would rebuild what
//   a purpose-built framework provides, which Article VII forbids. React Flow (@xyflow/react) is
//   therefore adopted here for the canvas surface, lazy-loaded so it stays off the shared bundle.

import { useEffect, useMemo } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { CanvasNode, ContainerCapacity } from '../logic/canvasTypes.ts';
import { nodeMatchesFilter, type CanvasNodeFilter } from '../logic/nodeFilter.ts';
import type { CanvasContainer } from '../overlay/overlayModel.ts';
import { ContainerNode, type ContainerNodeData } from './ContainerNode.tsx';
import { FeatureNode, type FeatureNodeData } from './FeatureNode.tsx';

const NODE_TYPES = { feature: FeatureNode, container: ContainerNode };

/** Props the board needs to render nodes and report user gestures back to the overlay. */
export interface FeatureCanvasBoardProps {
  canvasNodes: readonly CanvasNode[];
  containers: readonly CanvasContainer[];
  capacities: ReadonlyMap<string, ContainerCapacity>;
  onSelect: (issueKey: string | null) => void;
  onPositionChange: (issueKey: string, x: number, y: number) => void;
  onDropIntoContainer: (issueKey: string, containerId: string | null) => void;
  onDeleteContainer: (containerId: string) => void;
  onDeleteNode: (issueKey: string) => void;
  /** Active legend focus filter; non-matching feature cards dim back. Null shows all at full strength. */
  filter?: CanvasNodeFilter | null;
}

/** Builds the React Flow node array: container boxes first (behind), then feature cards on top. */
function buildReactFlowNodes(
  canvasNodes: readonly CanvasNode[],
  containers: readonly CanvasContainer[],
  capacities: ReadonlyMap<string, ContainerCapacity>,
  onDeleteContainer: (containerId: string) => void,
  onDeleteNode: (issueKey: string) => void,
  filter: CanvasNodeFilter | null,
): Node[] {
  const containerNodes: Node[] = containers.map((container) => ({
    id: container.id,
    type: 'container',
    position: { x: container.bounds.x, y: container.bounds.y },
    data: {
      kind: container.kind,
      title: container.title,
      isProvisional: container.provenance.state === 'provisional',
      capacity: capacities.get(container.id) ?? null,
      onDelete: () => onDeleteContainer(container.id),
    } satisfies ContainerNodeData,
    style: { width: container.bounds.width, height: container.bounds.height },
    draggable: true,
    selectable: false,
    zIndex: 0,
  }));

  const featureNodes: Node[] = canvasNodes.map((node) => ({
    id: node.issueKey,
    type: 'feature',
    position: node.position,
    data: { node, onDelete: () => onDeleteNode(node.issueKey), isDimmed: !nodeMatchesFilter(node, filter) } satisfies FeatureNodeData,
    zIndex: 1,
  }));

  return [...containerNodes, ...featureNodes];
}

/** A signature that changes only when the rendered node set meaningfully changes. */
function buildNodeSignature(canvasNodes: readonly CanvasNode[], containers: readonly CanvasContainer[], filter: CanvasNodeFilter | null): string {
  const featurePart = canvasNodes
    .map((node) => `${node.issueKey}:${node.size}:${node.priority}:${node.containerId}:${node.isParked}`)
    .join('|');
  const containerPart = containers.map((container) => `${container.id}:${container.capacityBudget}`).join('|');
  // Include the filter so the cards rebuild (dim/undim) when the user focuses a legend entry.
  const filterPart = filter ? `${filter.dimension}=${filter.value}` : 'none';
  return `${featurePart}##${containerPart}##${filterPart}`;
}

/** Inner board that has access to the React Flow instance for intersection hit-testing. */
function BoardInner(props: FeatureCanvasBoardProps): React.JSX.Element {
  const { canvasNodes, containers, capacities, onSelect, onPositionChange, onDropIntoContainer, onDeleteContainer, onDeleteNode, filter = null } = props;
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const { getIntersectingNodes } = useReactFlow();

  const nodeSignature = useMemo(() => buildNodeSignature(canvasNodes, containers, filter), [canvasNodes, containers, filter]);

  // Rebuild the canvas nodes whenever the underlying feature/container set changes.
  useEffect(() => {
    setNodes(buildReactFlowNodes(canvasNodes, containers, capacities, onDeleteContainer, onDeleteNode, filter));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeSignature, setNodes]);

  const handleNodeClick: NodeMouseHandler = (_event, node) => {
    if (node.type === 'feature') {
      onSelect(node.id);
    }
  };

  const handleNodeDragStop = (_event: unknown, node: Node): void => {
    if (node.type !== 'feature') {
      return;
    }
    onPositionChange(node.id, node.position.x, node.position.y);
    const intersectingContainer = getIntersectingNodes(node).find((candidate) => candidate.type === 'container');
    onDropIntoContainer(node.id, intersectingContainer ? intersectingContainer.id : null);
  };

  return (
    <ReactFlow
      nodes={nodes}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onNodeClick={handleNodeClick}
      onNodeDragStop={handleNodeDragStop}
      onPaneClick={() => onSelect(null)}
      onlyRenderVisibleElements
      minZoom={0.1}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}

/** The pan/zoom Feature Canvas board, wrapped in its own React Flow provider. */
export function FeatureCanvasBoard(props: FeatureCanvasBoardProps): React.JSX.Element {
  return (
    <ReactFlowProvider>
      <BoardInner {...props} />
    </ReactFlowProvider>
  );
}
