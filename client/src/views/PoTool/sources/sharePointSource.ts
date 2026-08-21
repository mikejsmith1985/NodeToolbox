// sharePointSource.ts — Browsing a SharePoint library from the PO Tool, and taking documents from it.
//
// The walk and the parsing happen on the server, through the relay — the user's own authenticated
// SharePoint tab. This is the client half: it asks, and turns what comes back into the same
// `ReferencedSource` shape every other kind of material uses, so a SharePoint document behaves
// exactly like a Confluence page once it is in the workspace.
//
// The one thing worth being careful about is what a FAILURE means. A relay that is not running, a
// library that is not shared with the user, and a document that is locked are three different
// problems with three different fixes, and collapsing them into "could not load" would send someone
// looking in the wrong place.

import { mintSourceId, type ReferencedSource, type SharePointSource } from './sourceModel.ts';

/** One document the library holds, as the server's walk found it. */
export interface LibraryDocumentSummary {
  name: string;
  folderPath: string;
  serverRelativeUrl: string;
  modifiedAtIso: string;
}

/** A document the walk found and could not read, with the reason a person can act on. */
export interface UnreadableDocument extends LibraryDocumentSummary {
  reason: string;
}

/** Everything one walk of a library turned up, including what it did NOT look at. */
export interface LibraryBrowseResult {
  documents: LibraryDocumentSummary[];
  unreadable: UnreadableDocument[];
  /** Folders below the depth limit. Named so an empty-looking result is never mistaken for empty. */
  skippedTooDeep: string[];
  visitedFolderCount: number;
}

/** Raised when the library could not be browsed, carrying the server's own words. */
export class SharePointSourceError extends Error {}

/** Reads the server's message, or falls back to something that still says which step failed. */
async function readFailureMessage(response: Response, fallbackMessage: string): Promise<string> {
  try {
    const body = await response.json() as { message?: string };
    return body.message ?? fallbackMessage;
  } catch {
    return fallbackMessage;
  }
}

/**
 * Walks a library folder and returns its documents — names only, no contents.
 *
 * The contents are a second, deliberate step: a library holds hundreds of documents, and reading
 * them all to find the three that matter is the cost this whole design exists to avoid.
 */
export async function browseSharePointLibrary(folderUrl: string): Promise<LibraryBrowseResult> {
  const trimmedFolderUrl = folderUrl.trim();
  if (trimmedFolderUrl === '') {
    throw new SharePointSourceError('Enter the library folder path first, e.g. /sites/Delivery/Shared Documents.');
  }

  const response = await fetch('/api/sharepoint-documents/browse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderUrl: trimmedFolderUrl }),
  });
  if (!response.ok) {
    throw new SharePointSourceError(await readFailureMessage(
      response,
      'That library could not be browsed. Check the SharePoint relay is running in a SharePoint tab.',
    ));
  }

  const body = await response.json() as Partial<LibraryBrowseResult>;
  return {
    documents: body.documents ?? [],
    unreadable: body.unreadable ?? [],
    skippedTooDeep: body.skippedTooDeep ?? [],
    visitedFolderCount: body.visitedFolderCount ?? 0,
  };
}

/**
 * Fetches the chosen documents and returns them as workspace sources.
 *
 * A document that could not be read is REPORTED rather than dropped: somebody who selected six and
 * received five deserves to know which one is missing, and why.
 */
export async function fetchSharePointDocuments(
  documents: readonly LibraryDocumentSummary[],
  existingSources: readonly ReferencedSource[],
  fetchedAtIso: string,
): Promise<{ sources: SharePointSource[]; failures: { name: string; reason: string }[] }> {
  if (documents.length === 0) {
    return { sources: [], failures: [] };
  }

  const response = await fetch('/api/sharepoint-documents/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serverRelativeUrls: documents.map((document) => document.serverRelativeUrl) }),
  });
  if (!response.ok) {
    throw new SharePointSourceError(await readFailureMessage(response, 'Those documents could not be read.'));
  }

  const body = await response.json() as { documents?: { serverRelativeUrl: string; text: string; error: string | null }[] };
  const fetchedByUrl = new Map((body.documents ?? []).map((entry) => [entry.serverRelativeUrl, entry]));

  const sources: SharePointSource[] = [];
  const failures: { name: string; reason: string }[] = [];
  // Ids are minted against the growing list, not the original one, so two documents added in the
  // same run cannot collide on an id and knock each other out of the workspace.
  let sourcesSoFar: ReferencedSource[] = [...existingSources];

  documents.forEach((document) => {
    const fetched = fetchedByUrl.get(document.serverRelativeUrl);
    if (!fetched || fetched.error !== null || fetched.text.trim() === '') {
      failures.push({
        name: document.name,
        reason: fetched?.error ?? 'came back empty',
      });
      return;
    }
    const source: SharePointSource = {
      kind: 'sharepoint',
      id: mintSourceId(sourcesSoFar, 'sharepoint'),
      fileName: document.name,
      folderPath: document.folderPath,
      serverRelativeUrl: document.serverRelativeUrl,
      text: fetched.text,
      fetchedAtIso,
    };
    sources.push(source);
    sourcesSoFar = [...sourcesSoFar, source];
  });

  return { sources, failures };
}
