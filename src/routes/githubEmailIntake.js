// src/routes/githubEmailIntake.js — Admin Hub endpoints for the GitHub Email Intake scheduler:
// read/save the config (drop folder, mode, transitions, filters), run the intake immediately, preview
// a dry-run parse without touching Jira or archiving, and read the persisted last run. No credentials
// are ever accepted or returned — runs reuse configuration.jira.

'use strict';

const express = require('express');
const fs = require('fs');
const { makeJiraApiRequest } = require('../utils/httpClient');
const { saveConfigToDisk } = require('../config/loader');
const {
  runGithubEmailIntakeNow,
  isGithubEmailIntakeRunInProgress,
  readLastRunResult,
} = require('../services/githubEmailIntakeScheduler');

const DEFAULT_SCHEDULE_TIME = '07:00';
const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_MODES = ['dryRun', 'commentOnly', 'full'];

function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Light shape-sanitise for AI-authored custom rules. Keeps only well-formed objects and coerces field
 * types; the engine does full validation (regex compilability, at-least-one-matcher) at classification
 * time, so a bad rule is simply ignored rather than able to break the run.
 */
function sanitiseCustomRules(rawRules) {
  if (!Array.isArray(rawRules)) {
    return [];
  }
  return rawRules
    .filter((rule) => rule && typeof rule === 'object')
    .map((rule) => {
      const cleaned = { id: toTrimmedString(rule.id), eventType: toTrimmedString(rule.eventType) };
      if (Array.isArray(rule.reasonHeaderIn)) {
        cleaned.reasonHeaderIn = rule.reasonHeaderIn.map(toTrimmedString).filter((value) => value !== '');
      }
      if (typeof rule.subjectPattern === 'string' && rule.subjectPattern !== '') cleaned.subjectPattern = rule.subjectPattern;
      if (typeof rule.bodyPattern === 'string' && rule.bodyPattern !== '') cleaned.bodyPattern = rule.bodyPattern;
      if (rule.requiresPrNumber === true) cleaned.requiresPrNumber = true;
      return cleaned;
    })
    .filter((rule) => rule.id !== '' && rule.eventType !== '');
}

/** Sanitises the posted config block, coercing every field to a safe shape. Never accepts credentials. */
function sanitiseConfig(rawBody, previousSeenPrs) {
  const scheduleTime = toTrimmedString(rawBody && rawBody.scheduleTime);
  const mode = VALID_MODES.includes(rawBody && rawBody.mode) ? rawBody.mode : 'dryRun';
  const rawExtensions = Array.isArray(rawBody && rawBody.fileExtensions) ? rawBody.fileExtensions : ['.eml', '.txt'];
  const rawProjectKeys = Array.isArray(rawBody && rawBody.jiraProjectKeys) ? rawBody.jiraProjectKeys : [];
  const rawTransitions = (rawBody && rawBody.transitions) || {};
  return {
    isEnabled: !!(rawBody && rawBody.isEnabled),
    mode,
    scheduleTime: SCHEDULE_TIME_PATTERN.test(scheduleTime) ? scheduleTime : DEFAULT_SCHEDULE_TIME,
    intervalMin: Number.isFinite(Number(rawBody && rawBody.intervalMin)) ? Math.max(0, Number(rawBody.intervalMin)) : 0,
    dropFolder: toTrimmedString(rawBody && rawBody.dropFolder),
    processedArchiveFolder: toTrimmedString(rawBody && rawBody.processedArchiveFolder),
    errorFolder: toTrimmedString(rawBody && rawBody.errorFolder),
    fileExtensions: rawExtensions.map(toTrimmedString).filter((extension) => extension !== ''),
    jiraProjectKeys: rawProjectKeys.map((key) => toTrimmedString(key).toUpperCase()).filter((key) => key !== ''),
    transitions: {
      branchCreated: toTrimmedString(rawTransitions.branchCreated),
      commitPushed:  toTrimmedString(rawTransitions.commitPushed),
      prOpened:      toTrimmedString(rawTransitions.prOpened),
      prMerged:      toTrimmedString(rawTransitions.prMerged),
    },
    customRules: sanitiseCustomRules(rawBody && rawBody.customRules),
    // Preserve the dedup state across saves — a config edit must never lose it.
    seenPrs: previousSeenPrs || {},
  };
}

function buildDefaultConfigResponse() {
  return {
    isEnabled: false,
    mode: 'dryRun',
    scheduleTime: DEFAULT_SCHEDULE_TIME,
    intervalMin: 0,
    dropFolder: '',
    processedArchiveFolder: '',
    errorFolder: '',
    fileExtensions: ['.eml', '.txt'],
    jiraProjectKeys: [],
    transitions: { branchCreated: '', commitPushed: '', prOpened: '', prMerged: '' },
    customRules: [],
  };
}

/**
 * Fetches the distinct Jira status NAMES the operator can map events to, for the transition dropdowns.
 * When project keys are configured it unions the statuses across those projects' issue types (the most
 * relevant set); otherwise it falls back to the instance-wide status list. Never throws — an unreachable
 * Jira yields an empty list so the UI can fall back to free-text entry.
 */
async function fetchAvailableStatuses(configuration) {
  const cfg = ((configuration.scheduler || {}).githubEmailIntake) || {};
  const jiraConfig = configuration.jira || {};
  const isTlsVerified = configuration.sslVerify !== false;
  const projectKeys = Array.isArray(cfg.jiraProjectKeys) ? cfg.jiraProjectKeys.filter(Boolean) : [];
  const statusNames = new Set();

  try {
    if (projectKeys.length > 0) {
      for (const projectKey of projectKeys) {
        const response = await makeJiraApiRequest(
          'GET', '/rest/api/2/project/' + encodeURIComponent(projectKey) + '/statuses', null, jiraConfig, isTlsVerified);
        if (response.status === 200 && Array.isArray(response.body)) {
          response.body.forEach((issueType) => (issueType.statuses || []).forEach((status) => {
            if (status && status.name) statusNames.add(status.name);
          }));
        }
      }
    } else {
      const response = await makeJiraApiRequest('GET', '/rest/api/2/status', null, jiraConfig, isTlsVerified);
      if (response.status === 200 && Array.isArray(response.body)) {
        response.body.forEach((status) => { if (status && status.name) statusNames.add(status.name); });
      }
    }
  } catch (fetchError) {
    return { statuses: [], error: fetchError instanceof Error ? fetchError.message : String(fetchError) };
  }
  return { statuses: Array.from(statusNames).sort() };
}

/** Reports whether a path is an existing directory (best-effort; used only for a UI warning). */
function isExistingDirectory(folderPath) {
  try {
    return folderPath !== '' && fs.statSync(folderPath).isDirectory();
  } catch (_error) {
    return false;
  }
}

/**
 * Creates the GitHub Email Intake router.
 * @param {object} configuration - live server config reference (mutated in place on save)
 * @returns {import('express').Router}
 */
function createGithubEmailIntakeRouter(configuration) {
  const router = express.Router();

  router.get('/api/github-email-intake/config', (req, res) => {
    const storedConfig = ((configuration.scheduler || {}).githubEmailIntake) || {};
    const merged = { ...buildDefaultConfigResponse(), ...storedConfig };
    // seenPrs is internal dedup state — don't ship it to the UI.
    delete merged.seenPrs;
    return res.json(merged);
  });

  router.post('/api/github-email-intake/config', (req, res) => {
    if (!configuration.scheduler) {
      configuration.scheduler = {};
    }
    const previousSeenPrs = (((configuration.scheduler || {}).githubEmailIntake) || {}).seenPrs;
    const sanitisedConfig = sanitiseConfig(req.body || {}, previousSeenPrs);
    configuration.scheduler.githubEmailIntake = sanitisedConfig;
    try {
      saveConfigToDisk(configuration);
    } catch (saveError) {
      const errorMessage = saveError instanceof Error ? saveError.message : String(saveError);
      return res.status(500).json({ ok: false, message: 'Config save failed: ' + errorMessage });
    }
    // A non-existent drop folder is a warning, not a failure — the user may set it before the folder exists.
    const folderWarning = sanitisedConfig.dropFolder !== '' && !isExistingDirectory(sanitisedConfig.dropFolder)
      ? 'Drop folder does not exist yet: ' + sanitisedConfig.dropFolder
      : null;
    return res.json({ ok: true, mode: sanitisedConfig.mode, folderWarning });
  });

  router.post('/api/github-email-intake/run-now', async (req, res) => {
    const dropFolder = (((configuration.scheduler || {}).githubEmailIntake) || {}).dropFolder || '';
    if (dropFolder === '') {
      return res.status(400).json({ ok: false, message: 'No drop folder configured — set it and save first.' });
    }
    if (isGithubEmailIntakeRunInProgress()) {
      return res.status(409).json({ ok: false, message: 'A GitHub email intake run is already in progress.' });
    }
    try {
      const outcome = await runGithubEmailIntakeNow(configuration, { trigger: 'manual' });
      if (!outcome.ok) {
        return res.status(outcome.isAlreadyRunning ? 409 : 400).json({ ok: false, message: outcome.message });
      }
      return res.json({ ok: true, result: outcome.result });
    } catch (runError) {
      const errorMessage = runError instanceof Error ? runError.message : String(runError);
      console.error('  ⚠ GitHub email intake run-now error:', errorMessage);
      return res.status(500).json({ ok: false, message: errorMessage });
    }
  });

  // Preview: a forced dry-run that parses and reports classified events but never posts or archives.
  router.post('/api/github-email-intake/preview', async (req, res) => {
    const cfg = ((configuration.scheduler || {}).githubEmailIntake) || {};
    if (!cfg.dropFolder) {
      return res.status(400).json({ ok: false, message: 'No drop folder configured — set it and save first.' });
    }
    // Run in dryRun mode against a config clone, and skip archiving by using a no-op moveFile.
    const previewConfiguration = {
      ...configuration,
      scheduler: { ...configuration.scheduler, githubEmailIntake: { ...cfg, mode: 'dryRun' } },
    };
    try {
      const outcome = await runGithubEmailIntakeNow(previewConfiguration, {
        trigger: 'preview',
        moveFile: () => {},          // never move files during a preview
        writeLedger: () => {},       // never persist ledger during a preview
        writeLastRun: false,
      });
      return res.json(outcome);
    } catch (previewError) {
      const errorMessage = previewError instanceof Error ? previewError.message : String(previewError);
      return res.status(500).json({ ok: false, message: errorMessage });
    }
  });


  router.get('/api/github-email-intake/status', (req, res) => {
    return res.json(readLastRunResult());
  });

  // Jira status names for the transition dropdowns (so an operator selects a real status instead of typing).
  router.get('/api/github-email-intake/jira-statuses', async (req, res) => {
    try {
      return res.json(await fetchAvailableStatuses(configuration));
    } catch (statusError) {
      const errorMessage = statusError instanceof Error ? statusError.message : String(statusError);
      return res.status(500).json({ statuses: [], error: errorMessage });
    }
  });

  return router;
}

module.exports = createGithubEmailIntakeRouter;
