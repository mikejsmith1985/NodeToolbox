// piPlanCarryover.ts — Carryover reconciliation for the PI Delivery Framework (spec 032, Phase A).
//
// You cannot switch this framework on mid-PI and regenerate everything: work already in flight is CARRYOVER
// and its Stories/sub-tasks already exist in Jira. A Feature that already has child Stories must be
// RECONCILED, not regenerated — we read its existing Stories and only propose the MISSING sub-tasks
// (gap-fill), never a duplicate. Pure and deterministic so the reconciliation is unit-testable.

import { buildStorySubtaskScaffold, type ScaffoldSubtask } from './piPlanRepoSubtasks.ts';
import type { ExistingChild } from './piPlanTypes.ts';

/** Classifies a Jira child issue's kind from its summary prefix (the convention the write path stamps). */
export function classifyChildKind(summary: string): ExistingChild['kind'] {
  const lower = summary.trim().toLowerCase();
  if (lower.startsWith('[sl]')) return 'slTest';
  if (lower.startsWith('[int]')) return 'deployInt';
  if (lower.startsWith('[rel]')) return 'deployRel';
  if (lower.startsWith('[prod]')) return 'deployProd';
  // Any other bracketed prefix (e.g. "[enrollment-api] …") is a repo coding sub-task.
  if (/^\[[^\]]+\]/.test(summary.trim())) return 'coding';
  return 'unknown';
}

/** True when a Feature already has at least one child Story in flight — i.e. it is carryover. */
export function isCarryoverFeature(existingChildren: readonly ExistingChild[]): boolean {
  return existingChildren.some((child) => child.kind === 'story');
}

/** One existing in-flight Story to reconcile: its key, the repos it covers, and its existing sub-task children. */
export interface CarryoverStory {
  key: string;
  summary: string;
  /** The repo components this Story covers (from its own component field). */
  repoNames: string[];
  /** The Story's existing sub-task children (kinds already classified), so gap-fill skips what exists. */
  existingChildren: ExistingChild[];
}

/** The reconciliation of one carryover Story: which sub-tasks are missing and should be gap-filled. */
export interface CarryoverStoryReconcile {
  storyKey: string;
  storySummary: string;
  /** The sub-tasks the Story is missing (coding for an uncovered repo, or a missing SL/deploy checkpoint). */
  gapSubtasks: ScaffoldSubtask[];
}

/**
 * Reconciles one carryover Story: returns only the sub-tasks it is MISSING. Reuses the shared scaffold
 * builder, whose coding + checkpoint idempotency skips every sub-task the Story already has — so a fully
 * scaffolded Story yields an empty gap list and nothing is duplicated. Dev points are nominal (carryover
 * work is not re-estimated), giving at least one point per uncovered repo.
 */
export function reconcileCarryoverStory(
  story: CarryoverStory,
  resolveComponentId: (repoName: string) => string | null,
): CarryoverStoryReconcile {
  const gapSubtasks = buildStorySubtaskScaffold(
    { summary: story.summary, devPoints: Math.max(1, story.repoNames.length) },
    story.repoNames,
    resolveComponentId,
    story.existingChildren,
  );
  return { storyKey: story.key, storySummary: story.summary, gapSubtasks };
}

/** Reconciles every carryover Story of a Feature, dropping the ones already fully scaffolded (no gaps). */
export function reconcileCarryoverFeature(
  stories: readonly CarryoverStory[],
  resolveComponentId: (repoName: string) => string | null,
): CarryoverStoryReconcile[] {
  return stories
    .map((story) => reconcileCarryoverStory(story, resolveComponentId))
    .filter((reconcile) => reconcile.gapSubtasks.length > 0);
}
