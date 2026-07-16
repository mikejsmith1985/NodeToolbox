// src/routes/monthlyDelivery.js — Admin Hub endpoints for the Monthly Delivery Report scheduler
// (feature 018): read/save the scheduler config (snapshotted teams + fire time), trigger an immediate
// whole-run, and read the persisted last run (including the prompt artifact). No credentials are ever
// accepted or returned — runs reuse configuration.jira.

'use strict';

const express = require('express');
const { saveConfigToDisk } = require('../config/loader');

/** Fallback fire time when the posted value is missing or malformed. */
const DEFAULT_SCHEDULE_TIME = '08:00';
/** Default "Feature Link" custom field id, matching the client's featureLink.ts default. */
const DEFAULT_FEATURE_LINK_FIELD_ID = 'customfield_10108';
/** House HH:MM validation pattern, shared shape with the sibling scheduler routes. */
const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Trims a value to a string, or '' when it is not a string. */
function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** Sanitises one snapshotted team, keeping only the fields the scheduler needs. */
function sanitiseTeamSnapshot(rawTeam) {
  return {
    teamName: toTrimmedString(rawTeam && rawTeam.teamName),
    projectKey: toTrimmedString(rawTeam && rawTeam.projectKey),
    boardId: toTrimmedString(rawTeam && rawTeam.boardId),
  };
}

/** Sanitises the whole posted config block; teams without a project key are unqueryable and dropped. */
function sanitiseMonthlyDeliveryConfig(rawBody) {
  const scheduleTime = toTrimmedString(rawBody && rawBody.scheduleTime);
  const rawTeams = Array.isArray(rawBody && rawBody.teams) ? rawBody.teams : [];
  return {
    isEnabled: !!(rawBody && rawBody.isEnabled),
    scheduleTime: SCHEDULE_TIME_PATTERN.test(scheduleTime) ? scheduleTime : DEFAULT_SCHEDULE_TIME,
    featureLinkFieldId: toTrimmedString(rawBody && rawBody.featureLinkFieldId) || DEFAULT_FEATURE_LINK_FIELD_ID,
    teams: rawTeams.map(sanitiseTeamSnapshot).filter((team) => team.projectKey !== ''),
  };
}

/** The config block returned when the scheduler was never configured. */
function buildDefaultConfigResponse() {
  return {
    isEnabled: false,
    scheduleTime: DEFAULT_SCHEDULE_TIME,
    featureLinkFieldId: DEFAULT_FEATURE_LINK_FIELD_ID,
    teams: [],
  };
}

/**
 * Creates the Monthly Delivery Report router.
 * @param {object} configuration - live server config reference (mutated in place on save)
 * @returns {import('express').Router}
 */
function createMonthlyDeliveryRouter(configuration) {
  const router = express.Router();

  // GET config — the scheduler block for the Admin Hub panel (defaults when unset).
  router.get('/api/monthly-delivery/config', (req, res) => {
    const storedConfig = ((configuration.scheduler || {}).monthlyDelivery) || {};
    return res.json({ ...buildDefaultConfigResponse(), ...storedConfig });
  });

  // POST config — sanitise and persist. Never accepts credentials.
  router.post('/api/monthly-delivery/config', (req, res) => {
    if (!configuration.scheduler) {
      configuration.scheduler = {};
    }
    const sanitisedConfig = sanitiseMonthlyDeliveryConfig(req.body || {});
    configuration.scheduler.monthlyDelivery = sanitisedConfig;
    try {
      saveConfigToDisk(configuration);
    } catch (saveError) {
      const errorMessage = saveError instanceof Error ? saveError.message : String(saveError);
      return res.status(500).json({ ok: false, message: 'Config save failed: ' + errorMessage });
    }
    return res.json({ ok: true, teams: sanitisedConfig.teams.length });
  });

  return router;
}

module.exports = createMonthlyDeliveryRouter;
