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

/** The comment each event type posts (mirrors the repo monitor's wording). */
const EVENT_COMMENT_TEMPLATES = {
  branch_created:   '🔀 GitHub: branch created and work has started.',
  commit_pushed:    '✅ GitHub: new commit pushed to feature branch.',
  pr_opened:        '📬 GitHub: pull request opened for review.',
  pr_merged:        '🎉 GitHub: pull request has been merged.',
  review_requested: '👀 GitHub: a review was requested.',
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
  // A custom bucket (an AI-authored rule's own event type) has no template — give it the same
  // emoji-led style as the built-ins so agent-created rules read consistently in Jira.
  const base = EVENT_COMMENT_TEMPLATES[event.eventType] || ('🔔 GitHub: ' + event.eventType.replace(/_/g, ' ') + '.');
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

    // An operator-tuned custom rule (from the Rules panel) may override the comment and set a per-rule
    // transition. Look it up by the rule that classified this email; built-in classifications have no override.
    const matchedRule = (cfg.customRules || []).find((customRule) => customRule.id === event.matchedRuleId);
    const commentText = matchedRule && typeof matchedRule.comment === 'string' && matchedRule.comment.trim() !== ''
      ? matchedRule.comment
      : buildCommentText(event);
    const forcedTransitionStatus = matchedRule && typeof matchedRule.transitionStatus === 'string'
      ? matchedRule.transitionStatus
      : '';
    // Parent-story actions (merged branch names reference the dev sub-task; the story is what the
    // team tracks): a rule may move the matched issue's PARENT and/or set its Sub-status dropdown.
    // The all-coding-sub-tasks-done guard is ON unless the rule explicitly turns it off.
    const parentTransitionStatus = matchedRule && typeof matchedRule.parentTransitionStatus === 'string'
      ? matchedRule.parentTransitionStatus.trim()
      : '';
    const parentSubStatusValue = matchedRule && typeof matchedRule.parentSubStatusValue === 'string'
      ? matchedRule.parentSubStatusValue.trim()
      : '';
    const parentActions = (parentTransitionStatus || parentSubStatusValue)
      ? {
        transitionStatus: parentTransitionStatus,
        requireAllDevDone: !(matchedRule && matchedRule.parentRequiresAllDevDone === false),
        subStatusValue: parentSubStatusValue,
        subStatusFieldId: (typeof cfg.subStatusFieldId === 'string' && cfg.subStatusFieldId.trim() !== '')
          ? cfg.subStatusFieldId.trim()
          : 'customfield_10201',
      }
      : null;

    // Only attach a forced transition / parent actions when the rule actually sets them, so a plain
    // run's options stay clean.
    const postOptionsForFile = (forcedTransitionStatus || parentActions)
      ? Object.assign(
        {},
        postOptions,
        forcedTransitionStatus ? { forcedTransitionStatus } : {},
        parentActions ? { parentActions } : {},
      )
      : postOptions;

    // Drive Jira (or a dry run). The result records land on the run via the recordResult sink.
    const resultRecords = [];
    await deps.postEvent({
      jiraKey: event.jiraKey,
      commentText,
      eventType: event.eventType,
      repo: event.repo || 'unknown/unknown',
      transitions: cfg.transitions || {},
      configuration,
      options: postOptionsForFile,
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

// ── Rule-sample collection (read-only: for the bulk AI rule generator) ──

// Cap the number of emails returned so a huge drop folder can't build an unusable payload/prompt.
const MAX_RULE_SAMPLES = 60;

/**
 * Reads the drop folder and returns the raw source of each email with its current classification, so the
 * Admin panel can bundle them into ONE bulk AI prompt. Purely read-only: it never posts, moves, or ledgers.
 * By default it returns only the emails the engine currently classifies as 'unknown' (the ones that actually
 * need a rule); pass options.includeAll to return every eligible email. All I/O is injected for tests.
 *
 * @param {object} configuration - live server config
 * @param {object} deps - { includeAll?, listFiles?, readFile?, engine? }
 * @returns {{ ok: boolean, message?: string, samples: object[], totalCount: number, unknownCount: number, truncated: boolean }}
 */
function collectRuleSamples(configuration, deps = {}) {
  const cfg = ((configuration.scheduler || {}).githubEmailIntake) || {};
  const dropFolder = cfg.dropFolder || '';
  if (dropFolder === '') {
    return { ok: false, message: 'No drop folder configured — set it and save first.', samples: [], totalCount: 0, unknownCount: 0, truncated: false };
  }

  const includeAll = deps.includeAll === true;
  const listFiles = deps.listFiles || defaultListFiles;
  const readFile = deps.readFile || defaultReadFile;
  const engine = deps.engine || getEngine();
  const fileExtensions = cfg.fileExtensions || ['.eml', '.txt', '.msg'];

  // Scan the drop folder AND its processed/error archives. After ANY run — including the default dry run —
  // every email is moved out of the root into _processed (or _errors), so the emails a user needs to teach a
  // rule for almost always live there, not in the root. Reading the root alone found nothing once a run had
  // swept the folder (GH #262 follow-up). The root is required; a missing/unreadable archive is simply skipped.
  const processedDir = cfg.processedArchiveFolder || path.join(dropFolder, PROCESSED_SUBFOLDER);
  const errorDir = cfg.errorFolder || path.join(dropFolder, ERROR_SUBFOLDER);

  let rootFileNames;
  try {
    rootFileNames = listFiles(dropFolder, fileExtensions);
  } catch (listError) {
    return { ok: false, message: 'Could not read drop folder: ' + listError.message, samples: [], totalCount: 0, unknownCount: 0, truncated: false };
  }

  // Gather (folder, fileName) pairs from the root first, then the archives; dedup by file name so a moved
  // email (which keeps its name and lives in exactly one folder) is never counted twice.
  const seenFileNames = new Set();
  const candidates = [];
  const addFolderFiles = (folder, fileNames) => {
    for (const fileName of fileNames) {
      if (seenFileNames.has(fileName)) {
        continue;
      }
      seenFileNames.add(fileName);
      candidates.push({ folder, fileName });
    }
  };
  addFolderFiles(dropFolder, rootFileNames);
  for (const archiveDir of [processedDir, errorDir]) {
    try {
      addFolderFiles(archiveDir, listFiles(archiveDir, fileExtensions));
    } catch (_archiveError) {
      // An archive folder that does not exist yet (no run has swept anything) is simply skipped.
    }
  }

  const samples = [];
  let totalCount = 0;
  let unknownCount = 0;
  for (const candidate of candidates) {
    const fullPath = path.join(candidate.folder, candidate.fileName);
    let rawSource;
    try {
      rawSource = readFile(fullPath);
    } catch (_readError) {
      continue; // An unreadable file is simply skipped for sample-collection.
    }
    let event;
    try {
      event = engine.parseGithubEmail(rawSource, cfg.customRules || []);
    } catch (_parseError) {
      // A file we cannot parse is itself a candidate needing a rule — treat it as 'unknown'.
      event = { eventType: 'unknown', jiraKey: null };
    }
    totalCount += 1;
    const isUnknown = event.eventType === 'unknown';
    if (isUnknown) {
      unknownCount += 1;
    }
    if (includeAll || isUnknown) {
      samples.push({ fileName: candidate.fileName, eventType: event.eventType, jiraKey: event.jiraKey || null, rawSource });
    }
  }

  const truncated = samples.length > MAX_RULE_SAMPLES;
  return { ok: true, samples: samples.slice(0, MAX_RULE_SAMPLES), totalCount, unknownCount, truncated };
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
let moduleLastAlignedSlot = '';
let schedulerIntervalHandle = null;

/** Parses an "HH:MM" clock string into minutes since midnight (a bad value yields 0). */
function minutesSinceMidnight(hhmm) {
  const [hoursPart, minutesPart] = String(hhmm || '').split(':').map((part) => Number(part));
  if (Number.isNaN(hoursPart) || Number.isNaN(minutesPart)) {
    return 0;
  }
  return hoursPart * 60 + minutesPart;
}

/**
 * One scheduler tick. Two fire models, chosen by config:
 *   • intervalMin > 0 → CLOCK-ALIGNED interval: fire on wall-clock boundaries of intervalMin (e.g. :00 and
 *     :30 for 30), at or after scheduleTime as the daily earliest run. This runs at the top and middle of
 *     each hour starting at (say) 07:00 — rather than intervalMin after the previous run, which drifted from
 *     whenever the server happened to start. A per-slot guard means the 60s tick fires each boundary once.
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
    const today = options.today || getTodayDateString();
    const currentTime = options.currentTime || getCurrentTimeHHMM();
    const scheduleTime = cfg.scheduleTime || DEFAULT_SCHEDULE_TIME;
    // Fire only on a clock boundary (minutes since midnight divisible by the interval) and only once the
    // daily start time has been reached — so a 30-minute interval starting 07:00 runs 07:00, 07:30, 08:00…
    const isOnBoundary = minutesSinceMidnight(currentTime) % intervalMin === 0;
    const isAtOrAfterStart = isScheduledTimeReached(scheduleTime, currentTime);
    const currentSlot = today + ' ' + currentTime;
    const lastSlot = options.lastAlignedSlot !== undefined ? options.lastAlignedSlot : moduleLastAlignedSlot;
    if (!isOnBoundary || !isAtOrAfterStart || currentSlot === lastSlot) {
      return false;
    }
    moduleLastAlignedSlot = currentSlot;
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
  collectRuleSamples,
  isGithubEmailIntakeRunInProgress,
  readLastRunResult,
  checkAndFireGithubEmailIntake,
  startGithubEmailIntakeScheduler,
};
