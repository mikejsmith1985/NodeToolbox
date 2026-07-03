// nodeMapping.ts — Joins the persisted overlay with live Jira feature data into canvas nodes.
//
// The overlay stores only arrangement (position, size, priority, box). All display data —
// summary, status, health, hygiene, child stories, dependencies — comes live from the Feature
// Review fetch, so a reopened canvas restores arrangement without ever showing stale Jira data.
// This module is pure: given the same inputs it always produces the same nodes.

import type { FeatureReviewItem } from '../../SprintDashboard/featureReview.ts';
import type { CanvasOverlay, CanvasNodeState } from '../overlay/overlayModel.ts';
import { createNodeState } from '../overlay/overlayModel.ts';
import { resolveEffectivePoints } from '../logic/sizing.ts';
import type { CanvasChildStory, CanvasNode, CanvasNodeDependency } from '../logic/canvasTypes.ts';

// Default grid layout for features that have never been positioned, so the first surfacing is
// legible rather than a pile at the origin.
const DEFAULT_GRID_COLUMNS = 5;
const DEFAULT_GRID_GAP_X = 300;
const DEFAULT_GRID_GAP_Y = 220;

/** Computes a stable default canvas position for the Nth freshly-surfaced feature. */
export function computeDefaultPosition(featureIndex: number): { x: number; y: number } {
  return {
    x: (featureIndex % DEFAULT_GRID_COLUMNS) * DEFAULT_GRID_GAP_X,
    y: Math.floor(featureIndex / DEFAULT_GRID_COLUMNS) * DEFAULT_GRID_GAP_Y,
  };
}

/** Rolls a feature's live points up from its child stories; null when no child is pointed. */
function rollUpStoryPoints(item: FeatureReviewItem): number | null {
  const pointedChildren = item.feature.children
    .map((childStory) => childStory.storyPoints)
    .filter((points): points is number => typeof points === 'number' && Number.isFinite(points));
  if (pointedChildren.length === 0) {
    return null;
  }
  return pointedChildren.reduce((runningTotal, points) => runningTotal + points, 0);
}

/** Maps a feature's blueprint child stories into the lighter canvas child-story shape. */
function mapChildStories(item: FeatureReviewItem): CanvasChildStory[] {
  return item.feature.children.map((childStory) => ({
    key: childStory.key,
    summary: childStory.summary,
    status: childStory.status,
    statusCategoryKey: childStory.statusCategoryKey ?? null,
    storyPoints: childStory.storyPoints,
  }));
}

/** Extracts blocker/relationship indicators from a feature issue's Jira issue links. */
function mapDependencies(item: FeatureReviewItem): CanvasNodeDependency[] {
  const issueLinks = (item.featureIssue.fields as { issuelinks?: unknown }).issuelinks;
  if (!Array.isArray(issueLinks)) {
    return [];
  }
  const dependencies: CanvasNodeDependency[] = [];
  for (const rawLink of issueLinks) {
    const link = rawLink as {
      type?: { name?: string };
      inwardIssue?: { key?: string };
      outwardIssue?: { key?: string };
    };
    const typeName = link.type?.name ?? 'relates';
    if (link.inwardIssue?.key) {
      dependencies.push({ targetKey: link.inwardIssue.key, type: typeName, direction: 'inward' });
    } else if (link.outwardIssue?.key) {
      dependencies.push({ targetKey: link.outwardIssue.key, type: typeName, direction: 'outward' });
    }
  }
  return dependencies;
}

/** Reads the feature's live status-category key (used for WIP classification). */
function readStatusCategoryKey(item: FeatureReviewItem): string | null {
  const status = item.featureIssue.fields.status as { statusCategory?: { key?: string } } | null | undefined;
  return status?.statusCategory?.key ?? null;
}

/** Returns node states that must be created because a surfaced feature has never been placed. */
export function collectMissingNodeStates(
  items: readonly FeatureReviewItem[],
  overlay: CanvasOverlay,
): CanvasNodeState[] {
  return items
    .map((item, featureIndex) => ({ item, featureIndex }))
    .filter(({ item }) => overlay.nodes[item.feature.key] === undefined)
    .map(({ item, featureIndex }) => {
      const position = computeDefaultPosition(featureIndex);
      return createNodeState(item.feature.key, position.x, position.y);
    });
}

/**
 * Builds the render/logic node list by joining each live feature with its overlay arrangement
 * (falling back to a computed default position for features not yet placed).
 */
export function mapFeaturesToNodes(items: readonly FeatureReviewItem[], overlay: CanvasOverlay): CanvasNode[] {
  return items.map((item, featureIndex) => {
    const nodeState = overlay.nodes[item.feature.key];
    const position = nodeState?.position ?? computeDefaultPosition(featureIndex);
    const size = nodeState?.size ?? null;
    const rolledStoryPoints = rollUpStoryPoints(item);
    return {
      issueKey: item.feature.key,
      position,
      size,
      priority: nodeState?.priority ?? null,
      containerId: nodeState?.containerId ?? null,
      isExpanded: nodeState?.isExpanded ?? false,
      isParked: nodeState?.isParked ?? false,
      summary: item.feature.summary,
      status: item.feature.status,
      statusCategoryKey: readStatusCategoryKey(item),
      assignee: item.featureIssue.fields.assignee?.displayName ?? null,
      storyPoints: rolledStoryPoints,
      health: item.feature.health,
      completionPercent: item.feature.completionPercent,
      hygieneFlags: item.hygieneFlags,
      childStories: mapChildStories(item),
      dependencies: mapDependencies(item),
      effectivePoints: resolveEffectivePoints(size, rolledStoryPoints, overlay.sizeMapping),
    };
  });
}
