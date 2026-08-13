// sharePointEmailRelay.js — Reading the GitHub-email library from the SERVER, through the relay.
//
// The intake pipeline has always been server-side. The SharePoint half of it was not: listing the
// folder, downloading each email and clearing the ingested ones all lived in the browser, so the
// schedule had to live there too — inside the NodeToolbox tab. Close the tab and the schedule stopped;
// leave it open and it still skipped every boundary whenever the relay looked disconnected.
//
// Nothing about SharePoint requires a browser to be DRIVING, only that the requests are executed in
// the authenticated session. `submitRelayRequest` already hands a request to the bookmarklet and waits
// for its answer, so the server can drive exactly the same conversation. The user's SharePoint tab
// still does the fetching — it just no longer has to be told what to fetch by another tab.
//
// This module is the transport only. Everything it collects is handed to the existing
// `runGithubEmailSourcesNow`, which is the same pipeline the local drop folder uses.

'use strict';

const { submitRelayRequest } = require('../routes/relayBridge');

// ── Named constants (mirrored from the client implementation this replaces) ──

/**
 * Extensions that are definitely not readable email text.
 *
 * Everything else is a candidate, because Power Automate commonly names files by the email SUBJECT —
 * extensionless, sometimes with dots mid-name — so allow-listing extensions can never work. The
 * parser is the real judge; an unparseable candidate becomes one honest log entry.
 */
const UNSUPPORTED_BINARY_EXTENSIONS = ['.msg', '.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip'];

/** Upper bound on one folder listing — far above any sane library backlog. */
const LISTING_PAGE_SIZE = 2000;

/**
 * How many pages the listing follows before giving up.
 *
 * A backlog is normal — the folder is only emptied after a successful ingest — so the listing must
 * page rather than trust one $top. The cap exists purely so a malformed nextLink cannot loop forever.
 */
const MAX_LISTING_PAGES = 50;

/** How long one relay round trip may take. Downloads of large emails are the slow case. */
const RELAY_REQUEST_TIMEOUT_MS = 60000;

/** The managed-path site root (/sites/x or /teams/x) of a folder URL, for the _api base. '' = root web. */
function siteRootOfFolder(folderServerRelativeUrl) {
  const managedPathMatch = /^\/(sites|teams)\/[^/]+/i.exec(folderServerRelativeUrl || '');
  return managedPathMatch ? managedPathMatch[0] : '';
}

/** Encodes a server-relative path for a quoted REST parameter ('' doubles OData quotes). */
function encodeRestPathParameter(serverRelativePath) {
  return encodeURIComponent(String(serverRelativePath || '').replace(/'/g, "''"));
}

/** True when the name is a known binary this pipeline cannot read as text. */
function isUnsupportedBinaryFileName(fileName) {
  const lowerName = String(fileName || '').toLowerCase();
  return UNSUPPORTED_BINARY_EXTENSIONS.some((extension) => lowerName.endsWith(extension));
}

/**
 * Turns SharePoint's next-page link into a path the relay can request.
 *
 * The bookmarklet builds its target as `location.origin + path`, so an absolute nextLink has to lose
 * its origin or the request would end up at a doubled host.
 */
function readNextListingPath(nextLink) {
  if (typeof nextLink !== 'string' || nextLink.trim() === '') return null;
  if (nextLink.startsWith('/')) return nextLink;
  try {
    const parsedLink = new URL(nextLink);
    return `${parsedLink.pathname}${parsedLink.search}`;
  } catch {
    return null;
  }
}

/** The listing request path for the first page of a folder. */
function buildListingPath(folderServerRelativeUrl) {
  // The decodedUrl=@alias form is REQUIRED: the older ByServerRelativeUrl('...') form 404s on any
  // path containing '#', and every GitHub PR email subject contains one.
  return `${siteRootOfFolder(folderServerRelativeUrl)}`
    + '/_api/web/GetFolderByServerRelativePath(decodedUrl=@folderPath)/Files'
    + `?$select=Name,TimeCreated&$top=${LISTING_PAGE_SIZE}`
    + `&@folderPath='${encodeRestPathParameter(folderServerRelativeUrl)}'`;
}

/** The download request path for one file's raw text. */
function buildDownloadPath(folderServerRelativeUrl, fileName) {
  const filePath = `${folderServerRelativeUrl}/${fileName}`;
  return `${siteRootOfFolder(folderServerRelativeUrl)}`
    + '/_api/web/GetFileByServerRelativePath(decodedUrl=@filePath)/$value'
    + `?@filePath='${encodeRestPathParameter(filePath)}'`;
}

/** The recycle request path for one file. Recycle bin, never a hard delete. */
function buildRecyclePath(folderServerRelativeUrl, fileName) {
  const filePath = `${folderServerRelativeUrl}/${fileName}`;
  return `${siteRootOfFolder(folderServerRelativeUrl)}`
    + '/_api/web/GetFileByServerRelativePath(decodedUrl=@filePath)/recycle()'
    + `?@filePath='${encodeRestPathParameter(filePath)}'`;
}

/**
 * Sorts and filters one listing's raw rows into the names worth ingesting.
 *
 * Oldest first, so ingest follows arrival order. Skipped binaries are counted rather than silently
 * dropped — a folder full of images should say so, not look empty.
 */
function selectEmailFileNames(namedFiles) {
  const emailFileNames = (namedFiles || [])
    .filter((file) => typeof file.Name === 'string')
    .filter((file) => !isUnsupportedBinaryFileName(file.Name))
    .sort((first, second) => String(first.TimeCreated || '').localeCompare(String(second.TimeCreated || '')))
    .map((file) => file.Name);
  const namedCount = (namedFiles || []).filter((file) => typeof file.Name === 'string').length;
  return { emailFileNames, unsupportedCount: namedCount - emailFileNames.length };
}

/** One relay round trip, returning the parsed body. */
async function requestThroughRelay(requestPath, method, deps) {
  const submit = deps.submitRelayRequest || submitRelayRequest;
  return submit('sharepoint', { method: method || 'GET', url: requestPath }, RELAY_REQUEST_TIMEOUT_MS);
}

/** Lists the email candidates in the library folder, following SharePoint's paging. */
async function listFolderEmailFiles(folderServerRelativeUrl, deps = {}) {
  let listingPath = buildListingPath(folderServerRelativeUrl);
  const namedFiles = [];

  for (let pageIndex = 0; pageIndex < MAX_LISTING_PAGES && listingPath !== null; pageIndex += 1) {
    const body = await requestThroughRelay(listingPath, 'GET', deps);
    const pageRows = (body && body.value) || [];
    namedFiles.push(...pageRows);
    listingPath = readNextListingPath(body && body['odata.nextLink']);
  }

  return selectEmailFileNames(namedFiles);
}

/** Downloads one file's raw text. A non-string body means nothing readable came back. */
async function downloadFileText(folderServerRelativeUrl, fileName, deps = {}) {
  const body = await requestThroughRelay(buildDownloadPath(folderServerRelativeUrl, fileName), 'GET', deps);
  return typeof body === 'string' ? body : '';
}

/** Moves one ingested file to the recycle bin. */
async function recycleFile(folderServerRelativeUrl, fileName, deps = {}) {
  await requestThroughRelay(buildRecyclePath(folderServerRelativeUrl, fileName), 'POST', deps);
}

/**
 * Collects the emails this folder holds that have not been ingested yet.
 *
 * Downloads run one at a time on purpose. They go through a single browser tab, and a burst of
 * parallel fetches through one relay channel would queue behind each other anyway while making a
 * failure much harder to attribute.
 */
async function collectNewSharePointSources(folderServerRelativeUrl, filterNewFileNames, deps = {}) {
  const listing = await listFolderEmailFiles(folderServerRelativeUrl, deps);
  const newFileNames = await filterNewFileNames(listing.emailFileNames);

  const sources = [];
  for (const fileName of newFileNames) {
    const content = await downloadFileText(folderServerRelativeUrl, fileName, deps);
    sources.push({ fileName, content });
  }

  return { sources, listedCount: listing.emailFileNames.length, unsupportedCount: listing.unsupportedCount };
}

/**
 * Deletes only the files the pipeline has CONFIRMED it recorded.
 *
 * The confirmation is the seen-names ledger, re-asked after the run: a file it no longer calls new is
 * one it has recorded. Nothing is deleted on the strength of a status code — a batch can report
 * success while an individual email failed to parse, and that email has to survive for somebody to
 * look at. A file that will not delete is simply left; the ledger stops it being processed twice, so
 * leaving it is untidy and never incorrect.
 */
async function recycleConfirmedFiles(folderServerRelativeUrl, attemptedFileNames, filterNewFileNames, deps = {}) {
  if (!attemptedFileNames || attemptedFileNames.length === 0) {
    return { deletedCount: 0, keptCount: 0 };
  }

  const stillNewFileNames = new Set(await filterNewFileNames([...attemptedFileNames]));
  const confirmedFileNames = attemptedFileNames.filter((fileName) => !stillNewFileNames.has(fileName));

  let deletedCount = 0;
  for (const fileName of confirmedFileNames) {
    try {
      await recycleFile(folderServerRelativeUrl, fileName, deps);
      deletedCount += 1;
    } catch {
      // Left where it is, deliberately — see the note above.
    }
  }

  return { deletedCount, keptCount: attemptedFileNames.length - deletedCount };
}

module.exports = {
  buildDownloadPath,
  buildListingPath,
  buildRecyclePath,
  collectNewSharePointSources,
  downloadFileText,
  encodeRestPathParameter,
  isUnsupportedBinaryFileName,
  listFolderEmailFiles,
  readNextListingPath,
  recycleConfirmedFiles,
  recycleFile,
  selectEmailFileNames,
  siteRootOfFolder,
  LISTING_PAGE_SIZE,
  MAX_LISTING_PAGES,
  UNSUPPORTED_BINARY_EXTENSIONS,
};
