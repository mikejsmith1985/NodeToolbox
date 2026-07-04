// containerFactory.ts — Builds provisional (not-yet-in-Jira) container boxes for the canvas.
//
// Shared by the toolbar's "add sprint/release" action and the AI Sprint-grouping accept path, so a
// box created either way looks and behaves identically. "Provisional" means the box exists only in
// the local overlay until Review & Commit turns it into a real Jira sprint/version.

import type { CanvasContainer } from './overlayModel.ts';

// Layout: new boxes tile across a lower band of the canvas so they don't cover the feature grid.
const CONTAINER_COLUMN_COUNT = 3;
const CONTAINER_COLUMN_WIDTH = 440;
const CONTAINER_BAND_Y = 720;
const CONTAINER_BAND_X = 40;
const CONTAINER_WIDTH = 400;
const CONTAINER_HEIGHT = 260;
// Default sprint capacity in points; releases have no default budget.
const DEFAULT_SPRINT_BUDGET = 20;

/**
 * Builds a provisional container box. `existingCount` tiles the new box across the band; an optional
 * `title` names it (used when AI Sprint-grouping proposes a specific sprint), else a default label.
 */
export function createProvisionalContainer(
  kind: 'sprint' | 'release',
  existingCount: number,
  title?: string,
): CanvasContainer {
  const columnIndex = existingCount % CONTAINER_COLUMN_COUNT;
  const defaultTitle = kind === 'sprint' ? 'New sprint' : 'New release';
  return {
    id: `ctr-${Date.now()}-${kind}`,
    kind,
    title: title?.trim() ? title.trim() : defaultTitle,
    bounds: {
      x: CONTAINER_BAND_X + columnIndex * CONTAINER_COLUMN_WIDTH,
      y: CONTAINER_BAND_Y,
      width: CONTAINER_WIDTH,
      height: CONTAINER_HEIGHT,
    },
    capacityBudget: kind === 'sprint' ? DEFAULT_SPRINT_BUDGET : null,
    provenance: { state: 'provisional', jiraSprintId: null, jiraVersionName: null, startDateIso: null, endDateIso: null },
  };
}
