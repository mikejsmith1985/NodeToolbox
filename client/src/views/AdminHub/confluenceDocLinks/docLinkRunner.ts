// docLinkRunner.ts — The half that talks to Jira and Confluence, once a plan has been agreed.
//
// Deliberately thin. Every decision was made by `docLinkPlan`, so this reads Feature children,
// writes remote links, and creates SL stories — and decides nothing. A dry run and a real run walk
// the same plan; the only difference is whether this module is called at all, which is what makes
// "what you approved is what happens" structural rather than a promise.

import { jiraGet, jiraPost, createIssue, createIssueLink } from '../../../services/jiraApi.ts';
import { crawlConfluencePageTree, findConfluencePageByTitle } from '../../../services/confluenceApi.ts';
import { buildDocLinkPlan, readFeatureKeysToResolve, type CrawledPage, type DocLinkPlan } from './docLinkPlan.ts';
import { buildSlStoryPayload, buildSlStorySummary } from './slStoryClone.ts';
import type { FeatureChild } from './slStoryRouting.ts';

/** The fields a Feature's children are judged on. Small on purpose — this is a routing read. */
const CHILD_FIELDS = 'summary,assignee';

/** How Jira answers a JQL search for a Feature's children. */
interface ChildSearchResponse {
  issues?: Array<{ key: string; fields?: { summary?: string } }>;
}

/**
 * The stories under one Feature.
 *
 * Read by the Feature Link field, which is how this instance attaches a story to a Feature — the
 * `parent` field does not carry it. The caller supplies the field id so no id lives in here.
 *
 * `assigneeCanInternalTest` is left null: it needs the roster, and a routing read that also had to
 * resolve people would be a much heavier request for a signal that only matters when a summary has
 * no tag. Untagged stories are reported rather than guessed.
 */
export async function fetchFeatureChildren(
  featureKey: string,
  featureLinkFieldId: string,
): Promise<FeatureChild[]> {
  const jql = `"${featureLinkFieldId}" = "${featureKey}" ORDER BY key ASC`;
  const response = await jiraGet<ChildSearchResponse>(
    `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${CHILD_FIELDS}&maxResults=100`,
  );

  return (response.issues ?? []).map((issue) => ({
    issueKey: issue.key,
    summary: issue.fields?.summary ?? '',
    assigneeCanInternalTest: null,
  }));
}

/** Everything one planning run needs to reach Confluence and Jira. */
export interface DocLinkScanRequest {
  spaceKey: string;
  rootPageTitle: string;
  featureProjectKeys: string[];
  featureLinkFieldId: string;
  /** Only report pages created or edited in the last N days. 0 means the whole tree. */
  windowDays: number;
}

/** A planning run's outcome, including what it could not read. */
export interface DocLinkScanOutcome {
  plan: DocLinkPlan | null;
  /** Why there is no plan — a missing root page, most often a renamed one. */
  failureReason: string | null;
}

/**
 * Crawls the tree and works out the plan, writing nothing.
 *
 * A missing root page fails LOUDLY rather than crawling nothing and reporting an empty tree: those
 * two look identical on screen and mean opposite things.
 */
export async function scanForDocLinks(request: DocLinkScanRequest): Promise<DocLinkScanOutcome> {
  const rootPage = await findConfluencePageByTitle(request.spaceKey, request.rootPageTitle);
  if (rootPage === null) {
    return {
      plan: null,
      failureReason: `No page titled "${request.rootPageTitle}" in space ${request.spaceKey}. `
        + 'If it was renamed, update the setting — an empty crawl and a missing page look the same.',
    };
  }

  const crawl = await crawlConfluencePageTree(rootPage.id);
  const pages: CrawledPage[] = crawl.pages.map((page) => ({
    id: page.id,
    title: page.title,
    webUrl: page.webUrl,
    lastModifiedIso: page.lastModifiedIso,
    createdIso: page.createdIso,
  }));

  // One clock reading for the whole run: a window evaluated per page would drift across a long
  // crawl, and a page could fall in or out depending on how long the request before it took.
  const nowIso = new Date().toISOString();

  // Each Feature once, and only for pages inside the window.
  const featureKeys = readFeatureKeysToResolve(pages, request.featureProjectKeys, request.windowDays, nowIso);
  const featureChildrenByKey: Record<string, FeatureChild[]> = {};
  for (const featureKey of featureKeys) {
    featureChildrenByKey[featureKey] = await fetchFeatureChildren(featureKey, request.featureLinkFieldId)
      // A Feature that cannot be read is reported as childless, which the plan already words
      // honestly. Failing the whole run for one unreadable Feature would be worse.
      .catch(() => []);
  }

  return {
    plan: buildDocLinkPlan(
      pages,
      request.featureProjectKeys,
      featureChildrenByKey,
      crawl.isTruncated,
      request.windowDays,
      nowIso,
    ),
    failureReason: null,
  };
}

/**
 * A stable id for one page-to-issue link, so re-running updates rather than duplicating.
 *
 * Jira treats `globalId` as the identity of a remote link: POSTing the same one twice replaces it.
 * Without this a nightly run would add the same link every night, and nobody would notice until an
 * issue had thirty copies of one document on it.
 */
export function buildDocLinkGlobalId(pageId: string): string {
  return `nodetoolbox-confluence-doc:${pageId}`;
}

/** Writes one Confluence page onto one Jira issue as a remote link. */
export async function writeDocLink(
  issueKey: string,
  pageTitle: string,
  pageUrl: string,
  pageId: string,
): Promise<void> {
  await jiraPost(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/remotelink`, {
    globalId: buildDocLinkGlobalId(pageId),
    object: {
      url: pageUrl,
      title: pageTitle,
      // Named so a reader can tell at a glance which links came from here and which somebody added.
      icon: { title: 'Confluence' },
    },
    relationship: 'documentation',
  });
}

/** What creating one SL story needs, read from the dev story it is cloned from. */
export interface SlStoryCloneRequest {
  devStoryKey: string;
  devStorySummary: string;
  projectKey: string;
  issueTypeId: string;
  /** Jira's own name for the containment link type on this instance. */
  containmentLinkTypeName: string;
  inheritedFields?: Record<string, unknown>;
}

/**
 * Creates the SL story and links it as contained in the dev story it came from.
 *
 * The link is written after the create and is NOT allowed to undo it: an SL story that exists but is
 * not yet nested is a smaller problem than one that was rolled back, and the link can be added by
 * hand. The failure is returned rather than thrown so the caller can report both facts.
 */
export async function createSlStoryFromDevStory(
  request: SlStoryCloneRequest,
): Promise<{ slStoryKey: string; linkError: string | null }> {
  const created = await createIssue(buildSlStoryPayload({
    summary: request.devStorySummary,
    projectKey: request.projectKey,
    issueTypeId: request.issueTypeId,
    inheritedFields: request.inheritedFields,
  }));

  let linkError: string | null = null;
  try {
    await createIssueLink({
      type: { name: request.containmentLinkTypeName },
      // Inward is the contained end on this link type: the SL story sits INSIDE the dev story.
      inwardIssue: { key: created.key },
      outwardIssue: { key: request.devStoryKey },
    });
  } catch (caughtError) {
    linkError = caughtError instanceof Error ? caughtError.message : 'Could not link the new story.';
  }

  return { slStoryKey: created.key, linkError };
}

/** The summary a create would produce, so the panel can show it before anything is written. */
export function previewSlStorySummary(devStorySummary: string): string {
  return buildSlStorySummary(devStorySummary);
}
