// src/services/scopeChangeScheduler.js — Daily Scope Change report scheduler.
//
// Tracks Fix Version (PI-level) scope changes for Features only.
// Sprint-level changes are intentionally excluded — this report is PI-scoped.
// Runs Monday–Friday only, looking back to the previous business day so that
// Monday's run captures anything that slipped in over the weekend.
// A single setInterval fires every 60 seconds and checks all configured
// scheduleTime values against the current HH:MM local time, firing any
// that match and have not yet run today.

'use strict';

const { makeJiraApiRequest, makeConfluenceApiRequest, triggerWebhook } = require('../utils/httpClient');
const { requestAiAssistText, isAiAssistEnabled } = require('./aiAssistEnrichment');
const { loadFiredDates, recordFiredDate, isScheduledTimeReached } = require('./schedulerFiredState');
const { recordDeliveryOutcome } = require('./reportDeliveryStatus');
const { resolveCoverageCutoff, getCoverageWatermark, setCoverageWatermark } = require('./reportCoverage');

/** Stable name under which this scheduler's fired dates and delivery status are persisted. */
const FIRED_STATE_SCHEDULER_NAME = 'scopeChange';

// ── Constants ──

/** How often (ms) the scheduler checks for reports to fire. */
const SCHEDULE_CHECK_INTERVAL_MS = 60 * 1000;

/** How many issues to fetch per Jira query. */
const JIRA_MAX_RESULTS = 200;

/** Default schedule time used when a config has no scheduleTime set. */
const DEFAULT_SCHEDULE_TIME = '11:00';

/**
 * Day-of-week numbers returned by Date.getDay().
 * Stored as constants so the weekend and business-day logic is self-documenting.
 */
const DAY_SUNDAY   = 0;
const DAY_MONDAY   = 1;
const DAY_SATURDAY = 6;

/**
 * How many calendar days to subtract from today to reach the previous business day.
 * Indexed by getDay() value (0 = Sunday … 6 = Saturday).
 * Monday (1) → 3 days back lands on Friday.
 * Saturday (6) and Sunday (0) are safety fallbacks; the scheduler skips weekends.
 */
const DAYS_BACK_TO_PREVIOUS_BUSINESS_DAY = [2, 3, 1, 1, 1, 1, 1];

// ── Schedule tracking ──

// Tracks the last date (YYYY-MM-DD) each config fired so we never fire twice on the same day.
// Hydrated from the persistent fired-state file when the scheduler starts, so a restart
// later the same day does not re-deliver a report that already went out.
let lastFiredDates = new Map();

let schedulerIntervalHandle = null;

/**
 * Returns the current local time as "HH:MM" (24-hour, zero-padded).
 * @returns {string}
 */
function getCurrentTimeHHMM() {
  const now = new Date();
  return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
}

/**
 * Returns today's date string "YYYY-MM-DD" in local time.
 * @returns {string}
 */
function getTodayDateString() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

/**
 * Checks whether a config key has already fired today.
 * @param {string} configKey
 * @returns {boolean}
 */
function hasAlreadyFiredToday(configKey) {
  return lastFiredDates.get(configKey) === getTodayDateString();
}

/**
 * Records that a config key fired today, both in memory and on disk. Persisting the
 * date lets a restart later the same day recognise the slot as already satisfied.
 * @param {string} configKey
 */
function markFiredToday(configKey) {
  const today = getTodayDateString();
  lastFiredDates.set(configKey, today);
  recordFiredDate(FIRED_STATE_SCHEDULER_NAME, configKey, today);
}

/**
 * Returns true when today is Saturday or Sunday.
 * The scheduler skips both weekend days — scope change reports are business-day only.
 *
 * @returns {boolean}
 */
function isTodayWeekend() {
  const dayOfWeek = new Date().getDay();
  return dayOfWeek === DAY_SUNDAY || dayOfWeek === DAY_SATURDAY;
}

/**
 * Returns a Date set to midnight at the start of the previous business day.
 *
 * Monday  → Friday  (3 days back)
 * Tue–Fri → previous calendar day (1 day back)
 * Weekend → Friday  (safety fallback; normally gated by isTodayWeekend)
 *
 * Using midnight ensures the Jira query window covers the full previous day,
 * not just the last 24 hours from the exact moment the scheduler fires.
 *
 * @returns {Date}
 */
function getPreviousBusinessDayCutoff() {
  const now        = new Date();
  const dayOfWeek  = now.getDay();
  const daysToBack = DAYS_BACK_TO_PREVIOUS_BUSINESS_DAY[dayOfWeek];

  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - daysToBack);
  cutoff.setHours(0, 0, 0, 0);
  return cutoff;
}

// ── Scheduler entry point ──

/**
 * Starts the scope change scheduler. Fires a check every 60 seconds.
 * Each check iterates all teamReports and the artRollup, firing any whose
 * scheduleTime matches the current minute and have not yet run today.
 *
 * @param {object} configuration - Live server config (read at fire time, not capture time)
 */
function startScopeChangeScheduler(configuration) {
  if (schedulerIntervalHandle) {
    clearInterval(schedulerIntervalHandle);
  }
  // Seed the in-memory tracker from disk so today's already-delivered reports are not
  // re-sent after a restart, while any slot still due today can still catch up.
  lastFiredDates = loadFiredDates(FIRED_STATE_SCHEDULER_NAME);
  console.log('  📅 Scope Change scheduler started — checking every minute');

  schedulerIntervalHandle = setInterval(() => {
    checkAndFireScheduledReports(configuration);
  }, SCHEDULE_CHECK_INTERVAL_MS);
}

/**
 * Iterates all team reports and the ART rollup, firing any whose scheduleTime
 * matches the current minute and have not yet fired today.
 * Skips entirely on Saturday and Sunday — there is no business activity to report.
 *
 * @param {object} configuration
 */
function checkAndFireScheduledReports(configuration) {
  // Weekend guard: scope change reports are business-day only.
  if (isTodayWeekend()) {
    return;
  }

  const scopeChangeConfig = (configuration.scheduler || {}).scopeChange || {};
  const teamReports = scopeChangeConfig.teamReports || [];
  const artRollup   = scopeChangeConfig.artRollup   || {};
  const jiraConfig       = configuration.jira;
  const confluenceConfig = configuration.confluence;
  const sslVerify        = configuration.sslVerify !== false;
  const currentTime      = getCurrentTimeHHMM();

  for (let teamIndex = 0; teamIndex < teamReports.length; teamIndex++) {
    const teamReport = teamReports[teamIndex];
    if (!teamReport.isEnabled) continue;

    // Fire when the scheduled time has been reached OR passed today (catch-up) and
    // the report has not already fired today — not only on an exact minute match.
    const scheduledTime = teamReport.scheduleTime || DEFAULT_SCHEDULE_TIME;
    if (!isScheduledTimeReached(scheduledTime, currentTime)) continue;

    const configKey = 'team-' + teamIndex + '-' + teamReport.projectKey;
    if (hasAlreadyFiredToday(configKey)) continue;

    markFiredToday(configKey);
    console.log('  📤 Scope Change: firing team report for ' + teamReport.projectKey + ' (' + teamReport.teamName + ')');
    const teamLabel = teamReport.teamName || teamReport.projectKey;
    recordDeliveryOutcome('scopeChange', configKey, teamLabel, 'scheduled',
      () => runTeamReportDelivery(teamReport, jiraConfig, confluenceConfig, sslVerify, configuration),
    ).catch((deliveryError) => {
      console.error('  ⚠ Scope Change team report error (' + teamReport.projectKey + '):', deliveryError.message);
    });
  }

  if (artRollup.isEnabled) {
    const rollupTime = artRollup.scheduleTime || DEFAULT_SCHEDULE_TIME;
    if (isScheduledTimeReached(rollupTime, currentTime) && !hasAlreadyFiredToday('artRollup')) {
      markFiredToday('artRollup');
      console.log('  📤 Scope Change: firing ART rollup');
      recordDeliveryOutcome('scopeChange', 'artRollup', 'ART Rollup', 'scheduled',
        () => runArtRollupDelivery(artRollup, jiraConfig, confluenceConfig, sslVerify, configuration),
      ).catch((deliveryError) => {
        console.error('  ⚠ Scope Change ART rollup error:', deliveryError.message);
      });
    }
  }
}

// ── Jira queries ──

/**
 * Fetches all issues whose fixVersion changed after the cutoff date.
 * Covers every issue type (not just Features) so the scheduled report matches what the
 * Reports Hub shows — a Story or Task fixVersion change is a real scope change too.
 *
 * @param {string} projectKey
 * @param {string} cutoffDateString - YYYY-MM-DD
 * @param {object} jiraConfig
 * @param {boolean} sslVerify
 * @returns {Promise<Array>}
 */
async function fetchFixVersionChanges(projectKey, cutoffDateString, jiraConfig, sslVerify) {
  const jql  = 'project = "' + projectKey + '" AND fixVersion changed AFTER "' + cutoffDateString + '"';
  const path = '/rest/api/2/search?jql=' + encodeURIComponent(jql) + '&fields=summary,issuetype&expand=changelog&maxResults=' + JIRA_MAX_RESULTS;
  const result = await makeJiraApiRequest('GET', path, null, jiraConfig, sslVerify);
  return result.body.issues || [];
}

/**
 * Fetches candidate issues for Sprint changes after the cutoff date.
 *
 * Jira's history-search JQL supports `fixVersion changed AFTER` but NOT `sprint changed
 * AFTER` (sprint is an Agile-managed field excluded from history predicates), so we widen
 * the query to `updated >= cutoff` and let extractChangeEntries() filter the inline
 * changelog for sprint-field changes inside the window. This mirrors the Reports Hub.
 *
 * @param {string} projectKey
 * @param {string} cutoffDateString - YYYY-MM-DD
 * @param {object} jiraConfig
 * @param {boolean} sslVerify
 * @returns {Promise<Array>}
 */
async function fetchSprintChanges(projectKey, cutoffDateString, jiraConfig, sslVerify) {
  const jql  = 'project = "' + projectKey + '" AND updated >= "' + cutoffDateString + '"';
  const path = '/rest/api/2/search?jql=' + encodeURIComponent(jql) + '&fields=summary,issuetype&expand=changelog&maxResults=' + JIRA_MAX_RESULTS;
  const result = await makeJiraApiRequest('GET', path, null, jiraConfig, sslVerify);
  return result.body.issues || [];
}

// ── Change entry extraction ──

/**
 * Reduces every in-window change to one field on one issue to a single net change: the previous
 * value is taken from the EARLIEST change and the current value from the LATEST. A self-healed
 * catch-up window can hold several edits to the same field (e.g. removed from a sprint, then added
 * to another); collapsing them keeps the "previous" column showing the value the field actually
 * held when the window opened, rather than an intermediate blank left by the last raw edit.
 *
 * @param {object} issue       - Jira issue with an expanded changelog.
 * @param {string} targetField - Lowercase field name to collapse ('fix version' or 'sprint').
 * @param {Date}   cutoffDate  - Only changes at or after this date are considered.
 * @returns {{ fromValue: string, toValue: string, changedBy: string, changedAt: string }|null}
 */
function collapseNetFieldChange(issue, targetField, cutoffDate) {
  const changes = [];
  for (const history of (issue.changelog && issue.changelog.histories) || []) {
    if (new Date(history.created) < cutoffDate) continue;
    for (const item of history.items || []) {
      if (item.field.toLowerCase() !== targetField) continue;
      changes.push({ item, created: history.created, author: history.author });
    }
  }
  if (changes.length === 0) return null;
  changes.sort((first, second) => new Date(first.created) - new Date(second.created));
  const earliest = changes[0];
  const latest   = changes[changes.length - 1];
  return {
    fromValue: earliest.item.fromString || '',
    toValue:   latest.item.toString    || '',
    changedBy: latest.author.displayName,
    changedAt: latest.created,
  };
}

/**
 * Builds one net change entry per issue for a specific field after the cutoff date. Multiple edits
 * to the same field inside the window collapse into a single row (see collapseNetFieldChange).
 *
 * @param {Array}  issues
 * @param {string} targetField    - Lowercase field name ('fix version' or 'sprint')
 * @param {'fixVersion'|'sprint'} changeType
 * @param {Date}   cutoffDate
 * @returns {Array<object>}
 */
function extractChangeEntries(issues, targetField, changeType, cutoffDate) {
  const entries = [];
  for (const issue of issues) {
    const netChange = collapseNetFieldChange(issue, targetField, cutoffDate);
    if (!netChange) continue;
    // Skip when the field ended the window with no value (a removal) or did not net change —
    // mirrors the original "ignore items without a toString" rule, applied to the net result.
    if (!netChange.toValue || netChange.fromValue === netChange.toValue) continue;
    entries.push({
      issueKey:     issue.key,
      issueSummary: issue.fields.summary,
      issueType:    (issue.fields.issuetype && issue.fields.issuetype.name) || 'Unknown',
      changeType,
      fromValue:    netChange.fromValue || '—',
      toValue:      netChange.toValue,
      changedBy:    netChange.changedBy,
      changedAt:    netChange.changedAt,
    });
  }
  return entries;
}

// ── Confluence formatting ──

/**
 * Escapes a string for safe inclusion in Confluence storage format XML.
 * @param {string} text
 * @returns {string}
 */
function escapeXml(text) {
  return String(text)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

/**
 * Builds the prompt asking AI Assist for a one-paragraph trend commentary on the
 * release (fix version) changes, identifying the release most at risk.
 *
 * @param {Array} releaseEntries - Change entries (issueKey, issueSummary, fromValue, toValue).
 * @param {string} projectKey
 * @returns {string}
 */
function buildScopeAiAssistPrompt(releaseEntries, projectKey) {
  const lines = (releaseEntries || [])
    .map((entry) => `- ${entry.issueKey} ${entry.issueSummary}: ${entry.fromValue} → ${entry.toValue}`)
    .join('\n');
  return [
    `You are a release train assistant. Below are the fix-version (release scope) changes for "${projectKey}" since the last business day.`,
    'Write ONE short paragraph (2-3 sentences, plain prose, no preamble or heading) identifying the release',
    'most at risk from these scope movements and why.',
    '',
    lines || '(none)',
  ].join('\n');
}

/**
 * Builds the prompt asking AI Assist for a one-paragraph cross-team trend commentary on
 * the ART rollup, identifying the team/release most at risk across all teams.
 *
 * @param {Array} teamResults - [{ teamName, projectKey, releaseEntries }]
 * @returns {string}
 */
function buildScopeRollupAiAssistPrompt(teamResults) {
  const lines = (teamResults || [])
    .map((result) => `- ${result.teamName} (${result.projectKey}): ${(result.releaseEntries || []).length} release change(s)`)
    .join('\n');
  return [
    'You are a release train assistant. Below is a cross-team ART rollup of fix-version (release scope)',
    'changes since the last business day. Write ONE short paragraph (2-3 sentences, plain prose, no',
    'preamble or heading) identifying which team or release is most at risk across the ART and why.',
    '',
    lines || '(none)',
  ].join('\n');
}

/**
 * Wraps AI Assist's trend commentary in a Confluence "info" panel for prepending above
 * the change table. Text is XML-escaped; blank-line groups become paragraphs.
 *
 * @param {string} commentaryText - Plain-text commentary returned by AI Assist.
 * @returns {string} Confluence storage-format markup.
 */
function buildAiAssistTrendPanel(commentaryText) {
  const paragraphs = String(commentaryText)
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => '<p>' + escapeXml(paragraph).replace(/\n/g, '<br/>') + '</p>')
    .join('');
  return '<ac:structured-macro ac:name="info"><ac:rich-text-body>'
    + '<p><strong>🤖 AI Assist trend</strong></p>' + paragraphs
    + '</ac:rich-text-body></ac:structured-macro>';
}

/**
 * Renders a list of scope change entries as a Confluence storage-format table.
 * Returns an empty-state paragraph when the list is empty.
 *
 * @param {Array}  entries
 * @param {string} emptyMessage
 * @returns {string}
 */
function renderChangeTable(entries, emptyMessage) {
  if (entries.length === 0) {
    return '<p><em>' + escapeXml(emptyMessage) + '</em></p>';
  }

  const headerRow = ['Issue', 'Summary', 'Type', 'From', 'To', 'Changed By', 'Changed At']
    .map((header) => '<th><strong>' + header + '</strong></th>')
    .join('');

  const dataRows = entries.map((entry) => {
    const changedAtFormatted = new Date(entry.changedAt).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return [
      '<td><strong>' + escapeXml(entry.issueKey) + '</strong></td>',
      '<td>' + escapeXml(entry.issueSummary) + '</td>',
      '<td>' + escapeXml(entry.issueType) + '</td>',
      '<td>' + escapeXml(entry.fromValue) + '</td>',
      '<td>' + escapeXml(entry.toValue) + '</td>',
      '<td>' + escapeXml(entry.changedBy) + '</td>',
      '<td>' + escapeXml(changedAtFormatted) + '</td>',
    ].join('');
  }).map((cells) => '<tr>' + cells + '</tr>').join('');

  return '<table><tbody><tr>' + headerRow + '</tr>' + dataRows + '</tbody></table>';
}

/**
 * Renders a list of scope change entries as a Confluence table that includes a Team column.
 * Used in the ART rollup report.
 *
 * @param {Array}  entries - entries with an extra teamName field
 * @param {string} emptyMessage
 * @returns {string}
 */
function renderRollupChangeTable(entries, emptyMessage) {
  if (entries.length === 0) {
    return '<p><em>' + escapeXml(emptyMessage) + '</em></p>';
  }

  const headerRow = ['Team', 'Issue', 'Summary', 'Type', 'From', 'To', 'Changed By', 'Changed At']
    .map((header) => '<th><strong>' + header + '</strong></th>')
    .join('');

  const dataRows = entries.map((entry) => {
    const changedAtFormatted = new Date(entry.changedAt).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return [
      '<td><strong>' + escapeXml(entry.teamName || entry.projectKey) + '</strong></td>',
      '<td><strong>' + escapeXml(entry.issueKey) + '</strong></td>',
      '<td>' + escapeXml(entry.issueSummary) + '</td>',
      '<td>' + escapeXml(entry.issueType) + '</td>',
      '<td>' + escapeXml(entry.fromValue) + '</td>',
      '<td>' + escapeXml(entry.toValue) + '</td>',
      '<td>' + escapeXml(entry.changedBy) + '</td>',
      '<td>' + escapeXml(changedAtFormatted) + '</td>',
    ].join('');
  }).map((cells) => '<tr>' + cells + '</tr>').join('');

  return '<table><tbody><tr>' + headerRow + '</tr>' + dataRows + '</tbody></table>';
}

/**
 * Builds the Confluence storage-format body for a single team report.
 * Shows both Release (Fix Version) and Sprint changes so the scheduled report matches
 * what the Reports Hub displays.
 *
 * @param {Array}  releaseEntries
 * @param {Array}  sprintEntries
 * @param {string} projectKey
 * @param {string} generatedAt     - Human-readable timestamp
 * @param {string} sinceLabel      - Human-readable "since" date, e.g. "Jun 13, 2026 (Fri)"
 * @returns {string}
 */
function buildConfluenceBlogBody(releaseEntries, sprintEntries, projectKey, generatedAt, sinceLabel) {
  const releaseBadge = '(' + releaseEntries.length + ' change' + (releaseEntries.length !== 1 ? 's' : '') + ')';
  const sprintBadge  = '(' + sprintEntries.length  + ' change' + (sprintEntries.length  !== 1 ? 's' : '') + ')';

  return [
    '<p><strong>Project:</strong> ' + escapeXml(projectKey) +
      ' &nbsp;|&nbsp; <strong>Generated:</strong> ' + escapeXml(generatedAt) +
      ' &nbsp;|&nbsp; <strong>Since:</strong> ' + escapeXml(sinceLabel) + '</p>',
    '<h2>📦 Release Changes ' + escapeXml(releaseBadge) + '</h2>',
    renderChangeTable(releaseEntries, 'No fix version changes since ' + sinceLabel + '.'),
    '<h2>🏃 Sprint Changes ' + escapeXml(sprintBadge) + '</h2>',
    renderChangeTable(sprintEntries, 'No sprint changes since ' + sinceLabel + '.'),
  ].join('\n');
}

/**
 * Builds the Confluence storage-format body for the ART rollup report.
 * Shows a team summary table and combined Release + Sprint change tables, matching the
 * per-team report and the Reports Hub.
 *
 * @param {Array}  teamResults    - [{ teamName, projectKey, releaseEntries, sprintEntries }]
 * @param {string} projectKeyList - Comma-separated project keys shown in the header
 * @param {string} generatedAt    - Human-readable timestamp
 * @param {string} sinceLabel     - Human-readable "since" date, e.g. "Jun 13, 2026 (Fri)"
 * @returns {string}
 */
function buildArtRollupBlogBody(teamResults, projectKeyList, generatedAt, sinceLabel) {
  const withTeamName = (entries, result) =>
    entries.map((entry) => Object.assign({}, entry, { teamName: result.teamName || result.projectKey }));

  const allReleaseEntries = teamResults.flatMap((result) => withTeamName(result.releaseEntries, result));
  const allSprintEntries  = teamResults.flatMap((result) => withTeamName(result.sprintEntries || [], result));

  const releaseBadge = '(' + allReleaseEntries.length + ' change' + (allReleaseEntries.length !== 1 ? 's' : '') + ')';
  const sprintBadge  = '(' + allSprintEntries.length  + ' change' + (allSprintEntries.length  !== 1 ? 's' : '') + ')';

  const teamSummaryRows = teamResults.map((result) => {
    return '<tr><td><strong>' + escapeXml(result.teamName || result.projectKey) + '</strong></td>' +
      '<td>' + escapeXml(result.projectKey) + '</td>' +
      '<td>' + result.releaseEntries.length + '</td>' +
      '<td>' + (result.sprintEntries || []).length + '</td></tr>';
  }).join('');

  const teamSummaryTable = '<table><tbody>' +
    '<tr><th><strong>Team</strong></th><th><strong>Project</strong></th><th><strong>Release Changes</strong></th><th><strong>Sprint Changes</strong></th></tr>' +
    teamSummaryRows + '</tbody></table>';

  return [
    '<p><strong>Teams:</strong> ' + escapeXml(projectKeyList) +
      ' &nbsp;|&nbsp; <strong>Generated:</strong> ' + escapeXml(generatedAt) +
      ' &nbsp;|&nbsp; <strong>Since:</strong> ' + escapeXml(sinceLabel) + '</p>',
    '<h2>📊 Team Summary</h2>',
    teamSummaryTable,
    '<h2>📦 Release Changes ' + escapeXml(releaseBadge) + '</h2>',
    renderRollupChangeTable(allReleaseEntries, 'No fix version changes since ' + sinceLabel + '.'),
    '<h2>🏃 Sprint Changes ' + escapeXml(sprintBadge) + '</h2>',
    renderRollupChangeTable(allSprintEntries, 'No sprint changes since ' + sinceLabel + '.'),
  ].join('\n');
}

// ── Confluence delivery ──

/**
 * Extracts the numeric Confluence page ID from a full page URL.
 * Handles both blog and page URL formats.
 *
 * @param {string} url
 * @returns {string|null}
 */
function extractPageIdFromUrl(url) {
  const match = url.match(/\/(\d{6,})(?:\/|$)/);
  return match ? match[1] : null;
}

/**
 * Fetches the current version number and body storage value of a Confluence page/blog post.
 * Both are needed to append new content while preserving the existing history.
 *
 * @param {string} pageId
 * @param {object} confluenceConfig
 * @param {boolean} sslVerify
 * @returns {Promise<{ versionNumber: number, existingBody: string }>}
 */
async function fetchConfluencePage(pageId, confluenceConfig, sslVerify) {
  const result = await makeConfluenceApiRequest(
    'GET',
    '/wiki/rest/api/content/' + pageId + '?expand=version,body.storage',
    null,
    confluenceConfig,
    sslVerify,
  );
  if (result.status !== 200) {
    const errorDetail = (result.body && result.body.message) || ('HTTP ' + result.status);
    throw new Error('Could not fetch page: ' + errorDetail);
  }
  const versionNumber = (result.body.version && result.body.version.number) || 1;
  const existingBody  = (result.body.body && result.body.body.storage && result.body.body.storage.value) || '';
  // Preserve the original content type ('page' or 'blogpost') so updates don't misclassify it.
  const contentType   = result.body.type || 'page';
  return { versionNumber, existingBody, contentType };
}

/**
 * Prepends a new scope change report to an existing Confluence page or blog post.
 * Each run's output is separated by a horizontal rule so the page accumulates
 * a dated history rather than being overwritten each time.
 *
 * @param {string} pageId
 * @param {string} title
 * @param {string} newReportHtml
 * @param {object} confluenceConfig
 * @param {boolean} sslVerify
 * @returns {Promise<string>} Web URL of the updated post
 */
async function updateConfluenceBlogPost(pageId, title, newReportHtml, confluenceConfig, sslVerify) {
  const { versionNumber, existingBody, contentType } = await fetchConfluencePage(pageId, confluenceConfig, sslVerify);

  // Prepend the new report above existing content so the most recent run is always at the top.
  const separator   = '<hr/>';
  const combinedBody = existingBody
    ? newReportHtml + '\n' + separator + '\n' + existingBody
    : newReportHtml;

  const payload = {
    id:      pageId,
    type:    contentType,
    title,
    version: { number: versionNumber + 1 },
    body: {
      storage: {
        value:          combinedBody,
        representation: 'storage',
      },
    },
  };

  const result = await makeConfluenceApiRequest('PUT', '/wiki/rest/api/content/' + pageId, payload, confluenceConfig, sslVerify);

  if (result.status !== 200 && result.status !== 201) {
    const errorDetail = (result.body && result.body.message) || JSON.stringify(result.body);
    throw new Error('Confluence returned HTTP ' + result.status + ': ' + errorDetail);
  }

  return (result.body._links && result.body._links.base && result.body._links.webui)
    ? result.body._links.base + result.body._links.webui
    : '(URL unavailable)';
}

/**
 * Creates a new Confluence blog post.
 *
 * @param {string} spaceKey
 * @param {string} title
 * @param {string} bodyHtml
 * @param {object} confluenceConfig
 * @param {boolean} sslVerify
 * @returns {Promise<string>} URL of the created post
 */
async function createConfluenceBlogPost(spaceKey, title, bodyHtml, confluenceConfig, sslVerify) {
  const payload = {
    type:  'blogpost',
    title,
    space: { key: spaceKey },
    body:  {
      storage: {
        value:          bodyHtml,
        representation: 'storage',
      },
    },
  };

  const result = await makeConfluenceApiRequest('POST', '/wiki/rest/api/content', payload, confluenceConfig, sslVerify);

  if (result.status !== 200 && result.status !== 201) {
    const errorDetail = (result.body && result.body.message) || JSON.stringify(result.body);
    throw new Error('Confluence returned HTTP ' + result.status + ': ' + errorDetail);
  }

  return (result.body._links && result.body._links.base && result.body._links.webui)
    ? result.body._links.base + result.body._links.webui
    : '(URL unavailable)';
}

/**
 * Delivers a scope change report for one team to Confluence.
 * Updates an existing page if targetBlogUrl is configured, otherwise creates a new post.
 *
 * @param {object} teamReport - { teamName, projectKey, confluenceSpaceKey, targetBlogUrl, scheduleTime, isEnabled }
 * @param {object} jiraConfig
 * @param {object} confluenceConfig
 * @param {boolean} sslVerify
 * @returns {Promise<{ skipped: boolean, message: string, postUrl?: string }>}
 */
async function runTeamReportDelivery(teamReport, jiraConfig, confluenceConfig, sslVerify, configuration) {
  const { teamName, projectKey, confluenceSpaceKey, targetBlogUrl, triggerUrl, triggerSecret } = teamReport;

  // Cutoff = the previous business day, but reaching back to the last run if days were missed
  // (downtime), so a gap self-heals instead of dropping changes. coverageKey is per project.
  const coverageKey      = 'scope-team-' + projectKey;
  const runStartedAt     = new Date();
  const cutoffDate       = resolveCoverageCutoff(getCoverageWatermark(coverageKey), getPreviousBusinessDayCutoff(), runStartedAt);
  const cutoffDateString = cutoffDate.toISOString().slice(0, 10);
  const sinceLabel       = cutoffDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', weekday: 'short' });

  console.log('  🔍 Scope Change [' + projectKey + ']: querying fix version + sprint changes since ' + cutoffDateString + '…');
  console.log('  🔗 Scope Change [' + projectKey + ']: triggerUrl = ' + (triggerUrl || '(not set)'));

  // Query release (fixVersion) and sprint changes in parallel — both are real scope
  // changes, matching what the Reports Hub shows.
  const [fixVersionIssues, sprintIssues] = await Promise.all([
    fetchFixVersionChanges(projectKey, cutoffDateString, jiraConfig, sslVerify),
    fetchSprintChanges(projectKey, cutoffDateString, jiraConfig, sslVerify),
  ]);
  const releaseEntries = extractChangeEntries(fixVersionIssues, 'fix version', 'fixVersion', cutoffDate);
  const sprintEntries  = extractChangeEntries(sprintIssues, 'sprint', 'sprint', cutoffDate);

  // Only deliver when there is actual data — an empty report has no value and
  // should not trigger automation rules or clutter the Confluence page history.
  if (releaseEntries.length === 0 && sprintEntries.length === 0) {
    console.log('  ✅ Scope Change [' + projectKey + ']: no fix version or sprint changes — skipping');
    // A skip confirms coverage through now (there was nothing to report), so advance the watermark.
    setCoverageWatermark(coverageKey, runStartedAt.toISOString());
    return { skipped: true, message: 'No fix version or sprint changes since ' + sinceLabel + ' — delivery skipped.' };
  }

  const generatedAt = new Date().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
  const dateLabel    = new Date().toISOString().slice(0, 10);
  const teamLabel    = teamName || projectKey;
  const targetPageId = targetBlogUrl ? extractPageIdFromUrl(targetBlogUrl) : null;
  // Always stamp the run date into the title so the page name reflects when it was last
  // updated. On an ongoing (updated) page Confluence renames it to the latest date; on a
  // fresh post the date keeps each new post uniquely named.
  const postTitle    = 'Scope Change Report — ' + teamLabel + ' — ' + dateLabel;
  let bodyHtml     = buildConfluenceBlogBody(releaseEntries, sprintEntries, projectKey, generatedAt, sinceLabel);

  // Optional, non-blocking AI Assist enrichment: prepend a trend paragraph above the
  // change table. Skipped silently when AI Assist is disabled/unavailable so the report
  // always publishes (FR-002, SC-002, SC-008).
  if (isAiAssistEnabled(configuration)) {
    const aiAssistCommentary = await requestAiAssistText(
      configuration,
      buildScopeAiAssistPrompt(releaseEntries, projectKey),
      { label: 'scope-change' },
    );
    if (aiAssistCommentary) {
      bodyHtml = buildAiAssistTrendPanel(aiAssistCommentary) + bodyHtml;
    }
  }
  console.log('  🔗 Scope Change [' + projectKey + ']: targetBlogUrl = ' + (targetBlogUrl || '(not set)') + ' → pageId = ' + (targetPageId || 'none'));
  let postUrl;
  if (targetPageId) {
    console.log('  📝 Scope Change [' + projectKey + ']: updating page ' + targetPageId + '…');
    postUrl = await updateConfluenceBlogPost(targetPageId, postTitle, bodyHtml, confluenceConfig, sslVerify);
  } else {
    console.log('  📝 Scope Change [' + projectKey + ']: creating post in space ' + confluenceSpaceKey + '…');
    postUrl = await createConfluenceBlogPost(confluenceSpaceKey, postTitle, bodyHtml, confluenceConfig, sslVerify);
  }
  console.log('  ✅ Scope Change [' + projectKey + ']: delivered — ' + postUrl);

  // Fire the automation webhook only when there are real changes — this is the
  // signal that drives email notifications. Never fire on an empty-data run.
  if (triggerUrl) {
    const webhookPayload = {
      teamName:           teamName || projectKey,
      projectKey,
      postUrl,
      generatedAt:        new Date().toISOString(),
      releaseChangeCount: releaseEntries.length,
      sprintChangeCount:  sprintEntries.length,
    };
    console.log('  🔔 Scope Change [' + projectKey + ']: triggering webhook…');
    triggerWebhook(triggerUrl, webhookPayload, sslVerify, triggerSecret || undefined).catch((webhookError) => {
      console.error('  ⚠ Scope Change [' + projectKey + ']: webhook trigger failed — ' + webhookError.message);
    });
  }

  // Delivery succeeded — coverage is confirmed through this run's start.
  setCoverageWatermark(coverageKey, runStartedAt.toISOString());

  return {
    skipped: false,
    message: 'Report delivered — ' + releaseEntries.length + ' release change(s), ' + sprintEntries.length + ' sprint change(s).',
    postUrl,
  };
}

/**
 * Delivers the ART rollup report to Confluence.
 * Queries all projectKeys in parallel, combines results, and creates/updates a single post.
 *
 * @param {object} artRollup - { projectKeys, teamNames?, confluenceSpaceKey, targetBlogUrl }
 * @param {object} jiraConfig
 * @param {object} confluenceConfig
 * @param {boolean} sslVerify
 * @returns {Promise<{ skipped: boolean, message: string, postUrl?: string }>}
 */
async function runArtRollupDelivery(artRollup, jiraConfig, confluenceConfig, sslVerify, configuration) {
  const { projectKeys, teamNames, confluenceSpaceKey, targetBlogUrl, triggerUrl, triggerSecret } = artRollup;

  if (!projectKeys || projectKeys.length === 0) {
    return { skipped: true, message: 'No project keys configured for ART rollup.' };
  }

  // Prior-business-day cutoff, reaching back to the last run when days were missed.
  const coverageKey      = 'scope-rollup';
  const runStartedAt     = new Date();
  const cutoffDate       = resolveCoverageCutoff(getCoverageWatermark(coverageKey), getPreviousBusinessDayCutoff(), runStartedAt);
  const cutoffDateString = cutoffDate.toISOString().slice(0, 10);
  const sinceLabel       = cutoffDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', weekday: 'short' });

  console.log('  🔍 Scope Change ART Rollup: querying ' + projectKeys.join(', ') + ' since ' + cutoffDateString + '…');
  console.log('  🔗 Scope Change ART Rollup: triggerUrl = ' + (triggerUrl || '(not set)'));

  const teamResults = await Promise.all(projectKeys.map(async (projectKey, index) => {
    const teamName = (teamNames && teamNames[index]) || projectKey;
    const [fixVersionIssues, sprintIssues] = await Promise.all([
      fetchFixVersionChanges(projectKey, cutoffDateString, jiraConfig, sslVerify),
      fetchSprintChanges(projectKey, cutoffDateString, jiraConfig, sslVerify),
    ]);
    return {
      teamName,
      projectKey,
      releaseEntries: extractChangeEntries(fixVersionIssues, 'fix version', 'fixVersion', cutoffDate),
      sprintEntries:  extractChangeEntries(sprintIssues, 'sprint', 'sprint', cutoffDate),
    };
  }));

  const totalChanges = teamResults.reduce(
    (sum, result) => sum + result.releaseEntries.length + result.sprintEntries.length,
    0,
  );

  // Only deliver when at least one team has a real release or sprint change.
  if (totalChanges === 0) {
    console.log('  ✅ Scope Change ART Rollup: no fix version or sprint changes across any team — skipping');
    setCoverageWatermark(coverageKey, runStartedAt.toISOString());
    return { skipped: true, message: 'No fix version or sprint changes since ' + sinceLabel + ' — delivery skipped.' };
  }

  const generatedAt    = new Date().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
  const dateLabel      = new Date().toISOString().slice(0, 10);
  const targetPageId   = targetBlogUrl ? extractPageIdFromUrl(targetBlogUrl) : null;
  // Always stamp the run date into the title so the page name reflects its latest update.
  const postTitle      = 'ART Scope Change Rollup — ' + dateLabel;
  const projectKeyList = projectKeys.join(', ');
  let   bodyHtml       = buildArtRollupBlogBody(teamResults, projectKeyList, generatedAt, sinceLabel);

  // Optional, non-blocking AI Assist enrichment: prepend a cross-team trend paragraph
  // above the rollup table. Skipped silently when AI Assist is disabled/unavailable.
  if (isAiAssistEnabled(configuration)) {
    const aiAssistCommentary = await requestAiAssistText(
      configuration,
      buildScopeRollupAiAssistPrompt(teamResults),
      { label: 'scope-rollup' },
    );
    if (aiAssistCommentary) {
      bodyHtml = buildAiAssistTrendPanel(aiAssistCommentary) + bodyHtml;
    }
  }
  let postUrl;
  if (targetPageId) {
    console.log('  📝 Scope Change ART Rollup: updating page ' + targetPageId + '…');
    postUrl = await updateConfluenceBlogPost(targetPageId, postTitle, bodyHtml, confluenceConfig, sslVerify);
  } else {
    console.log('  📝 Scope Change ART Rollup: creating post in space ' + confluenceSpaceKey + '…');
    postUrl = await createConfluenceBlogPost(confluenceSpaceKey, postTitle, bodyHtml, confluenceConfig, sslVerify);
  }
  console.log('  ✅ Scope Change ART Rollup: delivered — ' + postUrl);

  const releaseTotal = teamResults.reduce((sum, r) => sum + r.releaseEntries.length, 0);
  const sprintTotal  = teamResults.reduce((sum, r) => sum + r.sprintEntries.length, 0);

  // Fire the automation webhook only when there is real data.
  if (triggerUrl) {
    const webhookPayload = {
      teamName:           'ART Rollup',
      projectKeys,
      postUrl,
      generatedAt:        new Date().toISOString(),
      releaseChangeCount: releaseTotal,
      sprintChangeCount:  sprintTotal,
      teamCount:          projectKeys.length,
    };
    console.log('  🔔 Scope Change ART Rollup: triggering webhook…');
    triggerWebhook(triggerUrl, webhookPayload, sslVerify, triggerSecret || undefined).catch((webhookError) => {
      console.error('  ⚠ Scope Change ART Rollup: webhook trigger failed — ' + webhookError.message);
    });
  }

  // Delivery succeeded — coverage is confirmed through this run's start.
  setCoverageWatermark(coverageKey, runStartedAt.toISOString());

  return {
    skipped: false,
    message: 'ART rollup delivered — ' + releaseTotal + ' release change(s), ' + sprintTotal + ' sprint change(s) across ' + projectKeys.length + ' team(s).',
    postUrl,
  };
}

// ── Run-now entry points (called from notifications route) ──

/**
 * Manually triggers a single team report delivery.
 *
 * @param {object} configuration
 * @param {number} teamIndex - Index into configuration.scheduler.scopeChange.teamReports
 * @returns {Promise<{ skipped: boolean, message: string, postUrl?: string }>}
 */
async function runTeamReportNow(configuration, teamIndex) {
  const scopeChangeConfig = (configuration.scheduler || {}).scopeChange || {};
  const teamReports = scopeChangeConfig.teamReports || [];
  const teamReport  = teamReports[teamIndex];

  if (!teamReport) {
    return { skipped: true, message: 'Team report at index ' + teamIndex + ' not found.' };
  }

  const jiraConfig       = configuration.jira;
  const confluenceConfig = configuration.confluence;
  const sslVerify        = configuration.sslVerify !== false;

  const configKey = 'team-' + teamIndex + '-' + teamReport.projectKey;
  const teamLabel = teamReport.teamName || teamReport.projectKey;
  return recordDeliveryOutcome('scopeChange', configKey, teamLabel, 'manual',
    () => runTeamReportDelivery(teamReport, jiraConfig, confluenceConfig, sslVerify, configuration));
}

/**
 * Manually triggers the ART rollup delivery.
 *
 * @param {object} configuration
 * @returns {Promise<{ skipped: boolean, message: string, postUrl?: string }>}
 */
async function runArtRollupNow(configuration) {
  const scopeChangeConfig = (configuration.scheduler || {}).scopeChange || {};
  const artRollup         = scopeChangeConfig.artRollup || {};
  const jiraConfig        = configuration.jira;
  const confluenceConfig  = configuration.confluence;
  const sslVerify         = configuration.sslVerify !== false;

  return recordDeliveryOutcome('scopeChange', 'artRollup', 'ART Rollup', 'manual',
    () => runArtRollupDelivery(artRollup, jiraConfig, confluenceConfig, sslVerify, configuration));
}

module.exports = {
  startScopeChangeScheduler,
  runTeamReportNow,
  runArtRollupNow,
  // Pure helpers exported for unit testing.
  getCurrentTimeHHMM,
  getTodayDateString,
  isTodayWeekend,
  getPreviousBusinessDayCutoff,
  extractChangeEntries,
  escapeXml,
  renderChangeTable,
  extractPageIdFromUrl,
  buildConfluenceBlogBody,
  buildArtRollupBlogBody,
  buildScopeAiAssistPrompt,
  buildScopeRollupAiAssistPrompt,
  buildAiAssistTrendPanel,
};
