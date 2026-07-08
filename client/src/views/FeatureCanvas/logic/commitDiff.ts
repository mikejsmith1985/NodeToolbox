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
  // Parking Lot / Complete / Later boxes are canvas-only organizers — never created as Jira sprints/versions.
  return containers
    .filter((container) => container.provenance.state === 'provisional' && container.kind !== 'parkingLot' && container.kind !== 'complete' && container.kind !== 'later')
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

/**
 * Expands a feature into per-child-story sprintAssign items (FR-6.1a: Jira sprints hold stories,
 * not epics). Each story goes to the sprint of its EFFECTIVE box — its own story-level placement when
 * set, otherwise the feature's box — so a feature's stories can be split across sprints. Stories whose
 * effective box is not a sprint (Parking Lot / Complete / Later / release / none) are not assigned.
 */
function buildSprintAssignItems(node: CanvasNode, containersById: Map<string, CanvasContainer>): CommitDiffItem[] {
  const targetKeys = node.childStories.length > 0 ? node.childStories.map((story) => story.key) : [node.issueKey];
  const items: CommitDiffItem[] = [];
  for (const targetKey of targetKeys) {
    const effectiveContainerId = node.storyPlacements[targetKey] ?? node.containerId;
    const container = effectiveContainerId ? containersById.get(effectiveContainerId) : undefined;
    if (!container || container.kind !== 'sprint') {
      continue;
    }
    items.push({
      id: `sprintAssign:${targetKey}:${container.id}`,
      kind: 'sprintAssign',
      issueKey: targetKey,
      containerId: container.id,
      from: null,
      to: container.title,
      dependsOn: resolveDependsOn(container),
      selected: true,
    });
  }
  return items;
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

/** Builds a "post this canvas-drafted comment to Jira" item when the feature has a pending comment. */
function buildCommentItem(node: CanvasNode): CommitDiffItem | null {
  if (node.pendingComment.trim() === '') {
    return null;
  }
  return {
    id: `comment:${node.issueKey}`,
    kind: 'comment',
    issueKey: node.issueKey,
    containerId: null,
    from: null,
    to: node.pendingComment.trim(),
    dependsOn: null,
    selected: true,
  };
}

/** Builds a "post the park reason as a comment" item for a parked feature that has a reason. */
function buildParkCommentItem(node: CanvasNode): CommitDiffItem | null {
  if (!node.isParked || node.parkReason === null || node.parkReason.trim() === '') {
    return null;
  }
  return {
    id: `parkComment:${node.issueKey}`,
    kind: 'parkComment',
    issueKey: node.issueKey,
    containerId: null,
    from: null,
    to: node.parkReason.trim(),
    dependsOn: null,
    selected: true,
  };
}

/**
 * Builds one assigneeSet item per target whose staged reassignment differs from its live owner.
 * Targets are the feature's child-story keys (Jira assigns owners at the story level), or the feature's
 * own key when it has no children. A proposal is emitted only when it is a non-empty display name that
 * differs from the live assignee, so an unchanged owner never produces a spurious write. The name→id
 * lookup (and the skip of any unknown user) happens later at commit time — never here.
 */
function buildAssigneeItems(node: CanvasNode): CommitDiffItem[] {
  const hasChildStories = node.childStories.length > 0;
  const targetKeys = hasChildStories ? node.childStories.map((story) => story.key) : [node.issueKey];
  const liveAssigneeByKey = new Map<string, string | null>();
  if (hasChildStories) {
    for (const story of node.childStories) {
      liveAssigneeByKey.set(story.key, story.assignee ?? null);
    }
  } else {
    liveAssigneeByKey.set(node.issueKey, node.assignee);
  }

  const items: CommitDiffItem[] = [];
  for (const targetKey of targetKeys) {
    const proposedAssignee = node.storyAssignees[targetKey];
    const liveAssignee = liveAssigneeByKey.get(targetKey) ?? null;
    if (typeof proposedAssignee !== 'string' || proposedAssignee === '' || proposedAssignee === (liveAssignee ?? '')) {
      continue;
    }
    items.push({
      id: `assigneeSet:${targetKey}`,
      kind: 'assigneeSet',
      issueKey: targetKey,
      containerId: null,
      from: liveAssignee,
      to: proposedAssignee,
      dependsOn: null,
      selected: true,
    });
  }
  return items;
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
    // Sprint membership is resolved per child story (so a feature can span sprints); release
    // membership stays feature-level (fixVersion is set on the feature itself).
    assignmentItems.push(...buildSprintAssignItems(node, containersById));
    if (node.containerId !== null) {
      const container = containersById.get(node.containerId);
      if (container && container.kind === 'release') {
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
    assignmentItems.push(...buildAssigneeItems(node));
    const parkCommentItem = buildParkCommentItem(node);
    if (parkCommentItem) {
      assignmentItems.push(parkCommentItem);
    }
    const commentItem = buildCommentItem(node);
    if (commentItem) {
      assignmentItems.push(commentItem);
    }
  }

  return [...createItems, ...assignmentItems];
}
