// hygieneMonitorScheduler.js — Proactive daily hygiene monitor for Jira issues.
//
// Runs on a per-team schedule, evaluates server-side hygiene rules against
// open Jira issues, dispatches violations to Rovo for FIXABLE/UNFIXABLE
// classification, applies Jira fixes for FIXABLE items, posts Jira comments
// for UNFIXABLE items, then emails a digest via reportWebhookDelivery (an Atlassian
// Automation rule composes the email; an inbox rule forwards it to Teams).
//
// Key exports:
//   parseRovoClassifications(text) — pure helper, no side effects
//   buildHygieneDigest(scan, priorScan) — pure helper, no side effects
//   runHygieneScan(teamConfig, configuration) — orchestrates one full scan
//   getLastScanStatus() — returns the cached scan status summary

'use strict';

const { makeJiraApiRequest } = require('../utils/httpClient');
const { requestRovoText, isRovoEnabled } = require('./rovoEnrichment');
const { deliverReport } = require('./reportWebhookDelivery');
const { evaluateHygieneRules } = require('./hygieneRules');

// ── Jira query constants ──────────────────────────────────────────────────────

// Fields fetched per issue — keep narrow to reduce response size.
const HYGIENE_JIRA_FIELDS = [
  'summary', 'issuetype', 'status', 'assignee', 'reporter',
  'fixVersions', 'updated', 'created', 'duedate',
  'customfield_10028', 'customfield_10016', 'customfield_10020',
].join(',');

// Maximum issues fetched per project key batch (Jira paginates at 100 by default).
const JIRA_HYGIENE_MAX_RESULTS = 100;

// Maximum number of violations batched into a single Rovo classification prompt.
// Keeps prompts within Rovo's context window.
const ROVO_BATCH_SIZE = 50;

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

// ── Rovo classification prompt builder ───────────────────────────────────────

/**
 * Builds the structured Rovo prompt for a batch of hygiene violations.
 * Instructs Rovo to respond with one FIXABLE or UNFIXABLE line per violation.
 *
 * @param {string} teamName - Display name of the team being scanned.
 * @param {Array<{ issueKey: string, summary: string, checkId: string, label: string }>} violations
 * @returns {string} The formatted prompt text.
 */
function buildHygieneClassificationPrompt(teamName, violations) {
  const violationLines = violations.map((violation) =>
    violation.issueKey + ': [' + violation.checkId + '] ' + violation.label + ' — "' + violation.summary + '"'
  ).join('\n');

  return [
    'You are reviewing Jira hygiene violations for team "' + teamName + '".',
    'For each violation below, classify it on a single line using EXACTLY one of these formats:',
    '  FIXABLE: <ISSUE-KEY> | <fieldId> | <suggested-value>',
    '  UNFIXABLE: <ISSUE-KEY> | <checkId> | <one-sentence guidance for the assignee>',
    '',
    'Rules:',
    '- FIXABLE means you can suggest a concrete field value Toolbox should write (e.g. story points, acceptance criteria text, a date).',
    '- UNFIXABLE means a human must act (e.g. no-assignee, missing parent link, ambiguous feature link).',
    '- Use the field ID from the violation for FIXABLE lines (e.g. customfield_10028 for story points).',
    '- For "no-ac" violations: draft acceptance criteria from the issue summary as the FIXABLE value.',
    '- For "missing-sp" violations: estimate story points (1, 2, 3, 5, 8) from the summary complexity as the FIXABLE value.',
    '- For "stale-issue" violations: classify UNFIXABLE with a prompt asking the assignee for a status update.',
    '- Output ONLY the classification lines — no preamble, no explanation, no blank lines between them.',
    '',
    'Violations:',
    violationLines,
  ].join('\n');
}

// ── FIXABLE — apply Jira field updates ───────────────────────────────────────

/**
 * Attempts to apply a FIXABLE classification as a Jira field update.
 * Returns true on success, false when the update is rejected by Jira.
 * On rejection, the violation is re-classified as UNFIXABLE for this run.
 *
 * @param {{ issueKey: string, field: string, value: string }} classification
 * @param {object} jiraConfig - Jira service config.
 * @param {boolean} isTlsVerified - TLS verification flag.
 * @returns {Promise<boolean>} True when the update succeeded (2xx status).
 */
async function applyJiraFieldFix(classification, jiraConfig, isTlsVerified) {
  const issueUpdatePath = '/rest/api/2/issue/' + encodeURIComponent(classification.issueKey);
  const requestBody = { fields: { [classification.field]: classification.value } };

  try {
    const updateResponse = await makeJiraApiRequest('PUT', issueUpdatePath, requestBody, jiraConfig, isTlsVerified);
    const isSuccess = updateResponse.status >= 200 && updateResponse.status < 300;
    if (!isSuccess) {
      console.warn('[HygieneMonitor] Field update rejected for ' + classification.issueKey
        + ' field=' + classification.field + ' status=' + updateResponse.status);
    }
    return isSuccess;
  } catch (updateError) {
    console.error('[HygieneMonitor] Field update threw for ' + classification.issueKey + ': ' + updateError.message);
    return false;
  }
}

// ── UNFIXABLE — post Jira comments ───────────────────────────────────────────

/**
 * Posts a single Jira comment to the issue flagged as UNFIXABLE.
 * Addresses the assignee when available, then the reporter, then neither.
 * Uses a per-cycle dedup set to post at most one comment per (issueKey, checkId) pair
 * per scan run — prevents comment spam when a violation recurs across multiple cycles.
 *
 * @param {{ issueKey: string, checkId: string, guidance: string }} classification
 * @param {object} issue - Full Jira issue object (for assignee/reporter lookup).
 * @param {Set<string>} postedCommentKeys - Dedup set mutated by this call.
 * @param {object} jiraConfig - Jira service config.
 * @param {boolean} isTlsVerified - TLS verification flag.
 * @returns {Promise<boolean>} True when the comment was posted successfully.
 */
async function postUnfixableComment(classification, issue, postedCommentKeys, jiraConfig, isTlsVerified) {
  const dedupKey = classification.issueKey + '|' + classification.checkId;
  if (postedCommentKeys.has(dedupKey)) return false;
  postedCommentKeys.add(dedupKey);

  const assigneeName = (issue && issue.fields.assignee && issue.fields.assignee.displayName) || null;
  const reporterName = (issue && issue.fields.reporter && issue.fields.reporter.displayName) || null;
  const addressee = assigneeName || reporterName;
  const greeting = addressee ? 'Hi ' + addressee + ', ' : '';

  const commentBody = greeting
    + '[Hygiene Monitor] ' + classification.guidance
    + '\n\n_This comment was added automatically by the NodeToolbox Hygiene Monitor. '
    + 'Check ID: ' + classification.checkId + '_';

  const commentPath = '/rest/api/2/issue/' + encodeURIComponent(classification.issueKey) + '/comment';

  try {
    const commentResponse = await makeJiraApiRequest(
      'POST',
      commentPath,
      { body: commentBody },
      jiraConfig,
      isTlsVerified
    );
    return commentResponse.status === 200 || commentResponse.status === 201;
  } catch (commentError) {
    console.error('[HygieneMonitor] Comment post threw for ' + classification.issueKey + ': ' + commentError.message);
    return false;
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
 * 3. Batch violations and dispatch to Rovo for classification (when enabled)
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
  let fixesApplied = 0;
  let actionsRequired = 0;
  let unassignedCount = 0;
  const scanFailures = [];

  // Per-cycle dedup set: prevents duplicate comments within a single scan run.
  const postedCommentKeys = new Set();

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

  // ── Step 3: Dispatch violations to Rovo for classification ───────────────

  const allClassifications = [];

  if (isRovoEnabled(configuration) && issueViolationMap.size > 0) {
    // Flatten all (issueKey, flag) pairs into a flat violation list for batching.
    const flatViolations = [];
    for (const [issueKey, { issue, flags }] of issueViolationMap.entries()) {
      for (const flag of flags) {
        flatViolations.push({
          issueKey,
          summary: (issue.fields.summary || '').substring(0, 120),
          checkId: flag.checkId,
          label:   flag.label,
        });
      }
    }

    // Process in batches of ROVO_BATCH_SIZE to stay within Rovo's context window.
    for (let batchStart = 0; batchStart < flatViolations.length; batchStart += ROVO_BATCH_SIZE) {
      const batchViolations = flatViolations.slice(batchStart, batchStart + ROVO_BATCH_SIZE);
      const classificationPrompt = buildHygieneClassificationPrompt(teamConfig.teamName, batchViolations);

      console.log('[HygieneMonitor] Dispatching batch ' + (Math.floor(batchStart / ROVO_BATCH_SIZE) + 1)
        + ' (' + batchViolations.length + ' violations) to Rovo...');

      const rovoResponse = await requestRovoText(configuration, classificationPrompt, { label: 'hygiene-' + teamConfig.teamName });
      if (rovoResponse) {
        allClassifications.push(...parseRovoClassifications(rovoResponse));
      } else {
        console.warn('[HygieneMonitor] Rovo returned no classification for batch starting at index ' + batchStart);
      }
    }
  } else if (issueViolationMap.size > 0) {
    console.log('[HygieneMonitor] Rovo not enabled — all ' + issueViolationMap.size + ' violating issues will receive comments only.');
  }

  // ── Step 4: Apply FIXABLE fixes via Jira proxy ──────────────────────────

  for (const classification of allClassifications) {
    if (classification.type !== 'FIXABLE') continue;

    const wasFixApplied = await applyJiraFieldFix(classification, jiraConfig, isTlsVerified);
    if (wasFixApplied) {
      fixesApplied++;
    } else {
      // Rejected by Jira — re-classify as UNFIXABLE so the assignee is notified.
      const issueEntry = issueViolationMap.get(classification.issueKey);
      if (issueEntry) {
        const wasCommentPosted = await postUnfixableComment(
          { issueKey: classification.issueKey, checkId: classification.field, guidance: 'Automated fix was rejected by Jira for field ' + classification.field + '. Please update manually.' },
          issueEntry.issue,
          postedCommentKeys,
          jiraConfig,
          isTlsVerified
        );
        if (wasCommentPosted) actionsRequired++;
      }
      scanFailures.push({ issueKey: classification.issueKey, reason: 'Jira field update rejected for field ' + classification.field });
    }
  }

  // ── Step 5: Post UNFIXABLE comments ──────────────────────────────────────

  for (const classification of allClassifications) {
    if (classification.type !== 'UNFIXABLE') continue;

    const issueEntry = issueViolationMap.get(classification.issueKey);
    const wasCommentPosted = await postUnfixableComment(
      classification,
      issueEntry ? issueEntry.issue : null,
      postedCommentKeys,
      jiraConfig,
      isTlsVerified
    );
    if (wasCommentPosted) actionsRequired++;
  }

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

/** Returns the current local time as a 'HH:MM' string for schedule comparisons. */
function getCurrentTimeHHMM() {
  const now = new Date();
  return now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
}

/** Returns the short weekday name ('Mon', 'Tue', etc.) for today in local time. */
function getTodayWeekdayName() {
  return WEEKDAY_NAMES[new Date().getDay()];
}

/** Module-level set of teams that have already run today (resets at process restart). */
const firedTodayKeys = new Set();
let lastKnownDayKey = '';

/**
 * Resets the fired-today set when the calendar day changes.
 * Called at the top of every scheduled tick so the set stays current.
 */
function refreshDayIfNeeded() {
  const todayKey = new Date().toDateString();
  if (todayKey !== lastKnownDayKey) {
    firedTodayKeys.clear();
    lastKnownDayKey = todayKey;
  }
}

/** Tracks the interval handle so the scheduler can be restarted if needed. */
let hygieneSchedulerInterval = null;

/**
 * Checks all configured teams and fires any whose scheduleTime matches the current
 * minute and have not yet fired today. Weekday filtering is applied per-team.
 *
 * @param {object} configuration - Live server config (read at fire time).
 */
function checkAndFireHygieneScans(configuration) {
  refreshDayIfNeeded();

  const currentTime = getCurrentTimeHHMM();
  const todayWeekday = getTodayWeekdayName();
  const hygieneTeams = (configuration.hygieneMonitor || {}).teams || [];

  for (let teamIndex = 0; teamIndex < hygieneTeams.length; teamIndex++) {
    const teamConfig = hygieneTeams[teamIndex];
    const scheduledTime = teamConfig.scheduleTime || DEFAULT_HYGIENE_SCHEDULE_TIME;

    if (scheduledTime !== currentTime) continue;

    // Per-team weekday filter — default to Mon–Fri.
    const allowedWeekdays = Array.isArray(teamConfig.weekdays) && teamConfig.weekdays.length > 0
      ? teamConfig.weekdays
      : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    if (!allowedWeekdays.includes(todayWeekday)) continue;

    const firedKey = 'hygiene-' + teamIndex + '-' + (teamConfig.teamName || '');
    if (firedTodayKeys.has(firedKey)) continue;
    firedTodayKeys.add(firedKey);

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
  console.log('[HygieneMonitor] Daily hygiene monitor scheduler started — checking every minute.');

  hygieneSchedulerInterval = setInterval(() => {
    checkAndFireHygieneScans(configuration);
  }, SCHEDULE_CHECK_INTERVAL_MS);
}

module.exports = {
  parseRovoClassifications,
  buildHygieneDigest,
  runHygieneScan,
  getLastScanStatus,
  startHygieneMonitorScheduler,
};
