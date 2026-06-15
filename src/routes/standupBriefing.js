// src/routes/standupBriefing.js — Pre-standup briefing configuration and on-demand run endpoints.
//
// Exposes the standup briefing team config, ART rollup config, and run-now
// endpoints used by the Admin Hub panel to generate briefings on demand.

'use strict';

const express = require('express');
const { saveConfigToDisk } = require('../config/loader');
const { runTeamBriefingNow, runArtRollupNow, runAdhocBriefing } = require('../services/standupBriefingScheduler');

/** Default schedule time applied when a team report has no scheduleTime set. */
const DEFAULT_TEAM_SCHEDULE_TIME = '08:45';

/** Default schedule time for the ART rollup. */
const DEFAULT_ART_SCHEDULE_TIME  = '09:00';

/**
 * Creates and returns the standup briefing router.
 *
 * @param {object} configuration - Live server config reference (mutated in place on save)
 * @returns {import('express').Router}
 */
function createStandupBriefingRouter(configuration) {
  const router = express.Router();

  /**
   * GET /api/standup/config
   * Returns the current standup briefing configuration (team reports and ART rollup).
   */
  router.get('/api/standup/config', (req, res) => {
    const standupConfig = ((configuration.scheduler || {}).standupBriefing) || {};
    return res.json({
      teamReports: standupConfig.teamReports || [],
      artRollup:   standupConfig.artRollup   || buildDefaultArtRollup(),
    });
  });

  /**
   * POST /api/standup/config
   * Saves the standup briefing config (teams and ART rollup) to disk.
   *
   * Body: { teamReports: TeamReportConfig[], artRollup: ArtRollupConfig }
   */
  router.post('/api/standup/config', (req, res) => {
    const { teamReports, artRollup } = req.body || {};

    if (!configuration.scheduler) {
      configuration.scheduler = {};
    }

    configuration.scheduler.standupBriefing = {
      teamReports: Array.isArray(teamReports) ? teamReports.map(sanitiseTeamReport) : [],
      artRollup:   sanitiseArtRollup(artRollup),
    };

    saveConfigToDisk(configuration);
    return res.json({ ok: true, config: configuration.scheduler.standupBriefing });
  });

  /**
   * POST /api/standup/run-team
   * Triggers an immediate standup briefing for a specific team.
   * Returns the plain-text briefingText so the Admin Hub can display and copy it.
   *
   * Body: { teamIndex: number }
   */
  router.post('/api/standup/run-team', async (req, res) => {
    const teamIndex = Number((req.body || {}).teamIndex);
    if (!Number.isInteger(teamIndex) || teamIndex < 0) {
      return res.status(400).json({ ok: false, message: 'teamIndex must be a non-negative integer.' });
    }
    try {
      const result = await runTeamBriefingNow(configuration, teamIndex);
      return res.json({ ok: true, ...result });
    } catch (deliveryError) {
      const errorMessage = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
      console.error('  ⚠ Standup run-team error:', errorMessage);
      return res.status(502).json({ ok: false, message: errorMessage });
    }
  });

  /**
   * POST /api/standup/run-rollup
   * Triggers an immediate ART standup rollup across all enabled teams.
   */
  router.post('/api/standup/run-rollup', async (req, res) => {
    try {
      const result = await runArtRollupNow(configuration);
      return res.json({ ok: true, ...result });
    } catch (deliveryError) {
      const errorMessage = deliveryError instanceof Error ? deliveryError.message : String(deliveryError);
      console.error('  ⚠ Standup run-rollup error:', errorMessage);
      return res.status(502).json({ ok: false, message: errorMessage });
    }
  });

  /**
   * POST /api/standup/run-adhoc
   * Generates a standup briefing for the given project keys and team name
   * without requiring a saved standup config entry or triggering any delivery.
   * Used by the Team Dashboard "Briefing" mode for on-demand in-app display.
   *
   * Body: { projectKeys: string[], teamName: string, daysBack?: number }
   */
  router.post('/api/standup/run-adhoc', async (req, res) => {
    const { projectKeys, teamName, daysBack } = req.body || {};

    if (!Array.isArray(projectKeys) || projectKeys.length === 0) {
      return res.status(400).json({ ok: false, message: 'projectKeys must be a non-empty array of strings.' });
    }
    const sanitisedProjectKeys = projectKeys.filter((key) => typeof key === 'string' && key.trim()).map((key) => key.trim());
    if (sanitisedProjectKeys.length === 0) {
      return res.status(400).json({ ok: false, message: 'projectKeys contained no valid strings.' });
    }

    const resolvedTeamName = typeof teamName === 'string' && teamName.trim() ? teamName.trim() : 'Team';
    const resolvedDaysBack = Number.isInteger(Number(daysBack)) && Number(daysBack) > 0 ? Number(daysBack) : 1;

    try {
      const result = await runAdhocBriefing(configuration, sanitisedProjectKeys, resolvedTeamName, resolvedDaysBack);
      return res.json({ ok: true, ...result });
    } catch (briefingError) {
      const errorMessage = briefingError instanceof Error ? briefingError.message : String(briefingError);
      console.error('  ⚠ Standup run-adhoc error:', errorMessage);
      return res.status(502).json({ ok: false, message: errorMessage });
    }
  });

  /**
   * POST /api/standup/test-webhook
   * Fires a test POST to the given triggerUrl so the user can verify webhook
   * plumbing without triggering a full Jira query.
   *
   * Body: { triggerUrl: string, triggerSecret?: string }
   */
  router.post('/api/standup/test-webhook', async (req, res) => {
    const { triggerUrl, triggerSecret } = req.body || {};
    if (!triggerUrl || typeof triggerUrl !== 'string' || !triggerUrl.startsWith('http')) {
      return res.status(400).json({ ok: false, message: 'triggerUrl must be a valid HTTP/HTTPS URL.' });
    }

    const { triggerWebhook } = require('../utils/httpClient');
    const sslVerify = configuration.sslVerify !== false;

    const testPayload = {
      teamName:   'Test',
      text:       '=== PRE-STANDUP BRIEFING TEST ===\nThis is a test delivery from NodeToolbox.',
      generatedAt: new Date().toISOString(),
      counts:     { statusChanges: 0, blockers: 0, defects: 0, risks: 0, completions: 0 },
      isTest:     true,
    };

    try {
      const result = await triggerWebhook(triggerUrl, testPayload, sslVerify, triggerSecret || undefined);
      const isSuccess = result.status >= 200 && result.status < 300;
      return res.json({ ok: isSuccess, httpStatus: result.status, body: result.body || '' });
    } catch (webhookError) {
      const errorMessage = webhookError instanceof Error ? webhookError.message : String(webhookError);
      console.error('  ⚠ Standup test-webhook error:', errorMessage);
      return res.status(502).json({ ok: false, message: errorMessage });
    }
  });

  return router;
}

// ── Sanitisation helpers ──

/**
 * Sanitises a team report config object from the request body.
 * Prevents storing unexpected fields or malformed values.
 *
 * @param {object} rawConfig
 * @returns {object}
 */
function sanitiseTeamReport(rawConfig) {
  return {
    teamName:           typeof rawConfig.teamName           === 'string' ? rawConfig.teamName.trim()           : '',
    projectKeys:        Array.isArray(rawConfig.projectKeys)
      ? rawConfig.projectKeys.filter((key) => typeof key === 'string' && key.trim()).map((key) => key.trim())
      : [],
    confluenceSpaceKey: typeof rawConfig.confluenceSpaceKey === 'string' ? rawConfig.confluenceSpaceKey.trim() : '',
    targetBlogUrl:      typeof rawConfig.targetBlogUrl      === 'string' ? rawConfig.targetBlogUrl.trim()      : '',
    triggerUrl:         typeof rawConfig.triggerUrl         === 'string' ? rawConfig.triggerUrl.trim()         : '',
    triggerSecret:      typeof rawConfig.triggerSecret      === 'string' ? rawConfig.triggerSecret.trim()      : '',
    scheduleTime:       typeof rawConfig.scheduleTime       === 'string' ? rawConfig.scheduleTime.trim()       : DEFAULT_TEAM_SCHEDULE_TIME,
    daysBack:           Number.isInteger(Number(rawConfig.daysBack)) && Number(rawConfig.daysBack) > 0
      ? Number(rawConfig.daysBack)
      : 1,
    isEnabled:          !!rawConfig.isEnabled,
  };
}

/**
 * Sanitises the ART rollup config from the request body.
 * Falls back to safe defaults when the config is absent or malformed.
 *
 * @param {object|null|undefined} rawConfig
 * @returns {object}
 */
function sanitiseArtRollup(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') return buildDefaultArtRollup();
  return {
    confluenceSpaceKey: typeof rawConfig.confluenceSpaceKey === 'string' ? rawConfig.confluenceSpaceKey.trim() : '',
    targetBlogUrl:      typeof rawConfig.targetBlogUrl      === 'string' ? rawConfig.targetBlogUrl.trim()      : '',
    triggerUrl:         typeof rawConfig.triggerUrl         === 'string' ? rawConfig.triggerUrl.trim()         : '',
    triggerSecret:      typeof rawConfig.triggerSecret      === 'string' ? rawConfig.triggerSecret.trim()      : '',
    scheduleTime:       typeof rawConfig.scheduleTime       === 'string' ? rawConfig.scheduleTime.trim()       : DEFAULT_ART_SCHEDULE_TIME,
    isEnabled:          !!rawConfig.isEnabled,
  };
}

/**
 * Returns a safe default ART rollup config with all fields empty and disabled.
 * @returns {object}
 */
function buildDefaultArtRollup() {
  return {
    confluenceSpaceKey: '',
    targetBlogUrl:      '',
    triggerUrl:         '',
    triggerSecret:      '',
    scheduleTime:       DEFAULT_ART_SCHEDULE_TIME,
    isEnabled:          false,
  };
}

module.exports = createStandupBriefingRouter;
