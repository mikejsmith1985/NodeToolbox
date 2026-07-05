// overlayModel.ts — Type definitions and defaults for the Feature Canvas planning overlay.
//
// The "planning overlay" is the sandbox record of how a Scrum Master has arranged their
// backlog on the canvas — where each feature sits, how it is sized, which release/sprint
// box it belongs to, and how far through the coaching journey they are. It is persisted
// separately from Jira (see overlayStorage.ts) and is never written to Jira except through
// the explicit Review & Commit step. Only arrangement attributes live here; all live Jira
// fields (summary, status, points, health) are re-fetched so the overlay never goes stale.

/** Current persisted overlay schema version. Bump when the stored shape changes. */
export const OVERLAY_SCHEMA_VERSION = 1;

/** Relative sizing scale used when a feature has no story points yet. */
export type TshirtSize = 'S' | 'M' | 'L' | 'XL';

/** MoSCoW prioritization buckets applied to nodes during Stage 3. */
export type MoscowBucket = 'Must' | 'Should' | 'Could' | 'Wont';

/** The five coaching stages, in their recommended order. */
export type StageId = 'surface' | 'stabilize' | 'prioritize' | 'size' | 'sequence';

/** Kinds of container box a node can be dropped into. `complete`/`parkingLot`/`later` are canvas-only
 *  organizers (never committed to Jira): complete = finished, parkingLot = deferred, later = kept but
 *  not sequenced into a sprint this PI. */
export type ContainerKind = 'release' | 'sprint' | 'parkingLot' | 'complete' | 'later';

/** Default t-shirt → story-point mapping (Fibonacci-adjacent); editable per overlay. */
export const DEFAULT_SIZE_MAPPING: Record<TshirtSize, number> = { S: 1, M: 3, L: 5, XL: 8 };

/** The ordered stage identifiers, exposed for coach navigation and completion tracking. */
export const STAGE_ORDER: readonly StageId[] = ['surface', 'size', 'prioritize', 'stabilize', 'sequence'];

/** How a container box maps (or does not yet map) to a real Jira sprint/fixVersion. */
export interface ContainerProvenance {
  state: 'real' | 'provisional';
  jiraSprintId: number | null;
  jiraVersionName: string | null;
  startDateIso: string | null;
  endDateIso: string | null;
}

/** A release/sprint/parking-lot box drawn on the canvas. */
export interface CanvasContainer {
  id: string;
  kind: ContainerKind;
  title: string;
  bounds: { x: number; y: number; width: number; height: number };
  capacityBudget: number | null;
  provenance: ContainerProvenance;
}

/** The overlay-owned (arrangement) attributes for one feature node, keyed by Jira issue key. */
export interface CanvasNodeState {
  issueKey: string;
  position: { x: number; y: number };
  size: TshirtSize | null;
  priority: MoscowBucket | null;
  containerId: string | null;
  isExpanded: boolean;
  isParked: boolean;
  /** Why this feature was parked (from AI triage or manual note); posted as a Jira comment on commit. */
  parkReason?: string | null;
}

/** Coach progress, enabling resume and non-linear revisit. */
export interface JourneyStageState {
  currentStageId: StageId;
  completed: Record<StageId, boolean>;
}

/** The single persisted planning overlay for one team + PI scope. */
export interface CanvasOverlay {
  schemaVersion: number;
  profileId: string;
  scopeKey: string;
  nodes: Record<string, CanvasNodeState>;
  containers: CanvasContainer[];
  wipLimit: number | null;
  stageState: JourneyStageState;
  sizeMapping: Record<TshirtSize, number>;
  updatedAtIso: string;
}

/** Builds the fresh, empty coaching-journey state (starts on Surface, nothing completed). */
export function createInitialStageState(): JourneyStageState {
  return {
    currentStageId: 'surface',
    completed: { surface: false, stabilize: false, prioritize: false, size: false, sequence: false },
  };
}

/**
 * Creates an empty overlay for a team profile + scope. `updatedAtIso` is left blank for the
 * caller to stamp, because deterministic modules here never read the wall clock.
 */
export function createEmptyOverlay(profileId: string, scopeKey: string): CanvasOverlay {
  return {
    schemaVersion: OVERLAY_SCHEMA_VERSION,
    profileId,
    scopeKey,
    nodes: {},
    containers: [],
    wipLimit: null,
    stageState: createInitialStageState(),
    sizeMapping: { ...DEFAULT_SIZE_MAPPING },
    updatedAtIso: '',
  };
}

/** Builds a fresh node-arrangement record positioned at the given canvas coordinates. */
export function createNodeState(issueKey: string, x: number, y: number): CanvasNodeState {
  return { issueKey, position: { x, y }, size: null, priority: null, containerId: null, isExpanded: false, isParked: false };
}
