// overlayStorage.test.ts — Verifies scope-key derivation, persistence round-trip, migration, and self-heal.

import { beforeEach, describe, expect, it } from 'vitest';

import { createEmptyOverlay, type CanvasContainer } from './overlayModel.ts';
import { buildOverlayStorageKey, deriveScopeKey, loadOverlay, saveOverlay } from './overlayStorage.ts';

const REAL_CONTAINER: CanvasContainer = {
  id: 'ctr-1',
  kind: 'sprint',
  title: 'Sprint 24',
  bounds: { x: 0, y: 0, width: 400, height: 300 },
  capacityBudget: 20,
  provenance: { state: 'real', jiraSprintId: 100, jiraVersionName: null, startDateIso: null, endDateIso: null },
};

describe('overlayStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('derives a deterministic, normalized scope key', () => {
    expect(deriveScopeKey('DENP', 'PI 2026.3')).toBe('denp:pi-2026.3');
    expect(deriveScopeKey('DENP', '   ')).toBe('denp:no-pi');
  });

  it('builds the team+scope storage key', () => {
    expect(buildOverlayStorageKey('team-a', 'denp:pi-1')).toBe('tbxFeatureCanvasOverlay:team-a:denp:pi-1');
  });

  it('round-trips an overlay through save and load', () => {
    const overlay = createEmptyOverlay('team-a', 'denp:pi-1');
    overlay.wipLimit = 5;
    overlay.containers = [REAL_CONTAINER];
    overlay.nodes = { 'DENP-1': { issueKey: 'DENP-1', position: { x: 10, y: 20 }, size: 'L', priority: 'Must', containerId: 'ctr-1', isExpanded: true, isParked: false } };
    saveOverlay(overlay);
    const loaded = loadOverlay('team-a', 'denp:pi-1');
    expect(loaded.wipLimit).toBe(5);
    expect(loaded.nodes['DENP-1'].position).toEqual({ x: 10, y: 20 });
    expect(loaded.nodes['DENP-1'].containerId).toBe('ctr-1');
  });

  it('returns a fresh empty overlay when nothing is stored', () => {
    const loaded = loadOverlay('team-a', 'denp:pi-1');
    expect(Object.keys(loaded.nodes)).toHaveLength(0);
    expect(loaded.stageState.currentStageId).toBe('surface');
  });

  it('self-heals a node pointing at a non-existent container', () => {
    const overlay = createEmptyOverlay('team-a', 'denp:pi-1');
    overlay.containers = [];
    overlay.nodes = { 'DENP-1': { issueKey: 'DENP-1', position: { x: 0, y: 0 }, size: null, priority: null, containerId: 'ghost', isExpanded: false, isParked: false } };
    saveOverlay(overlay);
    expect(loadOverlay('team-a', 'denp:pi-1').nodes['DENP-1'].containerId).toBeNull();
  });

  it('normalizes an unknown/old-schema payload to the current schema', () => {
    window.localStorage.setItem(buildOverlayStorageKey('team-a', 'denp:pi-1'), JSON.stringify({ schemaVersion: 0, nodes: null }));
    const loaded = loadOverlay('team-a', 'denp:pi-1');
    expect(loaded.schemaVersion).toBe(1);
    expect(loaded.sizeMapping).toEqual({ XS: 10, S: 20, M: 40, L: 60, XL: 80, XXL: 100 });
  });

  it('degrades corrupt JSON to a valid empty overlay', () => {
    window.localStorage.setItem(buildOverlayStorageKey('team-a', 'denp:pi-1'), '{not json');
    expect(() => loadOverlay('team-a', 'denp:pi-1')).not.toThrow();
    expect(loadOverlay('team-a', 'denp:pi-1').containers).toHaveLength(0);
  });
});
