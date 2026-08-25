// slStoryRouting.test.ts — Test scenarios filed at Feature level, routed to the story that runs them.

import { describe, expect, it } from 'vitest';

import { routeDocToIssue, type FeatureChild } from './slStoryRouting.ts';

function child(issueKey: string, summary: string, assigneeCanInternalTest: boolean | null = null): FeatureChild {
  return { issueKey, summary, assigneeCanInternalTest };
}

describe('routeDocToIssue', () => {
  it('links a page that names a team issue straight to it', () => {
    const route = routeDocToIssue('ENCUC-1088', false, []);

    expect(route.targetIssueKey).toBe('ENCUC-1088');
    expect(route.outcome).toBe('linked-directly');
  });

  it('routes a FEATURE page to the SL story that runs its scenarios', () => {
    // The documentation is filed at Feature level because that is how the folders are organised,
    // but the scenarios belong to the story that runs them.
    const route = routeDocToIssue('DENP-475', true, [
      child('ENCUC-2213', '[DEV] COB/MSP ingestion'),
      child('ENCUC-2358', '[SL] COB/MSP ingestion'),
    ]);

    expect(route.targetIssueKey).toBe('ENCUC-2358');
    expect(route.outcome).toBe('routed-to-sl-story');
  });

  it('refuses to choose when a Feature has SEVERAL SL stories', () => {
    // Which one owns the Feature's scenarios is a question only the team can answer; picking the
    // first would file them against an arbitrary third of them.
    const route = routeDocToIssue('DENP-475', true, [
      child('ENCUC-2358', '[SL] part one'),
      child('ENCUC-2359', '[SL] part two'),
    ]);

    expect(route.targetIssueKey).toBeNull();
    expect(route.outcome).toBe('several-sl-stories');
    expect(route.reason).toContain('ENCUC-2358, ENCUC-2359');
  });

  it('names the dev story to clone when a Feature has no SL story', () => {
    // So the report can offer the action instead of only describing the gap.
    const route = routeDocToIssue('DENP-475', true, [child('ENCUC-2213', '[DEV] COB/MSP ingestion')]);

    expect(route.outcome).toBe('no-sl-story');
    expect(route.cloneSourceIssueKey).toBe('ENCUC-2213');
    expect(route.targetIssueKey).toBeNull();
  });

  it('says plainly when there is no dev story to clone from either', () => {
    // Untagged AND no assignee signal — classifyChainRole calls this unclassified, which is neither
    // a test story nor something safe to clone one from.
    const route = routeDocToIssue('DENP-475', true, [child('ENCUC-9', 'Something untagged', null)]);

    expect(route.outcome).toBe('no-sl-story');
    expect(route.reason).toContain('no dev story to clone one from');
  });

  it('reports a Feature with no children at all', () => {
    const route = routeDocToIssue('DENP-475', true, []);

    expect(route.outcome).toBe('feature-has-no-children');
    expect(route.targetIssueKey).toBeNull();
  });

  it('reports a page whose title names nothing', () => {
    const route = routeDocToIssue(null, false, []);

    expect(route.outcome).toBe('no-key-in-title');
    expect(route.targetIssueKey).toBeNull();
  });

  it('classifies an untagged story by its assignee, the same way every other surface does', () => {
    // Delegated to `classifyChainRole` on purpose: there is one answer to "is this the test story".
    const route = routeDocToIssue('DENP-475', true, [
      child('ENCUC-2213', 'Untagged coding work', false),
      child('ENCUC-2358', 'Untagged testing work', true),
    ]);

    expect(route.targetIssueKey).toBe('ENCUC-2358');
  });
});
