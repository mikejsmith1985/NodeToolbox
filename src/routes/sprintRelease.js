// src/routes/sprintRelease.js — Express router for the Sprint–Release Workflow API.
//
// Exposes five endpoints used by the Admin Hub and the run-now trigger:
//   GET  /api/sprint-release/config           → current team workflow profile
//   POST /api/sprint-release/config           → validate and save profile
//   GET  /api/sprint-release/dor-violations   → DoR violations for active sprint
//   POST /api/sprint-release/run-now          → trigger immediate poll cycle
//   GET  /api/sprint-release/status           → full runtime state
//
// Webhook secrets in the team profile are stripped from all GET responses.

'use strict';

const express = require('express');
const { saveConfigToDisk } = require('../config/loader');
const { makeJiraApiRequest } = require('../utils/httpClient');
const { findSprintByName, findDorViolations, postDorViolationComment } = require('../services/sprintReleaseOrchestrator');
const { triggerPollCycleNow, getSprintReleaseStatus } = require('../services/sprintReleaseScheduler');

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default team profile used when no profiles have been configured yet. */
const DEFAULT_TEAM_PROFILE = {
  teamProfileId:            'default',
  isEnabled:                true,
  featureProjectKey:        '',
  devProjectKey:            '',
  qeProjectKey:             '',
  btProjectKey:             '',
  boardId:                  0,
  subStatusFieldId:         'customfield_10201',
  qeHandoffSubStatusValue:  'Ready for System Integration Test',
  btHandoffSubStatusValue:  'Ready for UAT',
  configOnlyLabel:          'no-testing-required',
  defectIntakeLabel:        'defect-intake',
  freezeWindowBusinessDays: 13,
  doneTransitionName:       'Done',
  dorQeFieldId:             '',
  dorBtFieldId:             '',
  handoffDelivery:          { webhookUrl: '', webhookSecret: '' },
  pollIntervalMinutes:      5,
};

/** Required project key fields that must be validated against Jira before saving. */
const REQUIRED_PROJECT_KEY_FIELDS = ['featureProjectKey', 'devProjectKey', 'qeProjectKey', 'btProjectKey'];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns the first team profile from the config, falling back to the default shape.
 * Strips the handoffDelivery.webhookSecret from the returned object.
 *
 * @param {object} configuration - Live server config
 * @returns {object} Safe (secret-stripped) team profile
 */
function getSafeTeamProfile(configuration) {
  const profiles = (configuration.sprintRelease || {}).teamProfiles || [];
  const activeProfile = profiles[0] || { ...DEFAULT_TEAM_PROFILE };

  // Deep-copy and strip webhook secret before returning.
  const safeProfile = JSON.parse(JSON.stringify(activeProfile));
  if (safeProfile.handoffDelivery) {
    safeProfile.handoffDelivery.webhookSecret = '***';
  }
  return safeProfile;
}

/**
 * Validates that a given Jira project key exists in the connected Jira instance.
 *
 * @param {string} projectKey - The Jira project key to validate
 * @param {object} jiraConfig - Jira service config
 * @param {boolean} isTlsVerified - TLS verification flag
 * @returns {Promise<boolean>} True when the project exists (HTTP 200)
 */
async function isValidJiraProjectKey(projectKey, jiraConfig, isTlsVerified) {
  try {
    const projectResponse = await makeJiraApiRequest(
      'GET',
      '/rest/api/2/project/' + encodeURIComponent(projectKey),
      null, jiraConfig, isTlsVerified
    );
    return projectResponse.status === 200;
  } catch (_validationError) {
    return false;
  }
}

/**
 * Validates that a given board ID exists in the Jira Agile API.
 *
 * @param {number} boardId - The board ID to validate
 * @param {object} jiraConfig - Jira service config
 * @param {boolean} isTlsVerified - TLS verification flag
 * @returns {Promise<boolean>} True when the board exists (HTTP 200)
 */
async function isValidJiraBoardId(boardId, jiraConfig, isTlsVerified) {
  try {
    const boardResponse = await makeJiraApiRequest(
      'GET',
      '/rest/agile/1.0/board/' + boardId,
      null, jiraConfig, isTlsVerified
    );
    return boardResponse.status === 200;
  } catch (_boardValidationError) {
    return false;
  }
}

// ── Router factory ────────────────────────────────────────────────────────────

/**
 * Creates and returns an Express router for the Sprint–Release Workflow API.
 * The `configuration` object is mutated in place on POST /config so that
 * in-process callers (the scheduler) see the update without a server restart.
 *
 * @param {object} configuration - Live server configuration object
 * @returns {express.Router}
 */
function createSprintReleaseRouter(configuration) {
  const router = express.Router();

  // ── GET /api/sprint-release/config ────────────────────────────────────────

  router.get('/api/sprint-release/config', (req, res) => {
    return res.json(getSafeTeamProfile(configuration));
  });

  // ── POST /api/sprint-release/config ──────────────────────────────────────

  router.post('/api/sprint-release/config', async (req, res) => {
    const submittedProfile = req.body || {};
    const jiraConfig = configuration.jira || {};
    const isTlsVerified = configuration.sslVerify !== false;

    // Validate all four required project keys against live Jira.
    const validatedProjectKeys = [];
    for (const projectKeyField of REQUIRED_PROJECT_KEY_FIELDS) {
      const projectKey = submittedProfile[projectKeyField];
      if (!projectKey) {
        return res.status(400).json({ error: 'Required field "' + projectKeyField + '" is missing.' });
      }

      const isValid = await isValidJiraProjectKey(projectKey, jiraConfig, isTlsVerified);
      if (!isValid) {
        return res.status(400).json({ error: 'Project key ' + projectKey + ' not found in Jira' });
      }
      validatedProjectKeys.push(projectKey);
    }

    // Validate boardId against the Jira Agile API.
    const boardId = parseInt(submittedProfile.boardId, 10);
    if (!boardId || boardId <= 0) {
      return res.status(400).json({ error: '"boardId" must be a positive integer.' });
    }
    const isBoardValid = await isValidJiraBoardId(boardId, jiraConfig, isTlsVerified);
    if (!isBoardValid) {
      return res.status(400).json({ error: 'Board ID ' + boardId + ' not found in Jira Agile' });
    }

    // Merge submitted values over defaults, preserving the existing webhookSecret
    // if the submitted value is the masked placeholder.
    const existingProfile = ((configuration.sprintRelease || {}).teamProfiles || [])[0] || {};
    const existingWebhookSecret = (existingProfile.handoffDelivery || {}).webhookSecret || '';
    const submittedWebhookSecret = (submittedProfile.handoffDelivery || {}).webhookSecret;
    const resolvedWebhookSecret = (submittedWebhookSecret === '***' || !submittedWebhookSecret)
      ? existingWebhookSecret
      : submittedWebhookSecret;

    const updatedProfile = {
      ...DEFAULT_TEAM_PROFILE,
      ...existingProfile,
      ...submittedProfile,
      boardId,
      handoffDelivery: {
        webhookUrl:    (submittedProfile.handoffDelivery || {}).webhookUrl || '',
        webhookSecret: resolvedWebhookSecret,
      },
    };

    // Mutate the live config so the scheduler picks up the new profile immediately.
    if (!configuration.sprintRelease) {
      configuration.sprintRelease = { teamProfiles: [] };
    }
    configuration.sprintRelease.teamProfiles = [updatedProfile];
    saveConfigToDisk(configuration);

    return res.json({ saved: true, validatedProjects: validatedProjectKeys });
  });

  // ── GET /api/sprint-release/dor-violations ────────────────────────────────

  router.get('/api/sprint-release/dor-violations', async (req, res) => {
    const jiraConfig = configuration.jira || {};
    const isTlsVerified = configuration.sslVerify !== false;
    const teamProfile = ((configuration.sprintRelease || {}).teamProfiles || [])[0];

    if (!teamProfile) {
      return res.status(400).json({ error: 'Sprint-release workflow not configured. POST /api/sprint-release/config first.' });
    }

    // Resolve the sprint to scan — caller can pass ?sprintId= to override.
    let sprintId = req.query.sprintId ? parseInt(req.query.sprintId, 10) : null;
    let sprintName = null;

    if (!sprintId) {
      const activeSprint = await findSprintByName('', teamProfile.boardId, jiraConfig, isTlsVerified)
        .catch(() => null);
      if (!activeSprint) {
        return res.status(404).json({ error: 'No active sprint found on board ' + teamProfile.boardId + '.' });
      }
      sprintId = activeSprint.id;
      sprintName = activeSprint.name;
    }

    const fieldList = [
      'summary', 'assignee', 'labels',
      teamProfile.dorQeFieldId,
      teamProfile.dorBtFieldId,
    ].filter(Boolean).join(',');

    const sprintIssuesPath = '/rest/agile/1.0/sprint/' + sprintId
      + '/issue?fields=' + encodeURIComponent(fieldList)
      + '&maxResults=100';

    let sprintIssues;
    try {
      const sprintResponse = await makeJiraApiRequest('GET', sprintIssuesPath, null, jiraConfig, isTlsVerified);
      sprintIssues = (sprintResponse.body && sprintResponse.body.issues) || [];
    } catch (sprintError) {
      return res.status(503).json({ error: 'Jira sprint issues fetch failed.', detail: sprintError.message });
    }

    const violations = findDorViolations(sprintIssues, teamProfile);

    // Post a comment on each violating issue (advisory only — non-blocking).
    for (const violation of violations) {
      await postDorViolationComment(violation.issueKey, violation.missingFields, jiraConfig, isTlsVerified)
        .catch(() => {});
    }

    return res.json({
      sprintId,
      sprintName,
      checkedAt:      new Date().toISOString(),
      violations,
      totalIssues:    sprintIssues.length,
      violationCount: violations.length,
    });
  });

  // ── POST /api/sprint-release/run-now ─────────────────────────────────────

  router.post('/api/sprint-release/run-now', async (req, res) => {
    const teamProfile = ((configuration.sprintRelease || {}).teamProfiles || [])[0];
    const teamProfileId = (teamProfile && teamProfile.teamProfileId) || 'default';

    // Fire and forget — the poll cycle is async; respond immediately.
    triggerPollCycleNow(configuration).catch((cycleError) => {
      console.error('[SprintRelease] run-now poll cycle threw: ' + cycleError.message);
    });

    return res.json({
      triggered:     true,
      teamProfileId,
      message:       'Poll cycle started. Check /api/sprint-release/status for results.',
    });
  });

  // ── GET /api/sprint-release/status ───────────────────────────────────────

  router.get('/api/sprint-release/status', (req, res) => {
    return res.json(getSprintReleaseStatus(configuration));
  });

  return router;
}

module.exports = createSprintReleaseRouter;
