// featureCompletion.ts — How "done" a feature is, from the state of its child stories.
//
// Extracted from blueprintHierarchy so more than one surface can share the SAME completion maths: the
// Blueprint tree that shows a feature's progress, and the PI Review carryover estimator that needs to
// know how much of a carried feature is left. Two copies of this would eventually disagree, and a
// "remaining points" figure that contradicted the progress bar beside it would be worse than useless.
//
// The weighting is point-weighted and status-based: a story counts fully once it reaches the team's
// Definition of Done (Ready-for-QA or later, per the ART delivered rule), half while in test, a fifth
// while in active development, nothing before that.

import { isDeliveredWorkflowStatusName } from '../../utils/workflowDelivery.ts';

/** Status names that mean actively-in-development. */
const WORKING_STATUS_KEYWORDS = ['work', 'working', 'in progress', 'implementing'];

/** Status names that mean in-test. */
const TESTING_STATUS_KEYWORDS = ['test', 'testing'];

/** Weight given to an unpointed story, so a feature of unpointed stories still has a denominator. */
const DEFAULT_UNPOINTED_STORY_WEIGHT = 1;

/** The minimal slice of a story this calculation reads. */
export interface CompletionStoryNode {
  status: string;
  statusCategoryKey?: string | null;
  storyPoints: number | null;
}

/**
 * How complete one story is, from 0 (not started) to 1 (done).
 *
 * Done counts fully; the ART delivered rule means Ready-for-QA-and-beyond also counts fully even while
 * Jira still calls it In Progress. In-test is half, active development a fifth, everything earlier zero.
 */
export function readStoryCompletionWeight(storyNode: CompletionStoryNode): number {
  const normalizedStatusName = storyNode.status.toLowerCase();
  const normalizedStatusCategoryKey = storyNode.statusCategoryKey?.toLowerCase() ?? '';

  if (normalizedStatusCategoryKey === 'done') {
    return 1;
  }
  if (isDeliveredWorkflowStatusName(normalizedStatusName)) {
    return 1;
  }
  if (TESTING_STATUS_KEYWORDS.some((statusKeyword) => normalizedStatusName.includes(statusKeyword))) {
    return 0.5;
  }
  if (WORKING_STATUS_KEYWORDS.some((statusKeyword) => normalizedStatusName.includes(statusKeyword))) {
    return 0.2;
  }
  return 0;
}

/** A story's weight in the rollup: its points, or a default so unpointed stories still count. */
export function readStoryPointWeight(storyNode: CompletionStoryNode): number {
  return typeof storyNode.storyPoints === 'number' && storyNode.storyPoints > 0
    ? storyNode.storyPoints
    : DEFAULT_UNPOINTED_STORY_WEIGHT;
}

/** A feature's completion as a whole percentage (0–100), point-weighted across its stories. */
export function computeCompletionPercent(storyNodes: readonly CompletionStoryNode[]): number {
  return Math.round(computeCompletionFraction(storyNodes) * 100);
}

/**
 * A feature's completion as a fraction (0–1), point-weighted across its stories.
 *
 * The fraction form exists for arithmetic that continues past the number — such as "remaining points"
 * — where rounding to a whole percent first would visibly drift the result.
 */
export function computeCompletionFraction(storyNodes: readonly CompletionStoryNode[]): number {
  if (storyNodes.length === 0) {
    return 0;
  }
  const completionWeightTotal = storyNodes.reduce(
    (runningTotal, storyNode) => runningTotal + (readStoryCompletionWeight(storyNode) * readStoryPointWeight(storyNode)),
    0,
  );
  const storyPointWeightTotal = storyNodes.reduce(
    (runningTotal, storyNode) => runningTotal + readStoryPointWeight(storyNode),
    0,
  );
  return storyPointWeightTotal > 0 ? completionWeightTotal / storyPointWeightTotal : 0;
}
