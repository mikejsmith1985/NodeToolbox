// hygieneMonitorScheduler.js — Proactive daily hygiene monitor for Jira issues.
//
// Runs on a per-team schedule, evaluates server-side hygiene rules against open
// Jira issues, then emails a digest via reportWebhookDelivery (an Atlassian
// Automation rule composes the email; an inbox rule forwards it to Teams).
//
// REPORT-ONLY BY DESIGN: this scheduler never writes to Jira. It used to send
// violations to AI Assist for FIXABLE/UNFIXABLE classification and then apply
// field fixes and post comments unsupervised — that pipeline is retired. The
// automated AI channel no longer exists, and AI-proposed fixes now live in the
// Hygiene page's AI Assist panel, where a human accepts or declines each one.
//
// Key exports:
//   buildHygieneDigest(scan, priorScan) — pure helper, no side effects
//   runHygieneScan(teamConfig, configuration) — one scan + digest delivery
//   getLastScanStatus() — returns the cached scan status summary

'use strict';

const { makeJiraApiRequest } = require('../utils/httpClient');
const { deliverReport } = require('./reportWebhookDelivery');
const { evaluateHygieneRules } = require('./hygieneRules');
const { loadFiredDates, recordFiredDate, isScheduledTimeReached } = require('./schedulerFiredState');

// ── Jira query constants ──────────────────────────────────────────────────────

// Fields fetched per issue — keep narrow to reduce response size.
const HYGIENE_JIRA_FIELDS = [
  'summary', 'issuetype', 'status', 'assignee', 'reporter',
  'fixVersions', 'updated', 'created', 'duedate',
  'customfield_10028', 'customfield_10016', 'customfield_10020',
].join(',');

// Maximum issues fetched per project key batch (Jira paginates at 100 by default).
const JIRA_HYGIENE_MAX_RESULTS = 100;

// ── Trend calculation ─────────────────────────────────────────────────────────

const TREND_DOWN = 'down';
const TREND_UP = 'up';
const TREND_FLAT = 'flat';
const TREND_NOT_AVAILABLE = 'n/a';

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
    trend: scanResult.trend || 'n/a',
  }));

  return {
    lastScanAt: globalLastScanAt,
    nextScanAt: null,
    teamStatuses,
  };
}

// ── Jira issue fetching ───────────────────────────────────────────────────────

/**
 * Queries Jira for all open issues across the team's project keys.
 * Returns an empty array when the Jira request fails or the team has no project keys.
 *
 * @param {string[]} projectKeys - Jira project keys to include in the search.
 * @param {object} jiraConfig - Jira service config from the main configuration object.
 * @param {boolean} isTlsVerified - Whether to verify TLS certificates.
 * @returns {Promise<object[]>} Array of Jira issue objects.
 */
async function fetchOpenIssuesForTeam(projectKeys, jiraConfig, isTlsVerified) {
  if (!projectKeys || projectKeys.length === 0) return [];

  const projectList = projectKeys.map((projectKey) => '"' + projectKey + '"').join(', ');
  const jql = 'project in (' + projectList + ') AND statusCategory != Done ORDER BY updated DESC';
  const searchPath = '/rest/api/2/search'
    + '?jql=' + encodeURIComponent(jql)
    + '&fields=' + encodeURIComponent(HYGIENE_JIRA_FIELDS)
    + '&maxResults=' + JIRA_HYGIENE_MAX_RESULTS;

  try {
    const jiraResponse = await makeJiraApiRequest('GET', searchPath, null, jiraConfig, isTlsVerified);
    return (jiraResponse.body && jiraResponse.body.issues) || [];
  } catch (jiraError) {
    console.error('[HygieneMonitor] Jira query failed for projects ' + projectKeys.join(',') + ': ' + jiraError.message);
    return [];
  }
}

// ── Digest delivery ───────────────────────────────────────────────────────────

/**
 * Delivers the hygiene digest by email — POSTs it to the team's Atlassian Automation
 * webhook, which composes the email (the recipient's inbox rule forwards it to Teams) —
 * and appends the scan result to the bounded hygieneScanHistory in the live config.
 *
 * Skips delivery silently when no digest trigger webhook is configured for the team.
 *
 * @param {object} digest - Computed by buildHygieneDigest.
 * @param {{ digestTriggerUrl?: string, digestTriggerSecret?: string, digestEmailTo?: string }} teamConfig
 * @param {object} configuration - Live server configuration (mutated to append history).
 */
async function deliverHygieneDigest(digest, teamConfig, configuration) {
  const hygieneMonitorConfig = configuration.hygieneMonitor || {};
  const historyArray = hygieneMonitorConfig.hygieneScanHistory || [];

  // Append this scan result to the bounded history before delivery.
  historyArray.push(digest);
  if (historyArray.length > 30) historyArray.splice(0, historyArray.length - 30);
  if (!hygieneMonitorConfig.hygieneScanHistory) {
    hygieneMonitorConfig.hygieneScanHistory = historyArray;
  }
  if (!configuration.hygieneMonitor) {
    configuration.hygieneMonitor = hygieneMonitorConfig;
  }

  if (!teamConfig.digestTriggerUrl) {
    console.log('[HygieneMonitor] No digest trigger webhook configured for team "' + digest.teamName + '" — digest skipped.');
    return;
  }

  try {
    // deliverReport resolves the destination via the hygiene-digest surface's
    // resolveDestination, which looks up the team by name in configuration.hygieneMonitor.teams.
    // The destination is an Atlassian Automation webhook that emails the digest.
    const deliveryResult = await deliverReport(configuration, {
      surface: 'hygiene-digest',
      teamId:  digest.teamName,
      report:  {
        teamName:        digest.teamName,
        scannedAt:       digest.scannedAt,
        issuesScanned:   digest.issuesScanned,
        violationsFound: digest.violationsFound,
        fixesApplied:    digest.fixesApplied,
        actionsRequired: digest.actionsRequired,
        unassignedCount: digest.unassignedCount,
        trend:           digest.trend,
        failures:        digest.failures,
        emailTo:         teamConfig.digestEmailTo || '',
      },
    });

    if (!deliveryResult.ok) {
      console.warn('[HygieneMonitor] Digest delivery not-ok for "' + digest.teamName + '": ' + deliveryResult.message);
    }
  } catch (deliveryError) {
    console.error('[HygieneMonitor] Digest delivery threw for "' + digest.teamName + '": ' + deliveryError.message);
  }
}

// ── runHygieneScan ────────────────────────────────────────────────────────────

/**
 * Orchestrates a full hygiene scan for one team configuration:
 * 1. Query Jira for open issues across all project keys
 * 2. Evaluate server-side hygiene rules against each issue
 * 3. Batch violations and dispatch to AI Assist for classification (when enabled)
 * 4. Apply FIXABLE fixes via the Jira proxy
 * 5. Post UNFIXABLE comments with per-cycle dedup
 * 6. Build and email the digest (via the Automation webhook)
 * 7. Cache the result and append to scan history
 *
 * @param {{ teamName: string, projectKeys: string[], enabledCheckIds?: string[], digestTriggerUrl?: string, digestTriggerSecret?: string, digestEmailTo?: string, fieldConfig?: object }} teamConfig
 * @param {object} configuration - Live server configuration object.
 * @returns {Promise<{ teamName: string, issuesScanned: number, violationsFound: number, fixesApplied: number, actionsRequired: number, unassignedCount: number, failures: object[] }>}
 */
async function runHygieneScan(teamConfig, configuration) {
  const scanStartedAt = new Date().toISOString();
  const isTlsVerified = configuration.sslVerify !== false;
  const jiraConfig = configuration.jira || {};
  const teamFieldConfig = teamConfig.fieldConfig || {};
  const enabledCheckFilter = teamConfig.enabledCheckIds && teamConfig.enabledCheckIds.length > 0
    ? new Set(teamConfig.enabledCheckIds)
    : null;

  let issuesScanned = 0;
  let unassignedCount = 0;
  // Report-only: this scheduler never writes to Jira, so nothing is ever "applied" and no
  // comment is ever posted. The fields stay in the result so the digest/status shape is stable.
  const fixesApplied = 0;
  const actionsRequired = 0;
  const scanFailures = [];

  // ── Step 1: Fetch open issues from Jira ──────────────────────────────────

  const openIssues = await fetchOpenIssuesForTeam(teamConfig.projectKeys, jiraConfig, isTlsVerified);
  issuesScanned = openIssues.length;
  console.log('[HygieneMonitor] Team "' + teamConfig.teamName + '": ' + issuesScanned + ' open issues fetched.');

  // ── Step 2: Evaluate hygiene rules per issue ─────────────────────────────

  const issueViolationMap = new Map();
  let totalViolationCount = 0;

  for (const jiraIssue of openIssues) {
    if (!jiraIssue.fields.assignee) unassignedCount++;

    const allFlags = evaluateHygieneRules(jiraIssue, teamFieldConfig);
    const filteredFlags = enabledCheckFilter
      ? allFlags.filter((flag) => enabledCheckFilter.has(flag.checkId))
      : allFlags;

    if (filteredFlags.length > 0) {
      issueViolationMap.set(jiraIssue.key, { issue: jiraIssue, flags: filteredFlags });
      totalViolationCount += filteredFlags.length;
    }
  }

  console.log('[HygieneMonitor] Team "' + teamConfig.teamName + '": ' + totalViolationCount + ' violations across '
    + issueViolationMap.size + ' issues.');

  // ── Step 6: Build digest, email it (via Automation), append to history ────────────

  const scanResult = {
    teamName:        teamConfig.teamName,
    scannedAt:       scanStartedAt,
    issuesScanned,
    violationsFound: totalViolationCount,
    fixesApplied,
    actionsRequired,
    unassignedCount,
    failures:        scanFailures,
  };

  const priorScan = lastScanResultByTeam.get(teamConfig.teamName) || null;
  const digest = buildHygieneDigest(scanResult, priorScan);

  await deliverHygieneDigest(digest, teamConfig, configuration);

  // ── Step 7: Cache and return ─────────────────────────────────────────────

  // Cache the result WITH the computed trend so the status endpoint and panel can
  // show a per-team trend (↓ improving / ↑ worsening) without recomputing (SC-009).
  const cachedResult = { ...scanResult, trend: digest.trend };
  lastScanResultByTeam.set(teamConfig.teamName, cachedResult);
  globalLastScanAt = scanStartedAt;

  console.log('[HygieneMonitor] Scan complete for "' + teamConfig.teamName + '": '
    + fixesApplied + ' fixed, ' + actionsRequired + ' actions required, trend=' + digest.trend + '.');

  return cachedResult;
}

// ── Daily scheduler ───────────────────────────────────────────────────────────

const SCHEDULE_CHECK_INTERVAL_MS = 60 * 1000;
const DEFAULT_HYGIENE_SCHEDULE_TIME = '06:00';
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Stable name under which this scheduler's fired dates are persisted to disk. */
const FIRED_STATE_SCHEDULER_NAME = 'hygieneMonitor';

/** Returns the current local time as a 'HH:MM' string for schedule comparisons. */
function getCurrentTimeHHMM() {
  const now = new Date();
  return now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
}

/** Returns today's local date as "YYYY-MM-DD" — the value stored per fired team. */
function getTodayDateString() {
  const now = new Date();
  return now.getFullYear() + '-' + (now.getMonth() + 1).toString().padStart(2, '0') + '-' + now.getDate().toString().padStart(2, '0');
}

/** Returns the short weekday name ('Mon', 'Tue', etc.) for today in local time. */
function getTodayWeekdayName() {
  return WEEKDAY_NAMES[new Date().getDay()];
}

// Tracks the last date (YYYY-MM-DD) each team's scan fired — prevents double-firing.
// Hydrated from the persistent fired-state file when the scheduler starts, so a restart
// later the same day does not re-run a scan that already completed. Comparing against
// today's date also makes the day-rollover reset automatic — no manual clearing needed.
let hygieneLastFiredDates = new Map();

/** Tracks the interval handle so the scheduler can be restarted if needed. */
let hygieneSchedulerInterval = null;

/**
 * Checks all configured teams and fires any whose scheduleTime matches the current
 * minute and have not yet fired today. Weekday filtering is applied per-team.
 *
 * @param {object} configuration - Live server config (read at fire time).
 */
function checkAndFireHygieneScans(configuration) {
  const currentTime = getCurrentTimeHHMM();
  const todayDate = getTodayDateString();
  const todayWeekday = getTodayWeekdayName();
  const hygieneTeams = (configuration.hygieneMonitor || {}).teams || [];

  for (let teamIndex = 0; teamIndex < hygieneTeams.length; teamIndex++) {
    const teamConfig = hygieneTeams[teamIndex];
    const scheduledTime = teamConfig.scheduleTime || DEFAULT_HYGIENE_SCHEDULE_TIME;

    // Fire when the scheduled time has been reached OR passed today (catch-up) and
    // the scan has not already run today — not only on an exact minute match.
    if (!isScheduledTimeReached(scheduledTime, currentTime)) continue;

    // Per-team weekday filter — default to Mon–Fri.
    const allowedWeekdays = Array.isArray(teamConfig.weekdays) && teamConfig.weekdays.length > 0
      ? teamConfig.weekdays
      : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    if (!allowedWeekdays.includes(todayWeekday)) continue;

    const firedKey = 'hygiene-' + teamIndex + '-' + (teamConfig.teamName || '');
    if (hygieneLastFiredDates.get(firedKey) === todayDate) continue;
    hygieneLastFiredDates.set(firedKey, todayDate);
    recordFiredDate(FIRED_STATE_SCHEDULER_NAME, firedKey, todayDate);

    console.log('[HygieneMonitor] Firing scheduled scan for team "' + teamConfig.teamName + '"...');
    runHygieneScan(teamConfig, configuration).catch((scanError) => {
      console.error('[HygieneMonitor] Scheduled scan threw for "' + teamConfig.teamName + '": ' + scanError.message);
    });
  }
}

/**
 * Starts the daily hygiene monitor scheduler. Fires a check every 60 seconds.
 * Per-team weekday + scheduleTime guards prevent duplicate runs on the same day.
 *
 * Can be called after a config change to re-register teams without restarting
 * the server — safe because `configuration` is read by reference at tick time.
 *
 * @param {object} configuration - Live server configuration object.
 */
function startHygieneMonitorScheduler(configuration) {
  if (hygieneSchedulerInterval) {
    clearInterval(hygieneSchedulerInterval);
  }
  // Seed the in-memory tracker from disk so today's already-completed scans are not
  // re-run after a restart, while any team still due today can still catch up.
  hygieneLastFiredDates = loadFiredDates(FIRED_STATE_SCHEDULER_NAME);
  console.log('[HygieneMonitor] Daily hygiene monitor scheduler started — checking every minute.');

  hygieneSchedulerInterval = setInterval(() => {
    checkAndFireHygieneScans(configuration);
  }, SCHEDULE_CHECK_INTERVAL_MS);
}

module.exports = {
  buildHygieneDigest,
  runHygieneScan,
  getLastScanStatus,
  startHygieneMonitorScheduler,
};
