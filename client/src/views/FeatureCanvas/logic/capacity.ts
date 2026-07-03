// capacity.ts — Container capacity math for Stage 5 (Sequence & Box).
//
// Every release/sprint box shows whether it is under, at, or over its capacity budget so the
// user can tell at a glance without doing arithmetic. Capacity is the sum of member nodes'
// effective points (t-shirt size mapped to points, or live story points).

import type { CanvasContainer } from '../overlay/overlayModel.ts';
import type { CanvasNode, ContainerCapacity } from './canvasTypes.ts';

/** Sums the effective points of every node currently assigned to the given container. */
export function sumContainerPoints(containerId: string, nodes: readonly CanvasNode[]): number {
  return nodes
    .filter((node) => node.containerId === containerId)
    .reduce((runningTotal, node) => runningTotal + node.effectivePoints, 0);
}

/** Classifies a total against a budget; a container with no budget is always reported "under". */
export function classifyCapacity(total: number, budget: number | null): ContainerCapacity['status'] {
  if (budget === null) {
    return 'under';
  }
  if (total > budget) {
    return 'over';
  }
  return total === budget ? 'at' : 'under';
}

/** Builds the full capacity readout for one container box. */
export function computeContainerCapacity(container: CanvasContainer, nodes: readonly CanvasNode[]): ContainerCapacity {
  const total = sumContainerPoints(container.id, nodes);
  const budget = container.capacityBudget;
  return {
    containerId: container.id,
    total,
    budget,
    status: classifyCapacity(total, budget),
    overBy: budget === null ? 0 : Math.max(0, total - budget),
  };
}
