// src/routes/scheduler.js — Express router for the background scheduler endpoints.
//
// Exposes runtime status, configuration management, manual run trigger, and
// result history for the GitHub repo monitor. These endpoints are used by the
// Toolbox Admin Hub to monitor and control automation.

'use strict';

const express     = require('express');
const repoMonitor = require('../services/repoMonitor');
const { saveConfigToDisk } = require('../config/loader');

// ── Router Factory ────────────────────────────────────────────────────────────

/**
 * Creates and returns an Express router with all scheduler endpoints.
 *
 * @param {import('../config/loader').ProxyConfig} configuration - Live config reference
 * @returns {import('express').Router}
 */
function createSchedulerRouter(configuration) {
  const router = express.Router();

  // ── GET /api/scheduler/status ────────────────────────────────────────────
  // Returns current scheduler runtime state (enabled, last run, next run, event count).

  router.get('/api/scheduler/status', (req, res) => {
    res.json(repoMonitor.getSchedulerStatus(configuration));
  });

  // ── GET /api/scheduler/config ────────────────────────────────────────────
  // Returns the non-sensitive scheduler configuration (repos, pattern, interval).
  // Does not expose credentials — only automation behaviour settings.

  router.get('/api/scheduler/config', (req, res) => {
    const repoMonitorConfig = (configuration.scheduler && configuration.scheduler.repoMonitor) || {};
    res.json({
      repoMonitor: {
        enabled:       !!repoMonitorConfig.enabled,
        repos:         repoMonitorConfig.repos         || [],
        branchPattern: repoMonitorConfig.branchPattern || 'feature/[A-Z]+-\\d+',
        intervalMin:   repoMonitorConfig.intervalMin   || 15,
        transitions:   repoMonitorConfig.transitions   || {},
      },
    });
  });

  // ── POST /api/scheduler/config ────────────────────────────────────────────
  // Updates the scheduler configuration and saves to disk immediately.

  router.post('/api/scheduler/config', (req, res) => {
    const incomingSchedulerConfig = req.body;

    if (!incomingSchedulerConfig || typeof incomingSchedulerConfig !== 'object') {
      return res.status(400).json({
        error:   'Invalid body',
        message: 'Request body must be a JSON object.',
      });
    }

    // Ensure the scheduler config object exists in the live config before mutating
    if (!configuration.scheduler) {
      configuration.scheduler = { repoMonitor: {} };
    }
    if (!configuration.scheduler.repoMonitor) {
      configuration.scheduler.repoMonitor = {};
    }

    repoMonitor.applySchedulerConfig(configuration, incomingSchedulerConfig);
    saveConfigToDisk(configuration);

    res.json({ success: true });
  });

  // ── POST /api/scheduler/run-now ────────────────────────────────────────────
  // Triggers an immediate scheduler run outside the normal interval.
  // Returns 409 if a run is already in progress (not currently tracked, so always 200).

  router.post('/api/scheduler/run-now', (req, res) => {
    if (!configuration.github || !configuration.github.pat) {
      return res.status(400).json({
        error:   'GitHub not configured',
        message: 'Configure a GitHub PAT before triggering the scheduler.',
      });
    }

    // Fire-and-forget — long-running poll must not block the HTTP response
    repoMonitor.runRepoMonitor(configuration).catch((runError) => {
      console.error('  [Scheduler] Manual run error: ' + runError.message);
    });

    res.json({ ok: true, message: 'Scheduler run started' });
  });

  // ── GET /api/scheduler/results ────────────────────────────────────────────
  // Returns the most recent scheduler result events from the in-memory ring buffer.

  router.get('/api/scheduler/results', (req, res) => {
    res.json(repoMonitor.getSchedulerResults());
  });

  // ── GET /api/scheduler/validate ───────────────────────────────────────────
  // Performs a read-only GitHub connectivity probe for each configured monitor
  // repo so operators can confirm "reachable with zero events" vs "not connected".
  router.get('/api/scheduler/validate', (req, res) => {
    repoMonitor.validateRepoMonitorConnectivity(configuration)
      .then((validationResult) => {
        res.json(validationResult);
      })
      .catch((validationError) => {
        res.status(500).json({
          error: 'Scheduler validation failed',
          message: validationError.message,
        });
      });
  });

  // ── GET /api/scheduler/github-debug ───────────────────────────────────────
  // Debug endpoint to test raw GitHub API connectivity with request/response logging.
  // Shows exact headers, PAT configuration, and GitHub's response for troubleshooting.
  router.get('/api/scheduler/github-debug', (req, res) => {
    const githubPat = configuration.github && configuration.github.pat;
    const githubBaseUrl = (configuration.github && configuration.github.baseUrl) || 'https://api.github.com';

    if (!githubPat) {
      return res.json({
        isConfigured: false,
        message: 'GitHub PAT not configured in Admin Hub',
        debugInfo: {
          pat: null,
          baseUrl: githubBaseUrl,
          authHeaderFormat: 'token <PAT>',
          expectedHeader: 'Authorization: token ghp_*** (masked for security)',
        },
      });
    }

    const maskedPat = githubPat.substring(0, 4) + '...' + githubPat.substring(githubPat.length - 4);

    repoMonitor.testGitHubConnectivity(configuration)
      .then((debugResult) => {
        res.json({
          isConfigured: true,
          timestamp: new Date().toISOString(),
          debugInfo: {
            pat: maskedPat,
            baseUrl: githubBaseUrl,
            authHeaderFormat: 'token <PAT>',
            sentHeader: 'Authorization: token ' + maskedPat,
          },
          probeResult: debugResult,
        });
      })
      .catch((debugError) => {
        res.status(500).json({
          error: 'GitHub debug probe failed',
          message: debugError.message,
          debugInfo: {
            pat: maskedPat,
            baseUrl: githubBaseUrl,
            authHeaderFormat: 'token <PAT>',
          },
        });
      });
  });

  return router;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = createSchedulerRouter;
