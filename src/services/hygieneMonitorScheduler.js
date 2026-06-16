// hygieneMonitorScheduler.js — Proactive daily hygiene monitor for Jira issues.
//
// Runs on a per-team schedule, evaluates server-side hygiene rules against
// open Jira issues, dispatches violations to Rovo for FIXABLE/UNFIXABLE
// classification, applies Jira fixes for FIXABLE items, posts Jira comments
// for UNFIXABLE items, then delivers a Teams digest via reportWebhookDelivery.
//
// Key exports:
//   parseRovoClassifications(text) — pure helper, no side effects
//   buildHygieneDigest(scan, priorScan) — pure helper, no side effects
//   runHygieneScan(teamConfig, configuration) — orchestrates one full scan
//   getLastScanStatus() — returns the cached scan status summary

'use strict';

// ── Trend calculation ─────────────────────────────────────────────────────────

const TREND_DOWN = 'down';
const TREND_UP = 'up';
const TREND_FLAT = 'flat';
const TREND_NOT_AVAILABLE = 'n/a';

// ── parseRovoClassifications ──────────────────────────────────────────────────

/**
 * Parses Rovo's deterministic classification output into structured objects.
 *
 * Rovo outputs one line per issue in one of two formats:
 *   FIXABLE: ISSUE-KEY | fieldId | suggested-value
 *   UNFIXABLE: ISSUE-KEY | checkId | human-readable guidance
 *
 * Lines that do not match either pattern are silently skipped — Rovo may
 * include preamble or explanatory paragraphs around the structured lines.
 *
 * @param {string | null | undefined} responseText - Raw Rovo response text.
 * @returns {Array<{ issueKey: string, type: 'FIXABLE'|'UNFIXABLE', field?: string, value?: string, checkId?: string, guidance?: string }>}
 */
function parseRovoClassifications(responseText) {
  if (!responseText) return [];

  const classifications = [];
  const linePattern = /^(FIXABLE|UNFIXABLE):\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+)$/;

  for (const rawLine of String(responseText).split('\n')) {
    const trimmedLine = rawLine.trim();
    const patternMatch = trimmedLine.match(linePattern);
    if (!patternMatch) continue;

    const [, classificationType, issueKey, secondField, thirdField] = patternMatch;

    if (classificationType === 'FIXABLE') {
      classifications.push({
        issueKey: issueKey.trim(),
        type: 'FIXABLE',
        field: secondField.trim(),
        value: thirdField.trim(),
      });
    } else {
      classifications.push({
        issueKey: issueKey.trim(),
        type: 'UNFIXABLE',
        checkId: secondField.trim(),
        guidance: thirdField.trim(),
      });
    }
  }

  return classifications;
}

// ── buildHygieneDigest ────────────────────────────────────────────────────────

/**
 * Computes a hygiene digest from the current scan result and an optional prior
 * scan result. The trend field reflects whether violations have improved, worsened,
 * or stayed the same since the prior scan.
 *
 * This function is pure — it has no side effects and is fully deterministic.
 *
 * @param {{ teamName: string, scannedAt: string, issuesScanned: number, violationsFound: number, fixesApplied: number, actionsRequired: number, unassignedCount: number, failures: object[] }} currentScan
 * @param {{ violationsFound: number } | null} priorScan - Prior scan result, or null when this is the first scan.
 * @returns {{ teamName: string, scannedAt: string, issuesScanned: number, violationsFound: number, fixesApplied: number, actionsRequired: number, unassignedCount: number, failures: object[], trend: string }}
 */
function buildHygieneDigest(currentScan, priorScan) {
  let trend = TREND_NOT_AVAILABLE;

  if (priorScan !== null && priorScan !== undefined) {
    if (currentScan.violationsFound < priorScan.violationsFound) {
      trend = TREND_DOWN;
    } else if (currentScan.violationsFound > priorScan.violationsFound) {
      trend = TREND_UP;
    } else {
      trend = TREND_FLAT;
    }
  }

  return {
    teamName: currentScan.teamName,
    scannedAt: currentScan.scannedAt,
    issuesScanned: currentScan.issuesScanned,
    violationsFound: currentScan.violationsFound,
    fixesApplied: currentScan.fixesApplied,
    actionsRequired: currentScan.actionsRequired,
    unassignedCount: currentScan.unassignedCount,
    failures: currentScan.failures,
    trend,
  };
}

// ── Scan state (module-level, process lifetime) ───────────────────────────────

/** In-memory cache of the last completed scan per team. Keys are teamName strings. */
const lastScanResultByTeam = new Map();

/** ISO timestamp of the most recent scan across all teams. */
let globalLastScanAt = null;

// ── getLastScanStatus ─────────────────────────────────────────────────────────

/**
 * Returns the cached scan status summary for the status endpoint.
 * Returns null values when no scan has run yet.
 *
 * @returns {{ lastScanAt: string | null, nextScanAt: string | null, teamStatuses: object[] }}
 */
function getLastScanStatus() {
  const teamStatuses = Array.from(lastScanResultByTeam.values()).map((scanResult) => ({
    teamName: scanResult.teamName,
    violationsFound: scanResult.violationsFound,
    scannedAt: scanResult.scannedAt,
  }));

  return {
    lastScanAt: globalLastScanAt,
    nextScanAt: null,
    teamStatuses,
  };
}

// ── runHygieneScan ────────────────────────────────────────────────────────────

/**
 * Orchestrates a full hygiene scan for one team configuration.
 * Queries Jira, evaluates rules, dispatches to Rovo, applies fixes,
 * posts comments, delivers digest, and caches the result.
 *
 * This is the integration point for the scheduler — the scan engine
 * is implemented incrementally across T022–T025 tasks. This initial
 * skeleton provides the cache write and returns a minimal result so
 * T020 route tests can pass against the mock interface.
 *
 * @param {{ teamName: string, projectKeys: string[], enabledCheckIds?: string[] }} teamConfig
 * @param {object} configuration - Live server configuration object.
 * @returns {Promise<{ teamName: string, issuesScanned: number, violationsFound: number, fixesApplied: number, actionsRequired: number, unassignedCount: number, failures: object[] }>}
 */
async function runHygieneScan(teamConfig, configuration) {
  const scanStartedAt = new Date().toISOString();

  // Scan engine implementation comes in T022–T025.
  // This skeleton satisfies the route contract (T020) and will be
  // expanded incrementally as the full scan pipeline is built.
  const scanResult = {
    teamName: teamConfig.teamName,
    scannedAt: scanStartedAt,
    issuesScanned: 0,
    violationsFound: 0,
    fixesApplied: 0,
    actionsRequired: 0,
    unassignedCount: 0,
    failures: [],
  };

  lastScanResultByTeam.set(teamConfig.teamName, scanResult);
  globalLastScanAt = scanStartedAt;

  return scanResult;
}

module.exports = {
  parseRovoClassifications,
  buildHygieneDigest,
  runHygieneScan,
  getLastScanStatus,
};
