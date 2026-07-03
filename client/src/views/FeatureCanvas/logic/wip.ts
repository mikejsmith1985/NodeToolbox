// wip.ts — Work-in-progress computation for Stage 2 (Stabilize WIP).
//
// Reuses the same status-category signal the rest of the product uses for its "WIP zones":
// an issue is in-progress when its Jira status category is "indeterminate". Stage 2's job is
// to make overflow visible so the user can park work down to a sustainable limit.

import type { CanvasNode, WipSnapshot } from './canvasTypes.ts';

/** Jira status category key that represents active, in-progress work. */
const IN_PROGRESS_STATUS_CATEGORY = 'indeterminate';

/** Counts nodes that are actively in progress but not parked. */
function countActiveInProgress(nodes: readonly CanvasNode[]): number {
  return nodes.filter((node) => !node.isParked && node.statusCategoryKey === IN_PROGRESS_STATUS_CATEGORY).length;
}

/**
 * Builds the Stage 2 WIP snapshot: how many nodes are in progress, the configured limit, how
 * far over the limit the team is, and how many items have been parked.
 */
export function computeWipSnapshot(nodes: readonly CanvasNode[], wipLimit: number | null): WipSnapshot {
  const inProgressCount = countActiveInProgress(nodes);
  const parkedCount = nodes.filter((node) => node.isParked).length;
  const overflow = wipLimit === null ? 0 : Math.max(0, inProgressCount - wipLimit);
  return { inProgressCount, limit: wipLimit, overflow, parkedCount };
}
