// changeAutoScheduleScheduler.js — Moves a ServiceNow change to "Scheduled" when its planned start
// arrives, without anybody having to be watching.
//
// The tick chassis is the one every other NodeToolbox scheduler uses: a 60-second interval reading
// live config, so enabling it or changing the sweep interval takes effect without a restart.
//
// The ONE thing that makes this scheduler different from its siblings, and the reason its failure
// handling looks the way it does: ServiceNow writes go through the relay bookmarklet, which needs a
// live browser session. There is no credentialed write path. So a sweep that finds due work while
// the relay is unregistered has NOT failed — the work is still due, and the next sweep will do it.
// Nothing is marked done that did not happen, and the reason is recorded rather than swallowed.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const relayBridge = require('../routes/relayBridge');
const { SCHEDULED_STATE_VALUE, SUBMITTED_STATE_VALUE, listChangeScheduleDecisions } = require('./changeAutoSchedule');

// ── Constants ──

/** How often (ms) the scheduler wakes to look for changes whose planned start has arrived. */
const SCHEDULE_CHECK_INTERVAL_MS = 60 * 1000;

/** Default minutes between sweeps when none is configured — a change starts on a whole minute. */
const DEFAULT_SWEEP_INTERVAL_MINUTES = 5;

/** How many changes one sweep will read. Far above any one person's active change list. */
const CHANGE_QUERY_LIMIT = 100;

/** Fields the sweep needs. Raw values only — a display value is formatted for the reader's profile. */
const CHANGE_QUERY_FIELDS = 'sys_id,number,short_description,state,start_date';

/** How long to wait for the relay to answer one request. Matches the other relay callers. */
const RELAY_TIMEOUT_MS = 30 * 1000;

/** Most recent sweep outcomes kept for the Admin Hub panel. Older entries fall off the end. */
const MAX_RECORDED_RUNS = 20;

// ── Module state ──

let schedulerIntervalHandle = null;
let lastSweptMinuteSlot = '';
let isSweepInFlight = false;

// ── Persisted run history (so the panel can prove what happened) ──

/** Path of the run-history file; overridable via env so tests never touch the real profile. */
function getRunHistoryFilePath() {
  return process.env.TBX_CHANGE_AUTO_SCHEDULE_RESULTS_PATH
    || path.join(process.env.APPDATA || os.homedir(), 'NodeToolbox', 'change-auto-schedule-runs.json');
}

/** Reads the recorded sweeps; an absent or corrupt file reads as no history rather than throwing. */
function readRunHistory() {
  try {
    const parsedHistory = JSON.parse(fs.readFileSync(getRunHistoryFilePath(), 'utf8'));
    return Array.isArray(parsedHistory) ? parsedHistory : [];
  } catch (_readError) {
    return [];
  }
}

/** Appends one sweep to the history, newest first, bounded so the file cannot grow forever. */
function recordRun(runSummary) {
  const boundedHistory = [runSummary].concat(readRunHistory()).slice(0, MAX_RECORDED_RUNS);
  try {
    fs.mkdirSync(path.dirname(getRunHistoryFilePath()), { recursive: true });
    fs.writeFileSync(getRunHistoryFilePath(), JSON.stringify(boundedHistory, null, 2) + '\n', 'utf8');
  } catch (writeError) {
    console.error('  ⚠ Could not persist change auto-schedule history: ' + writeError.message);
  }
}

// ── Config ──

/** Reads this scheduler's config block, with every default applied. */
function readSchedulerConfig(configuration) {
  const storedConfig = ((configuration || {}).scheduler || {}).changeAutoSchedule || {};
  return {
    isEnabled: !!storedConfig.isEnabled,
    intervalMin: Number(storedConfig.intervalMin) > 0
      ? Math.floor(Number(storedConfig.intervalMin))
      : DEFAULT_SWEEP_INTERVAL_MINUTES,
    leadTimeMinutes: Math.max(0, Math.floor(Number(storedConfig.leadTimeMinutes) || 0)),
    isDryRun: !!storedConfig.isDryRun,
  };
}

// ── ServiceNow access (every call goes through the relay) ──

/**
 * The clause that scopes a query to whoever is signed in, evaluated by ServiceNow itself.
 *
 * This is the form Release Management, Modify CHG and My Issues all already use, and it needs no
 * user lookup at all. The first attempt here looked the user up first and asked sys_user for
 * `user_name=javascript:gs.getUserID()` — but gs.getUserID() returns a sys_id, not a user name, so
 * it matched nothing and every sweep gave up saying it could not identify the signed-in user.
 */
const ASSIGNED_TO_CURRENT_USER_CLAUSE = 'assigned_to=javascript:gs.getUserID()';

/** Asks ServiceNow for the current user's submitted changes, so a sweep never touches anyone else's. */
async function fetchSubmittedChangesForCurrentUser(submitRelayRequest) {
  const queryParts = [
    'state=' + SUBMITTED_STATE_VALUE,
    ASSIGNED_TO_CURRENT_USER_CLAUSE,
  ];
  const changesResponse = await submitRelayRequest('snow', {
    method: 'GET',
    url: '/api/now/v2/table/change_request'
      + '?sysparm_query=' + encodeURIComponent(queryParts.join('^'))
      + '&sysparm_fields=' + CHANGE_QUERY_FIELDS
      + '&sysparm_limit=' + CHANGE_QUERY_LIMIT,
  }, RELAY_TIMEOUT_MS);

  return { changes: (changesResponse && changesResponse.result) || [], skipReason: '' };
}

/** Writes one change into the Scheduled state. */
async function moveChangeToScheduled(submitRelayRequest, changeSysId) {
  await submitRelayRequest('snow', {
    method: 'PATCH',
    url: '/api/now/v2/table/change_request/' + changeSysId,
    body: { state: SCHEDULED_STATE_VALUE },
  }, RELAY_TIMEOUT_MS);
}

// ── One sweep ──

/**
 * Runs one sweep: read the signed-in user's submitted changes, decide which are due, and move those.
 *
 * Every dependency is injectable so the sweep is unit-testable with no relay, no clock and no disk.
 * Returns a summary that names what moved, what did not, and why — the panel renders it verbatim.
 */
async function runChangeAutoScheduleSweep(configuration, deps = {}) {
  const submitRelayRequest = deps.submitRelayRequest || relayBridge.submitRelayRequest;
  const isRelayConnected = deps.isRelayConnected || (() => relayBridge.getBridgeStatus('snow'));
  const currentTimeMs = deps.currentTimeMs !== undefined ? deps.currentTimeMs : Date.now();
  const recordRunSummary = deps.recordRun || recordRun;

  const schedulerConfig = readSchedulerConfig(configuration);
  const runSummary = {
    ranAtIso: new Date(currentTimeMs).toISOString(),
    isDryRun: schedulerConfig.isDryRun,
    scheduledChangeNumbers: [],
    failures: [],
    skipReason: '',
    consideredCount: 0,
  };

  // The relay is a live browser session, not a credential. Without it the work is still due, so the
  // sweep reports why it could not act and leaves the next sweep to do it.
  if (!isRelayConnected()) {
    runSummary.skipReason = 'The ServiceNow relay bookmarklet is not registered, so no change could be updated.';
    recordRunSummary(runSummary);
    return runSummary;
  }

  let submittedChanges = [];
  try {
    const fetchResult = await fetchSubmittedChangesForCurrentUser(submitRelayRequest);
    if (fetchResult.skipReason) {
      runSummary.skipReason = fetchResult.skipReason;
      recordRunSummary(runSummary);
      return runSummary;
    }
    submittedChanges = fetchResult.changes;
  } catch (fetchError) {
    runSummary.skipReason = 'Could not read changes from ServiceNow: ' + fetchError.message;
    recordRunSummary(runSummary);
    return runSummary;
  }

  const decisions = listChangeScheduleDecisions(submittedChanges, currentTimeMs, schedulerConfig.leadTimeMinutes);
  runSummary.consideredCount = decisions.length;

  for (const decision of decisions) {
    if (!decision.shouldSchedule) continue;
    if (schedulerConfig.isDryRun) {
      runSummary.scheduledChangeNumbers.push(decision.changeNumber);
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop -- changes are moved one at a time to bound relay load
      await moveChangeToScheduled(submitRelayRequest, decision.changeSysId);
      runSummary.scheduledChangeNumbers.push(decision.changeNumber);
      console.log('  🗓  Change ' + decision.changeNumber + ' moved to Scheduled at its planned start');
    } catch (updateError) {
      // One refusal must not abandon the rest of the list — the others are still due.
      runSummary.failures.push({ changeNumber: decision.changeNumber, message: updateError.message });
    }
  }

  recordRunSummary(runSummary);
  return runSummary;
}

// ── The tick ──

/** Today's local date and clock minute, as the slot key that stops one minute sweeping twice. */
function buildMinuteSlot(now) {
  return now.getFullYear()
    + '-' + String(now.getMonth() + 1).padStart(2, '0')
    + '-' + String(now.getDate()).padStart(2, '0')
    + ' ' + String(now.getHours()).padStart(2, '0')
    + ':' + String(now.getMinutes()).padStart(2, '0');
}

/** Minutes since midnight for a Date, used to decide whether this minute is on a sweep boundary. */
function readMinutesSinceMidnight(now) {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Decides whether this tick should sweep, and sweeps if so.
 *
 * Sweeps land on clock-aligned boundaries of the configured interval (:00/:05/:10 for 5), the same
 * model the GitHub email intake uses, so the timing is predictable rather than drifting from
 * whenever the server happened to start. Injectable hooks make it testable without timers.
 * Returns true when a sweep was started.
 */
function checkAndSweepDueChanges(configuration, options = {}) {
  const schedulerConfig = readSchedulerConfig(configuration);
  if (!schedulerConfig.isEnabled) {
    return false;
  }

  const now = options.now || new Date();
  const currentSlot = buildMinuteSlot(now);
  const slotState = options.slotState || { lastSweptMinuteSlot };
  const isOnBoundary = readMinutesSinceMidnight(now) % schedulerConfig.intervalMin === 0;
  if (!isOnBoundary || slotState.lastSweptMinuteSlot === currentSlot) {
    return false;
  }

  // A slow sweep must not have a second one started on top of it — that would move the same change
  // twice and produce a spurious failure on the second attempt.
  const inFlightState = options.inFlightState || { isSweepInFlight };
  if (inFlightState.isSweepInFlight) {
    return false;
  }

  slotState.lastSweptMinuteSlot = currentSlot;
  inFlightState.isSweepInFlight = true;
  if (options.slotState === undefined) lastSweptMinuteSlot = currentSlot;
  if (options.inFlightState === undefined) isSweepInFlight = true;

  const runSweep = options.runSweep || ((config) => runChangeAutoScheduleSweep(config));
  Promise.resolve(runSweep(configuration))
    .catch((sweepError) => console.error('  ⚠ Change auto-schedule sweep error: ' + sweepError.message))
    .then(() => {
      inFlightState.isSweepInFlight = false;
      if (options.inFlightState === undefined) isSweepInFlight = false;
    });

  return true;
}

// ── Entry point ──

/**
 * Starts the change auto-schedule sweeper: a 60-second tick that moves due changes to Scheduled.
 * Reads config live, so enabling it or changing the interval needs no restart.
 * @returns {Function} stop function that clears the interval
 */
function startChangeAutoScheduleScheduler(configuration) {
  if (schedulerIntervalHandle) {
    clearInterval(schedulerIntervalHandle);
  }
  console.log('  🗓  Change auto-schedule scheduler started — checking every minute');
  schedulerIntervalHandle = setInterval(() => {
    checkAndSweepDueChanges(configuration);
  }, SCHEDULE_CHECK_INTERVAL_MS);
  return () => clearInterval(schedulerIntervalHandle);
}

module.exports = {
  startChangeAutoScheduleScheduler,
  checkAndSweepDueChanges,
  runChangeAutoScheduleSweep,
  readSchedulerConfig,
  readRunHistory,
  DEFAULT_SWEEP_INTERVAL_MINUTES,
};
