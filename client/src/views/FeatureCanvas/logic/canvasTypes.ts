// canvasTypes.ts — Derived, in-memory projections that the canvas renders and reasons over.
//
// These types are never persisted. They are built at load time by joining the persisted
// overlay (overlayModel.ts) with live Jira data, and are consumed by the pure-logic modules
// (wip, capacity, commitDiff) and the React components. Keeping them in one dependency-free
// module avoids import cycles between mapping and logic.

import type { HygieneFlag } from '../../Hygiene/checks/hygieneChecks.ts';
import type { MoscowBucket, TshirtSize } from '../overlay/overlayModel.ts';

/** A single Jira issue-link surfaced on a node so the user can spot blocker ordering. */
export interface CanvasNodeDependency {
  targetKey: string;
  type: string;
  direction: 'inward' | 'outward';
}

/** A file attached to a feature, surfaced read-only in the node inspector. */
export interface CanvasAttachment {
  id: string;
  filename: string;
  sizeBytes: number;
  /** Absolute Jira URL the file downloads from. */
  contentUrl: string;
  mimeType: string | null;
  author: string | null;
  created: string | null;
}

/** A child story revealed when a feature node is expanded; also the unit committed to sprints. */
export interface CanvasChildStory {
  key: string;
  summary: string;
  status: string;
  statusCategoryKey: string | null;
  storyPoints: number | null;
}

/** The full render/logic projection of one feature node (overlay arrangement + live Jira data). */
export interface CanvasNode {
  // Overlay-owned arrangement attributes.
  issueKey: string;
  position: { x: number; y: number };
  size: TshirtSize | null;
  priority: MoscowBucket | null;
  containerId: string | null;
  isExpanded: boolean;
  isParked: boolean;
  /** Why this feature was parked; surfaced in the inspector and posted as a Jira comment on commit. */
  parkReason: string | null;
  /** Per-child-story box overrides (storyKey → containerId). Absent story inherits the feature's box;
   *  this is what lets a feature's stories be split across sprints during story-level planning. */
  storyPlacements: Record<string, string>;
  // Live Jira/blueprint data (re-fetched, never persisted).
  summary: string;
  status: string;
  statusCategoryKey: string | null;
  assignee: string | null;
  storyPoints: number | null;
  /** Live Business Value custom-field score; feeds AI prioritization. Null when unset. */
  businessValue: number | null;
  /** Live plain-text-normalizable description; rendered read-only in the inspector. */
  description: string | null;
  /** Acceptance-criteria text (plain text) from the instance's configured AC field; null when absent. */
  acceptanceCriteria: string | null;
  health: string;
  completionPercent: number;
  hygieneFlags: HygieneFlag[];
  childStories: CanvasChildStory[];
  dependencies: CanvasNodeDependency[];
  attachments: CanvasAttachment[];
  // Derived capacity unit: overlay size (mapped to points) when set, else live story points.
  effectivePoints: number;
}

/** The running capacity readout for one container box (Stage 5 meter). */
export interface ContainerCapacity {
  containerId: string;
  total: number;
  budget: number | null;
  status: 'under' | 'at' | 'over';
  overBy: number;
}

/** The Stage 2 work-in-progress readout for the surfaced set. */
export interface WipSnapshot {
  inProgressCount: number;
  limit: number | null;
  overflow: number;
  parkedCount: number;
  /**
   * In-progress child stories across non-parked features — the true concurrent execution load,
   * shown alongside the feature-level count so a single "in progress" feature hiding many active
   * stories is visible. Informational only; the WIP limit still governs feature count.
   */
  activeStoryCount: number;
}

/** One proposed Jira write shown in the Review & Commit diff before anything is written. */
export interface CommitDiffItem {
  id: string;
  kind: 'sprintAssign' | 'versionAssign' | 'pointsSet' | 'prioritySet' | 'createSprint' | 'createVersion' | 'parkComment';
  issueKey: string | null;
  containerId: string | null;
  from: string | number | null;
  to: string | number;
  dependsOn: string | null;
  selected: boolean;
}
