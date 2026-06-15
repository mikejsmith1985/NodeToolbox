// src/routes/notifications.js — Notification configuration and on-demand delivery endpoints.
//
// Manages the multi-team Scope Change scheduler config and the Feature Change
// scheduler config, and exposes run-now endpoints for Admin Hub testing without
// waiting for the scheduled time.

'use strict';

const express = require('express');
const { saveConfigToDisk } = require('../config/loader');
const { runTeamReportNow, runArtRollupNow } = require('../services/scopeChangeScheduler');
const { runFeatureReportNow, runFeatureArtRollupNow } = require('../services/featureChangeScheduler');

/** Default schedule time applied when a feature change report has no scheduleTime set. */
const DEFAULT_FEATURE_SCHEDULE_TIME = '09:00';

/**
 * Creates and returns the notifications router.
 *
 * @param {object} configuration - Live server config reference (mutated in place on save)
 * @returns {import('express').Router}
 */
function createNotificationsRouter(configuration) {
  const router = express.Router();

  /**
   * GET /api/notifications/config
   * Returns the current scope change delivery configuration.
   */
  router.get('/api/notifications/config', (req, res) => {
    const scopeChangeConfig = ((configuration.scheduler || {}).scopeChange) || {};
    return res.json({
      teamReports: scopeChangeConfig.teamReports || [],
      artRollup:   scopeChangeConfig.artRollup   || buildDefaultArtRollup(),
    });
  });

  /**
   * POST /api/notifications/config
   * Saves the full multi-team scope change config to in-memory configuration and disk.
   *
   * Body: { teamReports: TeamReportConfig[], artRollup: ArtRollupConfig }
   */
  router.post('/api/notifications/config', (req, res) => {
    const { teamReports, artRollup } = req.body || {};

    if (!configuration.scheduler) {
      configuration.scheduler = {};
    }

    configuration.scheduler.scopeChange = {
      teamReports: Array.isArray(teamReports) ? teamReports.map(sanitiseTeamReport) : [],
      artRollup:   sanitiseArtRollup(artRollup),
    };

    saveConfigToDisk(configuration);
    return res.json({ ok: true, config: configuration.scheduler.scopeChange });
  });

  /**
   * POST /api/notifications/run-team
   * Triggers an immediate delivery for a specific team report.
   *
   * Body: { teamIndex: number }
   */
  router.post('/api/notifications/run-team', async (req, res) => {
    const teamIndex = Number((req.body || {}).teamIndex);
    if (!Number.isInteger(teamIndex) || teamIndex < 0) {
      return res.status(400).json({ ok: false, message: 'teamIndex must be a non-negative integer.' });
    }
    try {
      const result = await runTeamReportNow(configuration, teamIndex);
      return res.json({ ok: true, ...result });
    } catch (deliveryError) {
      const errorMessage = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
      console.error('  ⚠ Notifications run-team error:', errorMessage);
      return res.status(502).json({ ok: false, message: errorMessage });
    }
  });

  /**
   * POST /api/notifications/test-webhook
   * Fires a test POST to the given triggerUrl so the user can verify the
   * webhook plumbing without needing a live Jira delivery to be triggered.
   *
   * Body: { triggerUrl: string }
   */
  router.post('/api/notifications/test-webhook', async (req, res) => {
    const { triggerUrl, triggerSecret } = req.body || {};
    if (!triggerUrl || typeof triggerUrl !== 'string' || !triggerUrl.startsWith('http')) {
      return res.status(400).json({ ok: false, message: 'triggerUrl must be a valid HTTP/HTTPS URL.' });
    }

    const { triggerWebhook } = require('../utils/httpClient');
    const sslVerify = configuration.sslVerify !== false;

    const testPayload = {
      teamName:           'Test',
      projectKey:         'TEST',
      postUrl:            '(test — no report generated)',
      generatedAt:        new Date().toISOString(),
      releaseChangeCount: 0,
      sprintChangeCount:  0,
      isTest:             true,
    };

    try {
      const result = await triggerWebhook(triggerUrl, testPayload, sslVerify, triggerSecret || undefined);
      const isSuccess = result.status >= 200 && result.status < 300;
      return res.json({
        ok:         isSuccess,
        httpStatus: result.status,
        body:       result.body || '',
      });
    } catch (webhookError) {
      const message = webhookError instanceof Error ? webhookError.message : String(webhookError);
      console.error('  ⚠ Notifications test-webhook error:', message);
      return res.status(502).json({ ok: false, message });
    }
  });

  /**
   * POST /api/notifications/run-rollup
   * Triggers an immediate ART rollup delivery.
   */
  router.post('/api/notifications/run-rollup', async (req, res) => {
    try {
      const result = await runArtRollupNow(configuration);
      return res.json({ ok: true, ...result });
    } catch (deliveryError) {
      const errorMessage = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
      console.error('  ⚠ Notifications run-rollup error:', errorMessage);
      return res.status(502).json({ ok: false, message: errorMessage });
    }
  });

  // ── Feature Change endpoints ──

  /**
   * GET /api/notifications/feature-change-config
   * Returns the current feature change delivery configuration.
   */
  router.get('/api/notifications/feature-change-config', (req, res) => {
    const featureChangeConfig = ((configuration.scheduler || {}).featureChange) || {};
    return res.json({
      reports:   featureChangeConfig.reports   || [],
      artRollup: featureChangeConfig.artRollup || {},
    });
  });

  /**
   * POST /api/notifications/feature-change-config
   * Saves the full feature change report list to in-memory configuration and disk.
   *
   * Body: { reports: FeatureChangeReportConfig[] }
   */
  router.post('/api/notifications/feature-change-config', (req, res) => {
    const { reports, artRollup } = req.body || {};

    if (!configuration.scheduler) {
      configuration.scheduler = {};
    }

    // Preserve the existing artRollup if the request doesn't include it (backward compat).
    const existingRollup = ((configuration.scheduler.featureChange || {}).artRollup) || {};
    configuration.scheduler.featureChange = {
      reports:   Array.isArray(reports) ? reports.map(sanitiseFeatureReport) : [],
      artRollup: artRollup ? sanitiseFeatureArtRollup(artRollup) : existingRollup,
    };

    saveConfigToDisk(configuration);
    return res.json({ ok: true, config: configuration.scheduler.featureChange });
  });

  /**
   * POST /api/notifications/run-feature
   * Triggers an immediate delivery for a specific feature change report.
   *
   * Body: { reportIndex: number }
   */
  router.post('/api/notifications/run-feature', async (req, res) => {
    const reportIndex = Number((req.body || {}).reportIndex);
    if (!Number.isInteger(reportIndex) || reportIndex < 0) {
      return res.status(400).json({ ok: false, message: 'reportIndex must be a non-negative integer.' });
    }
    try {
      const result = await runFeatureReportNow(configuration, reportIndex);
      return res.json({ ok: true, ...result });
    } catch (deliveryError) {
      const errorMessage = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
      console.error('  ⚠ Notifications run-feature error:', errorMessage);
      return res.status(502).json({ ok: false, message: errorMessage });
    }
  });

  /**
   * POST /api/notifications/run-feature-rollup
   * Triggers an immediate ART Feature Change Rollup delivery (all teams combined).
   */
  router.post('/api/notifications/run-feature-rollup', async (req, res) => {
    try {
      const result = await runFeatureArtRollupNow(configuration);
      return res.json({ ok: true, ...result });
    } catch (deliveryError) {
      const errorMessage = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
      console.error('  ⚠ Notifications run-feature-rollup error:', errorMessage);
      return res.status(502).json({ ok: false, message: errorMessage });
    }
  });

  return router;
}

// ── Sanitisation helpers ──

/**
 * Sanitises a team report config object from the request body.
 * @param {object} raw
 * @returns {object}
 */
function sanitiseTeamReport(raw) {
  return {
    teamName:           typeof raw.teamName           === 'string' ? raw.teamName.trim()           : '',
    projectKey:         typeof raw.projectKey         === 'string' ? raw.projectKey.trim()         : '',
    confluenceSpaceKey: typeof raw.confluenceSpaceKey === 'string' ? raw.confluenceSpaceKey.trim() : '',
    targetBlogUrl:      typeof raw.targetBlogUrl      === 'string' ? raw.targetBlogUrl.trim()      : '',
    triggerUrl:         typeof raw.triggerUrl         === 'string' ? raw.triggerUrl.trim()         : '',
    triggerSecret:      typeof raw.triggerSecret      === 'string' ? raw.triggerSecret.trim()      : '',
    scheduleTime:       typeof raw.scheduleTime       === 'string' ? raw.scheduleTime.trim()       : '11:00',
    isEnabled:          !!raw.isEnabled,
  };
}

/**
 * Sanitises a feature change report config object from the request body.
 * Mirrors the shape of sanitiseTeamReport — same fields, same defaults —
 * because the feature change config entry has an identical structure.
 *
 * @param {object} raw
 * @returns {object}
 */
function sanitiseFeatureReport(raw) {
  return {
    teamName:           typeof raw.teamName           === 'string' ? raw.teamName.trim()           : '',
    projectKey:         typeof raw.projectKey         === 'string' ? raw.projectKey.trim()         : '',
    jiraLabel:          typeof raw.jiraLabel          === 'string' ? raw.jiraLabel.trim()          : '',
    confluenceSpaceKey: typeof raw.confluenceSpaceKey === 'string' ? raw.confluenceSpaceKey.trim() : '',
    targetBlogUrl:      typeof raw.targetBlogUrl      === 'string' ? raw.targetBlogUrl.trim()      : '',
    triggerUrl:         typeof raw.triggerUrl         === 'string' ? raw.triggerUrl.trim()         : '',
    triggerSecret:      typeof raw.triggerSecret      === 'string' ? raw.triggerSecret.trim()      : '',
    scheduleTime:       typeof raw.scheduleTime       === 'string' ? raw.scheduleTime.trim()       : DEFAULT_FEATURE_SCHEDULE_TIME,
    isEnabled:          !!raw.isEnabled,
  };
}

/**
 * Sanitises the ART rollup config object from the request body.
 * @param {object|null|undefined} raw
 * @returns {object}
 */
function sanitiseArtRollup(raw) {
  if (!raw || typeof raw !== 'object') return buildDefaultArtRollup();
  return {
    projectKeys:        Array.isArray(raw.projectKeys) ? raw.projectKeys.filter((k) => typeof k === 'string' && k.trim()) : [],
    teamNames:          Array.isArray(raw.teamNames)   ? raw.teamNames                                                    : [],
    confluenceSpaceKey: typeof raw.confluenceSpaceKey === 'string' ? raw.confluenceSpaceKey.trim() : '',
    targetBlogUrl:      typeof raw.targetBlogUrl      === 'string' ? raw.targetBlogUrl.trim()      : '',
    triggerUrl:         typeof raw.triggerUrl         === 'string' ? raw.triggerUrl.trim()         : '',
    triggerSecret:      typeof raw.triggerSecret      === 'string' ? raw.triggerSecret.trim()      : '',
    scheduleTime:       typeof raw.scheduleTime       === 'string' ? raw.scheduleTime.trim()       : '09:00',
    isEnabled:          !!raw.isEnabled,
  };
}

/**
 * Returns a safe default ART rollup config.
 * @returns {object}
 */
function buildDefaultArtRollup() {
  return {
    projectKeys:        [],
    teamNames:          [],
    confluenceSpaceKey: '',
    targetBlogUrl:      '',
    triggerUrl:         '',
    triggerSecret:      '',
    scheduleTime:       '09:00',
    isEnabled:          false,
  };
}

/**
 * Sanitises the Feature Change ART Rollup config from the request body.
 * The rollup has no per-team fields — it derives team labels from the per-team reports at run time.
 *
 * @param {object|null|undefined} raw
 * @returns {object}
 */
function sanitiseFeatureArtRollup(raw) {
  if (!raw || typeof raw !== 'object') {
    return { confluenceSpaceKey: '', targetBlogUrl: '', triggerUrl: '', triggerSecret: '', scheduleTime: DEFAULT_FEATURE_SCHEDULE_TIME, isEnabled: false };
  }
  return {
    confluenceSpaceKey: typeof raw.confluenceSpaceKey === 'string' ? raw.confluenceSpaceKey.trim() : '',
    targetBlogUrl:      typeof raw.targetBlogUrl      === 'string' ? raw.targetBlogUrl.trim()      : '',
    triggerUrl:         typeof raw.triggerUrl         === 'string' ? raw.triggerUrl.trim()         : '',
    triggerSecret:      typeof raw.triggerSecret      === 'string' ? raw.triggerSecret.trim()      : '',
    scheduleTime:       typeof raw.scheduleTime       === 'string' ? raw.scheduleTime.trim()       : DEFAULT_FEATURE_SCHEDULE_TIME,
    isEnabled:          !!raw.isEnabled,
  };
}

module.exports = createNotificationsRouter;
