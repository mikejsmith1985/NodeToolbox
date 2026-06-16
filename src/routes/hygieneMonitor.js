// hygieneMonitor.js — Express router factory for the hygiene monitor API.
//
// Exposes four endpoints used by the Admin Hub panel and the client-side
// Hygiene Monitor view:
//   GET  /api/hygiene-monitor/config   → current team config (no secrets)
//   POST /api/hygiene-monitor/config   → save team config to disk
//   POST /api/hygiene-monitor/scan     → trigger an immediate scan for one team
//   GET  /api/hygiene-monitor/status   → last scan summary (no secrets)
//
// All webhook secrets are stripped from GET responses — they must never
// appear in API output, logs, or error messages.

'use strict';

const express = require('express');
const { runHygieneScan, getLastScanStatus } = require('../services/hygieneMonitorScheduler');
const { saveConfigToDisk } = require('../config/loader');

// ── Secret scrubbing ──────────────────────────────────────────────────────────

/**
 * Returns a copy of a team config object with the Teams webhook secret removed.
 * Called on every team object before any outbound serialization.
 *
 * @param {{ teamsWebhookSecret?: string, [key: string]: unknown }} teamConfig
 * @returns {object} Team config with the secret field omitted.
 */
function scrubTeamSecret(teamConfig) {
  const { teamsWebhookSecret: _omitted, ...safeConfig } = teamConfig;
  return safeConfig;
}

// ── Router factory ────────────────────────────────────────────────────────────

/**
 * Creates and returns an Express router for the hygiene monitor API.
 * The `configuration` object is mutated in place on POST /config so that
 * in-process callers see the update without a server restart.
 *
 * @param {object} configuration - Live server configuration (may contain hygieneMonitor section).
 * @returns {express.Router}
 */
function createHygieneMonitorRouter(configuration) {
  const router = express.Router();

  // ── GET /api/hygiene-monitor/config ────────────────────────────────────────

  router.get('/api/hygiene-monitor/config', (req, res) => {
    const teams = (configuration.hygieneMonitor?.teams ?? []).map(scrubTeamSecret);
    return res.json({ teams });
  });

  // ── POST /api/hygiene-monitor/config ──────────────────────────────────────

  router.post('/api/hygiene-monitor/config', (req, res) => {
    const { teams } = req.body ?? {};

    if (!Array.isArray(teams)) {
      return res.status(400).json({ error: '"teams" array is required.' });
    }

    // Mutate the live config so the scheduler picks up the new settings
    // immediately, then persist to disk so they survive a restart.
    if (!configuration.hygieneMonitor) {
      configuration.hygieneMonitor = {};
    }
    configuration.hygieneMonitor.teams = teams;
    saveConfigToDisk(configuration);

    const safeTeams = teams.map(scrubTeamSecret);
    return res.json({ teams: safeTeams });
  });

  // ── POST /api/hygiene-monitor/scan ────────────────────────────────────────

  router.post('/api/hygiene-monitor/scan', async (req, res) => {
    const { teamName } = req.body ?? {};
    const configuredTeams = configuration.hygieneMonitor?.teams ?? [];
    const teamConfig = configuredTeams.find((team) => team.teamName === teamName);

    if (!teamConfig) {
      return res.status(404).json({ error: `Team not found: ${teamName}` });
    }

    try {
      const scanResult = await runHygieneScan(teamConfig, configuration);
      return res.json(scanResult);
    } catch (scanError) {
      return res.status(503).json({ error: 'Scan service unavailable.', detail: scanError.message });
    }
  });

  // ── GET /api/hygiene-monitor/status ───────────────────────────────────────

  router.get('/api/hygiene-monitor/status', (req, res) => {
    return res.json(getLastScanStatus());
  });

  return router;
}

module.exports = createHygieneMonitorRouter;
