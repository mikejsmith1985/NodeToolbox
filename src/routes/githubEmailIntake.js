// src/routes/githubEmailIntake.js — Admin Hub endpoints for the GitHub Email Intake scheduler:
// read/save the config (drop folder, mode, transitions, filters), run the intake immediately, preview
// a dry-run parse without touching Jira or archiving, and read the persisted last run. No credentials
// are ever accepted or returned — runs reuse configuration.jira.

'use strict';

const express = require('express');
const fs = require('fs');
const { makeJiraApiRequest } = require('../utils/httpClient');
const { isHttpUrl, normalizeSharePointFolderUrl } = require('../utils/sharePointFolderUrl');
const { saveConfigToDisk } = require('../config/loader');
const {
  runGithubEmailIntakeNow,
  runGithubEmailSourcesNow,
  filterNewSharePointFileNames,
  collectRuleSamples,
  isGithubEmailIntakeRunInProgress,
  readLastRunResult,
  readRunLog,
} = require('../services/githubEmailIntakeScheduler');

const DEFAULT_SCHEDULE_TIME = '07:00';
const SCHEDULE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const VALID_MODES = ['dryRun', 'commentOnly', 'full'];
/** Max email sources one /sharepoint/run call may carry — the client batches larger pulls. */
const MAX_SOURCES_PER_RUN = 100;
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
    // Server-relative URL of the SharePoint library folder the Power Automate flow drops emails into.
    sharePointFolderUrl: toTrimmedString(rawBody && rawBody.sharePointFolderUrl),
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
    sharePointFolderUrl: '',
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

/** GETs a Jira path and returns the JSON body, or null on any failure — a strategy probe, never fatal. */
async function readJiraJson(configuration, requestPath) {
  try {
    const response = await makeJiraApiRequest('GET', requestPath, null, configuration.jira || {}, configuration.sslVerify !== false);
    return response.status === 200 ? response.body : null;
  } catch (_requestError) {
    return null;
  }
}

/** Adds a field's allowedValues option labels ({ value } for selects, { name } fallback) into the set. */
function collectAllowedValueLabels(fieldMeta, optionValues) {
  const allowedValues = (fieldMeta && fieldMeta.allowedValues) || [];
  allowedValues.forEach((allowedValue) => {
    const optionValue = allowedValue && (allowedValue.value || allowedValue.name);
    if (optionValue) optionValues.add(optionValue);
  });
}

/** Strategy 1 (Jira ≤ 8.3): the legacy full createmeta with expanded fields, per configured project. */
async function readOptionsViaLegacyCreateMeta(configuration, projectKeys, fieldId) {
  const optionValues = new Set();
  for (const projectKey of projectKeys) {
    const body = await readJiraJson(configuration, '/rest/api/2/issue/createmeta?projectKeys='
      + encodeURIComponent(projectKey) + '&expand=projects.issuetypes.fields');
    ((body && body.projects) || []).forEach((project) => (project.issuetypes || []).forEach((issueType) => {
      collectAllowedValueLabels((issueType.fields || {})[fieldId], optionValues);
    }));
  }
  return optionValues;
}

/** Strategy 2 (Jira 8.4+/DC 9, which removed the legacy endpoint): per-project, per-issue-type createmeta.
 *  The per-issue-type reads run CONCURRENTLY — serially they were a dozen round trips on panel load. */
async function readOptionsViaProjectIssueTypes(configuration, projectKeys, fieldId) {
  const optionValues = new Set();
  for (const projectKey of projectKeys) {
    const issueTypesBody = await readJiraJson(configuration,
      '/rest/api/2/issue/createmeta/' + encodeURIComponent(projectKey) + '/issuetypes?maxResults=100');
    const issueTypes = (issueTypesBody && issueTypesBody.values) || [];
    const fieldsBodies = await Promise.all(issueTypes.map((issueType) => readJiraJson(configuration,
      '/rest/api/2/issue/createmeta/' + encodeURIComponent(projectKey) + '/issuetypes/'
      + encodeURIComponent(issueType.id) + '?maxResults=200')));
    for (const fieldsBody of fieldsBodies) {
      for (const fieldMeta of (fieldsBody && fieldsBody.values) || []) {
        if (fieldMeta && fieldMeta.fieldId === fieldId) {
          collectAllowedValueLabels(fieldMeta, optionValues);
        }
      }
    }
  }
  return optionValues;
}

/** Turns a JQL suggestion into a plain option label: unquote the JQL literal, else strip the highlight HTML. */
function readSuggestionOptionLabel(suggestion) {
  const quotedValue = String((suggestion && suggestion.value) || '').replace(/&quot;/g, '"');
  const unquotedValue = quotedValue.replace(/^"|"$/g, '').trim();
  if (unquotedValue !== '') {
    return unquotedValue;
  }
  return String((suggestion && suggestion.displayName) || '').replace(/<[^>]*>/g, '').trim();
}

/**
 * Strategy 3 (project-independent): resolve the field's NAME from /field, then read its option values
 * from the JQL autocomplete suggestions endpoint — works on every Server/DC version and needs no
 * project keys, at the cost of the endpoint's suggestion cap (fine for a small Sub-status list).
 */
async function readOptionsViaJqlSuggestions(configuration, fieldId) {
  const optionValues = new Set();
  const allFields = await readJiraJson(configuration, '/rest/api/2/field');
  const matchedField = Array.isArray(allFields) ? allFields.find((field) => field && field.id === fieldId) : null;
  if (!matchedField || !matchedField.name) {
    return optionValues;
  }
  const suggestionsBody = await readJiraJson(configuration,
    '/rest/api/2/jql/autocompletedata/suggestions?fieldName=' + encodeURIComponent(matchedField.name) + '&fieldValue=');
  for (const suggestion of (suggestionsBody && suggestionsBody.results) || []) {
    const optionLabel = readSuggestionOptionLabel(suggestion);
    if (optionLabel) optionValues.add(optionLabel);
  }
  return optionValues;
}

/**
 * Fetches the valid options of the parent Sub-status dropdown, trying every strategy the various
 * Jira Server/DC versions support: legacy createmeta → per-issue-type createmeta (DC 9 removed the
 * legacy one) → field-name + JQL suggestions (needs no project keys at all). The first strategy that
 * yields options wins. Never throws — an unreachable Jira yields an empty list so the panel falls
 * back to free-text entry.
 */
async function fetchSubStatusOptions(configuration) {
  const cfg = ((configuration.scheduler || {}).githubEmailIntake) || {};
  const fieldId = toTrimmedString(cfg.subStatusFieldId) || DEFAULT_SUB_STATUS_FIELD_ID;
  const projectKeys = Array.isArray(cfg.jiraProjectKeys) ? cfg.jiraProjectKeys.filter(Boolean) : [];

  const optionStrategies = [
    () => (projectKeys.length > 0 ? readOptionsViaLegacyCreateMeta(configuration, projectKeys, fieldId) : new Set()),
    () => (projectKeys.length > 0 ? readOptionsViaProjectIssueTypes(configuration, projectKeys, fieldId) : new Set()),
    () => readOptionsViaJqlSuggestions(configuration, fieldId),
  ];
  for (const runStrategy of optionStrategies) {
    const optionValues = await runStrategy();
    if (optionValues.size > 0) {
      return { options: Array.from(optionValues).sort() };
    }
  }
  return { options: [] };
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

    // A URL in the drop folder is the production misconfiguration that broke runs (a SharePoint
    // share link pasted into the wrong field). Self-heal BEFORE persisting rather than just warn:
    // move the link to the SharePoint folder field (normalized, unless one is already set) and
    // blank the drop folder, so the SAVED config is immediately usable. A non-existent LOCAL
    // folder is only a warning: the user may set it before the folder exists.
    let folderWarning = null;
    if (isHttpUrl(sanitisedConfig.dropFolder)) {
      if (sanitisedConfig.sharePointFolderUrl === '') {
        sanitisedConfig.sharePointFolderUrl = normalizeSharePointFolderUrl(sanitisedConfig.dropFolder);
      }
      sanitisedConfig.dropFolder = '';
      folderWarning = 'Moved the SharePoint link to the SharePoint folder field — the drop folder must be a LOCAL path (e.g. C:\\Users\\you\\GitHubEmails).';
    } else if (sanitisedConfig.dropFolder !== '' && !isExistingDirectory(sanitisedConfig.dropFolder)) {
      folderWarning = 'Drop folder does not exist yet: ' + sanitisedConfig.dropFolder;
    }

    configuration.scheduler.githubEmailIntake = sanitisedConfig;
    try {
      saveConfigToDisk(configuration);
    } catch (saveError) {
      const errorMessage = saveError instanceof Error ? saveError.message : String(saveError);
      return res.status(500).json({ ok: false, message: 'Config save failed: ' + errorMessage });
    }
    return res.json({ ok: true, mode: sanitisedConfig.mode, folderWarning });
  });

  router.post('/api/github-email-intake/run-now', async (req, res) => {
    const runCfg = (((configuration.scheduler || {}).githubEmailIntake) || {});
    const dropFolder = runCfg.dropFolder || '';
    if (dropFolder === '') {
      // A SharePoint-only setup has no local folder to sweep — point at the pull that IS its run.
      const message = toTrimmedString(runCfg.sharePointFolderUrl) !== ''
        ? 'This setup uses the SharePoint source — use "Pull from SharePoint now" (server-side runs only sweep a local drop folder).'
        : 'No drop folder configured — set it and save first.';
      return res.status(400).json({ ok: false, message });
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

  // SharePoint source, step 1: given the library's file listing, return only the names the server has
  // not yet ingested — so the client downloads new files only through the (slow, per-file) relay.
  router.post('/api/github-email-intake/sharepoint/filter-new', (req, res) => {
    const fileNames = req.body && req.body.fileNames;
    if (!Array.isArray(fileNames)) {
      return res.status(400).json({ ok: false, message: 'Expected a fileNames array.' });
    }
    return res.json({ ok: true, newFileNames: filterNewSharePointFileNames(fileNames) });
  });

  // SharePoint source, step 2: ingest the downloaded email sources through the same pipeline as the
  // drop folder (parse, dedup ledger, Jira post, Activity Log). Files stay in SharePoint — the
  // seen-ledger recorded by the run replaces the local archive move.
  router.post('/api/github-email-intake/sharepoint/run', async (req, res) => {
    const sources = req.body && req.body.sources;
    if (!Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({ ok: false, message: 'Expected a non-empty sources array.' });
    }
    if (sources.length > MAX_SOURCES_PER_RUN) {
      return res.status(400).json({ ok: false, message: 'Too many sources in one batch (max ' + MAX_SOURCES_PER_RUN + ') — split the pull into smaller batches.' });
    }
    if (isGithubEmailIntakeRunInProgress()) {
      return res.status(409).json({ ok: false, message: 'A GitHub email intake run is already in progress.' });
    }
    const cfg = ((configuration.scheduler || {}).githubEmailIntake) || {};
    const folderLabel = toTrimmedString(cfg.sharePointFolderUrl) || 'sharepoint';
    try {
      const outcome = await runGithubEmailSourcesNow(configuration, { folderLabel, sources });
      if (!outcome.ok) {
        return res.status(outcome.isAlreadyRunning ? 409 : 400).json({ ok: false, message: outcome.message });
      }
      return res.json({ ok: true, result: outcome.result });
    } catch (runError) {
      const errorMessage = runError instanceof Error ? runError.message : String(runError);
      console.error('  ⚠ GitHub email intake SharePoint run error:', errorMessage);
      return res.status(500).json({ ok: false, message: errorMessage });
    }
  });

  // SharePoint source preview: a FORCED dry run over the downloaded sources that persists nothing —
  // no ledger write, no seen-file recording, no last-run/Activity-Log entry — so an operator can
  // verify parsing before a real pull, exactly like the drop-folder Preview.
  router.post('/api/github-email-intake/sharepoint/preview', async (req, res) => {
    const sources = req.body && req.body.sources;
    if (!Array.isArray(sources) || sources.length === 0) {
      return res.status(400).json({ ok: false, message: 'Expected a non-empty sources array.' });
    }
    if (sources.length > MAX_SOURCES_PER_RUN) {
      return res.status(400).json({ ok: false, message: 'Too many sources in one batch (max ' + MAX_SOURCES_PER_RUN + ') — split the pull into smaller batches.' });
    }
    if (isGithubEmailIntakeRunInProgress()) {
      return res.status(409).json({ ok: false, message: 'A GitHub email intake run is already in progress.' });
    }
    const cfg = ((configuration.scheduler || {}).githubEmailIntake) || {};
    const folderLabel = toTrimmedString(cfg.sharePointFolderUrl) || 'sharepoint';
    const previewConfiguration = {
      ...configuration,
      scheduler: { ...configuration.scheduler, githubEmailIntake: { ...cfg, mode: 'dryRun' } },
    };
    try {
      const outcome = await runGithubEmailSourcesNow(previewConfiguration, { folderLabel, sources }, {
        writeLedger: () => {},       // never persist dedup state during a preview
        recordSeenNames: () => {},   // never mark files seen — a real pull must still ingest them
        writeLastRun: false,         // no last-run overwrite, no Activity Log entry
      });
      if (!outcome.ok) {
        return res.status(outcome.isAlreadyRunning ? 409 : 400).json({ ok: false, message: outcome.message });
      }
      return res.json({ ok: true, result: outcome.result });
    } catch (previewError) {
      const errorMessage = previewError instanceof Error ? previewError.message : String(previewError);
      return res.status(500).json({ ok: false, message: errorMessage });
    }
  });

  router.get('/api/github-email-intake/status', (req, res) => {
    return res.json(readLastRunResult());
  });

  // Persistent run history (newest first) — proves whether scheduled runs are actually firing
  // and records what each run did to every email.
  router.get('/api/github-email-intake/run-log', (req, res) => {
    return res.json({ ok: true, runs: readRunLog() });
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
