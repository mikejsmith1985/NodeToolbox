// src/routes/piReviewScheduler.js — Admin Hub endpoints for the PI Review scheduler (feature 015):
// read/save the per-team schedule config, trigger an immediate run, and read last-run status.
// No credentials are ever accepted or returned — a run reuses configuration.jira/confluence.

'use strict';

const express = require('express');
const { saveConfigToDisk } = require('../config/loader');
const { runPiReviewTeamNow, readLastRunResults } = require('../services/piReviewScheduler');

const DEFAULT_SCHEDULE_TIME = '06:00';
const DEFAULT_PI_FIELD_ID = 'customfield_10301';
const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Trims a value to a string, or '' when it is not a string. */
function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Sanitises one configured PI Review page ({ pageUrlOrId, piName }). */
function sanitisePage(rawPage) {
  return {
    pageUrlOrId: toTrimmedString(rawPage && rawPage.pageUrlOrId),
    piName: toTrimmedString(rawPage && rawPage.piName),
  };
}

/** Sanitises one team schedule from the request body, dropping unexpected fields. */
function sanitiseTeam(rawTeam) {
  const scheduleTime = toTrimmedString(rawTeam && rawTeam.scheduleTime);
  return {
    teamName: toTrimmedString(rawTeam && rawTeam.teamName),
    isEnabled: !!(rawTeam && rawTeam.isEnabled),
    scheduleTime: SCHEDULE_TIME_PATTERN.test(scheduleTime) ? scheduleTime : DEFAULT_SCHEDULE_TIME,
    productOwnerAssignee: toTrimmedString(rawTeam && rawTeam.productOwnerAssignee),
    piFieldId: toTrimmedString(rawTeam && rawTeam.piFieldId) || DEFAULT_PI_FIELD_ID,
    dependencyLinkTypes: Array.isArray(rawTeam && rawTeam.dependencyLinkTypes)
      ? rawTeam.dependencyLinkTypes.filter((name) => typeof name === 'string' && name.trim()).map((name) => name.trim())
      : [],
    pages: Array.isArray(rawTeam && rawTeam.pages)
      ? rawTeam.pages.map(sanitisePage).filter((page) => page.pageUrlOrId !== '')
      : [],
  };
}

/**
 * Creates the PI Review scheduler router.
 * @param {object} configuration - live server config reference (mutated in place on save)
 * @returns {import('express').Router}
 */
function createPiReviewSchedulerRouter(configuration) {
  const router = express.Router();

  // GET config — the per-team schedules for the Admin Hub panel.
  router.get('/api/pi-review-scheduler/config', (req, res) => {
    const piReviewConfig = ((configuration.scheduler || {}).piReview) || {};
    return res.json({ teams: piReviewConfig.teams || [] });
  });

  // POST config — sanitise and persist. Never accepts credentials.
  router.post('/api/pi-review-scheduler/config', (req, res) => {
    const rawTeams = (req.body || {}).teams;
    if (!configuration.scheduler) {
      configuration.scheduler = {};
    }
    const teams = Array.isArray(rawTeams) ? rawTeams.map(sanitiseTeam) : [];
    configuration.scheduler.piReview = { teams };
    saveConfigToDisk(configuration);
    return res.json({ ok: true, teams });
  });

  // POST run-now — refresh one team's pages immediately; returns per-page results.
  router.post('/api/pi-review-scheduler/run-now', async (req, res) => {
    const teamIndex = Number((req.body || {}).teamIndex);
    if (!Number.isInteger(teamIndex) || teamIndex < 0) {
      return res.status(400).json({ ok: false, message: 'teamIndex must be a non-negative integer.' });
    }
    try {
      const outcome = await runPiReviewTeamNow(configuration, teamIndex);
      if (!outcome || outcome.results.length === 0 && outcome.ok === false) {
        return res.status(404).json({ ok: false, message: 'Unknown team or no pages configured.', results: [] });
      }
      return res.json({ ok: outcome.ok, results: outcome.results });
    } catch (runError) {
      const errorMessage = runError instanceof Error ? runError.message : String(runError);
      console.error('  ⚠ PI Review run-now error:', errorMessage);
      return res.status(502).json({ ok: false, message: errorMessage });
    }
  });

  // GET status — the persisted last-run summary per team (survives restarts, FR-019).
  router.get('/api/pi-review-scheduler/status', (req, res) => {
    return res.json({ teams: readLastRunResults() });
  });

  return router;
}

module.exports = createPiReviewSchedulerRouter;
