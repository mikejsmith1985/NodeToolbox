// slStoryRouting.ts — Which issue a page's test scenarios actually belong on.
//
// The documentation is filed at Feature level because that is how the folders are organised, but
// test scenarios belong to the SL story that runs them. So the route is: page names a Feature →
// find the Feature's stories → pick the [SL] one.
//
// Every judgement about what makes a story an SL story is DELEGATED to `classifyChainRole`, the
// same function the forecast and the roll-up board use. There is one answer to "is this the test
// story", and this is not a second place to decide it.
//
// Pure. Fetching the children is the caller's job; deciding which one wins is this module's.

import { classifyChainRole } from '../../SprintDashboard/forecast/devSlChain.ts';

/** One child of a Feature, reduced to what routing reads. */
export interface FeatureChild {
  issueKey: string;
  summary: string;
  /** True when the assignee can run internal test — the fallback signal when a summary has no tag. */
  assigneeCanInternalTest?: boolean | null;
}

/** Where a page's link should land, and why. */
export interface DocRoute {
  /** The issue to link, or null when nothing can be linked yet. */
  targetIssueKey: string | null;
  /** What the caller should do about it, in words a report can print. */
  outcome:
    | 'linked-directly'
    | 'routed-to-sl-story'
    | 'no-sl-story'
    | 'several-sl-stories'
    | 'feature-has-no-children'
    | 'no-key-in-title';
  /** The dev story an SL story would be cloned FROM, when one is needed and one exists. */
  cloneSourceIssueKey: string | null;
  reason: string;
}

/** The SL children of a Feature, by the shared chain-role rule. */
function readSlChildren(children: readonly FeatureChild[]): FeatureChild[] {
  return children.filter((child) => classifyChainRole({
    summary: child.summary,
    assigneeCanInternalTest: child.assigneeCanInternalTest ?? null,
  }) === 'sl');
}

/** The dev children of a Feature — the candidates an SL story would be cloned from. */
function readDevChildren(children: readonly FeatureChild[]): FeatureChild[] {
  return children.filter((child) => classifyChainRole({
    summary: child.summary,
    assigneeCanInternalTest: child.assigneeCanInternalTest ?? null,
  }) === 'dev');
}

/**
 * Routes one page to the issue its scenarios belong on.
 *
 * A Feature with exactly one SL story routes there. Anything less certain than that is REPORTED
 * rather than resolved: several SL stories is a question only the team can answer, and quietly
 * picking the first would file a Feature's scenarios against an arbitrary third of them.
 *
 * A Feature with no SL story names the dev story to clone one from, so the report can offer the
 * action instead of just describing the gap.
 */
export function routeDocToIssue(
  pageIssueKey: string | null,
  isFeatureKey: boolean,
  featureChildren: readonly FeatureChild[],
): DocRoute {
  if (pageIssueKey === null) {
    return {
      targetIssueKey: null,
      outcome: 'no-key-in-title',
      cloneSourceIssueKey: null,
      reason: 'the page title names no Jira issue',
    };
  }

  if (!isFeatureKey) {
    return {
      targetIssueKey: pageIssueKey,
      outcome: 'linked-directly',
      cloneSourceIssueKey: null,
      reason: `the title names ${pageIssueKey} directly`,
    };
  }

  if (featureChildren.length === 0) {
    return {
      targetIssueKey: null,
      outcome: 'feature-has-no-children',
      cloneSourceIssueKey: null,
      reason: `${pageIssueKey} has no stories under it yet`,
    };
  }

  const slChildren = readSlChildren(featureChildren);
  if (slChildren.length === 1) {
    return {
      targetIssueKey: slChildren[0].issueKey,
      outcome: 'routed-to-sl-story',
      cloneSourceIssueKey: null,
      reason: `${pageIssueKey} → its SL story ${slChildren[0].issueKey}`,
    };
  }

  if (slChildren.length > 1) {
    // Not resolved by picking one. Which SL story owns a Feature's scenarios is a question only the
    // team can answer, and choosing the first would file them against an arbitrary third of them.
    return {
      targetIssueKey: null,
      outcome: 'several-sl-stories',
      cloneSourceIssueKey: null,
      reason: `${pageIssueKey} has ${slChildren.length} SL stories `
        + `(${slChildren.map((child) => child.issueKey).join(', ')}) — pick one`,
    };
  }

  const devChildren = readDevChildren(featureChildren);
  return {
    targetIssueKey: null,
    outcome: 'no-sl-story',
    // Named so the report can offer "create it" rather than only describing the gap.
    cloneSourceIssueKey: devChildren[0]?.issueKey ?? null,
    reason: devChildren.length === 0
      ? `${pageIssueKey} has no SL story, and no dev story to clone one from`
      : `${pageIssueKey} has no SL story — clone ${devChildren[0].issueKey}`,
  };
}
