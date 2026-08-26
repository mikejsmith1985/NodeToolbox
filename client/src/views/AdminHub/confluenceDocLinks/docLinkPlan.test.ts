// docLinkPlan.test.ts — What the run would do, decided before anything is written.

import { describe, expect, it } from 'vitest';

import { buildDocLinkPlan, readFeatureKeysToResolve, type CrawledPage } from './docLinkPlan.ts';

const FEATURE_PROJECTS = ['DENP'];

function page(id: string, title: string, changedIso = '2026-08-25T12:00:00.000Z'): CrawledPage {
  return {
    id,
    title,
    webUrl: `https://confluence/pages/${id}`,
    lastModifiedIso: changedIso,
    createdIso: '2025-01-01T00:00:00.000Z',
  };
}

const NOW_ISO = '2026-08-26T12:00:00.000Z';

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

describe('buildDocLinkPlan — the recency window', () => {
  it('reports only pages changed inside the window', () => {
    // A nightly run should not re-report two hundred pages dealt with weeks ago.
    const plan = buildDocLinkPlan([
      page('1', 'ENCUC-1 recent', '2026-08-25T12:00:00.000Z'),
      page('2', 'ENCUC-2 stale', '2026-06-01T12:00:00.000Z'),
    ], FEATURE_PROJECTS, {}, false, 7, NOW_ISO);

    expect(plan.rows.map((row) => row.pageId)).toEqual(['1']);
  });

  it('says how many it left out, so a small count is not read as a small tree', () => {
    const plan = buildDocLinkPlan([
      page('1', 'ENCUC-1 recent', '2026-08-25T12:00:00.000Z'),
      page('2', 'ENCUC-2 stale', '2026-06-01T12:00:00.000Z'),
      page('3', 'ENCUC-3 stale', '2026-05-01T12:00:00.000Z'),
    ], FEATURE_PROJECTS, {}, false, 7, NOW_ISO);

    expect(plan.outsideWindowCount).toBe(2);
  });

  it('reports everything when no window is set', () => {
    const plan = buildDocLinkPlan([
      page('1', 'ENCUC-1', '2026-08-25T12:00:00.000Z'),
      page('2', 'ENCUC-2', '2020-01-01T12:00:00.000Z'),
    ], FEATURE_PROJECTS, {}, false, 0, NOW_ISO);

    expect(plan.rows).toHaveLength(2);
    expect(plan.outsideWindowCount).toBe(0);
  });

  it('tells a NEW page from an edited one on each row', () => {
    // Different kinds of work: a new page needs linking, an edited one may already be linked.
    const newPage: CrawledPage = {
      id: '9',
      title: 'ENCUC-9 brand new',
      webUrl: 'https://confluence/pages/9',
      lastModifiedIso: '2026-08-25T12:00:00.000Z',
      createdIso: '2026-08-25T12:00:00.000Z',
    };

    const plan = buildDocLinkPlan([newPage, page('1', 'ENCUC-1 edited')], FEATURE_PROJECTS, {}, false, 7, NOW_ISO);

    expect(plan.rows.find((row) => row.pageId === '9')?.recencyKind).toBe('new');
    expect(plan.rows.find((row) => row.pageId === '1')?.recencyKind).toBe('updated');
  });

  it('keeps a page whose dates Confluence never returned', () => {
    // Dropping it would hide exactly the pages whose metadata is broken.
    const undatedPage: CrawledPage = {
      id: '5', title: 'ENCUC-5', webUrl: 'https://confluence/pages/5', lastModifiedIso: null, createdIso: null,
    };

    const plan = buildDocLinkPlan([undatedPage], FEATURE_PROJECTS, {}, false, 7, NOW_ISO);

    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].recencyKind).toBe('unknown');
  });
});

describe('readFeatureKeysToResolve — the window applies here too', () => {
  it('does not fetch a Feature for a page outside the window', () => {
    // The request count should follow the work, not the tree.
    const featureKeys = readFeatureKeysToResolve([
      page('1', 'DENP-475: recent', '2026-08-25T12:00:00.000Z'),
      page('2', 'DENP-999: stale', '2026-01-01T12:00:00.000Z'),
    ], FEATURE_PROJECTS, 7, NOW_ISO);

    expect(featureKeys).toEqual(['DENP-475']);
  });
});
