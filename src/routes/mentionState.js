// mentionState.js — Express router factory for the addressed-mentions API.
//
// Backs the "Mentions" report in the My Issues view. The report itself is built
// client-side (it queries Jira through the existing proxy); this API only stores
// which mentions the user has marked addressed so they stay hidden across
// devices and restarts.
//
//   GET  /api/mention-state?user=<userKey>  → { addressed: { mentionKey: record } }
//   POST /api/mention-state                 → mark/unmark one mention, returns updated map

'use strict';

const express = require('express');
const { getAddressedMentions, setMentionAddressed } = require('../services/mentionStateStore');

/**
 * Creates the Express router for the addressed-mentions API.
 * Takes no configuration — the store resolves its own AppData file path.
 *
 * @returns {express.Router}
 */
function createMentionStateRouter() {
  const router = express.Router();

  // ── GET /api/mention-state ─────────────────────────────────────────────────
  // Returns every mention the given user has already marked addressed.
  router.get('/api/mention-state', (req, res) => {
    const userKey = (req.query.user ?? '').toString().trim();
    if (!userKey) {
      return res.status(400).json({ error: 'Query param "user" is required.' });
    }
    return res.json({ addressed: getAddressedMentions(userKey) });
  });

  // ── POST /api/mention-state ────────────────────────────────────────────────
  // Marks one mention addressed (isAddressed=true) or undoes it (isAddressed=false).
  router.post('/api/mention-state', (req, res) => {
    const { userKey, mentionKey, issueKey, isAddressed } = req.body ?? {};

    if (!userKey || !mentionKey || typeof isAddressed !== 'boolean') {
      return res.status(400).json({
        error: '"userKey", "mentionKey", and boolean "isAddressed" are required.',
      });
    }

    const updatedMap = setMentionAddressed({ userKey, mentionKey, issueKey, isAddressed });
    return res.json({ addressed: updatedMap });
  });

  return router;
}

module.exports = createMentionStateRouter;
