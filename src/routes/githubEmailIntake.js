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
  collectRuleSamples,
  isGithubEmailIntakeRunInProgress,
  readLastRunResult,
} = require('../services/githubEmailIntakeScheduler');

const DEFAULT_SCHEDULE_TIME = '07:00';
const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_MODES = ['dryRun', 'commentOnly', 'full'];
/** Where the parent Sub-status dropdown lives on this Jira instance unless the operator overrides it. */
const DEFAULT_SUB_STATUS_FIELD_ID = 'customfield_10201';

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
      // Operator action fields (set in the Rules panel): the on/off switch, a custom comment, and a per-rule
      // status transition. Only a meaningful "off" is stored so an enabled rule stays clean.
      if (rule.isEnabled === false) cleaned.isEnabled = false;
      if (typeof rule.comment === 'string' && rule.comment.trim() !== '') cleaned.comment = rule.comment;
      if (typeof rule.transitionStatus === 'string' && rule.transitionStatus.trim() !== '') cleaned.transitionStatus = rule.transitionStatus;
      // Parent-story actions: move the matched sub-task's PARENT and/or set its Sub-status dropdown.
      // The all-coding-sub-tasks-done guard defaults ON, so only a meaningful "off" is stored.
      if (typeof rule.parentTransitionStatus === 'string' && rule.parentTransitionStatus.trim() !== '') {
        cleaned.parentTransitionStatus = rule.parentTransitionStatus.trim();
      }
      if (typeof rule.parentSubStatusValue === 'string' && rule.parentSubStatusValue.trim() !== '') {
        cleaned.parentSubStatusValue = rule.parentSubStatusValue.trim();
      }
      if (rule.parentRequiresAllDevDone === false) cleaned.parentRequiresAllDevDone = false;
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
    // The custom field the parent Sub-status dropdown lives in (a select field; writes as { value }).
    subStatusFieldId: toTrimmedString(rawBody && rawBody.subStatusFieldId) || DEFAULT_SUB_STATUS_FIELD_ID,
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
    subStatusFieldId: DEFAULT_SUB_STATUS_FIELD_ID,
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

/**
 * Fetches the valid options of the parent Sub-status dropdown, unioned across the configured
 * projects' issue types via createmeta (the only DC endpoint that exposes a select field's allowed
 * values without an issue in hand). Never throws — an unreachable Jira yields an empty list so the
 * panel falls back to free-text entry.
 */
async function fetchSubStatusOptions(configuration) {
  const cfg = ((configuration.scheduler || {}).githubEmailIntake) || {};
  const jiraConfig = configuration.jira || {};
  const isTlsVerified = configuration.sslVerify !== false;
  const fieldId = toTrimmedString(cfg.subStatusFieldId) || DEFAULT_SUB_STATUS_FIELD_ID;
  const projectKeys = Array.isArray(cfg.jiraProjectKeys) ? cfg.jiraProjectKeys.filter(Boolean) : [];
  const optionValues = new Set();

  try {
    for (const projectKey of projectKeys) {
      const createMetaPath = '/rest/api/2/issue/createmeta?projectKeys=' + encodeURIComponent(projectKey)
        + '&expand=projects.issuetypes.fields';
      const response = await makeJiraApiRequest('GET', createMetaPath, null, jiraConfig, isTlsVerified);
      const projects = (response.status === 200 && response.body && response.body.projects) || [];
      projects.forEach((project) => (project.issuetypes || []).forEach((issueType) => {
        const fieldMeta = (issueType.fields || {})[fieldId];
        (fieldMeta && fieldMeta.allowedValues ? fieldMeta.allowedValues : []).forEach((allowedValue) => {
          const optionValue = allowedValue && (allowedValue.value || allowedValue.name);
          if (optionValue) optionValues.add(optionValue);
        });
      }));
    }
  } catch (fetchError) {
    return { options: [], error: fetchError instanceof Error ? fetchError.message : String(fetchError) };
  }
  return { options: Array.from(optionValues).sort() };
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


  // Rule samples: reads the drop folder (read-only) and returns raw email sources + their current
  // classification, so the panel can bundle them into ONE bulk AI rule-generation prompt. Defaults to the
  // unclassified emails only; pass { includeAll: true } to return every eligible email.
  router.post('/api/github-email-intake/rule-samples', (req, res) => {
    const includeAll = !!(req.body && req.body.includeAll);
    try {
      const outcome = collectRuleSamples(configuration, { includeAll });
      if (!outcome.ok) {
        return res.status(400).json(outcome);
      }
      return res.json(outcome);
    } catch (sampleError) {
      const errorMessage = sampleError instanceof Error ? sampleError.message : String(sampleError);
      return res.status(500).json({ ok: false, message: errorMessage, samples: [] });
    }
  });

  router.get('/api/github-email-intake/status', (req, res) => {
    return res.json(readLastRunResult());
  });

  // Valid options of the parent Sub-status dropdown, so the Rules panel offers a real select.
  router.get('/api/github-email-intake/sub-status-options', async (req, res) => {
    try {
      return res.json(await fetchSubStatusOptions(configuration));
    } catch (optionsError) {
      const errorMessage = optionsError instanceof Error ? optionsError.message : String(optionsError);
      return res.status(500).json({ options: [], error: errorMessage });
    }
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
