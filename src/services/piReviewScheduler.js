// piReviewScheduler.js — Per-team scheduler that refreshes PI Review Confluence pages from Jira on a
// daily HH:MM, mirroring the other NodeToolbox schedulers (60-second tick, once-per-day + catch-up via
// schedulerFiredState, live config). Each due team's pages are routed through refreshPiReviewPage.
//
// linkedom (the headless DOM the refresh engine needs) is required LAZILY, only when a run actually
// happens — so this module (and the route that imports it) load cleanly under Jest, which cannot parse
// linkedom's ESM dependency. The tick is factored to accept injected time/run hooks so it is unit-testable
// without timers or a real clock.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { makeJiraApiRequest, makeConfluenceApiRequest } = require('../utils/httpClient');
const { isScheduledTimeReached, loadFiredDates, recordFiredDate } = require('./schedulerFiredState');
const { refreshPiReviewPage } = require('./piReviewRefresh');

// ── Constants ──

/** Stable name under which this scheduler's fired dates are persisted. */
const FIRED_STATE_SCHEDULER_NAME = 'piReview';
/** How often (ms) the scheduler checks for pages to refresh. */
const SCHEDULE_CHECK_INTERVAL_MS = 60 * 1000;
/** Default fire time when a team has no scheduleTime set. */
const DEFAULT_SCHEDULE_TIME = '06:00';

// ── Module state ──

let lastFiredDates = new Map();
let schedulerIntervalHandle = null;
const runningTeamKeys = new Set(); // overlap guard: team configKeys currently mid-run
let cachedDomParser = null;

// ── Time helpers ──

/** Current local time as zero-padded "HH:MM". */
function getCurrentTimeHHMM() {
  const now = new Date();
  return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
}

/** Today's local date as "YYYY-MM-DD". */
function getTodayDateString() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

// ── Persisted last-run results (FR-019) ──

/** Path of the last-run results file; overridable via env so tests never touch the real profile. */
function getResultsFilePath() {
  return process.env.TBX_PI_REVIEW_RESULTS_PATH
    || path.join(process.env.APPDATA || os.homedir(), 'NodeToolbox', 'pi-review-run-results.json');
}

/** Reads all persisted per-team results; returns {} on any missing/corrupt file. */
function readAllRunResults() {
  try {
    return JSON.parse(fs.readFileSync(getResultsFilePath(), 'utf8')) || {};
  } catch (_readError) {
    return {};
  }
}

/** Records a whole run's per-page results in a single read-modify-write (one file write per run). */
function recordTeamRunResults(teamName, results) {
  if (!results.length) {
    return;
  }
  const allResults = readAllRunResults();
  const teamKey = teamName || '(unnamed team)';
  const ranPageIds = new Set(results.map((result) => result.pageUrlOrId));
  const keptForOtherPages = (allResults[teamKey] || []).filter((entry) => !ranPageIds.has(entry.pageUrlOrId));
  allResults[teamKey] = [...keptForOtherPages, ...results];
  try {
    fs.mkdirSync(path.dirname(getResultsFilePath()), { recursive: true });
    fs.writeFileSync(getResultsFilePath(), JSON.stringify(allResults, null, 2) + '\n', 'utf8');
  } catch (writeError) {
    console.error('  ⚠ Could not persist PI Review run results: ' + writeError.message);
  }
}

/** Returns the persisted last-run results keyed by team name (for the Admin Hub status view). */
function readLastRunResults() {
  return readAllRunResults();
}

// ── DOM host (lazy) ──

/** Lazily constructs linkedom's DOMParser — deferred so this module loads without linkedom present. */
function getLinkedomDomParser() {
  if (!cachedDomParser) {
    const { DOMParser } = require('linkedom');
    cachedDomParser = new DOMParser();
  }
  return cachedDomParser;
}

// ── Fired-state helpers ──

function hasAlreadyFiredToday(configKey, firedDates, today) {
  return firedDates.get(configKey) === today;
}

function markFiredToday(configKey, firedDates, today, recordFired) {
  firedDates.set(configKey, today);
  recordFired(configKey, today);
}

/** A stable per-team config key for fired-state + overlap tracking. */
function buildTeamConfigKey(team, teamIndex) {
  return 'piReview-team-' + teamIndex + '-' + (team.teamName || '');
}

// ── Run one team now ──

/**
 * Refreshes every configured page for one team immediately (bypasses the schedule/fired-state).
 * @returns {Promise<{ok: boolean, teamName: string, results: object[]}>}
 */
async function runPiReviewTeamNow(configuration, teamReference, deps = {}) {
  const teams = ((configuration.scheduler || {}).piReview || {}).teams || [];
  const team = typeof teamReference === 'number'
    ? teams[teamReference]
    : teams.find((candidate) => candidate.teamName === teamReference);
  if (!team) {
    return { ok: false, teamName: String(teamReference), results: [] };
  }

  const runDeps = {
    makeJiraApiRequest: deps.makeJiraApiRequest || makeJiraApiRequest,
    makeConfluenceApiRequest: deps.makeConfluenceApiRequest || makeConfluenceApiRequest,
    domParser: deps.domParser || getLinkedomDomParser(),
    nowIso: deps.nowIso,
  };

  const results = [];
  for (const page of team.pages || []) {
    // eslint-disable-next-line no-await-in-loop -- pages are refreshed sequentially to bound Jira/Confluence load
    const result = await refreshPiReviewPage({ page, team, deps: runDeps, configuration });
    results.push(result);
  }
  recordTeamRunResults(team.teamName, results); // one file write per run, not per page
  return { ok: results.every((result) => result.status !== 'failed'), teamName: team.teamName || '', results };
}

// ── The tick ──

/**
 * Fires every enabled team whose scheduleTime has been reached today and that has not already fired
 * or is not already running. Injectable hooks (currentTime/today/runTeam/firedDates/runningTeams)
 * make it unit-testable without a clock or timers. Returns the configKeys fired this tick.
 */
function checkAndFireScheduledPiReviews(configuration, options = {}) {
  const currentTime = options.currentTime || getCurrentTimeHHMM();
  const today = options.today || getTodayDateString();
  const firedDates = options.firedDates || lastFiredDates;
  const runningKeys = options.runningTeams || runningTeamKeys;
  const recordFired = options.recordFired
    || ((configKey, date) => recordFiredDate(FIRED_STATE_SCHEDULER_NAME, configKey, date));
  const runTeam = options.runTeam || ((cfg, _team, teamIndex) => runPiReviewTeamNow(cfg, teamIndex));

  const teams = ((configuration.scheduler || {}).piReview || {}).teams || [];
  const firedThisTick = [];

  for (let teamIndex = 0; teamIndex < teams.length; teamIndex += 1) {
    const team = teams[teamIndex];
    if (!team || !team.isEnabled) continue;

    const scheduledTime = team.scheduleTime || DEFAULT_SCHEDULE_TIME;
    if (!isScheduledTimeReached(scheduledTime, currentTime)) continue;

    const configKey = buildTeamConfigKey(team, teamIndex);
    if (hasAlreadyFiredToday(configKey, firedDates, today)) continue;
    if (runningKeys.has(configKey)) continue; // don't start a second concurrent run for this team

    markFiredToday(configKey, firedDates, today, recordFired);
    runningKeys.add(configKey);
    firedThisTick.push(configKey);
    console.log('  📤 PI Review scheduler: refreshing team ' + (team.teamName || teamIndex));
    Promise.resolve(runTeam(configuration, team, teamIndex))
      .catch((runError) => console.error('  ⚠ PI Review scheduler error (' + (team.teamName || teamIndex) + '): ' + runError.message))
      .then(() => runningKeys.delete(configKey));
  }

  return firedThisTick;
}

// ── Entry point ──

/**
 * Starts the PI Review scheduler: a 60-second tick that refreshes due teams. Reads config live so
 * enabling/disabling or changing a time takes effect without a restart.
 * @returns {Function} stop function that clears the interval
 */
function startPiReviewScheduler(configuration) {
  if (schedulerIntervalHandle) {
    clearInterval(schedulerIntervalHandle);
  }
  console.log('  🗓  PI Review scheduler started — checking every minute');
  lastFiredDates = loadFiredDates(FIRED_STATE_SCHEDULER_NAME);
  schedulerIntervalHandle = setInterval(() => {
    checkAndFireScheduledPiReviews(configuration);
  }, SCHEDULE_CHECK_INTERVAL_MS);
  return () => clearInterval(schedulerIntervalHandle);
}

module.exports = {
  startPiReviewScheduler,
  runPiReviewTeamNow,
  checkAndFireScheduledPiReviews,
  readLastRunResults,
  recordTeamRunResults,
};
