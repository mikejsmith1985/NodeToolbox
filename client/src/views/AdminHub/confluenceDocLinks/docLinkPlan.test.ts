// docLinkPlan.test.ts — What the run would do, decided before anything is written.

import { describe, expect, it } from 'vitest';

import { buildDocLinkPlan, readFeatureKeysToResolve, type CrawledPage } from './docLinkPlan.ts';

const FEATURE_PROJECTS = ['DENP'];

function page(id: string, title: string): CrawledPage {
  return { id, title, webUrl: `https://confluence/pages/${id}` };
}

describe('buildDocLinkPlan', () => {
  it('routes a team-issue page straight to it', () => {
    const plan = buildDocLinkPlan([page('1', 'ENCUC-1088 CMS Processor')], FEATURE_PROJECTS, {});

    expect(plan.rows[0].route.targetIssueKey).toBe('ENCUC-1088');
    expect(plan.linkableCount).toBe(1);
  });

  it('routes a Feature page to its SL story', () => {
    const plan = buildDocLinkPlan([page('1', 'DENP-475: COB/MSP Test cases')], FEATURE_PROJECTS, {
      'DENP-475': [
        { issueKey: 'ENCUC-2213', summary: '[DEV] COB/MSP' },
        { issueKey: 'ENCUC-2358', summary: '[SL] COB/MSP' },
      ],
    });

    expect(plan.rows[0].route.targetIssueKey).toBe('ENCUC-2358');
    expect(plan.rows[0].isActionable).toBe(true);
  });

  it('counts a page that needs a decision separately from one that names nothing', () => {
    // They are different piles: one is work somebody has to do, the other is a page nobody has
    // labelled. Folding them together hides the first.
    const plan = buildDocLinkPlan([
      page('1', 'DENP-475: needs a decision'),
      page('2', 'ESI reconciliation'),
    ], FEATURE_PROJECTS, {
      'DENP-475': [
        { issueKey: 'ENCUC-1', summary: '[SL] one' },
        { issueKey: 'ENCUC-2', summary: '[SL] two' },
      ],
    });

    expect(plan.needsDecisionCount).toBe(1);
    expect(plan.untaggedCount).toBe(1);
    expect(plan.linkableCount).toBe(0);
  });

  it('reports a Feature it could not read children for, rather than skipping the page', () => {
    // A page that vanishes from a report is the one nobody chases.
    const plan = buildDocLinkPlan([page('1', 'DENP-999: unknown feature')], FEATURE_PROJECTS, {});

    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].route.outcome).toBe('feature-has-no-children');
  });

  it('carries the page URL through, which is what a Jira link points at', () => {
    const plan = buildDocLinkPlan([page('7', 'ENCUC-1 x')], FEATURE_PROJECTS, {});

    expect(plan.rows[0].pageUrl).toBe('https://confluence/pages/7');
  });

  it('passes the truncation flag through, so counts can be read as a floor', () => {
    expect(buildDocLinkPlan([], FEATURE_PROJECTS, {}, true).isTruncated).toBe(true);
  });

  it('plans nothing for an empty tree without failing', () => {
    const plan = buildDocLinkPlan([], FEATURE_PROJECTS, {});

    expect(plan.rows).toEqual([]);
    expect(plan.linkableCount).toBe(0);
  });
});

describe('readFeatureKeysToResolve', () => {
  it('names each Feature once, however many pages sit under it', () => {
    // A tree with forty pages under one Feature would otherwise ask Jira forty times.
    const featureKeys = readFeatureKeysToResolve([
      page('1', 'DENP-475: part one'),
      page('2', 'DENP-475: part two'),
      page('3', 'DENP-477: something else'),
    ], FEATURE_PROJECTS);

    expect(featureKeys).toEqual(['DENP-475', 'DENP-477']);
  });

  it('asks for nothing when no page names a Feature', () => {
    const featureKeys = readFeatureKeysToResolve([
      page('1', 'ENCUC-1088 direct'),
      page('2', 'ESI reconciliation'),
    ], FEATURE_PROJECTS);

    expect(featureKeys).toEqual([]);
  });
});
