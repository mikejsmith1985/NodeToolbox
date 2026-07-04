// nodeFilter.ts — The canvas "focus" filter driven by clicking an entry in the legend/key.
//
// Clicking a status stripe or health color in the key focuses the canvas on just those features:
// matching cards stay bright while the rest dim back. This is the pure model + matcher; the legend
// sets it, the board reads it. No filter (null) means show everything at full strength.

import type { CanvasNode } from './canvasTypes.ts';

/** A focus filter selecting one legend dimension + value. Null means "show all". */
export interface CanvasNodeFilter {
  dimension: 'status' | 'health';
  value: string;
}

/** True when the node matches the active filter — always true when there is no filter. */
export function nodeMatchesFilter(
  node: Pick<CanvasNode, 'statusCategoryKey' | 'health'>,
  filter: CanvasNodeFilter | null,
): boolean {
  if (filter === null) {
    return true;
  }
  if (filter.dimension === 'status') {
    return (node.statusCategoryKey ?? 'new') === filter.value;
  }
  return node.health === filter.value;
}

/** True when two filters name the same dimension+value — used to toggle a key entry off. */
export function isSameFilter(first: CanvasNodeFilter | null, second: CanvasNodeFilter | null): boolean {
  if (first === null || second === null) {
    return first === second;
  }
  return first.dimension === second.dimension && first.value === second.value;
}
