// src/services/schedulerFiredState.js — Persists each scheduler's "last fired" dates
// across server restarts so daily reports can CATCH UP after downtime instead of
// silently skipping a missed slot.
//
// The problem this solves: every report scheduler used to fire only on an EXACT
// HH:MM minute match, and tracked "already fired today" in memory only. If the
// server was not running during that exact minute (a restart, a late start, a busy
// event loop), the slot passed un-checked and the report was skipped for the whole
// day. By recording the last-fired date on disk and comparing "has the scheduled
// time been reached yet today", a scheduler that starts late can still deliver the
// day's report, and a restart cannot cause a duplicate delivery.

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Constants ──

/**
 * Persistent state file location. Kept alongside the proxy config in AppData so it
 * survives restarts and zip-extraction upgrades, exactly like toolbox-proxy.json.
 * Overridable via TBX_FIRED_STATE_PATH so tests never touch the real user profile.
 */
const DEFAULT_STATE_DIR  = path.join(process.env.APPDATA || os.homedir(), 'NodeToolbox');
const DEFAULT_STATE_FILE = path.join(DEFAULT_STATE_DIR, 'scheduler-fired-state.json');

// ── Path resolution ──

/**
 * Returns the absolute path of the fired-state file, honouring the test override.
 * Read lazily on every call so a test can set the env var before exercising the store.
 *
 * @returns {string}
 */
function getStateFilePath() {
  return process.env.TBX_FIRED_STATE_PATH || DEFAULT_STATE_FILE;
}

// ── Pure helpers (no I/O) ──

/**
 * Returns true when the scheduled time-of-day has been reached or passed for the
 * current time-of-day. Both values are zero-padded 24-hour "HH:MM" strings, which
 * compare correctly with a plain lexicographic string comparison.
 *
 * This replaces the old exact-equality check (`scheduled === current`). With a
 * "reached or passed" comparison, a scheduler that first ticks AFTER the scheduled
 * minute (because the server started late) still recognises the slot as due.
 *
 * @param {string} scheduledTime - The configured fire time, e.g. "09:00".
 * @param {string} currentTime   - The current local time, e.g. "09:03".
 * @returns {boolean}
 */
function isScheduledTimeReached(scheduledTime, currentTime) {
  if (typeof scheduledTime !== 'string' || typeof currentTime !== 'string') return false;
  if (!/^\d{2}:\d{2}$/.test(scheduledTime) || !/^\d{2}:\d{2}$/.test(currentTime)) return false;
  return currentTime >= scheduledTime;
}

/**
 * Parses the raw JSON text of the state file into a plain object. Returns an empty
 * object for missing, empty, or corrupt content so a damaged file never blocks a fire.
 *
 * @param {string} rawJson
 * @returns {object} Map of schedulerName → { configKey: "YYYY-MM-DD" }
 */
function parseStateJson(rawJson) {
  if (!rawJson) return {};
  try {
    const parsed = JSON.parse(rawJson);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (_parseError) {
    return {};
  }
}

// ── File I/O ──

/**
 * Reads and parses the entire state file. Never throws — any read or parse failure
 * yields an empty object so the scheduler degrades to "nothing fired yet" rather
 * than crashing on startup.
 *
 * @returns {object}
 */
function readStateObject() {
  const stateFilePath = getStateFilePath();
  if (!fs.existsSync(stateFilePath)) return {};
  try {
    return parseStateJson(fs.readFileSync(stateFilePath, 'utf8'));
  } catch (_readError) {
    return {};
  }
}

/**
 * Writes the full state object back to disk, creating the directory if needed.
 * Failures are logged but non-fatal — a read-only filesystem must not stop a report
 * from being delivered; it only loses cross-restart catch-up protection.
 *
 * @param {object} stateObject
 */
function writeStateObject(stateObject) {
  const stateFilePath = getStateFilePath();
  try {
    fs.mkdirSync(path.dirname(stateFilePath), { recursive: true });
    fs.writeFileSync(stateFilePath, JSON.stringify(stateObject, null, 2) + '\n', 'utf8');
  } catch (writeError) {
    console.error('  ⚠ Could not persist scheduler fired-state: ' + writeError.message);
  }
}

// ── Public API ──

/**
 * Loads the persisted last-fired dates for one scheduler into a Map. Called once when
 * a scheduler starts so its in-memory tracker is seeded with what already fired today
 * (before the restart) — preventing a duplicate delivery on catch-up.
 *
 * @param {string} schedulerName - Stable key, e.g. "scopeChange" or "featureChange".
 * @returns {Map<string, string>} configKey → "YYYY-MM-DD"
 */
function loadFiredDates(schedulerName) {
  const stateObject  = readStateObject();
  const schedulerMap = stateObject[schedulerName];
  if (!schedulerMap || typeof schedulerMap !== 'object') return new Map();
  return new Map(Object.entries(schedulerMap));
}

/**
 * Records that a single config key fired on the given date and persists it immediately,
 * so a restart later the same day knows the slot is already satisfied.
 *
 * @param {string} schedulerName
 * @param {string} configKey   - Identifier unique within the scheduler (e.g. "team-0-ABC").
 * @param {string} dateString  - "YYYY-MM-DD" the entry fired on.
 */
function recordFiredDate(schedulerName, configKey, dateString) {
  const stateObject = readStateObject();
  if (!stateObject[schedulerName] || typeof stateObject[schedulerName] !== 'object') {
    stateObject[schedulerName] = {};
  }
  stateObject[schedulerName][configKey] = dateString;
  writeStateObject(stateObject);
}

module.exports = {
  isScheduledTimeReached,
  loadFiredDates,
  recordFiredDate,
  // Exported for unit testing.
  parseStateJson,
  getStateFilePath,
};
