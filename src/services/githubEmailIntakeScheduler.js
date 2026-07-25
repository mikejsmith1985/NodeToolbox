// githubEmailIntakeScheduler.js — GitHub Email Intake engine.
//
// Reads GitHub notification emails saved to a local drop folder, parses them with the shared
// deterministic (non-AI) engine (generated/githubEmailEngine.cjs), and drives Jira comments +
// transitions via the shared jiraEventOutput helper — the same output the GitHub-API repo monitor
// uses, so a locked-down enterprise with no GitHub API access still gets the integration.
//
// Chassis mirrors monthlyDeliveryScheduler.js (60s tick, injectable DI-tick options, schedulerFiredState
// persistence). Dedup is a Message-ID/content-hash ledger PLUS a per-event key, both in one JSON file,
// so the same email never posts twice and two emails about the same PR event fire Jira once. Rollout is
// safe by default: mode 'dryRun' touches nothing, 'commentOnly' posts comments, 'full' also transitions.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { isScheduledTimeReached, loadFiredDates, recordFiredDate } = require('./schedulerFiredState');
const { postJiraCommentForEvent } = require('./jiraEventOutput');

// ── Constants ──

const SCHEDULE_CHECK_INTERVAL_MS = 60 * 1000;
const FIRED_STATE_SCHEDULER_NAME = 'githubEmailIntake';
const FIRED_STATE_CONFIG_KEY = 'githubEmailIntake';
const DEFAULT_SCHEDULE_TIME = '07:00';
const PROCESSED_SUBFOLDER = '_processed';
const ERROR_SUBFOLDER = '_errors';
const MS_PER_MINUTE = 60 * 1000;

/** The comment each event type posts (mirrors the repo monitor's wording, tagged "via email"). */
const EVENT_COMMENT_TEMPLATES = {
  branch_created:   '🔀 GitHub (via email): branch created and work has started.',
  commit_pushed:    '✅ GitHub (via email): new commit pushed to feature branch.',
  pr_opened:        '📬 GitHub (via email): pull request opened for review.',
  pr_merged:        '🎉 GitHub (via email): pull request has been merged.',
  review_requested: '👀 GitHub (via email): a review was requested.',
};

// ── Lazy engine load (like piReviewRefresh) so `node server.js` without the build degrades gracefully ──

let cachedEngine = null;
function getEngine() {
  if (cachedEngine === null) {
    cachedEngine = require('./generated/githubEmailEngine.cjs');
  }
  return cachedEngine;
}

// ── Ledger + last-run persistence (env-overridable paths, AppData convention) ──

function getLedgerFilePath() {
  return process.env.TBX_GITHUB_EMAIL_LEDGER_PATH
    || path.join(process.env.APPDATA || os.homedir(), 'NodeToolbox', 'github-email-processed.json');
}

function getResultsFilePath() {
  return process.env.TBX_GITHUB_EMAIL_RESULTS_PATH
    || path.join(process.env.APPDATA || os.homedir(), 'NodeToolbox', 'github-email-last-run.json');
}

function readLedgerFromDisk() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getLedgerFilePath(), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_readError) {
    return [];
  }
}

function writeLedgerToDisk(ledger) {
  try {
    fs.mkdirSync(path.dirname(getLedgerFilePath()), { recursive: true });
    fs.writeFileSync(getLedgerFilePath(), JSON.stringify(ledger, null, 2) + '\n', 'utf8');
  } catch (writeError) {
    console.error('  ⚠ Could not persist GitHub email ledger: ' + writeError.message);
  }
}

function writeLastRunResult(runResult) {
  try {
    fs.mkdirSync(path.dirname(getResultsFilePath()), { recursive: true });
    fs.writeFileSync(getResultsFilePath(), JSON.stringify(runResult, null, 2) + '\n', 'utf8');
  } catch (writeError) {
    console.error('  ⚠ Could not persist GitHub email intake run result: ' + writeError.message);
  }
}

function readLastRunResult() {
  try {
    return JSON.parse(fs.readFileSync(getResultsFilePath(), 'utf8'));
  } catch (_readError) {
    return { hasRun: false };
  }
}

// ── Default filesystem deps (all injectable for tests) ──

function defaultListFiles(dropFolder, fileExtensions) {
  const lowerExtensions = fileExtensions.map((extension) => extension.toLowerCase());
  return fs.readdirSync(dropFolder, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('.'))
    .filter((name) => lowerExtensions.some((extension) => name.toLowerCase().endsWith(extension)));
}

/**
 * Reads one drop-folder file into the RFC-822 email source string the engine parses. Text formats
 * (.eml/.txt) are read as UTF-8 directly; Outlook .msg files are binary (Compound File Binary Format), so
 * they are read as bytes and converted to an email source via the engine's .msg reader. An unreadable
 * .msg throws, which routes the file to the error folder for a later, fixed re-export.
 */
function defaultReadFile(fullPath) {
  if (/\.msg$/i.test(fullPath)) {
    const msgBytes = fs.readFileSync(fullPath); // Buffer — a Uint8Array the engine reads directly.
    const emailSource = getEngine().msgBytesToEmailSource(msgBytes);
    if (emailSource === null) {
      throw new Error('unreadable Outlook .msg (no transport headers found)');
    }
    return emailSource;
  }
  return fs.readFileSync(fullPath, 'utf8');
}

function defaultMoveFile(fromFullPath, toDirectory, fileName) {
  fs.mkdirSync(toDirectory, { recursive: true });
  fs.renameSync(fromFullPath, path.join(toDirectory, fileName));
}

// ── Pure helpers ──

/** Builds the two dedup keys: the file key (Message-ID or hash) and the per-event key. */
function buildDedupKeys(event, rawSource) {
  const fileKey = event.sourceMessageId && event.sourceMessageId.trim() !== ''
    ? event.sourceMessageId.trim()
    : 'sha256:' + crypto.createHash('sha256').update(rawSource).digest('hex');
  const eventIdentity = (event.prNumber !== null ? '#' + event.prNumber : (event.branch || '?'));
  const eventKey = 'event:' + (event.repo || '?') + ':' + eventIdentity + ':' + event.eventType;
  return { fileKey, eventKey };
}

/** True when the Jira key's project prefix is allowed by the configured filter ([] = all). */
function isProjectAllowed(jiraKey, jiraProjectKeys) {
  if (!jiraProjectKeys || jiraProjectKeys.length === 0) {
    return true;
  }
  const prefix = jiraKey.split('-')[0].toUpperCase();
  return jiraProjectKeys.some((allowed) => String(allowed).toUpperCase() === prefix);
}

/** Composes the Jira comment for an event, adding the PR number and actor when present. */
function buildCommentText(event) {
  const base = EVENT_COMMENT_TEMPLATES[event.eventType] || ('GitHub (via email): ' + event.eventType.replace(/_/g, ' '));
  const details = [];
  if (event.prNumber !== null) {
    details.push('PR #' + event.prNumber);
  }
  if (event.actor) {
    details.push('by @' + event.actor);
  }
  return details.length > 0 ? base + ' (' + details.join(' ') + ')' : base;
}

/** Maps the config mode to the postEvent options (dryRun / suppressTransition). */
function optionsForMode(mode) {
  if (mode === 'commentOnly') {
    return { suppressTransition: true };
  }
  if (mode === 'full') {
    return {};
  }
  return { dryRun: true }; // default / 'dryRun'
}

// ── Overlap guard ──

let isRunInProgress = false;
function isGithubEmailIntakeRunInProgress() {
  return isRunInProgress;
}

/**
 * Processes every eligible file in the drop folder once. All I/O is injected via deps so the whole
 * orchestration is unit-testable without a filesystem or Jira:
 *   deps.listFiles(dropFolder, extensions) → string[]
 *   deps.readFile(fullPath) → raw string
 *   deps.moveFile(fromFullPath, toDir, fileName) → void
 *   deps.readLedger() / deps.writeLedger(ledger)
 *   deps.postEvent({ jiraKey, commentText, eventType, repo, transitions, configuration, options, recordResult })
 *   deps.engine (parseGithubEmail, isProcessed, appendProcessed)
 *   deps.nowIso() → ISO string
 */
async function processDropFolder(configuration, deps) {
  const cfg = ((configuration.scheduler || {}).githubEmailIntake) || {};
  const dropFolder = cfg.dropFolder || '';
  const engine = deps.engine;
  const nowIso = deps.nowIso();
  const mode = cfg.mode || 'dryRun';
  const postOptions = optionsForMode(mode);
  const processedDir = cfg.processedArchiveFolder || path.join(dropFolder, PROCESSED_SUBFOLDER);
  const errorDir = cfg.errorFolder || path.join(dropFolder, ERROR_SUBFOLDER);
  const fileExtensions = cfg.fileExtensions || ['.eml', '.txt', '.msg'];

  const runResult = { hasRun: true, ranAtIso: nowIso, trigger: deps.trigger || 'manual', mode, dropFolder, events: [], postedCount: 0, skippedCount: 0, errorCount: 0 };

  // Managed Outlook export: pull fresh GitHub emails from Outlook into the drop folder FIRST, so this same
  // run then processes them. Gated on config; a failure is reported on the run but never aborts the sweep of
  // files already present. Preview injects a no-op runExport so a dry-run never moves real Outlook mail.
  if (cfg.outlookExport && cfg.outlookExport.isEnabled) {
    const runExport = deps.runExport || ((exportConfig) => require('./outlookEmailExport').runOutlookExport(exportConfig));
    try {
      runResult.outlookExport = await runExport({
        sourceFolder: cfg.outlookExport.sourceFolder,
        processedFolder: cfg.outlookExport.processedFolder,
        dropFolder,
      });
    } catch (exportError) {
      runResult.outlookExport = { ok: false, message: 'Outlook export threw: ' + (exportError && exportError.message ? exportError.message : String(exportError)) };
    }
  }

  let fileNames;
  try {
    fileNames = deps.listFiles(dropFolder, fileExtensions);
  } catch (listError) {
    runResult.folderError = 'Could not read drop folder: ' + listError.message;
    return runResult;
  }

  let ledger = deps.readLedger();

  for (const fileName of fileNames) {
    const fullPath = path.join(dropFolder, fileName);
    let rawSource;
    try {
      rawSource = deps.readFile(fullPath);
    } catch (readError) {
      runResult.errorCount += 1;
      runResult.events.push({ fileName, outcome: 'error', message: 'read failed: ' + readError.message });
      continue;
    }

    let event;
    try {
      // Config-driven custom rules (AI-authored) are applied ahead of the built-in classification table.
      event = engine.parseGithubEmail(rawSource, cfg.customRules || []);
    } catch (parseError) {
      // Route unparseable files to the error folder WITHOUT ledgering, so a fixed export can be retried.
      runResult.errorCount += 1;
      runResult.events.push({ fileName, outcome: 'error', message: 'parse failed: ' + parseError.message });
      safeMove(deps, fullPath, errorDir, fileName, runResult);
      continue;
    }

    const { fileKey, eventKey } = buildDedupKeys(event, rawSource);

    // Same email seen before → archive and skip silently.
    if (engine.isProcessed(ledger, fileKey)) {
      runResult.skippedCount += 1;
      runResult.events.push({ fileName, outcome: 'skipped', reason: 'duplicate-email', jiraKey: event.jiraKey, eventType: event.eventType });
      safeMove(deps, fullPath, processedDir, fileName, runResult);
      continue;
    }

    // Not actionable: unknown event, no Jira key, or a project outside the filter.
    const isActionable = event.eventType !== 'unknown'
      && event.jiraKey !== null
      && isProjectAllowed(event.jiraKey, cfg.jiraProjectKeys);
    if (!isActionable) {
      const reason = event.eventType === 'unknown' ? 'unclassified'
        : event.jiraKey === null ? 'no-jira-key' : 'project-filtered';
      runResult.skippedCount += 1;
      runResult.events.push({ fileName, outcome: 'skipped', reason, jiraKey: event.jiraKey, eventType: event.eventType });
      ledger = engine.appendProcessed(ledger, { key: fileKey, processedAtIso: nowIso, eventType: event.eventType, jiraKey: event.jiraKey, outcome: 'skipped' });
      safeMove(deps, fullPath, processedDir, fileName, runResult);
      continue;
    }

    // A DIFFERENT email about the same PR event already drove Jira → mark this file done, do not repost.
    if (engine.isProcessed(ledger, eventKey)) {
      runResult.skippedCount += 1;
      runResult.events.push({ fileName, outcome: 'skipped', reason: 'duplicate-event', jiraKey: event.jiraKey, eventType: event.eventType });
      ledger = engine.appendProcessed(ledger, { key: fileKey, processedAtIso: nowIso, eventType: event.eventType, jiraKey: event.jiraKey, outcome: 'skipped' });
      safeMove(deps, fullPath, processedDir, fileName, runResult);
      continue;
    }

    // Drive Jira (or a dry run). The result records land on the run via the recordResult sink.
    const resultRecords = [];
    await deps.postEvent({
      jiraKey: event.jiraKey,
      commentText: buildCommentText(event),
      eventType: event.eventType,
      repo: event.repo || 'unknown/unknown',
      transitions: cfg.transitions || {},
      configuration,
      options: postOptions,
      recordResult: (record) => resultRecords.push(record),
    });

    const isPosted = resultRecords.some((record) => record.isSuccess);
    runResult.postedCount += isPosted ? 1 : 0;
    runResult.errorCount += isPosted ? 0 : 1;
    runResult.events.push({
      fileName,
      outcome: postOptions.dryRun ? 'dry-run' : (isPosted ? 'posted' : 'error'),
      jiraKey: event.jiraKey,
      eventType: event.eventType,
      prNumber: event.prNumber,
      message: (resultRecords[0] && resultRecords[0].message) || '',
    });

    const ledgerOutcome = postOptions.dryRun ? 'dry-run' : (isPosted ? 'posted' : 'error');
    ledger = engine.appendProcessed(ledger, { key: fileKey, processedAtIso: nowIso, eventType: event.eventType, jiraKey: event.jiraKey, outcome: ledgerOutcome });
    // Only claim the per-event key once Jira was actually driven (never in dry-run), so a later real
    // run still fires the event.
    if (!postOptions.dryRun && isPosted) {
      ledger = engine.appendProcessed(ledger, { key: eventKey, processedAtIso: nowIso, eventType: event.eventType, jiraKey: event.jiraKey, outcome: 'posted' });
    }
    safeMove(deps, fullPath, processedDir, fileName, runResult);
  }

  deps.writeLedger(ledger);
  return runResult;
}

/** Moves a file, recording (but never throwing on) a move failure so the run always completes. */
function safeMove(deps, fromFullPath, toDirectory, fileName, runResult) {
  try {
    deps.moveFile(fromFullPath, toDirectory, fileName);
  } catch (moveError) {
    runResult.events.push({ fileName, outcome: 'move-failed', message: moveError.message });
  }
}

/** Default postEvent: routes through the shared jiraEventOutput helper. */
function defaultPostEvent(args) {
  return postJiraCommentForEvent(
    args.jiraKey,
    args.commentText,
    args.eventType,
    args.repo,
    args.transitions,
    args.configuration,
    Object.assign({ recordResult: args.recordResult }, args.options),
  );
}

/**
 * Runs the intake immediately. Injectable deps keep it unit-testable without a filesystem or Jira; a
 * manual run never touches the scheduler fired state. Returns { ok, result } or an honest error.
 */
async function runGithubEmailIntakeNow(configuration, deps = {}) {
  if (isRunInProgress) {
    return { ok: false, isAlreadyRunning: true, message: 'A GitHub email intake run is already in progress.' };
  }
  const cfg = ((configuration.scheduler || {}).githubEmailIntake) || {};
  if (!cfg.dropFolder) {
    return { ok: false, message: 'No drop folder configured — set the folder your GitHub emails are saved to.' };
  }

  isRunInProgress = true;
  try {
    const resolvedDeps = {
      listFiles:  deps.listFiles  || defaultListFiles,
      readFile:   deps.readFile   || defaultReadFile,
      moveFile:   deps.moveFile   || defaultMoveFile,
      readLedger: deps.readLedger || readLedgerFromDisk,
      writeLedger: deps.writeLedger || writeLedgerToDisk,
      postEvent:  deps.postEvent  || defaultPostEvent,
      engine:     deps.engine     || getEngine(),
      nowIso:     deps.nowIso     || (() => new Date().toISOString()),
      trigger:    deps.trigger    || 'manual',
      // Injectable so preview can pass a no-op (never touch Outlook) and tests can spy on the export.
      runExport:  deps.runExport  || ((exportConfig) => require('./outlookEmailExport').runOutlookExport(exportConfig)),
    };
    const runResult = await processDropFolder(configuration, resolvedDeps);
    if (deps.writeLastRun !== false) {
      writeLastRunResult(runResult);
    }
    return { ok: true, result: runResult };
  } finally {
    isRunInProgress = false;
  }
}

// ── Scheduled tick ──

function getTodayDateString() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

function getCurrentTimeHHMM() {
  const now = new Date();
  return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
}

let moduleFiredDates = new Map();
let moduleLastIntervalFireMs = 0;
let schedulerIntervalHandle = null;

/**
 * One scheduler tick. Two fire models, chosen by config:
 *   • intervalMin > 0 → fire when at least intervalMin have elapsed since the last interval fire
 *     (in-memory; a restart re-fires once, which the ledger makes harmless).
 *   • otherwise → a once-daily sweep at scheduleTime, with same-day catch-up (reached-or-passed),
 *     guarded by the persisted fired-state so a same-day restart never re-fires.
 * Every input is injectable for tests. Returns true when it fired.
 */
function checkAndFireGithubEmailIntake(configuration, options = {}) {
  const cfg = ((configuration.scheduler || {}).githubEmailIntake) || {};
  if (!cfg.isEnabled || !cfg.dropFolder) {
    return false;
  }
  const isRunBusy = options.isRunBusy || isGithubEmailIntakeRunInProgress;
  if (isRunBusy()) {
    return false;
  }
  const runIntake = options.runIntake || ((liveConfiguration) => runGithubEmailIntakeNow(liveConfiguration, { trigger: 'scheduled' }));

  const intervalMin = Number(cfg.intervalMin) || 0;
  if (intervalMin > 0) {
    const nowMs = options.nowMs || Date.now();
    const lastFireMs = options.lastIntervalFireMs !== undefined ? options.lastIntervalFireMs : moduleLastIntervalFireMs;
    if (lastFireMs !== 0 && nowMs - lastFireMs < intervalMin * MS_PER_MINUTE) {
      return false;
    }
    moduleLastIntervalFireMs = nowMs;
    fireAndForget(runIntake, configuration);
    return true;
  }

  const today = options.today || getTodayDateString();
  const currentTime = options.currentTime || getCurrentTimeHHMM();
  const firedDates = options.firedDates || moduleFiredDates;
  const recordFired = options.recordFired || ((configKey, dateString) => recordFiredDate(FIRED_STATE_SCHEDULER_NAME, configKey, dateString));

  if (firedDates.get(FIRED_STATE_CONFIG_KEY) === today) {
    return false;
  }
  const scheduleTime = cfg.scheduleTime || DEFAULT_SCHEDULE_TIME;
  if (!isScheduledTimeReached(scheduleTime, currentTime)) {
    return false;
  }
  firedDates.set(FIRED_STATE_CONFIG_KEY, today);
  recordFired(FIRED_STATE_CONFIG_KEY, today);
  fireAndForget(runIntake, configuration);
  return true;
}

/** Runs the intake without blocking the tick; a failure is logged, never thrown. */
function fireAndForget(runIntake, configuration) {
  Promise.resolve(runIntake(configuration)).catch((runError) => {
    console.error('  ⚠ GitHub email intake scheduled run failed: ' + (runError instanceof Error ? runError.message : String(runError)));
  });
}

/** Starts the scheduler: seeds fired state from disk, then ticks every 60 seconds on the live config. */
function startGithubEmailIntakeScheduler(configuration) {
  if (schedulerIntervalHandle !== null) {
    return () => {};
  }
  moduleFiredDates = loadFiredDates(FIRED_STATE_SCHEDULER_NAME);
  schedulerIntervalHandle = setInterval(() => checkAndFireGithubEmailIntake(configuration), SCHEDULE_CHECK_INTERVAL_MS);
  console.log('  📧 GitHub Email Intake scheduler started (60s tick).');
  return function stopGithubEmailIntakeScheduler() {
    if (schedulerIntervalHandle !== null) {
      clearInterval(schedulerIntervalHandle);
      schedulerIntervalHandle = null;
    }
  };
}

module.exports = {
  FIRED_STATE_SCHEDULER_NAME,
  FIRED_STATE_CONFIG_KEY,
  DEFAULT_SCHEDULE_TIME,
  buildDedupKeys,
  isProjectAllowed,
  buildCommentText,
  optionsForMode,
  processDropFolder,
  runGithubEmailIntakeNow,
  isGithubEmailIntakeRunInProgress,
  readLastRunResult,
  checkAndFireGithubEmailIntake,
  startGithubEmailIntakeScheduler,
};
