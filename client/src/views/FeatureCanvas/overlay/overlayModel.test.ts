// overlayModel.test.ts — Verifies the overlay model defaults and factory helpers.

import { describe, expect, it } from 'vitest';

import {
  createEmptyOverlay,
  createInitialStageState,
  createNodeState,
  DEFAULT_SIZE_MAPPING,
  OVERLAY_SCHEMA_VERSION,
  STAGE_ORDER,
} from './overlayModel.ts';

describe('overlayModel', () => {
  it('creates an empty overlay at the current schema version with default sizing', () => {
    const overlay = createEmptyOverlay('team-a', 'denp:pi-1');
    expect(overlay.schemaVersion).toBe(OVERLAY_SCHEMA_VERSION);
    expect(overlay.profileId).toBe('team-a');
    expect(overlay.scopeKey).toBe('denp:pi-1');
    expect(overlay.sizeMapping).toEqual(DEFAULT_SIZE_MAPPING);
    expect(overlay.containers).toHaveLength(0);
    expect(overlay.wipLimit).toBeNull();
  });

  it('starts the journey on Surface with nothing completed', () => {
    const stageState = createInitialStageState();
    expect(stageState.currentStageId).toBe('surface');
    expect(STAGE_ORDER.every((stageId) => stageState.completed[stageId] === false)).toBe(true);
  });

  it('exposes the five stages in recovery order', () => {
    expect(STAGE_ORDER).toEqual(['surface', 'size', 'prioritize', 'stabilize', 'sequence']);
  });

  it('creates an unsized, unranked, loose node at the given position', () => {
    const nodeState = createNodeState('DENP-1', 12, 34);
    expect(nodeState).toEqual({
      issueKey: 'DENP-1', position: { x: 12, y: 34 }, size: null, priority: null,
      containerId: null, isExpanded: false, isParked: false, storyPlacements: {},
    });
  });
});
