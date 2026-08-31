// src/routes/changeAutoSchedule.js — Admin Hub endpoints for the change auto-schedule sweeper:
// read/save its config, run a sweep immediately, and read what the recent sweeps actually did.
//
// No credentials are accepted or returned — every ServiceNow call goes through the relay bookmarklet
// under the signed-in user's own session.

'use strict';

const express = require('express');
const { saveConfigToDisk } = require('../config/loader');
const {
  runChangeAutoScheduleSweep,
  readRunHistory,
  DEFAULT_SWEEP_INTERVAL_MINUTES,
} = require('../services/changeAutoScheduleScheduler');

/** Longest sweep interval accepted, in minutes — a whole day between sweeps is not a schedule. */
const MAX_SWEEP_INTERVAL_MINUTES = 240;

/** Longest lead time accepted, in minutes: a day. Beyond that the planned start is not the trigger. */
const MAX_LEAD_TIME_MINUTES = 1440;

/** Clamps a posted number into a range, falling back when it is missing or unreadable. */
function readBoundedNumber(rawValue, fallbackValue, minimumValue, maximumValue) {
  const parsedValue = Math.floor(Number(rawValue));
  if (!Number.isFinite(parsedValue)) {
    return fallbackValue;
  }
  return Math.min(maximumValue, Math.max(minimumValue, parsedValue));
}

/** Sanitises the posted config block, so a malformed value can never reach the sweeper. */
function sanitiseChangeAutoScheduleConfig(rawBody) {
  const body = rawBody || {};
  return {
    isEnabled: !!body.isEnabled,
    isDryRun: !!body.isDryRun,
    intervalMin: readBoundedNumber(body.intervalMin, DEFAULT_SWEEP_INTERVAL_MINUTES, 1, MAX_SWEEP_INTERVAL_MINUTES),
    leadTimeMinutes: readBoundedNumber(body.leadTimeMinutes, 0, 0, MAX_LEAD_TIME_MINUTES),
  };
}

/** The block returned when the sweeper has never been configured. */
function buildDefaultConfigResponse() {
  return {
    isEnabled: false,
    isDryRun: false,
    intervalMin: DEFAULT_SWEEP_INTERVAL_MINUTES,
    leadTimeMinutes: 0,
  };
}

/**
 * Creates the change auto-schedule router.
 * @param {object} configuration - live server config reference (mutated in place on save)
 * @returns {import('express').Router}
 */
function createChangeAutoScheduleRouter(configuration) {
  const router = express.Router();

  // GET config — the sweeper's settings for the Admin Hub panel (defaults when unset).
  router.get('/api/change-auto-schedule/config', (req, res) => {
    const storedConfig = ((configuration.scheduler || {}).changeAutoSchedule) || {};
    return res.json({ ...buildDefaultConfigResponse(), ...storedConfig });
  });

  // POST config — sanitise and persist.
  router.post('/api/change-auto-schedule/config', (req, res) => {
    if (!configuration.scheduler) {
      configuration.scheduler = {};
    }
    const sanitisedConfig = sanitiseChangeAutoScheduleConfig(req.body);
    configuration.scheduler.changeAutoSchedule = sanitisedConfig;
    try {
      saveConfigToDisk(configuration);
    } catch (saveError) {
      const errorMessage = saveError instanceof Error ? saveError.message : String(saveError);
      return res.status(500).json({ ok: false, message: 'Config save failed: ' + errorMessage });
    }
    return res.json({ ok: true, config: sanitisedConfig });
  });

  // POST run-now — sweep immediately, whatever the schedule says. A sweep that could not act still
  // answers 200 carrying its reason, because "the relay is not registered" is an outcome to read,
  // not a server error.
  router.post('/api/change-auto-schedule/run-now', async (req, res) => {
    try {
      const runSummary = await runChangeAutoScheduleSweep(configuration);
      return res.json({ ok: true, run: runSummary });
    } catch (sweepError) {
      const errorMessage = sweepError instanceof Error ? sweepError.message : String(sweepError);
      return res.status(500).json({ ok: false, message: 'Sweep failed: ' + errorMessage });
    }
  });

  // GET runs — the recent sweeps, newest first, so the panel can prove what happened and when.
  router.get('/api/change-auto-schedule/runs', (req, res) => {
    return res.json({ runs: readRunHistory() });
  });

  return router;
}

module.exports = createChangeAutoScheduleRouter;
