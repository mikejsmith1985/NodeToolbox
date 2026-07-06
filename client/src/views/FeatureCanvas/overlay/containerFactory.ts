// containerFactory.ts — Builds provisional (not-yet-in-Jira) container boxes for the canvas.
//
// Shared by the toolbar's "add sprint/release" action and the AI Sprint-grouping accept path, so a
// box created either way looks and behaves identically. "Provisional" means the box exists only in
// the local overlay until Review & Commit turns it into a real Jira sprint/version.

import type { CanvasContainer } from './overlayModel.ts';

// How member cards stack inside a box: a single column below the box header. Simple and legible; a
// long list overflows the box height, which is fine — the box is a visual guide, not a hard frame.
const MEMBER_PAD_X = 16;
const MEMBER_HEADER_OFFSET = 44;
const MEMBER_SLOT_HEIGHT = 84;

const MEMBER_BOTTOM_PAD = 16;

/** Computes the canvas position for the Nth card placed inside a container, stacked below its header. */
export function positionInContainer(container: CanvasContainer, memberIndex: number): { x: number; y: number } {
  return {
    x: container.bounds.x + MEMBER_PAD_X,
    y: container.bounds.y + MEMBER_HEADER_OFFSET + memberIndex * MEMBER_SLOT_HEIGHT,
  };
}

/** The height a box needs to hold `memberCount` stacked cards without overflow (min one slot tall). */
export function boxHeightForCount(memberCount: number): number {
  return MEMBER_HEADER_OFFSET + Math.max(1, memberCount) * MEMBER_SLOT_HEIGHT + MEMBER_BOTTOM_PAD;
}

// Auto-layout: two columns of boxes, each sized to its card count, stacked without overlap.
const LAYOUT_COLUMNS = 2;
const LAYOUT_WIDTH = 300;
const LAYOUT_COL_GAP = 60;
const LAYOUT_ROW_GAP = 48;
const LAYOUT_ORIGIN_X = 40;
const LAYOUT_ORIGIN_Y = 40;

/** A box's member count, the only input the layout needs to size and place it. */
export interface BoxLayoutInput {
  id: string;
  memberCount: number;
}

/** Bounds assigned to a box by the auto-layout. */
export interface BoxBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Lays boxes out in two columns, each box sized to its card count, filling the shorter column so
 * nothing overlaps. Returns the new bounds per box id (in the given order). The caller repositions
 * each box's member cards afterwards (via positionInContainer against the new bounds).
 */
export function layoutBoxes(boxes: readonly BoxLayoutInput[]): Map<string, BoxBounds> {
  const columnBottoms = Array.from({ length: LAYOUT_COLUMNS }, () => LAYOUT_ORIGIN_Y);
  const bounds = new Map<string, BoxBounds>();
  for (const box of boxes) {
    let column = 0;
    for (let candidate = 1; candidate < LAYOUT_COLUMNS; candidate += 1) {
      if (columnBottoms[candidate] < columnBottoms[column]) {
        column = candidate;
      }
    }
    const height = boxHeightForCount(box.memberCount);
    const boxBounds: BoxBounds = { x: LAYOUT_ORIGIN_X + column * (LAYOUT_WIDTH + LAYOUT_COL_GAP), y: columnBottoms[column], width: LAYOUT_WIDTH, height };
    bounds.set(box.id, boxBounds);
    columnBottoms[column] = boxBounds.y + height + LAYOUT_ROW_GAP;
  }
  return bounds;
}

// Layout: new boxes tile across a lower band of the canvas so they don't cover the feature grid.
const CONTAINER_COLUMN_COUNT = 2;
const CONTAINER_COLUMN_WIDTH = 440;
const CONTAINER_BAND_Y = 720;
const CONTAINER_BAND_X = 40;
const CONTAINER_WIDTH = 400;
const CONTAINER_HEIGHT = 260;
// Vertical gap between box rows so a wrapped grid of boxes never overlaps.
const CONTAINER_ROW_GAP = 48;
// Default sprint capacity in points; releases have no default budget.
const DEFAULT_SPRINT_BUDGET = 20;

/**
 * Computes a unique, non-overlapping slot for the Nth box: tiles left-to-right across columns and
 * wraps down into new rows, so every box lands in its own cell instead of stacking on the last one.
 */
function bandSlot(existingCount: number): { x: number; y: number } {
  const columnIndex = existingCount % CONTAINER_COLUMN_COUNT;
  const rowIndex = Math.floor(existingCount / CONTAINER_COLUMN_COUNT);
  return {
    x: CONTAINER_BAND_X + columnIndex * CONTAINER_COLUMN_WIDTH,
    y: CONTAINER_BAND_Y + rowIndex * (CONTAINER_HEIGHT + CONTAINER_ROW_GAP),
  };
}

/**
 * Builds a provisional container box. `existingCount` tiles the new box across the band; an optional
 * `title` names it (used when AI Sprint-grouping proposes a specific sprint), else a default label.
 */
export function createProvisionalContainer(
  kind: 'sprint' | 'release',
  existingCount: number,
  title?: string,
  sprintCapacity: number = DEFAULT_SPRINT_BUDGET,
): CanvasContainer {
  const slot = bandSlot(existingCount);
  const defaultTitle = kind === 'sprint' ? 'New sprint' : 'New release';
  return {
    id: `ctr-${Date.now()}-${kind}`,
    kind,
    title: title?.trim() ? title.trim() : defaultTitle,
    bounds: { x: slot.x, y: slot.y, width: CONTAINER_WIDTH, height: CONTAINER_HEIGHT },
    capacityBudget: kind === 'sprint' ? sprintCapacity : null,
    provenance: { state: 'provisional', jiraSprintId: null, jiraVersionName: null, startDateIso: null, endDateIso: null },
  };
}

/**
 * Builds a box for an EXISTING Jira sprint (provenance 'real' + its sprint id), so committing assigns
 * stories to that real sprint rather than creating a new one. The id is derived from the sprint id so
 * pulling the same sprint twice is a no-op the caller can dedupe on.
 */
export function createRealSprintContainer(
  sprintId: number,
  name: string,
  existingCount: number,
  startDateIso: string | null = null,
  endDateIso: string | null = null,
  sprintCapacity: number = DEFAULT_SPRINT_BUDGET,
): CanvasContainer {
  const slot = bandSlot(existingCount);
  return {
    id: `sprint-${sprintId}`,
    kind: 'sprint',
    title: name,
    bounds: { x: slot.x, y: slot.y, width: CONTAINER_WIDTH, height: CONTAINER_HEIGHT },
    capacityBudget: sprintCapacity,
    provenance: { state: 'real', jiraSprintId: sprintId, jiraVersionName: null, startDateIso, endDateIso },
  };
}

/** Builds the single Parking Lot box that collects deferred features. Never committed to Jira. */
export function createParkingLotContainer(existingCount: number): CanvasContainer {
  const slot = bandSlot(existingCount);
  return {
    id: `ctr-${Date.now()}-parkingLot`,
    kind: 'parkingLot',
    title: 'Parking Lot',
    bounds: { x: slot.x, y: slot.y, width: CONTAINER_WIDTH, height: CONTAINER_HEIGHT },
    capacityBudget: null,
    provenance: { state: 'provisional', jiraSprintId: null, jiraVersionName: null, startDateIso: null, endDateIso: null },
  };
}

/** Builds the single Complete box that collects finished features. Never committed to Jira. */
export function createCompleteContainer(existingCount: number): CanvasContainer {
  const slot = bandSlot(existingCount);
  return {
    id: `ctr-${Date.now()}-complete`,
    kind: 'complete',
    title: 'Complete',
    bounds: { x: slot.x, y: slot.y, width: CONTAINER_WIDTH, height: CONTAINER_HEIGHT },
    capacityBudget: null,
    provenance: { state: 'provisional', jiraSprintId: null, jiraVersionName: null, startDateIso: null, endDateIso: null },
  };
}

/** Builds the single Later box for features kept active but not sequenced into a sprint this PI. */
export function createLaterContainer(existingCount: number): CanvasContainer {
  const slot = bandSlot(existingCount);
  return {
    id: `ctr-${Date.now()}-later`,
    kind: 'later',
    title: 'Later',
    bounds: { x: slot.x, y: slot.y, width: CONTAINER_WIDTH, height: CONTAINER_HEIGHT },
    capacityBudget: null,
    provenance: { state: 'provisional', jiraSprintId: null, jiraVersionName: null, startDateIso: null, endDateIso: null },
  };
}
