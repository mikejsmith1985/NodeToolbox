// checklistState.js — Express router factory for the "Today" daily-checklist API.
//
// Backs the Scrum Master's "Today" dashboard. The dashboard itself is built
// client-side; this API only stores which checklist categories the user has
// manually marked complete for the current business day so they stay ticked
// across devices and restarts (and reset automatically the next business day).
//
//   GET  /api/sm-checklist-state?user=<userKey>&day=<YYYY-MM-DD> → { completed: { categoryId: record } }
//   POST /api/sm-checklist-state                                 → tick/untick one category, returns updated map

'use strict';

const express = require('express');
const { getDailyChecklist, setCategoryComplete } = require('../services/dailyChecklistStore');

/**
 * Creates the Express router for the daily-checklist API.
 * Takes no configuration — the store resolves its own AppData file path.
 *
 * @returns {express.Router}
 */
function createChecklistStateRouter() {
  const router = express.Router();

  // ── GET /api/sm-checklist-state ────────────────────────────────────────────
  // Returns every category the given user has marked complete for the given day.
  router.get('/api/sm-checklist-state', (req, res) => {
    const userKey = (req.query.user ?? '').toString().trim();
    const dayKey = (req.query.day ?? '').toString().trim();
    if (!userKey) {
      return res.status(400).json({ error: 'Query param "user" is required.' });
    }
    if (!dayKey) {
      return res.status(400).json({ error: 'Query param "day" is required.' });
    }
    return res.json({ completed: getDailyChecklist(userKey, dayKey) });
  });

  // ── POST /api/sm-checklist-state ───────────────────────────────────────────
  // Marks one category complete (isComplete=true) or clears it (isComplete=false).
  router.post('/api/sm-checklist-state', (req, res) => {
    const { userKey, day, categoryId, isComplete } = req.body ?? {};

    if (!userKey || !day || !categoryId || typeof isComplete !== 'boolean') {
      return res.status(400).json({
        error: '"userKey", "day", "categoryId", and boolean "isComplete" are required.',
      });
    }

    const updatedMap = setCategoryComplete({ userKey, dayKey: day, categoryId, isComplete });
    return res.json({ completed: updatedMap });
  });

  return router;
}

module.exports = createChecklistStateRouter;
