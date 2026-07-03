// overlayStorage.ts — Persists the Feature Canvas planning overlay to team+scope-scoped localStorage.
//
// The overlay is a per-team, per-PI planning sandbox. It is stored client-side (no backend
// change) under the key `tbxFeatureCanvasOverlay:{profileId}:{scopeKey}`, mirroring how the
// Sprint Dashboard persists its per-team config. Every read self-heals: bad JSON, an old
// schema, or a dangling container reference degrade gracefully to a valid overlay rather than
// throwing, so a corrupt entry can never break the canvas.

import { buildTeamScopedStorageKey } from '../../SprintDashboard/hooks/teamScopedStorage.ts';
import {
  createEmptyOverlay,
  createInitialStageState,
  DEFAULT_SIZE_MAPPING,
  OVERLAY_SCHEMA_VERSION,
  STAGE_ORDER,
  type CanvasContainer,
  type CanvasNodeState,
  type CanvasOverlay,
  type StageId,
} from './overlayModel.ts';

const OVERLAY_BASE_STORAGE_KEY = 'tbxFeatureCanvasOverlay';
const MISSING_PI_SCOPE_SUFFIX = 'no-pi';

/** Guards localStorage access so private-browsing / disabled-storage degrades to in-memory use. */
function canUseLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

/**
 * Derives the deterministic scope key that namespaces an overlay to one project + PI, so the same
 * team+PI always resolves the same saved plan. Whitespace is collapsed and case normalized; an
 * empty PI falls back to a stable "no-pi" suffix.
 */
export function deriveScopeKey(projectKey: string, piName: string): string {
  const normalizedProjectKey = projectKey.trim().toLowerCase().replace(/\s+/g, '-') || 'no-project';
  const normalizedPiName = piName.trim().toLowerCase().replace(/\s+/g, '-');
  return `${normalizedProjectKey}:${normalizedPiName || MISSING_PI_SCOPE_SUFFIX}`;
}

/** Builds the full localStorage key `tbxFeatureCanvasOverlay:{profileId}:{scopeKey}`. */
export function buildOverlayStorageKey(profileId: string, scopeKey: string): string {
  return `${buildTeamScopedStorageKey(OVERLAY_BASE_STORAGE_KEY, profileId)}:${scopeKey}`;
}

/** Coerces an unknown parsed value into a valid stage state, defaulting anything malformed. */
function normalizeStageState(rawStageState: unknown): CanvasOverlay['stageState'] {
  const fallbackStageState = createInitialStageState();
  if (typeof rawStageState !== 'object' || rawStageState === null) {
    return fallbackStageState;
  }
  const candidate = rawStageState as { currentStageId?: unknown; completed?: unknown };
  const currentStageId = STAGE_ORDER.includes(candidate.currentStageId as StageId)
    ? (candidate.currentStageId as StageId)
    : 'surface';
  const completedSource = (candidate.completed ?? {}) as Record<string, unknown>;
  const completed = STAGE_ORDER.reduce((accumulator, stageId) => {
    accumulator[stageId] = completedSource[stageId] === true;
    return accumulator;
  }, {} as Record<StageId, boolean>);
  return { currentStageId, completed };
}

/** Drops node container references that no longer point at an existing container (self-healing). */
function healNodeContainerReferences(
  nodes: Record<string, CanvasNodeState>,
  containers: readonly CanvasContainer[],
): Record<string, CanvasNodeState> {
  const containerIds = new Set(containers.map((container) => container.id));
  const healedNodes: Record<string, CanvasNodeState> = {};
  for (const [issueKey, nodeState] of Object.entries(nodes)) {
    const containerId = nodeState.containerId !== null && containerIds.has(nodeState.containerId)
      ? nodeState.containerId
      : null;
    healedNodes[issueKey] = { ...nodeState, containerId };
  }
  return healedNodes;
}

/**
 * Normalizes any parsed overlay into a valid, current-schema overlay. Applies forward migration
 * (older schema versions are upgraded field-by-field) and self-heals dangling references.
 */
function normalizeOverlay(rawOverlay: unknown, profileId: string, scopeKey: string): CanvasOverlay {
  if (typeof rawOverlay !== 'object' || rawOverlay === null) {
    return createEmptyOverlay(profileId, scopeKey);
  }
  const candidate = rawOverlay as Partial<CanvasOverlay>;
  const containers = Array.isArray(candidate.containers) ? candidate.containers : [];
  const nodes = typeof candidate.nodes === 'object' && candidate.nodes !== null ? candidate.nodes : {};
  return {
    schemaVersion: OVERLAY_SCHEMA_VERSION,
    profileId,
    scopeKey,
    nodes: healNodeContainerReferences(nodes as Record<string, CanvasNodeState>, containers),
    containers,
    wipLimit: typeof candidate.wipLimit === 'number' ? candidate.wipLimit : null,
    stageState: normalizeStageState(candidate.stageState),
    sizeMapping: { ...DEFAULT_SIZE_MAPPING, ...(candidate.sizeMapping ?? {}) },
    updatedAtIso: typeof candidate.updatedAtIso === 'string' ? candidate.updatedAtIso : '',
  };
}

/** Loads and self-heals the overlay for a team+scope, or returns a fresh empty overlay. */
export function loadOverlay(profileId: string, scopeKey: string): CanvasOverlay {
  if (!canUseLocalStorage()) {
    return createEmptyOverlay(profileId, scopeKey);
  }
  try {
    const storedValue = window.localStorage.getItem(buildOverlayStorageKey(profileId, scopeKey));
    if (storedValue === null) {
      return createEmptyOverlay(profileId, scopeKey);
    }
    return normalizeOverlay(JSON.parse(storedValue), profileId, scopeKey);
  } catch {
    return createEmptyOverlay(profileId, scopeKey);
  }
}

/** Persists the overlay; silently no-ops when storage is unavailable. */
export function saveOverlay(overlay: CanvasOverlay): void {
  if (!canUseLocalStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(buildOverlayStorageKey(overlay.profileId, overlay.scopeKey), JSON.stringify(overlay));
  } catch {
    // Storage full or blocked — the in-memory overlay remains authoritative for the session.
  }
}
