// rollup.ts — Pure Pipeline View helpers for Jira story-point and completion rollups.

import { readStoryPointsFromFields } from '../../Hygiene/checks/storyPointsField.ts';

// ── Named constants — keep Jira field IDs and percentage math easy to audit. ─────

/** Jira Cloud story-points field used by newer NodeToolbox screens. */
export const STORY_POINTS_FIELD_PREFERRED = 'customfield_10028';

/** Legacy story-points field retained because older Jira deployments still use it. */
export const STORY_POINTS_FIELD_FALLBACK = 'customfield_10016';

const EMPTY_COUNT = 0;
const NO_COMPLETION_PERCENT = 0;
const PERCENTAGE_SCALE = 100;

// ── Public types shared by the hook and tests. ─────────────────────────────────

export type StatusCategoryKey = 'new' | 'indeterminate' | 'done';

export interface ChildIssue {
  key: string;
  summary: string;
  status: string;
  statusCategoryKey: StatusCategoryKey;
  storyPoints: number | null;
}

// ── Rollup helpers. ────────────────────────────────────────────────────────────

/**
 * Reads Jira story points from known fields so mixed Cloud and legacy projects both work.
 *
 * Delegates the VALUE reading to the shared reader. Accepting only `typeof === 'number'` missed
 * every estimate on an instance that keeps points in a Jira SELECT field — which returns
 * `{ id, value }` — and did so silently, reporting fully-pointed work as unpointed.
 */
export function readStoryPoints(fieldsObject: Record<string, unknown>): number | null {
  return readStoryPointsFromFields(fieldsObject, [STORY_POINTS_FIELD_PREFERRED, STORY_POINTS_FIELD_FALLBACK]);
}

/** Sums child story points after lazy loading, or falls back to the epic estimate before children exist. */
export function calculateStoryPointRollup(children: ChildIssue[] | null, epicStoryPoints: number | null): number {
  if (!children || children.length === EMPTY_COUNT) {
    return epicStoryPoints ?? EMPTY_COUNT;
  }

  return children.reduce((runningStoryPointTotal, childIssue) => {
    return runningStoryPointTotal + (childIssue.storyPoints ?? EMPTY_COUNT);
  }, EMPTY_COUNT);
}

/** Counts completed children so cards can explain the percentage shown to users. */
export function countCompletedChildren(children: ChildIssue[] | null): number {
  if (!children) return EMPTY_COUNT;
  return children.filter((childIssue) => childIssue.statusCategoryKey === 'done').length;
}

/** Calculates a rounded 0-100 completion percentage from done children versus all loaded children. */
export function calculateCompletionPercent(children: ChildIssue[] | null): number {
  if (!children || children.length === EMPTY_COUNT) {
    return NO_COMPLETION_PERCENT;
  }

  const completedChildCount = countCompletedChildren(children);
  return Math.round((completedChildCount / children.length) * PERCENTAGE_SCALE);
}

/** Normalizes Jira's status-category key into the three categories the Pipeline View groups by. */
export function normalizeStatusCategoryKey(candidateKey: unknown): StatusCategoryKey {
  if (candidateKey === 'new' || candidateKey === 'indeterminate' || candidateKey === 'done') {
    return candidateKey;
  }

  return 'indeterminate';
}
