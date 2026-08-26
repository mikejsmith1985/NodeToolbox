// docLinkPlan.ts — What the run WOULD do, worked out before anything is written.
//
// Nothing here talks to Jira or Confluence. It takes a crawled page list and whatever the caller
// managed to learn about each Feature's children, and produces the row-per-page plan the panel
// shows and the writer executes. Separating the two means a dry run and a real run are the same
// decision — the only difference is whether the writer is called — so what you approved is
// necessarily what happens.

import { readPageSubject } from './pageTitleKeys.ts';
import { isPageWithinWindow, readPageRecency, type PageRecencyKind } from './pageRecency.ts';
import { routeDocToIssue, type DocRoute, type FeatureChild } from './slStoryRouting.ts';

/** One crawled page, reduced to what planning reads. */
export interface CrawledPage {
  id: string;
  title: string;
  webUrl: string;
  /** When it was last edited, when Confluence said. */
  lastModifiedIso?: string | null;
  /** When it was created — what separates a NEW page from an edited one. */
  createdIso?: string | null;
}

/** One page's fate: where its link goes, or why it has nowhere to go yet. */
export interface DocLinkPlanRow {
  pageId: string;
  pageTitle: string;
  pageUrl: string;
  /** The key read from the title, before routing. */
  titleIssueKey: string | null;
  route: DocRoute;
  /** True when this row would write a link if the run were not a dry run. */
  isActionable: boolean;
  /** When the page last changed, so a row can say why it is in a narrowed scan. */
  changedAtIso: string | null;
  /** Whether this page is new or was edited — different kinds of work. */
  recencyKind: PageRecencyKind;
}

/** The whole run, and what it could not do. */
export interface DocLinkPlan {
  rows: DocLinkPlanRow[];
  /** Rows that would write a link. */
  linkableCount: number;
  /** Rows held for a decision — several SL stories, or a missing one. */
  needsDecisionCount: number;
  /** Pages whose titles name no issue, so nobody has told us what they document. */
  untaggedCount: number;
  /** True when the crawl hit its ceiling, so every count here is a floor. */
  isTruncated: boolean;
  /** Pages the recency window excluded — reported so a small count is never read as a small tree. */
  outsideWindowCount: number;
}

/** Whether a route would actually write something. */
function isRouteActionable(route: DocRoute): boolean {
  return route.targetIssueKey !== null;
}

/**
 * Builds the plan for a crawled tree.
 *
 * `featureChildrenByKey` is whatever the caller managed to fetch. A Feature MISSING from it is
 * treated as having no children, which reports honestly ("no stories under it yet") rather than
 * silently skipping the page — a page that vanishes from a report is the one nobody chases.
 */
export function buildDocLinkPlan(
  pages: readonly CrawledPage[],
  featureProjectKeys: readonly string[],
  featureChildrenByKey: Readonly<Record<string, FeatureChild[]>>,
  isTruncated = false,
  windowDays = 0,
  nowIso = '',
): DocLinkPlan {
  // Narrowed BEFORE routing, so a Feature is never resolved for a page the run will not report on.
  const pagesInWindow = nowIso === ''
    ? [...pages]
    : pages.filter((page) => isPageWithinWindow(
      { lastModifiedIso: page.lastModifiedIso ?? null, createdIso: page.createdIso ?? null },
      windowDays,
      nowIso,
    ));

  const rows = pagesInWindow.map((page) => {
    const subject = readPageSubject(page.title, featureProjectKeys);
    const featureChildren = subject.issueKey === null
      ? []
      : featureChildrenByKey[subject.issueKey] ?? [];
    const route = routeDocToIssue(subject.issueKey, subject.isFeatureKey, featureChildren);

    const recency = readPageRecency({
      lastModifiedIso: page.lastModifiedIso ?? null,
      createdIso: page.createdIso ?? null,
    });

    return {
      pageId: page.id,
      pageTitle: page.title,
      pageUrl: page.webUrl,
      titleIssueKey: subject.issueKey,
      route,
      isActionable: isRouteActionable(route),
      changedAtIso: recency.changedAtIso,
      recencyKind: recency.kind,
    };
  });

  return {
    rows,
    linkableCount: rows.filter((row) => row.isActionable).length,
    untaggedCount: rows.filter((row) => row.route.outcome === 'no-key-in-title').length,
    // Everything that named an issue and still has nowhere to go. Counted separately because it is
    // the pile somebody has to work through, and folding it into "untagged" would hide it.
    needsDecisionCount: rows.filter((row) => !row.isActionable && row.route.outcome !== 'no-key-in-title').length,
    isTruncated,
    // Named rather than silently dropped: a run reporting three pages out of two hundred must say
    // the other hundred and ninety-seven were outside the window, not simply absent.
    outsideWindowCount: pages.length - pagesInWindow.length,
  };
}

/**
 * Every FEATURE key the plan will need children for.
 *
 * Read from the titles before any Jira call, so the caller fetches each Feature once rather than
 * once per page — a tree with forty pages under one Feature would otherwise ask forty times.
 */
export function readFeatureKeysToResolve(
  pages: readonly CrawledPage[],
  featureProjectKeys: readonly string[],
  windowDays = 0,
  nowIso = '',
): string[] {
  const featureKeys = new Set<string>();
  // The same window the plan uses, so a narrowed run does not fetch Features for pages it will
  // never report on — the request count follows the work, not the tree.
  const pagesInWindow = nowIso === ''
    ? pages
    : pages.filter((page) => isPageWithinWindow(
      { lastModifiedIso: page.lastModifiedIso ?? null, createdIso: page.createdIso ?? null },
      windowDays,
      nowIso,
    ));

  pagesInWindow.forEach((page) => {
    const subject = readPageSubject(page.title, featureProjectKeys);
    if (subject.isFeatureKey && subject.issueKey !== null) {
      featureKeys.add(subject.issueKey);
    }
  });

  return [...featureKeys];
}
