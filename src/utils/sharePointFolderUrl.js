// sharePointFolderUrl.js — Server-side SharePoint folder URL normalization, mirroring the client
// pull service's forgiveness: a pasted share link (/:f:/r/... with encoding and query noise), a full
// URL, or a bare server-relative path all reduce to the clean folder path. Exists on the server so
// the config loader and intake route can SELF-HEAL a config where a SharePoint link was saved into
// the local drop-folder field (a production misconfiguration that broke every run until edited).

'use strict';

/** True when the value is an http(s) URL — something that can never be a local drop folder. */
function isHttpUrl(value) {
  return /^https?:/i.test(String(value || '').trim());
}

/**
 * Normalizes any pasted SharePoint folder reference to its server-relative path.
 * Steps mirror the client's normalizeSharePointFolderInput: take the URL path, drop query/fragment
 * BEFORE decoding (so an encoded path never resurrects a '?'), percent-decode, strip the share-link
 * type marker (/:f:/r for folders), and trim trailing slashes.
 *
 * @param {string} input - share link, full URL, or bare server-relative path
 * @returns {string} the clean server-relative folder path ('' for blank input)
 */
function normalizeSharePointFolderUrl(input) {
  const trimmed = String(input || '').trim();
  if (trimmed === '') {
    return '';
  }
  let folderPath = trimmed;
  if (/:\/\//.test(trimmed)) {
    try {
      folderPath = new URL(trimmed).pathname;
    } catch (_parseError) {
      // Not URL-parseable — treat it as a path below.
    }
  }
  folderPath = folderPath.split('?')[0].split('#')[0];
  try {
    folderPath = decodeURIComponent(folderPath);
  } catch (_decodeError) {
    // Leave the path as-is if it isn't validly encoded.
  }
  folderPath = folderPath.replace(/^\/:[a-z]:\/[a-z]\//i, '/');
  if (!folderPath.startsWith('/')) {
    folderPath = '/' + folderPath;
  }
  return folderPath.replace(/\/+$/, '');
}

module.exports = { isHttpUrl, normalizeSharePointFolderUrl };
