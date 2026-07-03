// commitDiff.ts — Builds the itemized, reviewable set of Jira writes from the planning overlay.
//
// This is the heart of the sandbox guarantee: arrangement lives in the overlay and is turned
// into concrete Jira changes ONLY here, as a list the user reviews before anything is written.
// Two rules make the output Jira-correct:
//   1. Provisional containers must be created before any assignment references them (dependsOn).
//   2. Feature→sprint boxing expands to one assignment PER CHILD STORY, because Jira sprints
//      hold stories, not epics/features (FR-6.1a). Feature→release sets the feature's fixVersion.

import type { CanvasContainer, MoscowBucket, TshirtSize } from '../overlay/overlayModel.ts';
import type { CanvasNode, CommitDiffItem } from './canvasTypes.ts';
import { pointsForSize } from './sizing.ts';

/** Optional commit inputs: a user-confirmed MoSCoW→Jira priority mapping and the size mapping. */
export interface CommitDiffOptions {
  priorityToJira?: Partial<Record<MoscowBucket, string>>;
  sizeMapping?: Record<TshirtSize, number>;
}

/** Stable id for the create item of a provisional container (referenced by dependsOn). */
function createItemId(containerId: string): string {
  return `create:${containerId}`;
}

/** Emits the create-sprint / create-version items for every provisional container, ordered first. */
function buildContainerCreateItems(containers: readonly CanvasContainer[]): CommitDiffItem[] {
  return containers
    .filter((container) => container.provenance.state === 'provisional' && container.kind !== 'parkingLot')
    .map((container) => ({
      id: createItemId(container.id),
      kind: container.kind === 'sprint' ? 'createSprint' : 'createVersion',
      issueKey: null,
      containerId: container.id,
      from: null,
      to: container.title,
      dependsOn: null,
      selected: true,
    }));
}

/** Resolves the dependsOn create-item id for a container, or null when the container is already real. */
function resolveDependsOn(container: CanvasContainer): string | null {
  return container.provenance.state === 'provisional' ? createItemId(container.id) : null;
}

/** Expands one feature assigned to a sprint into per-child-story sprintAssign items (FR-6.1a). */
function buildSprintAssignItems(node: CanvasNode, container: CanvasContainer): CommitDiffItem[] {
  const dependsOn = resolveDependsOn(container);
  const targetKeys = node.childStories.length > 0 ? node.childStories.map((story) => story.key) : [node.issueKey];
  return targetKeys.map((targetKey) => ({
    id: `sprintAssign:${targetKey}:${container.id}`,
    kind: 'sprintAssign',
    issueKey: targetKey,
    containerId: container.id,
    from: null,
    to: container.title,
    dependsOn,
    selected: true,
  }));
}

/** Builds the fixVersion assignment for a feature dropped into a release box. */
function buildVersionAssignItem(node: CanvasNode, container: CanvasContainer): CommitDiffItem {
  return {
    id: `versionAssign:${node.issueKey}:${container.id}`,
    kind: 'versionAssign',
    issueKey: node.issueKey,
    containerId: container.id,
    from: null,
    to: container.title,
    dependsOn: resolveDependsOn(container),
    selected: true,
  };
}

/** Builds a points write when the user sized a node to a value that differs from its live points. */
function buildPointsItem(node: CanvasNode, sizeMapping: Record<TshirtSize, number> | undefined): CommitDiffItem | null {
  if (node.size === null) {
    return null;
  }
  const targetPoints = pointsForSize(node.size, sizeMapping);
  if (node.storyPoints === targetPoints) {
    return null;
  }
  return {
    id: `pointsSet:${node.issueKey}`,
    kind: 'pointsSet',
    issueKey: node.issueKey,
    containerId: null,
    from: node.storyPoints,
    to: targetPoints,
    dependsOn: null,
    selected: true,
  };
}

/** Builds a priority write only when the user opted into a MoSCoW→Jira priority mapping. */
function buildPriorityItem(node: CanvasNode, options: CommitDiffOptions): CommitDiffItem | null {
  if (node.priority === null || !options.priorityToJira) {
    return null;
  }
  const jiraPriorityName = options.priorityToJira[node.priority];
  if (!jiraPriorityName) {
    return null;
  }
  return {
    id: `prioritySet:${node.issueKey}`,
    kind: 'prioritySet',
    issueKey: node.issueKey,
    containerId: null,
    from: null,
    to: jiraPriorityName,
    dependsOn: null,
    selected: true,
  };
}

/**
 * Produces the ordered Review & Commit diff: container-create items first (so provisional boxes
 * become real before assignments run), then per-node assignments, points, and any priority writes.
 * Parking-lot membership is intentionally never committed.
 */
export function buildCommitDiff(
  nodes: readonly CanvasNode[],
  containers: readonly CanvasContainer[],
  options: CommitDiffOptions = {},
): CommitDiffItem[] {
  const containersById = new Map(containers.map((container) => [container.id, container]));
  const createItems = buildContainerCreateItems(containers);
  const assignmentItems: CommitDiffItem[] = [];

  for (const node of nodes) {
    if (node.containerId !== null) {
      const container = containersById.get(node.containerId);
      if (container && container.kind === 'sprint') {
        assignmentItems.push(...buildSprintAssignItems(node, container));
      } else if (container && container.kind === 'release') {
        assignmentItems.push(buildVersionAssignItem(node, container));
      }
    }
    const pointsItem = buildPointsItem(node, options.sizeMapping);
    if (pointsItem) {
      assignmentItems.push(pointsItem);
    }
    const priorityItem = buildPriorityItem(node, options);
    if (priorityItem) {
      assignmentItems.push(priorityItem);
    }
  }

  return [...createItems, ...assignmentItems];
}
