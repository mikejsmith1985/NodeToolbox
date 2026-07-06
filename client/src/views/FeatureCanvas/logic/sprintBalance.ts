// sprintBalance.ts — Distributes child stories across sprints up to each sprint's point capacity.
//
// Sprints hold a finite amount of work (the team's velocity). This walks stories in priority order
// (MoSCoW), first-fits each pointed story into the earliest sprint with room, and sends everything
// that doesn't fit — plus unestimated stories, which can't be committed — to "Over Capacity". The
// result is an honest "what can we ACTUALLY finish" plan plus an explicit deferred set.

import type { MoscowBucket } from '../overlay/overlayModel.ts';

/** One story to place, with its parent feature's priority (MoSCoW) driving the fill order. */
export interface BalanceStoryInput {
  featureKey: string;
  storyKey: string;
  points: number | null;
  priority: MoscowBucket | null;
}

/** A sprint with its point capacity (the resolved velocity/override budget). */
export interface BalanceSprintInput {
  id: string;
  capacity: number;
}

/** Where one story landed: a sprint id, or null meaning "Over Capacity" (didn't fit / unestimated). */
export interface BalanceAssignment {
  featureKey: string;
  storyKey: string;
  sprintId: string | null;
}

/** The full outcome: per-story assignments plus the fit/overflow totals for the summary. */
export interface BalanceResult {
  assignments: BalanceAssignment[];
  fitPoints: number;
  fitCount: number;
  overflowPoints: number;
  overflowCount: number;
  unestimatedCount: number;
}

const MOSCOW_RANK: Record<MoscowBucket, number> = { Must: 0, Should: 1, Could: 2, Wont: 3 };

/** Lower rank = higher priority; unprioritized stories sort last. */
function priorityRank(priority: MoscowBucket | null): number {
  return priority === null ? 4 : MOSCOW_RANK[priority];
}

/**
 * Greedily fills sprints (in order) to capacity with pointed stories, highest MoSCoW priority first.
 * Unestimated stories (null/≤0 points) always go to Over Capacity — you can't commit unsized work.
 */
export function balanceStoriesAcrossSprints(
  stories: readonly BalanceStoryInput[],
  sprints: readonly BalanceSprintInput[],
): BalanceResult {
  const sortedStories = [...stories].sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority));
  const remainingCapacity = sprints.map((sprint) => sprint.capacity);

  const assignments: BalanceAssignment[] = [];
  let fitPoints = 0;
  let fitCount = 0;
  let overflowPoints = 0;
  let overflowCount = 0;
  let unestimatedCount = 0;

  for (const story of sortedStories) {
    const points = story.points;
    if (points === null || points <= 0) {
      assignments.push({ featureKey: story.featureKey, storyKey: story.storyKey, sprintId: null });
      overflowCount += 1;
      unestimatedCount += 1;
      continue;
    }
    const sprintIndex = remainingCapacity.findIndex((capacity) => capacity >= points);
    if (sprintIndex === -1) {
      assignments.push({ featureKey: story.featureKey, storyKey: story.storyKey, sprintId: null });
      overflowPoints += points;
      overflowCount += 1;
      continue;
    }
    remainingCapacity[sprintIndex] -= points;
    assignments.push({ featureKey: story.featureKey, storyKey: story.storyKey, sprintId: sprints[sprintIndex].id });
    fitPoints += points;
    fitCount += 1;
  }

  return { assignments, fitPoints, fitCount, overflowPoints, overflowCount, unestimatedCount };
}
