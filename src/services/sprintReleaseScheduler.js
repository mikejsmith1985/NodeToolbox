// src/services/sprintReleaseScheduler.js — Sprint–Release Workflow polling scheduler.
//
// Owns the setInterval loop, in-memory runtime state, and orchestration of the
// business logic functions in sprintReleaseOrchestrator.js. All Jira API calls
// flow through the orchestrator — this module only drives timing and state.
//
// Key exports:
//   startSprintReleaseScheduler(configuration) — start the polling loop
//   triggerPollCycleNow(configuration)          — immediate poll for run-now endpoint
//   getSprintReleaseStatus()                    — runtime state for status endpoint

'use strict';

const {
  detectSubStatusChanges,
  executeDevIssueDone,
  postHandoffComment,
  detectFixVersionDateChange,
  calculateCodeFreezeDate,
  findSprintByName,
  updateSprintEndDate,
  detectDefectIntakeLabels,
  createDefectIssue,
  removeDefectIntakeLabel,
  findDorViolations,
  postDorViolationComment,
} = require('./sprintReleaseOrchestrator');

const { makeJiraApiRequest } = require('../utils/httpClient');

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum entries kept in the recentHandoffs and recentDefectIntakes ring buffers. */
const MAX_RECENT_EVENTS = 20;

/** JQL fields fetched for sub-status and defect intake scanning — keep narrow. */
const DEV_ISSUE_FIELDS = 'summary,assignee,labels,parent,fixVersions,status,customfield_10201';

/** Fields fetched from QE/BT projects for defect intake scanning. */
const QE_BT_ISSUE_FIELDS = 'summary,labels,issueLinks,assignee';

/** Fields fetched for DoR violation checks. */
const DOR_ISSUE_FIELDS = 'summary,assignee,labels';

/** Tracks whether the DoR scan has already run today (resets on process restart or date change). */
let lastDorScanDate = '';

// ── In-memory runtime state ───────────────────────────────────────────────────

/**
 * Map keyed by "{teamProfileId}:{issueKey}".
 * Value: { qeHandoffAt: string|null, btHandoffAt: string|null }
 * Prevents duplicate handoff notifications across poll cycles.
 */
const lastHandoffByIssue = new Map();

/**
 * Map keyed by "{teamProfileId}:{fixVersionId}".
 * Value: ISO date string of the last known releaseDate.
 * Used to detect fixVersion date changes.
 */
const lastSeenFixVersionDates = new Map();

/**
 * Set of "{teamProfileId}:{issueKey}" strings for QE/BT issues that have
 * already been processed for defect intake. Prevents duplicate issue creation.
 */
const processedDefectIntakeKeys = new Set();

/** Ring buffer of recent handoff events (last MAX_RECENT_EVENTS). */
const recentHandoffs = [];

/** Ring buffer of recent defect intake events (last MAX_RECENT_EVENTS). */
const recentDefectIntakes = [];

/** List of sprint sync warnings from the current/last poll cycle. */
let sprintSyncWarnings = [];

/** ISO timestamp of the most recent poll cycle completion. */
let lastPollAt = null;

/** ISO timestamp when the next scheduled poll will fire. */
let nextPollAt = null;

/** Active sprint name from the last successful sprint lookup. */
let activeSprintName = null;

/** Active sprint end date from the last successful sprint lookup. */
let activeSprintEndDate = null;

/** Handle for the active setInterval — used to clear on restart. */
let schedulerIntervalHandle = null;

// ── Ring buffer helper ────────────────────────────────────────────────────────

/**
 * Appends an event to a ring buffer, capping it at MAX_RECENT_EVENTS entries.
 * Mutates the buffer array in place.
 *
 * @param {object[]} buffer - The ring buffer array to append to
 * @param {object} event - The event object to append
 */
function appendToRingBuffer(buffer, event) {
  buffer.push(event);
  if (buffer.length > MAX_RECENT_EVENTS) {
    buffer.splice(0, buffer.length - MAX_RECENT_EVENTS);
  }
}

// ── Sub-status poll scan ──────────────────────────────────────────────────────

/**
 * Queries Jira for recently-updated dev issues and processes any sub-status
 * changes that warrant a QE or BT handoff. Issues with the config-only label
 * close without a handoff notification.
 *
 * @param {object} teamProfile - The active TeamWorkflowProfile from config
 * @param {object} jiraConfig - Jira service config from the main configuration
 * @param {boolean} isTlsVerified - TLS verification flag
 * @returns {Promise<void>}
 */
async function runSubStatusScan(teamProfile, jiraConfig, isTlsVerified) {
  const pollWindowMinutes = teamProfile.pollIntervalMinutes || 5;
  const jql = 'project=' + teamProfile.devProjectKey
    + ' AND updated>=-' + pollWindowMinutes + 'm';

  const searchPath = '/rest/api/2/search'
    + '?jql=' + encodeURIComponent(jql)
    + '&expand=changelog'
    + '&fields=' + encodeURIComponent(DEV_ISSUE_FIELDS)
    + '&maxResults=100';

  let changedIssues;
  try {
    const searchResponse = await makeJiraApiRequest('GET', searchPath, null, jiraConfig, isTlsVerified);
    changedIssues = (searchResponse.body && searchResponse.body.issues) || [];
  } catch (searchError) {
    console.error('[SprintRelease] Dev issue search failed: ' + searchError.message);
    return;
  }

  const handoffEvents = detectSubStatusChanges(changedIssues, lastHandoffByIssue, teamProfile);

  for (const handoffEvent of handoffEvents) {
    const { issueKey, handoffType, issue } = handoffEvent;
    const nowIso = new Date().toISOString();
    const mapKey = teamProfile.teamProfileId + ':' + issueKey;

    // Always close the dev issue — whether handoff or bypass.
    await executeDevIssueDone(issueKey, jiraConfig, teamProfile, isTlsVerified);

    if (handoffType === 'BYPASS') {
      // Config-only issue: close without a handoff comment.
      console.log('[SprintRelease] Config-only bypass for ' + issueKey + ' — closed, no handoff.');
      // Record in the lastHandoffByIssue map so QE slot is marked (prevents re-trigger).
      const priorEntry = lastHandoffByIssue.get(mapKey) || { qeHandoffAt: null, btHandoffAt: null };
      lastHandoffByIssue.set(mapKey, { ...priorEntry, qeHandoffAt: nowIso });
      continue;
    }

    // Fetch parent feature for the handoff comment.
    const parentKey = (issue.fields && issue.fields.parent && issue.fields.parent.key) || '';
    let featureSummary = '';
    if (parentKey) {
      try {
        const parentResponse = await makeJiraApiRequest(
          'GET',
          '/rest/api/2/issue/' + encodeURIComponent(parentKey) + '?fields=summary',
          null, jiraConfig, isTlsVerified
        );
        featureSummary = (parentResponse.body && parentResponse.body.fields && parentResponse.body.fields.summary) || '';
      } catch (_parentFetchError) {
        // Non-fatal: handoff comment still fires without feature summary.
      }
    }

    await postHandoffComment(issueKey, handoffType, parentKey, featureSummary, jiraConfig, teamProfile, isTlsVerified);

    // Record the handoff in runtime state.
    const priorEntry = lastHandoffByIssue.get(mapKey) || { qeHandoffAt: null, btHandoffAt: null };
    const updatedEntry = { ...priorEntry };
    if (handoffType === 'QE') updatedEntry.qeHandoffAt = nowIso;
    if (handoffType === 'BT') updatedEntry.btHandoffAt = nowIso;
    lastHandoffByIssue.set(mapKey, updatedEntry);

    appendToRingBuffer(recentHandoffs, {
      issueKey,
      handoffType,
      firedAt: nowIso,
    });
  }
}

// ── FixVersion date sync scan ─────────────────────────────────────────────────

/**
 * Checks the feature project's fixVersions for release date changes and
 * updates the linked sprint's end date via the Agile API when a change is detected.
 *
 * @param {object} teamProfile - Active TeamWorkflowProfile
 * @param {object} jiraConfig - Jira service config
 * @param {boolean} isTlsVerified - TLS verification flag
 * @returns {Promise<void>}
 */
async function runFixVersionDateSync(teamProfile, jiraConfig, isTlsVerified) {
  const versionsPath = '/rest/api/2/project/' + teamProfile.featureProjectKey + '/versions';
  sprintSyncWarnings = [];

  let fixVersions;
  try {
    const versionsResponse = await makeJiraApiRequest('GET', versionsPath, null, jiraConfig, isTlsVerified);
    fixVersions = Array.isArray(versionsResponse.body) ? versionsResponse.body : [];
  } catch (versionsError) {
    console.error('[SprintRelease] FixVersion fetch failed: ' + versionsError.message);
    return;
  }

  const dateChangeEvents = detectFixVersionDateChange(fixVersions, lastSeenFixVersionDates, teamProfile);

  for (const changeEvent of dateChangeEvents) {
    const newSprintEndDate = calculateCodeFreezeDate(
      changeEvent.newReleaseDate,
      teamProfile.freezeWindowBusinessDays || 13
    );

    const matchedSprint = await findSprintByName(
      changeEvent.fixVersionName,
      teamProfile.boardId,
      jiraConfig,
      isTlsVerified
    );

    if (!matchedSprint) {
      const warning = 'No sprint named "' + changeEvent.fixVersionName + '" found on board ' + teamProfile.boardId + '.';
      sprintSyncWarnings.push(warning);
      continue;
    }

    // Refresh active sprint tracking from the found sprint.
    if (matchedSprint.state === 'active') {
      activeSprintName = matchedSprint.name;
      activeSprintEndDate = newSprintEndDate;
    }

    const updateResult = await updateSprintEndDate(matchedSprint, newSprintEndDate, jiraConfig, isTlsVerified);
    if (!updateResult.wasUpdated && updateResult.warning) {
      sprintSyncWarnings.push(updateResult.warning);
    }
  }
}

// ── Defect intake label scan ──────────────────────────────────────────────────

/**
 * Polls QE and BT project issues for the defect-intake label and creates
 * linked defect issues in the dev project for any new intakes.
 *
 * @param {object} teamProfile - Active TeamWorkflowProfile
 * @param {object} jiraConfig - Jira service config
 * @param {boolean} isTlsVerified - TLS verification flag
 * @returns {Promise<void>}
 */
async function runDefectIntakeScan(teamProfile, jiraConfig, isTlsVerified) {
  const pollWindowMinutes = teamProfile.pollIntervalMinutes || 5;
  const qeBtJql = 'project in ("' + teamProfile.qeProjectKey + '","' + teamProfile.btProjectKey
    + '") AND labels = "' + teamProfile.defectIntakeLabel + '" AND updated>=-' + pollWindowMinutes + 'm';

  const qeBtSearchPath = '/rest/api/2/search'
    + '?jql=' + encodeURIComponent(qeBtJql)
    + '&fields=' + encodeURIComponent(QE_BT_ISSUE_FIELDS)
    + '&maxResults=50';

  let qeBtIssues;
  try {
    const qeBtResponse = await makeJiraApiRequest('GET', qeBtSearchPath, null, jiraConfig, isTlsVerified);
    qeBtIssues = (qeBtResponse.body && qeBtResponse.body.issues) || [];
  } catch (qeBtError) {
    console.error('[SprintRelease] QE/BT defect intake search failed: ' + qeBtError.message);
    return;
  }

  const newIntakes = detectDefectIntakeLabels(qeBtIssues, processedDefectIntakeKeys, teamProfile);

  for (const intake of newIntakes) {
    // Fetch the original dev issue for assignee and fixVersion inheritance.
    let originalDevIssue = null;
    try {
      const devResponse = await makeJiraApiRequest(
        'GET',
        '/rest/api/2/issue/' + encodeURIComponent(intake.linkedDevIssueKey)
          + '?fields=summary,assignee,fixVersions',
        null, jiraConfig, isTlsVerified
      );
      originalDevIssue = devResponse.body;
    } catch (devFetchError) {
      console.error('[SprintRelease] Could not fetch original dev issue ' + intake.linkedDevIssueKey + ': ' + devFetchError.message);
      continue;
    }

    const { createdIssueKey } = await createDefectIssue(
      originalDevIssue,
      intake.triggerIssue,
      activeSprintEndDate,
      teamProfile,
      jiraConfig,
      isTlsVerified
    );

    if (!createdIssueKey) continue;

    // Remove the defect-intake label from the QE/BT issue to prevent reprocessing.
    const currentLabels = (intake.triggerIssue.fields && intake.triggerIssue.fields.labels) || [];
    await removeDefectIntakeLabel(intake.triggerIssueKey, currentLabels, teamProfile.defectIntakeLabel, jiraConfig, isTlsVerified);

    const processedKey = teamProfile.teamProfileId + ':' + intake.triggerIssueKey;
    processedDefectIntakeKeys.add(processedKey);

    appendToRingBuffer(recentDefectIntakes, {
      triggerIssueKey: intake.triggerIssueKey,
      createdIssueKey,
      processedAt: new Date().toISOString(),
    });
  }
}

// ── DoR violation daily scan ──────────────────────────────────────────────────

/**
 * Runs the Definition of Ready violation scan once per calendar day.
 * Queries the active sprint issues and flags any missing QE/BT criteria fields.
 *
 * @param {object} teamProfile - Active TeamWorkflowProfile
 * @param {object} jiraConfig - Jira service config
 * @param {boolean} isTlsVerified - TLS verification flag
 * @returns {Promise<void>}
 */
async function runDorScanIfDue(teamProfile, jiraConfig, isTlsVerified) {
  const todayDateKey = new Date().toISOString().slice(0, 10);
  if (todayDateKey === lastDorScanDate) return;

  // Find the active sprint on the configured board.
  const activeSprint = await findSprintByName(activeSprintName || '', teamProfile.boardId, jiraConfig, isTlsVerified)
    .catch(() => null);

  if (!activeSprint) return;

  const sprintIssuesPath = '/rest/agile/1.0/sprint/' + activeSprint.id
    + '/issue?fields=' + encodeURIComponent(DOR_ISSUE_FIELDS + ',' + (teamProfile.dorQeFieldId || '') + ',' + (teamProfile.dorBtFieldId || ''))
    + '&maxResults=100';

  let sprintIssues;
  try {
    const sprintResponse = await makeJiraApiRequest('GET', sprintIssuesPath, null, jiraConfig, isTlsVerified);
    sprintIssues = (sprintResponse.body && sprintResponse.body.issues) || [];
  } catch (sprintError) {
    console.error('[SprintRelease] Sprint issues fetch failed for DoR scan: ' + sprintError.message);
    return;
  }

  const violations = findDorViolations(sprintIssues, teamProfile);

  for (const violation of violations) {
    await postDorViolationComment(violation.issueKey, violation.missingFields, jiraConfig, isTlsVerified);
  }

  lastDorScanDate = todayDateKey;
  console.log('[SprintRelease] DoR scan complete — ' + violations.length + ' violations found.');
}

// ── Full poll cycle ───────────────────────────────────────────────────────────

/**
 * Runs a complete poll cycle for all enabled team profiles:
 *   1. Sub-status scan (QE/BT handoff detection)
 *   2. FixVersion date sync
 *   3. Defect intake label scan
 *   4. DoR violation check (daily only)
 *
 * Errors in individual scans are logged but do not abort the other scans.
 *
 * @param {object} configuration - Live server configuration object
 * @returns {Promise<void>}
 */
async function runPollCycle(configuration) {
  const jiraConfig = configuration.jira || {};
  const isTlsVerified = configuration.sslVerify !== false;
  const sprintReleaseConfig = configuration.sprintRelease || {};
  const teamProfiles = sprintReleaseConfig.teamProfiles || [];

  for (const teamProfile of teamProfiles) {
    if (!teamProfile.isEnabled) continue;

    console.log('[SprintRelease] Poll cycle starting for profile "' + teamProfile.teamProfileId + '"...');

    try {
      await runSubStatusScan(teamProfile, jiraConfig, isTlsVerified);
    } catch (subStatusError) {
      console.error('[SprintRelease] Sub-status scan threw: ' + subStatusError.message);
    }

    try {
      await runFixVersionDateSync(teamProfile, jiraConfig, isTlsVerified);
    } catch (fixVersionError) {
      console.error('[SprintRelease] FixVersion sync threw: ' + fixVersionError.message);
    }

    try {
      await runDefectIntakeScan(teamProfile, jiraConfig, isTlsVerified);
    } catch (defectIntakeError) {
      console.error('[SprintRelease] Defect intake scan threw: ' + defectIntakeError.message);
    }

    try {
      await runDorScanIfDue(teamProfile, jiraConfig, isTlsVerified);
    } catch (dorError) {
      console.error('[SprintRelease] DoR scan threw: ' + dorError.message);
    }
  }

  lastPollAt = new Date().toISOString();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Starts the sprint-release polling scheduler. Fires a poll cycle every
 * `pollIntervalMinutes` minutes (from the first active team profile config,
 * default 5 minutes). Safe to call multiple times — clears any prior interval.
 *
 * @param {object} configuration - Live server configuration object (read by reference).
 */
function startSprintReleaseScheduler(configuration) {
  if (schedulerIntervalHandle) {
    clearInterval(schedulerIntervalHandle);
  }

  // Read poll interval from the first team profile — all profiles share the same cadence.
  const firstProfile = ((configuration.sprintRelease || {}).teamProfiles || [])[0];
  const pollIntervalMinutes = (firstProfile && firstProfile.pollIntervalMinutes) || 5;
  const pollIntervalMs = pollIntervalMinutes * 60 * 1000;

  console.log('[SprintRelease] Scheduler started — polling every ' + pollIntervalMinutes + ' min.');

  schedulerIntervalHandle = setInterval(() => {
    nextPollAt = new Date(Date.now() + pollIntervalMs).toISOString();
    runPollCycle(configuration).catch((cycleError) => {
      console.error('[SprintRelease] Poll cycle threw: ' + cycleError.message);
    });
  }, pollIntervalMs);

  nextPollAt = new Date(Date.now() + pollIntervalMs).toISOString();
}

/**
 * Triggers an immediate poll cycle outside the scheduled interval.
 * Used by the POST /api/sprint-release/run-now endpoint.
 *
 * @param {object} configuration - Live server configuration object.
 * @returns {Promise<void>}
 */
async function triggerPollCycleNow(configuration) {
  await runPollCycle(configuration);
}

/**
 * Returns the current runtime state of the sprint-release scheduler.
 * Used by the GET /api/sprint-release/status endpoint.
 *
 * @param {object} configuration - Live server configuration (for isEnabled, teamProfileId).
 * @returns {object} Runtime status object matching the contracts/api-endpoints.md shape.
 */
function getSprintReleaseStatus(configuration) {
  const firstProfile = ((configuration.sprintRelease || {}).teamProfiles || [])[0] || {};

  return {
    teamProfileId:       firstProfile.teamProfileId || 'default',
    isEnabled:           !!firstProfile.isEnabled,
    lastPollAt,
    nextPollAt,
    recentHandoffs:      recentHandoffs.slice(),
    recentDefectIntakes: recentDefectIntakes.slice(),
    sprintSyncWarnings:  sprintSyncWarnings.slice(),
    activeSprintName,
    activeSprintEndDate,
  };
}

module.exports = {
  startSprintReleaseScheduler,
  triggerPollCycleNow,
  getSprintReleaseStatus,
  // Exported for unit tests:
  lastHandoffByIssue,
  recentHandoffs,
  recentDefectIntakes,
};
