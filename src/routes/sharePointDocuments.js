// src/routes/sharePointDocuments.js — Browsing a SharePoint document library from the PO Tool.
//
// The library is read through the relay, which means through the user's own authenticated
// SharePoint tab. Nothing here holds a credential and nothing here can reach SharePoint on its own;
// the server only decides WHICH requests to make, and the browser makes them.
//
// Two endpoints, deliberately separate. Browsing returns names only, because a library holds
// hundreds of documents and fetching them all to find the three that matter is the thing this
// design exists to avoid. Fetching takes an explicit list — chosen by a person, or shortlisted by
// an assistant from the names — and reads only those.

'use strict';

const express = require('express');

const { browseDocumentLibrary, downloadDocumentText } = require('../services/sharePointDocumentRelay');

/** Upper bound on one fetch. Well above a sensible shortlist, and below anything that would hang. */
const MAX_DOCUMENTS_PER_FETCH = 25;

/** Reads a trimmed string from an untrusted body value. */
function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

module.exports = function createSharePointDocumentsRouter() {
  const router = express.Router();

  /**
   * Walks a library folder and returns what is in it — names, not contents.
   *
   * Reports the documents it cannot read and the folders it did not descend into, rather than
   * returning a shorter list and letting the caller assume that was everything.
   */
  router.post('/api/sharepoint-documents/browse', async (req, res) => {
    const folderUrl = toTrimmedString(req.body && req.body.folderUrl);
    if (folderUrl === '') {
      return res.status(400).json({ ok: false, message: 'Expected a folderUrl (a server-relative library path).' });
    }
    try {
      const result = await browseDocumentLibrary(folderUrl);
      return res.json({ ok: true, ...result });
    } catch (browseError) {
      const message = browseError instanceof Error ? browseError.message : String(browseError);
      return res.status(502).json({ ok: false, message });
    }
  });

  /**
   * Fetches the text of documents chosen by their server-relative urls.
   *
   * One document failing does not abandon the rest: each result carries its own outcome, because a
   * fetch of six that returns nothing because the fourth was locked is worse than one that returns
   * five and says which one it could not read.
   */
  router.post('/api/sharepoint-documents/fetch', async (req, res) => {
    const requestedUrls = (req.body && req.body.serverRelativeUrls) || [];
    if (!Array.isArray(requestedUrls) || requestedUrls.length === 0) {
      return res.status(400).json({ ok: false, message: 'Expected a non-empty serverRelativeUrls array.' });
    }
    if (requestedUrls.length > MAX_DOCUMENTS_PER_FETCH) {
      return res.status(400).json({
        ok: false,
        message: `Too many documents in one fetch (max ${MAX_DOCUMENTS_PER_FETCH}) — narrow the selection.`,
      });
    }

    const documents = [];
    for (const rawUrl of requestedUrls) {
      const serverRelativeUrl = toTrimmedString(rawUrl);
      if (serverRelativeUrl === '') {
        continue;
      }
      try {
        const text = await downloadDocumentText(serverRelativeUrl);
        documents.push({ serverRelativeUrl, text, error: null });
      } catch (fetchError) {
        const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
        documents.push({ serverRelativeUrl, text: '', error: message });
      }
    }

    return res.json({ ok: true, documents });
  });

  return router;
};
