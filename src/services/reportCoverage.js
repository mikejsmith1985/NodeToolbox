// src/services/reportCoverage.js — Per-report "coverage watermark" so a report's window
// follows the last time it actually RAN, not a fixed prior-business-day assumption.
//
// The problem this solves: the scope/feature change reports look back to the previous
// business day, which silently assumes the report ran and wrote every prior business day.
// If the server was down on the day that would have reported a change, that change fell into
// a permanent gap — it was never written, even though it was genuinely new since the page
// was last updated. By remembering the timestamp through which each report has confirmed
// coverage (it delivered changes, or confirmed there were none) and extending the next
// run's window back to that point, missed/downtime days self-heal.
//
// Normal daily operation is unchanged: when a report runs every day, its watermark is
// always ~yesterday, so the window equals the prior business day exactly as before.

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Constants ──

/** Hard cap on how far back a catch-up window may reach, so a long outage cannot produce a
 *  query window of months (which would blow past Jira's result cap and miss issues anyway). */
const DEFAULT_MAX_LOOKBACK_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Persistent watermark file, kept beside the other NodeToolbox state in AppData.
 * Overridable via TBX_REPORT_COVERAGE_PATH so tests never touch the real user profile.
 */
const DEFAULT_COVERAGE_DIR  = path.join(process.env.APPDATA || os.homedir(), 'NodeToolbox');
const DEFAULT_COVERAGE_FILE = path.join(DEFAULT_COVERAGE_DIR, 'report-coverage.json');

// ── Path resolution ──

/** Returns the watermark file path, honouring the test override. @returns {string} */
function getCoverageFilePath() {
  return process.env.TBX_REPORT_COVERAGE_PATH || DEFAULT_COVERAGE_FILE;
}

// ── Pure cutoff resolution (no I/O) ──

/**
 * Resolves the cutoff date a report should query from. Returns the prior-business-day cutoff
 * in normal operation, but reaches further back to the last confirmed coverage point when the
 * report has missed days — never beyond the max-lookback cap.
 *
 * @param {string|null} watermarkIso     - ISO timestamp this report last confirmed coverage through.
 * @param {Date}        businessDayCutoff - The normal prior-business-day cutoff (midnight).
 * @param {Date}        now               - Current time (for the lookback cap).
 * @param {number}      [maxLookbackDays] - Maximum days to reach back. Defaults to 30.
 * @returns {Date}
 */
function resolveCoverageCutoff(watermarkIso, businessDayCutoff, now, maxLookbackDays = DEFAULT_MAX_LOOKBACK_DAYS) {
  const businessDayMs = businessDayCutoff.getTime();
  const watermarkMs = watermarkIso ? new Date(watermarkIso).getTime() : NaN;

  // No watermark yet (first run after install) → behave exactly like today: prior business day.
  if (Number.isNaN(watermarkMs)) {
    return new Date(businessDayMs);
  }

  // Reach back to the last confirmed coverage when it is older than the prior business day
  // (i.e. days were missed), but never further than the lookback cap.
  const extendedCutoffMs = Math.min(businessDayMs, watermarkMs);
  const maxLookbackMs = now.getTime() - maxLookbackDays * MS_PER_DAY;
  return new Date(Math.max(extendedCutoffMs, maxLookbackMs));
}

// ── File I/O ──

/** Reads the whole watermark map. Never throws — a damaged file yields an empty map. */
function readCoverageObject() {
  const coverageFilePath = getCoverageFilePath();
  if (!fs.existsSync(coverageFilePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(coverageFilePath, 'utf8'));
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (_readError) {
    return {};
  }
}

/** Writes the whole watermark map. Failures are logged but non-fatal. */
function writeCoverageObject(coverageObject) {
  const coverageFilePath = getCoverageFilePath();
  try {
    fs.mkdirSync(path.dirname(coverageFilePath), { recursive: true });
    fs.writeFileSync(coverageFilePath, JSON.stringify(coverageObject, null, 2) + '\n', 'utf8');
  } catch (writeError) {
    console.error('  ⚠ Could not persist report coverage watermark: ' + writeError.message);
  }
}

// ── Public API ──

/**
 * Returns the ISO timestamp this report last confirmed coverage through, or null if it has
 * never run since this feature was installed.
 * @param {string} reportKey
 * @returns {string|null}
 */
function getCoverageWatermark(reportKey) {
  const watermark = readCoverageObject()[reportKey];
  return (typeof watermark === 'string' && watermark) ? watermark : null;
}

/**
 * Advances this report's coverage watermark. Call when a run CONFIRMS coverage — either it
 * delivered the changes it found, or it confirmed there were none (a skip). Do NOT call when a
 * run errors before writing, so the next run retries the same window.
 * @param {string} reportKey
 * @param {string} isoTimestamp - The run's start time; the point coverage is now confirmed through.
 */
function setCoverageWatermark(reportKey, isoTimestamp) {
  const coverageObject = readCoverageObject();
  coverageObject[reportKey] = isoTimestamp;
  writeCoverageObject(coverageObject);
}

module.exports = {
  resolveCoverageCutoff,
  getCoverageWatermark,
  setCoverageWatermark,
  getCoverageFilePath,
  DEFAULT_MAX_LOOKBACK_DAYS,
};
