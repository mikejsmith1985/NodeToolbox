// src/services/scopeChangeScheduler.js — Daily Scope Change report scheduler.
//
// Supports multiple team reports and an ART-wide rollup report.
// A single setInterval fires every 60 seconds and checks all configured
// scheduleTime values against the current HH:MM local time, firing any
// that match and have not yet run today.

'use strict';

const { makeJiraApiRequest, makeConfluenceApiRequest, triggerWebhook } = require('../utils/httpClient');

// ── Constants ──

/** How often (ms) the scheduler checks for reports to fire. */
const SCHEDULE_CHECK_INTERVAL_MS = 60 * 1000;

/** How many issues to fetch per Jira query. */
const JIRA_MAX_RESULTS = 200;

/** Default schedule time used when a config has no scheduleTime set. */
const DEFAULT_SCHEDULE_TIME = '11:00';

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
 *
 * @param {object} configuration
 */
function checkAndFireScheduledReports(configuration) {
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
    runTeamReportDelivery(teamReport, jiraConfig, confluenceConfig, sslVerify).catch((deliveryError) => {
      console.error('  ⚠ Scope Change team report error (' + teamReport.projectKey + '):', deliveryError.message);
    });
  }

  if (artRollup.isEnabled) {
    const rollupTime = artRollup.scheduleTime || DEFAULT_SCHEDULE_TIME;
    if (rollupTime === currentTime && !hasAlreadyFiredToday('artRollup')) {
      markFiredToday('artRollup');
      console.log('  📤 Scope Change: firing ART rollup');
      runArtRollupDelivery(artRollup, jiraConfig, confluenceConfig, sslVerify).catch((deliveryError) => {
        console.error('  ⚠ Scope Change ART rollup error:', deliveryError.message);
      });
    }
  }
}

// ── Jira queries ──

/**
 * Fetches issues where fixVersion changed after the cutoff date.
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
 * Fetches recently updated issues for client-side sprint changelog filtering.
 * Jira does not support "sprint changed AFTER" as a JQL history predicate.
 *
 * @param {string} projectKey
 * @param {string} cutoffDateString - YYYY-MM-DD
 * @param {object} jiraConfig
 * @param {boolean} sslVerify
 * @returns {Promise<Array>}
 */
async function fetchSprintChangeCandidates(projectKey, cutoffDateString, jiraConfig, sslVerify) {
  const jql  = 'project = "' + projectKey + '" AND updated >= "' + cutoffDateString + '"';
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
 *
 * @param {Array}  releaseEntries
 * @param {Array}  sprintEntries
 * @param {string} projectKey
 * @param {string} generatedAt
 * @returns {string}
 */
function buildConfluenceBlogBody(releaseEntries, sprintEntries, projectKey, generatedAt) {
  const releaseBadge = '(' + releaseEntries.length + ' change' + (releaseEntries.length !== 1 ? 's' : '') + ')';
  const sprintBadge  = '(' + sprintEntries.length  + ' change' + (sprintEntries.length  !== 1 ? 's' : '') + ')';

  return [
    '<p><strong>Project:</strong> ' + escapeXml(projectKey) + ' &nbsp;|&nbsp; <strong>Generated:</strong> ' + escapeXml(generatedAt) + ' &nbsp;|&nbsp; <strong>Window:</strong> Last 24 hours</p>',
    '<h2>📦 Release Changes ' + escapeXml(releaseBadge) + '</h2>',
    renderChangeTable(releaseEntries, 'No release (fixVersion) changes in the last 24 hours.'),
    '<h2>🏃 Sprint Changes ' + escapeXml(sprintBadge) + '</h2>',
    renderChangeTable(sprintEntries, 'No sprint changes in the last 24 hours.'),
  ].join('\n');
}

/**
 * Builds the Confluence storage-format body for the ART rollup report.
 * Shows one section per team plus a combined table for each change type.
 *
 * @param {Array}  teamResults - [{ teamName, projectKey, releaseEntries, sprintEntries }]
 * @param {string} projectKeyList - comma-separated project keys for the header
 * @param {string} generatedAt
 * @returns {string}
 */
function buildArtRollupBlogBody(teamResults, projectKeyList, generatedAt) {
  const allReleaseEntries = teamResults.flatMap((result) =>
    result.releaseEntries.map((entry) => Object.assign({}, entry, { teamName: result.teamName || result.projectKey }))
  );
  const allSprintEntries = teamResults.flatMap((result) =>
    result.sprintEntries.map((entry) => Object.assign({}, entry, { teamName: result.teamName || result.projectKey }))
  );

  const releaseBadge = '(' + allReleaseEntries.length + ' change' + (allReleaseEntries.length !== 1 ? 's' : '') + ')';
  const sprintBadge  = '(' + allSprintEntries.length  + ' change' + (allSprintEntries.length  !== 1 ? 's' : '') + ')';

  const teamSummaryRows = teamResults.map((result) => {
    return '<tr><td><strong>' + escapeXml(result.teamName || result.projectKey) + '</strong></td>' +
      '<td>' + escapeXml(result.projectKey) + '</td>' +
      '<td>' + result.releaseEntries.length + '</td>' +
      '<td>' + result.sprintEntries.length + '</td></tr>';
  }).join('');

  const teamSummaryTable = '<table><tbody>' +
    '<tr><th><strong>Team</strong></th><th><strong>Project</strong></th><th><strong>Release Changes</strong></th><th><strong>Sprint Changes</strong></th></tr>' +
    teamSummaryRows + '</tbody></table>';

  return [
    '<p><strong>Teams:</strong> ' + escapeXml(projectKeyList) + ' &nbsp;|&nbsp; <strong>Generated:</strong> ' + escapeXml(generatedAt) + ' &nbsp;|&nbsp; <strong>Window:</strong> Last 24 hours</p>',
    '<h2>📊 Team Summary</h2>',
    teamSummaryTable,
    '<h2>📦 Release Changes ' + escapeXml(releaseBadge) + '</h2>',
    renderRollupChangeTable(allReleaseEntries, 'No release (fixVersion) changes in the last 24 hours.'),
    '<h2>🏃 Sprint Changes ' + escapeXml(sprintBadge) + '</h2>',
    renderRollupChangeTable(allSprintEntries, 'No sprint changes in the last 24 hours.'),
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
async function runTeamReportDelivery(teamReport, jiraConfig, confluenceConfig, sslVerify) {
  const { teamName, projectKey, confluenceSpaceKey, targetBlogUrl, triggerUrl, triggerSecret } = teamReport;

  const cutoffDate       = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const cutoffDateString = cutoffDate.toISOString().slice(0, 10);

  console.log('  🔍 Scope Change [' + projectKey + ']: querying changes since ' + cutoffDateString + '…');
  console.log('  🔗 Scope Change [' + projectKey + ']: triggerUrl = ' + (triggerUrl || '(not set)'));

  const [fixVersionIssues, sprintCandidates] = await Promise.all([
    fetchFixVersionChanges(projectKey, cutoffDateString, jiraConfig, sslVerify),
    fetchSprintChangeCandidates(projectKey, cutoffDateString, jiraConfig, sslVerify),
  ]);

  const releaseEntries = extractChangeEntries(fixVersionIssues, 'fix version', 'fixVersion', cutoffDate);
  const sprintEntries  = extractChangeEntries(sprintCandidates, 'sprint', 'sprint', cutoffDate);

  if (releaseEntries.length === 0 && sprintEntries.length === 0) {
    console.log('  ✅ Scope Change [' + projectKey + ']: no changes — skipping');
    return { skipped: true, message: 'No scope changes found in the last 24 hours — delivery skipped.' };
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
  const bodyHtml     = buildConfluenceBlogBody(releaseEntries, sprintEntries, projectKey, generatedAt);
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

  // Fire the automation webhook if configured — non-fatal if it fails.
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
async function runArtRollupDelivery(artRollup, jiraConfig, confluenceConfig, sslVerify) {
  const { projectKeys, teamNames, confluenceSpaceKey, targetBlogUrl, triggerUrl, triggerSecret } = artRollup;

  if (!projectKeys || projectKeys.length === 0) {
    return { skipped: true, message: 'No project keys configured for ART rollup.' };
  }

  const cutoffDate       = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const cutoffDateString = cutoffDate.toISOString().slice(0, 10);

  console.log('  🔍 Scope Change ART Rollup: querying ' + projectKeys.join(', ') + '…');
  console.log('  🔗 Scope Change ART Rollup: triggerUrl = ' + (triggerUrl || '(not set)'));

  const teamResults = await Promise.all(projectKeys.map(async (projectKey, index) => {
    const teamName = (teamNames && teamNames[index]) || projectKey;
    const [fixVersionIssues, sprintCandidates] = await Promise.all([
      fetchFixVersionChanges(projectKey, cutoffDateString, jiraConfig, sslVerify),
      fetchSprintChangeCandidates(projectKey, cutoffDateString, jiraConfig, sslVerify),
    ]);
    return {
      teamName,
      projectKey,
      releaseEntries: extractChangeEntries(fixVersionIssues, 'fix version', 'fixVersion', cutoffDate),
      sprintEntries:  extractChangeEntries(sprintCandidates, 'sprint', 'sprint', cutoffDate),
    };
  }));

  const totalChanges = teamResults.reduce((sum, result) => sum + result.releaseEntries.length + result.sprintEntries.length, 0);

  if (totalChanges === 0) {
    console.log('  ✅ Scope Change ART Rollup: no changes across any team — skipping');
    return { skipped: true, message: 'No scope changes found across any team — delivery skipped.' };
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
  const bodyHtml       = buildArtRollupBlogBody(teamResults, projectKeyList, generatedAt);
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

  // Fire the automation webhook if configured — non-fatal if it fails.
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

  return runTeamReportDelivery(teamReport, jiraConfig, confluenceConfig, sslVerify);
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

  return runArtRollupDelivery(artRollup, jiraConfig, confluenceConfig, sslVerify);
}

module.exports = {
  startScopeChangeScheduler,
  runTeamReportNow,
  runArtRollupNow,
  // Pure helpers exported for unit testing.
  getCurrentTimeHHMM,
  getTodayDateString,
  extractChangeEntries,
  escapeXml,
  renderChangeTable,
  extractPageIdFromUrl,
};
