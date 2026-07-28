// piPlanRepoSubtasks.ts — The repo→sub-task scaffold for the PI Delivery Framework (spec 032, US2).
//
// Replaces 031's one-Story-per-repo generation with one CODING SUB-TASK per repo beneath a Story that
// bridges the repositories it touches. Each Story also gets a single SL-test sub-task and per-story
// INT/REL/PROD deploy checkpoints (deploys are per-story, never per-repo, to avoid an explosion). Pure and
// deterministic — no I/O — so the whole scaffold is unit-testable and agrees with the engine by construction.

import type { ExistingChild, RepoCodingSubtask, SubTaskKind } from './piPlanTypes.ts';

/** The minimal Story facts this scaffold needs (kept small so the module is testable in isolation). */
export interface StoryForRepoSubtasks {
  summary: string;
  /** The Story's development (70%) points, to partition across its repos. */
  devPoints: number;
}

/** One reviewable sub-task in the scaffold (dates are attached later by the delivery engine). */
export interface ScaffoldSubtask {
  kind: SubTaskKind;
  summary: string;
  /** Present only for a coding sub-task — the repo it covers. */
  repo?: RepoCodingSubtask;
}

/** The fixed non-coding checkpoints every Story gets, in scaffold order. */
const STORY_CHECKPOINTS: { kind: SubTaskKind; label: string }[] = [
  { kind: 'slTest', label: '[SL] SL Test' },
  { kind: 'deployInt', label: '[INT] Deploy' },
  { kind: 'deployRel', label: '[REL] Deploy' },
  { kind: 'deployProd', label: '[PROD] Deploy' },
];

/**
 * Splits a Story's dev points as evenly as possible across its repos, giving each repo at least one point
 * and distributing any remainder to the earliest repos, so the parts always sum to the dev points.
 */
export function partitionDevPoints(devPoints: number, repoCount: number): number[] {
  if (repoCount <= 0) {
    return [];
  }
  // Guarantee at least 1 point per repo; base the split on the larger of the two so the sum stays honest.
  const total = Math.max(devPoints, repoCount);
  const base = Math.floor(total / repoCount);
  let remainder = total - base * repoCount;
  return Array.from({ length: repoCount }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return base + extra;
  });
}

/** The convention title for a repo's coding sub-task: the repo in brackets before the Story summary. */
export function buildCodingSubtaskTitle(repoName: string, storySummary: string): string {
  return `[${repoName.trim()}] ${storySummary.trim()}`;
}

/** De-duplicates repo names case-insensitively (preserving first-seen order) and drops blanks. */
function normalizeRepoNames(repoComponentNames: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of repoComponentNames) {
    const trimmed = name.trim();
    const key = trimmed.toLowerCase();
    if (trimmed === '' || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}

/** True when an existing child coding sub-task already represents this repo (matched by its title suffix). */
function hasExistingCodingChild(existingChildren: readonly ExistingChild[], repoName: string): boolean {
  const repoTag = `[${repoName.trim().toLowerCase()}]`;
  return existingChildren.some((child) =>
    child.kind === 'coding' && child.summary.trim().toLowerCase().startsWith(repoTag));
}

/**
 * Builds one coding sub-task per repository the Story touches — the 032 repo→sub-task 1:1 rule. Dev points
 * are partitioned across ALL of the Story's repos (so the split is stable), but a repo already covered by an
 * existing child coding sub-task is omitted (idempotency). An unresolved component id is surfaced as null,
 * never invented. Zero repos yields an empty list (the caller surfaces the "map repos first" state).
 */
export function buildRepoCodingSubtasks(
  story: StoryForRepoSubtasks,
  repoComponentNames: readonly string[],
  resolveComponentId: (repoName: string) => string | null,
  existingChildren: readonly ExistingChild[],
): RepoCodingSubtask[] {
  const repos = normalizeRepoNames(repoComponentNames);
  const shares = partitionDevPoints(story.devPoints, repos.length);
  const subtasks: RepoCodingSubtask[] = [];
  repos.forEach((repoName, index) => {
    if (hasExistingCodingChild(existingChildren, repoName)) {
      return; // idempotent — this repo already has a coding sub-task
    }
    subtasks.push({
      repoName,
      repoComponentId: resolveComponentId(repoName),
      devPoints: shares[index],
      assignee: null, // set by the delivery engine's load balancer
    });
  });
  return subtasks;
}

/**
 * Builds the full sub-task scaffold for a Story: one coding sub-task per repo (from
 * buildRepoCodingSubtasks) plus the fixed SL-test and INT/REL/PROD deploy checkpoints. Titles follow the
 * org convention. A Story with no repos yields only the checkpoints — the caller decides whether the
 * missing coding work is an honest "map repos first" state.
 */
export function buildStorySubtaskScaffold(
  story: StoryForRepoSubtasks,
  repoComponentNames: readonly string[],
  resolveComponentId: (repoName: string) => string | null,
  existingChildren: readonly ExistingChild[],
): ScaffoldSubtask[] {
  const codingSubtasks = buildRepoCodingSubtasks(story, repoComponentNames, resolveComponentId, existingChildren);
  const coding: ScaffoldSubtask[] = codingSubtasks.map((repo) => ({
    kind: 'coding' as SubTaskKind,
    summary: buildCodingSubtaskTitle(repo.repoName, story.summary),
    repo,
  }));
  // Checkpoint idempotency: emit an SL-test/deploy sub-task only when the Story does not already have one
  // (so reconciling a carryover Story gap-fills the missing checkpoints without duplicating existing ones).
  const checkpoints: ScaffoldSubtask[] = STORY_CHECKPOINTS
    .filter((checkpoint) => !existingChildren.some((child) => child.kind === checkpoint.kind))
    .map((checkpoint) => ({
      kind: checkpoint.kind,
      summary: `${checkpoint.label} — ${story.summary.trim()}`,
    }));
  return [...coding, ...checkpoints];
}
