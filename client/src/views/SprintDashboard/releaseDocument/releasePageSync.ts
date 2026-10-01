// releasePageSync.ts — Saves release pages to Confluence without ever losing what people typed (GH #395).
//
// Framework-First drift (research R-5): the release-notes publisher (releaseNotesConfluence.ts) overwrites a
// page's whole body, which would erase hand-entered deployment steps and notes. Here every save reads the page
// first, hands its typed content to the caller's build, and only then writes — and when someone saved the page
// in between, re-reads, rebuilds and retries once (the PI Review pattern).

import {
  createConfluencePage,
  fetchConfluencePage,
  fetchConfluencePageSpaceKey,
  findConfluencePageByTitle,
  resolveConfluencePageIdFromReference,
  updateConfluencePage,
  type CreateConfluencePageInput,
  type UpdateConfluencePageInput,
} from '../../../services/confluenceApi.ts';
import { isConfluenceVersionConflict } from '../../../services/confluenceVersionConflict.ts';
import type { EpicGroup, ReleaseItem } from './releaseGather.ts';
import { buildReleasePageStorage, parseReleasePageStorage, type ParsedReleasePage } from './releasePageStorage.ts';

/** The Confluence calls saving needs, injectable so the flow is testable without a network. */
export interface ReleasePageConfluenceApi {
  fetchPageSpaceKey: (pageId: string) => Promise<string>;
  findPageByTitle: (spaceKey: string, pageTitle: string) => Promise<{ id: string; webUrl: string } | null>;
  fetchPage: (pageId: string) => Promise<{ version: { number: number }; body: { storage: { value: string } } }>;
  createPage: (input: CreateConfluencePageInput) => Promise<{ id: string; webUrl: string }>;
  updatePage: (input: UpdateConfluencePageInput) => Promise<unknown>;
}

/** The real Confluence client, through the authenticated proxy. */
export const LIVE_RELEASE_PAGE_API: ReleasePageConfluenceApi = {
  fetchPageSpaceKey: fetchConfluencePageSpaceKey,
  findPageByTitle: findConfluencePageByTitle,
  fetchPage: fetchConfluencePage,
  createPage: createConfluencePage,
  updatePage: updateConfluencePage,
};

/** Where a release page lives: under which parent, and its title. */
export interface ReleasePageLocation {
  parentPageReference: string;
  title: string;
}

/** A release page as it stands in Confluence. */
export interface ExistingReleasePage {
  pageId: string;
  pageUrl: string;
  versionNumber: number;
  parsed: ParsedReleasePage;
}

const EMPTY_PARSED_PAGE: ParsedReleasePage = { deploymentSteps: [], notesByKey: new Map() };

/** The parent page's id and space, or a plain error when the link cannot be read. */
async function resolveParent(
  parentPageReference: string,
  api: ReleasePageConfluenceApi,
): Promise<{ parentPageId: string; spaceKey: string }> {
  const parentPageId = resolveConfluencePageIdFromReference(parentPageReference);
  if (parentPageId === null) {
    throw new Error('The release document parent page link is not valid. Paste the full Confluence page URL or its numeric page ID.');
  }
  return { parentPageId, spaceKey: await api.fetchPageSpaceKey(parentPageId) };
}

/** Reads one page by id into its version and typed content. */
async function readPageById(pageId: string, pageUrl: string, api: ReleasePageConfluenceApi): Promise<ExistingReleasePage> {
  const page = await api.fetchPage(pageId);
  return { pageId, pageUrl, versionNumber: page.version.number, parsed: parseReleasePageStorage(page.body.storage.value) };
}

/** The release page under its parent, read, or null when it does not exist yet. */
export async function readReleasePage(
  location: ReleasePageLocation,
  api: ReleasePageConfluenceApi = LIVE_RELEASE_PAGE_API,
): Promise<ExistingReleasePage | null> {
  const { spaceKey } = await resolveParent(location.parentPageReference, api);
  const foundPage = await api.findPageByTitle(spaceKey, location.title);
  return foundPage === null ? null : readPageById(foundPage.id, foundPage.webUrl, api);
}

/**
 * Saves a release page. `buildStorage` receives what the page currently holds (empty for a new page) and
 * returns the full body to write, so it decides how typed content is kept. A clash with someone else's save
 * re-reads, rebuilds and retries once; a second clash is reported.
 */
export async function saveReleasePage(
  request: ReleasePageLocation & { buildStorage: (current: ParsedReleasePage) => string },
  api: ReleasePageConfluenceApi = LIVE_RELEASE_PAGE_API,
): Promise<{ pageUrl: string; wasCreated: boolean }> {
  const { parentPageId, spaceKey } = await resolveParent(request.parentPageReference, api);
  const foundPage = await api.findPageByTitle(spaceKey, request.title);
  if (foundPage === null) {
    const createdPage = await api.createPage({
      spaceKey, parentPageId, pageTitle: request.title, storageValue: request.buildStorage(EMPTY_PARSED_PAGE),
    });
    return { pageUrl: createdPage.webUrl, wasCreated: true };
  }

  const writeLatest = async (): Promise<void> => {
    const existingPage = await readPageById(foundPage.id, foundPage.webUrl, api);
    await api.updatePage({
      pageId: existingPage.pageId,
      pageTitle: request.title,
      storageValue: request.buildStorage(existingPage.parsed),
      nextVersionNumber: existingPage.versionNumber + 1,
    });
  };
  try {
    await writeLatest();
  } catch (saveError) {
    if (!isConfluenceVersionConflict(saveError)) throw saveError;
    await writeLatest();
  }
  return { pageUrl: foundPage.webUrl, wasCreated: false };
}

// ── Sync all releases ──

/** A release to sync: its name and the page title it gets (null when it has no date to title it by). */
export interface SyncableRelease {
  name: string;
  pageTitle: string | null;
}

/** What happened to one release during a sync. */
export interface ReleaseSyncResult {
  versionName: string;
  pageTitle: string | null;
  outcome: 'created' | 'updated' | 'skipped-empty' | 'skipped-no-date' | 'failed';
  detail?: string;
}

export interface SyncAllInput {
  /** Unreleased releases only — a released one is never offered, so its page is never touched. */
  versions: readonly SyncableRelease[];
  parentPageReference: string;
  gatherVersion: (versionName: string) => Promise<{ groups: EpicGroup[]; warnings: string[] }>;
  buildIssueUrl: (issueKey: string) => string;
  lastSyncedLabel: string;
}

/** An item with its notes from the map, when the map has some for it. */
function withNotes(item: ReleaseItem, notesByKey: ReadonlyMap<string, string>): ReleaseItem {
  return { ...item, notes: notesByKey.get(item.key) ?? item.notes };
}

/** Every group with notes applied, by issue key, to its Epic and its children. */
export function applyNotesToGroups(groups: readonly EpicGroup[], notesByKey: ReadonlyMap<string, string>): EpicGroup[] {
  return groups.map((group) => ({
    ...group,
    epic: group.epic ? withNotes(group.epic, notesByKey) : null,
    items: group.items.map((item) => withNotes(item, notesByKey)),
  }));
}

/** Reads every existing release page first, pooling their notes by key — notes follow their item, not their page. */
async function collectExistingPages(
  input: SyncAllInput,
  api: ReleasePageConfluenceApi,
): Promise<{ pagesByTitle: Map<string, ExistingReleasePage>; notesByKey: Map<string, string> }> {
  const pagesByTitle = new Map<string, ExistingReleasePage>();
  const notesByKey = new Map<string, string>();
  for (const version of input.versions) {
    if (!version.pageTitle) continue;
    const existingPage = await readReleasePage({ parentPageReference: input.parentPageReference, title: version.pageTitle }, api);
    if (!existingPage) continue;
    pagesByTitle.set(version.pageTitle, existingPage);
    existingPage.parsed.notesByKey.forEach((notes, issueKey) => notesByKey.set(issueKey, notes));
  }
  return { pagesByTitle, notesByKey };
}

/** Syncs one release: gather, attach pooled notes, keep the page's own deployment steps, save. */
async function syncOneRelease(
  version: SyncableRelease & { pageTitle: string },
  input: SyncAllInput,
  pooledNotes: ReadonlyMap<string, string>,
  hasExistingPage: boolean,
  api: ReleasePageConfluenceApi,
): Promise<ReleaseSyncResult> {
  const { groups } = await input.gatherVersion(version.name);
  const hasWork = groups.some((group) => group.items.length > 0);
  if (!hasWork && !hasExistingPage) {
    return { versionName: version.name, pageTitle: version.pageTitle, outcome: 'skipped-empty' };
  }
  const notedGroups = applyNotesToGroups(groups, pooledNotes);
  const outcome = await saveReleasePage({
    parentPageReference: input.parentPageReference,
    title: version.pageTitle,
    // The page's latest deployment steps are kept as they are — they belong to the release, not to an item.
    buildStorage: (current) => buildReleasePageStorage(
      { groups: notedGroups, deploymentSteps: current.deploymentSteps, lastSyncedLabel: input.lastSyncedLabel },
      input.buildIssueUrl,
    ),
  }, api);
  return { versionName: version.name, pageTitle: version.pageTitle, outcome: outcome.wasCreated ? 'created' : 'updated' };
}

/**
 * Brings every unreleased release's page up to date in one go: creates missing pages, refreshes existing ones,
 * and moves each item — with its notes — to the page of the release it is now in. A release with no work and no
 * page gets none; one without a date is reported; one that fails is reported while the rest still sync.
 */
export async function syncAllReleases(
  input: SyncAllInput,
  api: ReleasePageConfluenceApi = LIVE_RELEASE_PAGE_API,
): Promise<ReleaseSyncResult[]> {
  const { pagesByTitle, notesByKey } = await collectExistingPages(input, api);
  const results: ReleaseSyncResult[] = [];
  for (const version of input.versions) {
    if (!version.pageTitle) {
      results.push({ versionName: version.name, pageTitle: null, outcome: 'skipped-no-date' });
      continue;
    }
    try {
      results.push(await syncOneRelease({ ...version, pageTitle: version.pageTitle }, input, notesByKey, pagesByTitle.has(version.pageTitle), api));
    } catch (syncError) {
      results.push({
        versionName: version.name,
        pageTitle: version.pageTitle,
        outcome: 'failed',
        detail: syncError instanceof Error ? syncError.message : String(syncError),
      });
    }
  }
  return results;
}
