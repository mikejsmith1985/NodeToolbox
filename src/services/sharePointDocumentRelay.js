// sharePointDocumentRelay.js — Browsing a SharePoint document library through the relay.
//
// The email relay next door reads ONE flat folder, parses every file as a message and recycles it
// afterwards. A document library is the opposite shape: nested folders somebody organised on
// purpose, files that are reference material rather than input, and nothing to consume or delete.
// Sharing that module's path helpers is right; sharing its behaviour would be wrong, so this is a
// sibling rather than an option on it.
//
// The pieces here are PURE — path building, format judgement, and the walk plan. The requests
// themselves are the caller's, because the relay transport already exists and does not need a
// second copy. That also makes the two things worth arguing about — which formats we can honestly
// read, and how far a walk is allowed to go — testable without a SharePoint.

'use strict';

const { encodeRestPathParameter } = require('./sharePointEmailRelay');
const { submitRelayRequest } = require('../routes/relayBridge');
const { isDocxFileName, readDocxTextFromBase64 } = require('./docxText');

/** One listing page. Far above any sane folder, and the paging follows nextLink regardless. */
const LISTING_PAGE_SIZE = 2000;

/**
 * How many folders deep a walk will descend.
 *
 * A document library can be enormous and the browser tab doing the fetching belongs to the user, so
 * the walk is bounded rather than trusted. Anything below the bound is REPORTED, never dropped
 * quietly: a folder somebody filed too deep should read as "not looked at" rather than "empty".
 */
const MAX_FOLDER_DEPTH = 6;

/**
 * Formats this application can honestly turn into text.
 *
 * Word documents are here because a parser was added for them; PDF is not, and is named as
 * unreadable rather than half-read into something that would silently mislead whoever relied on it.
 * Spreadsheets the app already reads.
 */
const READABLE_DOCUMENT_EXTENSIONS = [
  '.txt', '.md', '.csv', '.json', '.html', '.htm', '.aspx', '.xml', '.xlsx', '.xls',
  // Binary, and read through a different path: base64 out of the relay, then mammoth.
  '.docx',
];

/** The site root a REST call has to be made against, taken from the managed path. */
function siteRootOfFolder(folderServerRelativeUrl) {
  const managedPathMatch = /^\/(sites|teams)\/[^/]+/i.exec(folderServerRelativeUrl || '');
  return managedPathMatch ? managedPathMatch[0] : '';
}

/**
 * The request path listing one folder's SUBFOLDERS.
 *
 * The email relay never needed this — it reads a single folder somebody points it at. Navigating a
 * library is the whole point here, so the folders are as much of the answer as the files.
 *
 * @param {string} folderServerRelativeUrl
 * @returns {string}
 */
function buildFolderListingPath(folderServerRelativeUrl) {
  // The decodedUrl=@alias form is REQUIRED: the older ByServerRelativeUrl('...') form 404s on any
  // path containing '#', and document libraries are full of them.
  return `${siteRootOfFolder(folderServerRelativeUrl)}`
    + '/_api/web/GetFolderByServerRelativePath(decodedUrl=@folderPath)/Folders'
    + `?$select=Name,ServerRelativeUrl,ItemCount&$top=${LISTING_PAGE_SIZE}`
    + `&@folderPath='${encodeRestPathParameter(folderServerRelativeUrl)}'`;
}

/**
 * The request path listing one folder's FILES, with enough about each to choose between them.
 *
 * A bare name is not enough to pick from: when a document last changed is what tells a reader
 * whether they are looking at the current standard or last year's.
 *
 * @param {string} folderServerRelativeUrl
 * @returns {string}
 */
function buildDocumentListingPath(folderServerRelativeUrl) {
  return `${siteRootOfFolder(folderServerRelativeUrl)}`
    + '/_api/web/GetFolderByServerRelativePath(decodedUrl=@folderPath)/Files'
    + `?$select=Name,ServerRelativeUrl,TimeLastModified,Length&$top=${LISTING_PAGE_SIZE}`
    + `&@folderPath='${encodeRestPathParameter(folderServerRelativeUrl)}'`;
}

/** Whether this application can turn a file of that name into text. */
function isReadableDocumentName(fileName) {
  const lowerName = String(fileName || '').toLowerCase();
  return READABLE_DOCUMENT_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

/**
 * Splits a folder listing into what can be read and what cannot, keeping BOTH.
 *
 * The unreadable ones are named with a reason rather than filtered away. A document library is
 * mostly Word and PDF; a browser that showed neither would look broken rather than limited, and the
 * person looking for a document they can see in SharePoint deserves to be told why it is not here.
 *
 * @param {Array<object>} listingEntries - SharePoint /Files entries
 * @returns {{ readable: Array<object>, unreadable: Array<object> }}
 */
function selectReadableDocuments(listingEntries) {
  const entries = Array.isArray(listingEntries) ? listingEntries : [];
  const readable = [];
  const unreadable = [];

  entries.forEach((entry) => {
    const name = String((entry && entry.Name) || '').trim();
    if (name === '') {
      return;
    }
    const document = {
      name,
      serverRelativeUrl: String((entry && entry.ServerRelativeUrl) || ''),
      modifiedAtIso: String((entry && entry.TimeLastModified) || ''),
    };
    if (isReadableDocumentName(name)) {
      readable.push(document);
      return;
    }
    unreadable.push({
      ...document,
      reason: `${name.split('.').pop()} cannot be read here — export it to .docx, .txt, .md or .html, or paste it in.`,
    });
  });

  return { readable, unreadable };
}

/** How many path segments below the starting folder a discovered folder sits. */
function readDepthBelow(rootFolderUrl, folderUrl) {
  const rootSegments = rootFolderUrl.split('/').filter(Boolean).length;
  const folderSegments = folderUrl.split('/').filter(Boolean).length;
  return folderSegments - rootSegments;
}

/**
 * Works out which folders a walk should visit next, and which were too deep to follow.
 *
 * Pure so the bound is arguable in a test rather than discovered in production. De-duplicates,
 * because a library that links a folder into itself would otherwise spin forever.
 *
 * @param {string} rootFolderServerRelativeUrl
 * @param {Array<object>} discoveredSubfolders - SharePoint /Folders entries found so far
 * @returns {{ foldersToVisit: string[], skippedTooDeep: string[] }}
 */
function planDocumentWalk(rootFolderServerRelativeUrl, discoveredSubfolders) {
  const rootFolder = String(rootFolderServerRelativeUrl || '');
  const subfolders = Array.isArray(discoveredSubfolders) ? discoveredSubfolders : [];

  const foldersToVisit = [rootFolder];
  const skippedTooDeep = [];
  const seenFolders = new Set([rootFolder]);

  subfolders.forEach((entry) => {
    const folderUrl = String((entry && entry.ServerRelativeUrl) || '').trim();
    if (folderUrl === '' || seenFolders.has(folderUrl)) {
      return;
    }
    seenFolders.add(folderUrl);
    if (readDepthBelow(rootFolder, folderUrl) > MAX_FOLDER_DEPTH) {
      skippedTooDeep.push(folderUrl);
      return;
    }
    foldersToVisit.push(folderUrl);
  });

  return { foldersToVisit, skippedTooDeep };
}


/** How long one relay round trip may take. A library walk is many of these, so it is not generous. */
const RELAY_REQUEST_TIMEOUT_MS = 30000;

/** One relay round trip, returning the parsed body. Injectable so the walk is testable with no SharePoint. */
async function requestThroughRelay(requestPath, deps, responseType) {
  const submit = deps.submitRelayRequest || submitRelayRequest;
  const request = { method: 'GET', url: requestPath };
  if (responseType) {
    request.responseType = responseType;
  }
  return submit('sharepoint', request, RELAY_REQUEST_TIMEOUT_MS);
}

/**
 * Walks a document library and reports everything it found.
 *
 * Breadth-first and bounded by MAX_FOLDER_DEPTH. What it could not read and what it did not descend
 * into are both RETURNED rather than dropped: a person looking at a document they can see in
 * SharePoint and cannot see here is owed a reason, and a folder filed too deep should read as "not
 * looked at" rather than "empty".
 *
 * @param {string} rootFolderServerRelativeUrl
 * @param {object} [deps]
 * @returns {Promise<{documents: object[], unreadable: object[], skippedTooDeep: string[], visitedFolderCount: number}>}
 */
async function browseDocumentLibrary(rootFolderServerRelativeUrl, deps = {}) {
  const rootFolder = String(rootFolderServerRelativeUrl || '').trim();
  const documents = [];
  const unreadable = [];
  const skippedTooDeep = [];
  const visitedFolders = new Set();
  const foldersToVisit = [rootFolder];

  while (foldersToVisit.length > 0) {
    const folder = foldersToVisit.shift();
    if (folder === '' || visitedFolders.has(folder)) {
      continue;
    }
    visitedFolders.add(folder);

    const fileBody = await requestThroughRelay(buildDocumentListingPath(folder), deps);
    const split = selectReadableDocuments((fileBody && fileBody.value) || []);
    split.readable.forEach((document) => documents.push({ ...document, folderPath: folder }));
    split.unreadable.forEach((document) => unreadable.push({ ...document, folderPath: folder }));

    const folderBody = await requestThroughRelay(buildFolderListingPath(folder), deps);
    const plan = planDocumentWalk(rootFolder, (folderBody && folderBody.value) || []);
    skippedTooDeep.push(...plan.skippedTooDeep);
    plan.foldersToVisit.forEach((discovered) => {
      if (!visitedFolders.has(discovered)) {
        foldersToVisit.push(discovered);
      }
    });
  }

  return { documents, unreadable, skippedTooDeep, visitedFolderCount: visitedFolders.size };
}

/**
 * Downloads one document's text by its server-relative url.
 *
 * A non-string body means nothing readable came back — reported as empty rather than thrown, so one
 * unreadable document does not abandon a fetch of several.
 */
async function downloadDocumentText(serverRelativeUrl, deps = {}) {
  const path = `${siteRootOfFolder(serverRelativeUrl)}`
    + '/_api/web/GetFileByServerRelativePath(decodedUrl=@filePath)/$value'
    + `?@filePath='${encodeRestPathParameter(serverRelativeUrl)}'`;

  // A .docx is a ZIP. Read as text its bytes are decoded as UTF-8 and destroyed, so it is asked for
  // base64 and rebuilt here. Every other format keeps the plain text path it always had.
  if (isDocxFileName(serverRelativeUrl)) {
    const encoded = await requestThroughRelay(path, deps, 'base64');
    return readDocxTextFromBase64(typeof encoded === 'string' ? encoded : '');
  }

  const body = await requestThroughRelay(path, deps);
  return typeof body === 'string' ? body : '';
}

module.exports = {
  browseDocumentLibrary,
  buildDocumentListingPath,
  downloadDocumentText,
  buildFolderListingPath,
  isReadableDocumentName,
  MAX_FOLDER_DEPTH,
  planDocumentWalk,
  READABLE_DOCUMENT_EXTENSIONS,
  selectReadableDocuments,
};
