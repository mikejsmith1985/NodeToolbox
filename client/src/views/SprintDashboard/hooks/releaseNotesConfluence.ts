// releaseNotesConfluence.ts — Posts one release's notes to its own Confluence page under a chosen parent.
//
// Each release gets its own child page, titled like the on-screen heading
// ("Transformers 10/14/2026 Release Notes"). Confluence keeps titles unique within a space, so posting
// the same release again UPDATES that page rather than failing or duplicating it — a re-run after a
// corrected AI reply simply replaces the earlier notes.
//
// Built on the existing Confluence client (the same proxy and credentials PI Review's "Save to
// Confluence" uses); only the create-a-child-page call is new, because nothing in the browser created
// pages before.

import {
  createConfluencePage,
  fetchConfluencePage,
  fetchConfluencePageSpaceKey,
  findConfluencePageByTitle,
  resolveConfluencePageIdFromReference,
  updateConfluencePage,
  type CreateConfluencePageInput,
  type CreatedConfluencePage,
  type UpdateConfluencePageInput,
} from '../../../services/confluenceApi.ts';
import {
  escapeHtml,
  RELEASE_NOTES_HTML_COLUMN_LABELS,
  type ReleaseAiAssistTableDocument,
  type ReleaseAiAssistTableRow,
} from './releaseAiAssistNotes.ts';
import { describeGroupHeading, isGroupingWorthShowing, type ReleaseNotesGroup } from './releaseNotesGrouping.ts';

// Where each project's chosen parent page is remembered. The `tbx` prefix puts it in Settings Backup.
const PARENT_PAGE_STORAGE_KEY = 'tbxReleaseNotesConfluenceParents';

// ── Page body ──

/** One release item as a table row: the bold key and title, then the five note columns. */
function renderStorageRow(releaseRow: ReleaseAiAssistTableRow): string {
  const cellContents = [
    `<strong>${escapeHtml(releaseRow.issueKey)}</strong><br/>${escapeHtml(releaseRow.title)}`,
    escapeHtml(releaseRow.releaseNote),
    escapeHtml(releaseRow.customerImpact),
    escapeHtml(releaseRow.technicalDetails),
    escapeHtml(releaseRow.risks),
    escapeHtml(releaseRow.validation),
  ];
  return `<tr>${cellContents.map((cellHtml) => `<td>${cellHtml}</td>`).join('')}</tr>`;
}

/** A Feature heading spanning the table, followed by the rows filed under that Feature. */
function renderStorageGroup(group: ReleaseNotesGroup): string {
  const narrativeHtml = group.narrative === '' ? '' : `<br/>${escapeHtml(group.narrative)}`;
  const headingRow = `<tr><td colspan="${RELEASE_NOTES_HTML_COLUMN_LABELS.length}">`
    + `<strong>${escapeHtml(describeGroupHeading(group))}</strong>${narrativeHtml}</td></tr>`;
  return headingRow + group.rows.map((groupRow) => renderStorageRow(groupRow)).join('');
}

/**
 * Builds the release notes as a Confluence storage-format page body: the summary, then the same
 * six-column table the dashboard shows, grouped by Feature when that grouping is worth showing.
 *
 * Deliberately unstyled — Confluence applies its own table theme, and the email-client inline styles
 * used by the clipboard copy would only fight it. The page title carries the team and release, so the
 * body repeats neither.
 */
export function buildReleaseNotesConfluenceStorage(
  releaseDocument: ReleaseAiAssistTableDocument,
  groups: readonly ReleaseNotesGroup[] = [],
): string {
  const headerRow = `<tr>${RELEASE_NOTES_HTML_COLUMN_LABELS
    .map((columnLabel) => `<th>${escapeHtml(columnLabel)}</th>`)
    .join('')}</tr>`;
  const bodyRows = isGroupingWorthShowing(groups)
    ? groups.map((group) => renderStorageGroup(group)).join('')
    : releaseDocument.items.map((releaseRow) => renderStorageRow(releaseRow)).join('');

  return `<p>${escapeHtml(releaseDocument.releaseSummary)}</p><table><tbody>${headerRow}${bodyRows}</tbody></table>`;
}

// ── Publishing ──

/** The Confluence calls publishing needs, injectable so the flow is testable without a network. */
export interface ReleaseNotesConfluenceApi {
  fetchPageSpaceKey: (pageId: string) => Promise<string>;
  findPageByTitle: (spaceKey: string, pageTitle: string) => Promise<{ id: string; webUrl: string } | null>;
  fetchPageVersionNumber: (pageId: string) => Promise<number>;
  createPage: (input: CreateConfluencePageInput) => Promise<CreatedConfluencePage>;
  updatePage: (input: UpdateConfluencePageInput) => Promise<unknown>;
}

/** The real Confluence client, through the authenticated proxy. */
const LIVE_CONFLUENCE_API: ReleaseNotesConfluenceApi = {
  fetchPageSpaceKey: fetchConfluencePageSpaceKey,
  findPageByTitle: findConfluencePageByTitle,
  fetchPageVersionNumber: async (pageId) => (await fetchConfluencePage(pageId)).version.number,
  createPage: createConfluencePage,
  updatePage: updateConfluencePage,
};

export interface ReleaseNotesPublishRequest {
  /** The parent page's link or numeric id, as the person pasted it. */
  parentPageReference: string;
  pageTitle: string;
  storageValue: string;
}

export interface ReleaseNotesPublishOutcome {
  pageUrl: string;
  /** True for a brand-new page; false when an earlier post of this release was replaced. */
  wasCreated: boolean;
}

/**
 * Posts a release's notes as a child page of the chosen parent, or replaces that release's page when
 * it was posted before. The page is looked up by title in the parent's space because Confluence would
 * refuse a second page with the same title there anyway.
 */
export async function publishReleaseNotesToConfluence(
  { parentPageReference, pageTitle, storageValue }: ReleaseNotesPublishRequest,
  confluenceApi: ReleaseNotesConfluenceApi = LIVE_CONFLUENCE_API,
): Promise<ReleaseNotesPublishOutcome> {
  const parentPageId = resolveConfluencePageIdFromReference(parentPageReference);
  if (parentPageId === null) {
    throw new Error('The Confluence parent page link is not valid. Paste the full page URL or its numeric page ID.');
  }

  const spaceKey = await confluenceApi.fetchPageSpaceKey(parentPageId);
  const existingPage = await confluenceApi.findPageByTitle(spaceKey, pageTitle);
  if (existingPage === null) {
    const createdPage = await confluenceApi.createPage({ spaceKey, parentPageId, pageTitle, storageValue });
    return { pageUrl: createdPage.webUrl, wasCreated: true };
  }

  const currentVersionNumber = await confluenceApi.fetchPageVersionNumber(existingPage.id);
  await confluenceApi.updatePage({
    pageId: existingPage.id,
    pageTitle,
    storageValue,
    nextVersionNumber: currentVersionNumber + 1,
  });
  return { pageUrl: existingPage.webUrl, wasCreated: false };
}

// ── Remembered parent page ──

/** Every project's remembered parent page, or an empty map when nothing readable is stored. */
function readStoredParentPages(): Record<string, string> {
  try {
    const storedValue = window.localStorage.getItem(PARENT_PAGE_STORAGE_KEY);
    const parsedValue: unknown = storedValue === null ? {} : JSON.parse(storedValue);
    return parsedValue !== null && typeof parsedValue === 'object' ? parsedValue as Record<string, string> : {};
  } catch {
    // Blocked storage or a corrupted value both mean "nothing remembered" — the person re-pastes it.
    return {};
  }
}

/** The parent page this project's release notes are posted under, or '' when none was chosen. */
export function readReleaseNotesParentPageReference(projectKey: string): string {
  const storedReference = readStoredParentPages()[projectKey];
  return typeof storedReference === 'string' ? storedReference : '';
}

/** Remembers (or, when blank, forgets) the parent page for this project's release notes. */
export function writeReleaseNotesParentPageReference(projectKey: string, parentPageReference: string): void {
  const parentPages = readStoredParentPages();
  const trimmedReference = parentPageReference.trim();
  if (trimmedReference === '') {
    delete parentPages[projectKey];
  } else {
    parentPages[projectKey] = trimmedReference;
  }

  try {
    window.localStorage.setItem(PARENT_PAGE_STORAGE_KEY, JSON.stringify(parentPages));
  } catch {
    // Storage is unavailable (private window); the choice lasts only for this visit.
  }
}
