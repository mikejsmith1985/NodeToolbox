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
const { requestRovoText, isRovoEnabled } = require('./rovoEnrichment');

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
const lastFiredDates = new Map();

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
 * Records that a config key fired today.
 * @param {string} configKey
 */
function markFiredToday(configKey) {
  lastFiredDates.set(configKey, getTodayDateString());
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

    const scheduledTime = teamReport.scheduleTime || DEFAULT_SCHEDULE_TIME;
    if (scheduledTime !== currentTime) continue;

    const configKey = 'team-' + teamIndex + '-' + teamReport.projectKey;
    if (hasAlreadyFiredToday(configKey)) continue;

    markFiredToday(configKey);
    console.log('  📤 Scope Change: firing team report for ' + teamReport.projectKey + ' (' + teamReport.teamName + ')');
    runTeamReportDelivery(teamReport, jiraConfig, confluenceConfig, sslVerify, configuration).catch((deliveryError) => {
      console.error('  ⚠ Scope Change team report error (' + teamReport.projectKey + '):', deliveryError.message);
    });
  }

  if (artRollup.isEnabled) {
    const rollupTime = artRollup.scheduleTime || DEFAULT_SCHEDULE_TIME;
    if (rollupTime === currentTime && !hasAlreadyFiredToday('artRollup')) {
      markFiredToday('artRollup');
      console.log('  📤 Scope Change: firing ART rollup');
      runArtRollupDelivery(artRollup, jiraConfig, confluenceConfig, sslVerify, configuration).catch((deliveryError) => {
        console.error('  ⚠ Scope Change ART rollup error:', deliveryError.message);
      });
    }
  }
}

// ── Jira queries ──

/**
 * Fetches Feature-type issues where fixVersion changed after the cutoff date.
 * Restricted to issuetype = Feature so that Story-level scope changes
 * do not appear in this PI-level report.
 *
 * @param {string} projectKey
 * @param {string} cutoffDateString - YYYY-MM-DD
 * @param {object} jiraConfig
 * @param {boolean} sslVerify
 * @returns {Promise<Array>}
 */
async function fetchFixVersionChanges(projectKey, cutoffDateString, jiraConfig, sslVerify) {
  const jql  = 'project = "' + projectKey + '" AND issuetype = Feature AND fixVersion changed AFTER "' + cutoffDateString + '"';
  const path = '/rest/api/2/search?jql=' + encodeURIComponent(jql) + '&fields=summary,issuetype&expand=changelog&maxResults=' + JIRA_MAX_RESULTS;
  const result = await makeJiraApiRequest('GET', path, null, jiraConfig, sslVerify);
  return result.body.issues || [];
}

// ── Change entry extraction ──

/**
 * Filters Jira changelog entries for a specific field that were set (not removed)
 * after the cutoff date.
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
    for (const history of (issue.changelog && issue.changelog.histories) || []) {
      if (new Date(history.created) < cutoffDate) continue;
      for (const item of history.items || []) {
        if (item.field.toLowerCase() !== targetField) continue;
        if (!item.toString) continue;
        entries.push({
          issueKey:     issue.key,
          issueSummary: issue.fields.summary,
          issueType:    (issue.fields.issuetype && issue.fields.issuetype.name) || 'Unknown',
          changeType,
          fromValue:    item.fromString || '—',
          toValue:      item.toString,
          changedBy:    history.author.displayName,
          changedAt:    history.created,
        });
      }
    }
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
 * Builds the prompt asking Rovo for a one-paragraph trend commentary on the
 * release (fix version) changes, identifying the release most at risk.
 *
 * @param {Array} releaseEntries - Change entries (issueKey, issueSummary, fromValue, toValue).
 * @param {string} projectKey
 * @returns {string}
 */
function buildScopeRovoPrompt(releaseEntries, projectKey) {
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
 * Builds the prompt asking Rovo for a one-paragraph cross-team trend commentary on
 * the ART rollup, identifying the team/release most at risk across all teams.
 *
 * @param {Array} teamResults - [{ teamName, projectKey, releaseEntries }]
 * @returns {string}
 */
function buildScopeRollupRovoPrompt(teamResults) {
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
 * Wraps Rovo's trend commentary in a Confluence "info" panel for prepending above
 * the change table. Text is XML-escaped; blank-line groups become paragraphs.
 *
 * @param {string} commentaryText - Plain-text commentary returned by Rovo.
 * @returns {string} Confluence storage-format markup.
 */
function buildRovoTrendPanel(commentaryText) {
  const paragraphs = String(commentaryText)
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => '<p>' + escapeXml(paragraph).replace(/\n/g, '<br/>') + '</p>')
    .join('');
  return '<ac:structured-macro ac:name="info"><ac:rich-text-body>'
    + '<p><strong>🤖 Rovo trend</strong></p>' + paragraphs
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
 * Shows only PI-level Fix Version changes — sprint changes are excluded by design.
 *
 * @param {Array}  releaseEntries
 * @param {string} projectKey
 * @param {string} generatedAt     - Human-readable timestamp
 * @param {string} sinceLabel      - Human-readable "since" date, e.g. "Jun 13, 2026 (Fri)"
 * @returns {string}
 */
function buildConfluenceBlogBody(releaseEntries, projectKey, generatedAt, sinceLabel) {
  const releaseBadge = '(' + releaseEntries.length + ' change' + (releaseEntries.length !== 1 ? 's' : '') + ')';

  return [
    '<p><strong>Project:</strong> ' + escapeXml(projectKey) +
      ' &nbsp;|&nbsp; <strong>Generated:</strong> ' + escapeXml(generatedAt) +
      ' &nbsp;|&nbsp; <strong>Since:</strong> ' + escapeXml(sinceLabel) + '</p>',
    '<h2>📦 Release Changes ' + escapeXml(releaseBadge) + '</h2>',
    renderChangeTable(releaseEntries, 'No fix version changes since ' + sinceLabel + '.'),
  ].join('\n');
}

/**
 * Builds the Confluence storage-format body for the ART rollup report.
 * Shows a team summary table (Release Changes only) and a combined Release Changes table.
 * Sprint changes are intentionally excluded — this is a PI-level report.
 *
 * @param {Array}  teamResults    - [{ teamName, projectKey, releaseEntries }]
 * @param {string} projectKeyList - Comma-separated project keys shown in the header
 * @param {string} generatedAt    - Human-readable timestamp
 * @param {string} sinceLabel     - Human-readable "since" date, e.g. "Jun 13, 2026 (Fri)"
 * @returns {string}
 */
function buildArtRollupBlogBody(teamResults, projectKeyList, generatedAt, sinceLabel) {
  const allReleaseEntries = teamResults.flatMap((result) =>
    result.releaseEntries.map((entry) => Object.assign({}, entry, { teamName: result.teamName || result.projectKey }))
  );

  const releaseBadge = '(' + allReleaseEntries.length + ' change' + (allReleaseEntries.length !== 1 ? 's' : '') + ')';

  const teamSummaryRows = teamResults.map((result) => {
    return '<tr><td><strong>' + escapeXml(result.teamName || result.projectKey) + '</strong></td>' +
      '<td>' + escapeXml(result.projectKey) + '</td>' +
      '<td>' + result.releaseEntries.length + '</td></tr>';
  }).join('');

  const teamSummaryTable = '<table><tbody>' +
    '<tr><th><strong>Team</strong></th><th><strong>Project</strong></th><th><strong>Release Changes</strong></th></tr>' +
    teamSummaryRows + '</tbody></table>';

  return [
    '<p><strong>Teams:</strong> ' + escapeXml(projectKeyList) +
      ' &nbsp;|&nbsp; <strong>Generated:</strong> ' + escapeXml(generatedAt) +
      ' &nbsp;|&nbsp; <strong>Since:</strong> ' + escapeXml(sinceLabel) + '</p>',
    '<h2>📊 Team Summary</h2>',
    teamSummaryTable,
    '<h2>📦 Release Changes ' + escapeXml(releaseBadge) + '</h2>',
    renderRollupChangeTable(allReleaseEntries, 'No fix version changes since ' + sinceLabel + '.'),
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

  // Use the previous business day as the cutoff so Monday's run catches Friday's work.
  const cutoffDate       = getPreviousBusinessDayCutoff();
  const cutoffDateString = cutoffDate.toISOString().slice(0, 10);
  const sinceLabel       = cutoffDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', weekday: 'short' });

  console.log('  🔍 Scope Change [' + projectKey + ']: querying Feature fix version changes since ' + cutoffDateString + '…');
  console.log('  🔗 Scope Change [' + projectKey + ']: triggerUrl = ' + (triggerUrl || '(not set)'));

  const fixVersionIssues = await fetchFixVersionChanges(projectKey, cutoffDateString, jiraConfig, sslVerify);
  const releaseEntries   = extractChangeEntries(fixVersionIssues, 'fix version', 'fixVersion', cutoffDate);

  // Only deliver when there is actual data — an empty report has no value and
  // should not trigger automation rules or clutter the Confluence page history.
  if (releaseEntries.length === 0) {
    console.log('  ✅ Scope Change [' + projectKey + ']: no fix version changes — skipping');
    return { skipped: true, message: 'No fix version changes since ' + sinceLabel + ' — delivery skipped.' };
  }

  const generatedAt = new Date().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
  const dateLabel    = new Date().toISOString().slice(0, 10);
  const teamLabel    = teamName || projectKey;
  const targetPageId = targetBlogUrl ? extractPageIdFromUrl(targetBlogUrl) : null;
  // Omit date from title when updating an ongoing page — the date would accumulate
  // across every run and make the stable URL misleading. Use a dated title only when
  // creating a fresh post so each new post is uniquely named in Confluence.
  const postTitle    = targetPageId
    ? 'Scope Change Report — ' + teamLabel
    : 'Scope Change Report — ' + teamLabel + ' — ' + dateLabel;
  let bodyHtml     = buildConfluenceBlogBody(releaseEntries, projectKey, generatedAt, sinceLabel);

  // Optional, non-blocking Rovo enrichment: prepend a trend paragraph above the
  // change table. Skipped silently when Rovo is disabled/unavailable so the report
  // always publishes (FR-002, SC-002, SC-008).
  if (isRovoEnabled(configuration)) {
    const rovoCommentary = await requestRovoText(
      configuration,
      buildScopeRovoPrompt(releaseEntries, projectKey),
      { label: 'scope-change' },
    );
    if (rovoCommentary) {
      bodyHtml = buildRovoTrendPanel(rovoCommentary) + bodyHtml;
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
    };
    console.log('  🔔 Scope Change [' + projectKey + ']: triggering webhook…');
    triggerWebhook(triggerUrl, webhookPayload, sslVerify, triggerSecret || undefined).catch((webhookError) => {
      console.error('  ⚠ Scope Change [' + projectKey + ']: webhook trigger failed — ' + webhookError.message);
    });
  }

  return {
    skipped: false,
    message: 'Report delivered — ' + releaseEntries.length + ' release change(s).',
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

  // Previous business day cutoff — same logic as team reports.
  const cutoffDate       = getPreviousBusinessDayCutoff();
  const cutoffDateString = cutoffDate.toISOString().slice(0, 10);
  const sinceLabel       = cutoffDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', weekday: 'short' });

  console.log('  🔍 Scope Change ART Rollup: querying ' + projectKeys.join(', ') + ' since ' + cutoffDateString + '…');
  console.log('  🔗 Scope Change ART Rollup: triggerUrl = ' + (triggerUrl || '(not set)'));

  const teamResults = await Promise.all(projectKeys.map(async (projectKey, index) => {
    const teamName         = (teamNames && teamNames[index]) || projectKey;
    const fixVersionIssues = await fetchFixVersionChanges(projectKey, cutoffDateString, jiraConfig, sslVerify);
    return {
      teamName,
      projectKey,
      releaseEntries: extractChangeEntries(fixVersionIssues, 'fix version', 'fixVersion', cutoffDate),
    };
  }));

  const totalChanges = teamResults.reduce((sum, result) => sum + result.releaseEntries.length, 0);

  // Only deliver when at least one team has real fix version changes.
  if (totalChanges === 0) {
    console.log('  ✅ Scope Change ART Rollup: no fix version changes across any team — skipping');
    return { skipped: true, message: 'No fix version changes since ' + sinceLabel + ' — delivery skipped.' };
  }

  const generatedAt    = new Date().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
  const dateLabel      = new Date().toISOString().slice(0, 10);
  const targetPageId   = targetBlogUrl ? extractPageIdFromUrl(targetBlogUrl) : null;
  // Omit date from title when updating an ongoing page — use dated title only for fresh posts.
  const postTitle      = targetPageId
    ? 'ART Scope Change Rollup'
    : 'ART Scope Change Rollup — ' + dateLabel;
  const projectKeyList = projectKeys.join(', ');
  let   bodyHtml       = buildArtRollupBlogBody(teamResults, projectKeyList, generatedAt, sinceLabel);

  // Optional, non-blocking Rovo enrichment: prepend a cross-team trend paragraph
  // above the rollup table. Skipped silently when Rovo is disabled/unavailable.
  if (isRovoEnabled(configuration)) {
    const rovoCommentary = await requestRovoText(
      configuration,
      buildScopeRollupRovoPrompt(teamResults),
      { label: 'scope-rollup' },
    );
    if (rovoCommentary) {
      bodyHtml = buildRovoTrendPanel(rovoCommentary) + bodyHtml;
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

  // Fire the automation webhook only when there is real data.
  if (triggerUrl) {
    const webhookPayload = {
      teamName:           'ART Rollup',
      projectKeys,
      postUrl,
      generatedAt:        new Date().toISOString(),
      releaseChangeCount: releaseTotal,
      teamCount:          projectKeys.length,
    };
    console.log('  🔔 Scope Change ART Rollup: triggering webhook…');
    triggerWebhook(triggerUrl, webhookPayload, sslVerify, triggerSecret || undefined).catch((webhookError) => {
      console.error('  ⚠ Scope Change ART Rollup: webhook trigger failed — ' + webhookError.message);
    });
  }

  return {
    skipped: false,
    message: 'ART rollup delivered — ' + releaseTotal + ' release change(s) across ' + projectKeys.length + ' team(s).',
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

  return runTeamReportDelivery(teamReport, jiraConfig, confluenceConfig, sslVerify, configuration);
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

  return runArtRollupDelivery(artRollup, jiraConfig, confluenceConfig, sslVerify, configuration);
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
  buildScopeRovoPrompt,
  buildScopeRollupRovoPrompt,
  buildRovoTrendPanel,
};
