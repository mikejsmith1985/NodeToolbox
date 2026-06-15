// src/services/featureChangeScheduler.js — Daily Feature (Epic) Change report scheduler.
//
// Monitors Jira Epics for changes to Fix Version, Status, and schedule fields
// (Target Start, Target End, Due Date) and delivers a Confluence blog post report.
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
const DEFAULT_SCHEDULE_TIME = '09:00';

/**
 * Fields that indicate a Fix Version change in a Jira changelog entry.
 * We check both the fieldId (stable) and the display name (human-readable fallback).
 */
const FIX_VERSION_FIELD_ID   = 'fixVersions';
const FIX_VERSION_FIELD_NAME = 'fix version';

/**
 * Fields that indicate a Status change.
 */
const STATUS_FIELD_ID   = 'status';
const STATUS_FIELD_NAME = 'status';

/**
 * Custom field IDs and accepted display names for Target Start.
 * Jira instances may label this field differently across configurations.
 */
const TARGET_START_FIELD_ID    = 'customfield_10101';
const TARGET_START_FIELD_NAMES = ['target start', 'planned start', 'target start date'];

/**
 * Custom field IDs and accepted display names for Target End.
 */
const TARGET_END_FIELD_ID    = 'customfield_10102';
const TARGET_END_FIELD_NAMES = ['target end', 'planned end', 'target end date'];

/**
 * Fields that indicate a Due Date change.
 */
const DUE_DATE_FIELD_ID   = 'duedate';
const DUE_DATE_FIELD_NAME = 'due date';

// ── Schedule tracking ──

// Tracks the last date (YYYY-MM-DD) each config fired so we never fire twice on the same day.
const lastFiredDates = new Map();

let schedulerIntervalHandle = null;

// ── Time utilities ──

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
  return now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');
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
 * Starts the feature change scheduler. Fires a check every 60 seconds.
 * Each check iterates all featureChange reports, firing any whose
 * scheduleTime matches the current minute and have not yet run today.
 *
 * @param {object} configuration - Live server config (read at fire time, not capture time)
 */
function startFeatureChangeScheduler(configuration) {
  if (schedulerIntervalHandle) {
    clearInterval(schedulerIntervalHandle);
  }
  console.log('  📅 Feature Change scheduler started — checking every minute');

  schedulerIntervalHandle = setInterval(() => {
    checkAndFireScheduledReports(configuration);
  }, SCHEDULE_CHECK_INTERVAL_MS);
}

/**
 * Iterates all feature change reports and fires any whose scheduleTime
 * matches the current minute and have not yet fired today.
 *
 * @param {object} configuration
 */
function checkAndFireScheduledReports(configuration) {
  const featureChangeConfig = ((configuration.scheduler || {}).featureChange) || {};
  const reports             = featureChangeConfig.reports || [];
  const artRollup           = featureChangeConfig.artRollup || {};
  const jiraConfig          = configuration.jira;
  const confluenceConfig    = configuration.confluence;
  const sslVerify           = configuration.sslVerify !== false;
  const currentTime         = getCurrentTimeHHMM();

  // ── Per-team scheduled reports ──
  for (let reportIndex = 0; reportIndex < reports.length; reportIndex++) {
    const report = reports[reportIndex];
    if (!report.isEnabled) continue;

    const scheduledTime = report.scheduleTime || DEFAULT_SCHEDULE_TIME;
    if (scheduledTime !== currentTime) continue;

    // Config key is scoped to index + label so two entries at different times can coexist.
    const configKey = 'feature-' + reportIndex + '-' + (report.jiraLabel || report.projectKey);
    if (hasAlreadyFiredToday(configKey)) continue;

    markFiredToday(configKey);
    console.log('  🎯 Feature Change: firing report for label "' + (report.jiraLabel || report.projectKey) + '" (' + report.teamName + ')');
    runFeatureReportDelivery(report, jiraConfig, confluenceConfig, sslVerify).catch((deliveryError) => {
      console.error('  ⚠ Feature Change report error (' + (report.jiraLabel || report.projectKey) + '):', deliveryError.message);
    });
  }

  // ── ART Rollup — single combined report for all teams ──
  if (artRollup.isEnabled) {
    const rollupTime = artRollup.scheduleTime || DEFAULT_SCHEDULE_TIME;
    if (rollupTime === currentTime && !hasAlreadyFiredToday('feature-art-rollup')) {
      markFiredToday('feature-art-rollup');
      console.log('  🎯 Feature Change ART Rollup: firing combined report…');
      runFeatureChangeArtRollupDelivery(artRollup, reports, jiraConfig, confluenceConfig, sslVerify).catch((deliveryError) => {
        console.error('  ⚠ Feature Change ART Rollup error:', deliveryError.message);
      });
    }
  }
}

// ── Jira query ──

/**
 * Fetches all Epics updated since the start of today (midnight local time) for
 * the given project, with changelogs expanded so we can inspect field history.
 *
 * A single label-based query is used: type = Feature AND labels in (jiraLabel).
 * This replaces the previous project-key + issuetype=Epic approach.
 *
 * @param {string} jiraLabel - The Jira label assigned to this team's features.
 * @param {string} cutoffDateString - YYYY-MM-DD format expected by Jira updated>=
 * @param {object} jiraConfig
 * @param {boolean} sslVerify
 * @returns {Promise<Array>}
 */
async function fetchFeatureChangeCandidates(jiraLabel, cutoffDateString, jiraConfig, sslVerify) {
  const jql  = 'type = Feature AND labels in ("' + jiraLabel + '") AND updated >= "' + cutoffDateString + ' 00:00" ORDER BY updated DESC';
  const path = '/rest/api/2/search?jql=' + encodeURIComponent(jql) +
    '&fields=summary,issuetype,status&expand=changelog&maxResults=' + JIRA_MAX_RESULTS;
  const result = await makeJiraApiRequest('GET', path, null, jiraConfig, sslVerify);
  return result.body.issues || [];
}

// ── Change entry extraction ──

/**
 * Determines whether a single changelog item represents a Fix Version change.
 * Checks fieldId first (stable), then the display name (case-insensitive fallback).
 *
 * @param {object} item - A single Jira changelog item
 * @returns {boolean}
 */
function isFixVersionChange(item) {
  return item.fieldId === FIX_VERSION_FIELD_ID ||
    item.field.toLowerCase() === FIX_VERSION_FIELD_NAME;
}

/**
 * Determines whether a changelog item represents a Status change.
 *
 * @param {object} item
 * @returns {boolean}
 */
function isStatusChange(item) {
  return item.fieldId === STATUS_FIELD_ID ||
    item.field.toLowerCase() === STATUS_FIELD_NAME;
}

/**
 * Determines whether a changelog item represents a Target Start change.
 *
 * @param {object} item
 * @returns {boolean}
 */
function isTargetStartChange(item) {
  return item.fieldId === TARGET_START_FIELD_ID ||
    TARGET_START_FIELD_NAMES.includes(item.field.toLowerCase());
}

/**
 * Determines whether a changelog item represents a Target End change.
 *
 * @param {object} item
 * @returns {boolean}
 */
function isTargetEndChange(item) {
  return item.fieldId === TARGET_END_FIELD_ID ||
    TARGET_END_FIELD_NAMES.includes(item.field.toLowerCase());
}

/**
 * Determines whether a changelog item represents a Due Date change.
 *
 * @param {object} item
 * @returns {boolean}
 */
function isDueDateChange(item) {
  return item.fieldId === DUE_DATE_FIELD_ID ||
    item.field.toLowerCase() === DUE_DATE_FIELD_NAME;
}

/**
 * Inspects all Jira issue changelogs and extracts entries for the five monitored
 * Epic fields: Fix Version, Status, Target Start, Target End, and Due Date.
 *
 * Returns three parallel arrays — fixVersionEntries, statusEntries, and
 * scheduleEntries — so the report can render them in separate sections.
 *
 * @param {Array}  issues     - Jira issues with expanded changelog
 * @param {Date}   cutoffDate - Only changes at or after this date are included
 * @returns {{ fixVersionEntries: Array, statusEntries: Array, scheduleEntries: Array }}
 */
function extractFeatureChangeEntries(issues, cutoffDate) {
  const fixVersionEntries = [];
  const statusEntries     = [];
  const scheduleEntries   = [];

  for (const issue of issues) {
    const histories = (issue.changelog && issue.changelog.histories) || [];

    for (const history of histories) {
      // Skip change events that pre-date the monitoring window.
      if (new Date(history.created) < cutoffDate) continue;

      for (const item of history.items || []) {
        const sharedFields = {
          issueKey:     issue.key,
          issueSummary: issue.fields.summary,
          issueType:    (issue.fields.issuetype && issue.fields.issuetype.name) || 'Unknown',
          fromValue:    item.fromString || '—',
          toValue:      item.toString  || '—',
          changedBy:    history.author.displayName,
          changedAt:    history.created,
        };

        if (isFixVersionChange(item)) {
          fixVersionEntries.push(Object.assign({}, sharedFields, {
            changeCategory: 'fixVersion',
            fieldLabel:     'Fix Version',
          }));
        } else if (isStatusChange(item)) {
          statusEntries.push(Object.assign({}, sharedFields, {
            changeCategory: 'status',
            fieldLabel:     'Status',
          }));
        } else if (isTargetStartChange(item)) {
          scheduleEntries.push(Object.assign({}, sharedFields, {
            changeCategory: 'schedule',
            fieldLabel:     'Target Start',
          }));
        } else if (isTargetEndChange(item)) {
          scheduleEntries.push(Object.assign({}, sharedFields, {
            changeCategory: 'schedule',
            fieldLabel:     'Target End',
          }));
        } else if (isDueDateChange(item)) {
          scheduleEntries.push(Object.assign({}, sharedFields, {
            changeCategory: 'schedule',
            fieldLabel:     'Due Date',
          }));
        }
      }
    }
  }

  return { fixVersionEntries, statusEntries, scheduleEntries };
}

// ── Confluence formatting ──

/**
 * Escapes a string for safe inclusion in Confluence storage format XML.
 * Without this, special characters in Jira values could break the page body.
 *
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
 * Renders a Fix Version or Status entry list as a Confluence storage-format table.
 * Columns: Feature, Summary, From, To, Changed By, Changed At.
 *
 * @param {Array}  entries
 * @param {string} emptyMessage - Shown when the list is empty
 * @returns {string}
 */
function renderSimpleChangeTable(entries, emptyMessage) {
  if (entries.length === 0) {
    return '<p><em>' + escapeXml(emptyMessage) + '</em></p>';
  }

  const headerRow = ['Feature', 'Summary', 'From', 'To', 'Changed By', 'Changed At']
    .map((header) => '<th><strong>' + header + '</strong></th>')
    .join('');

  const dataRows = entries.map((entry) => {
    const changedAtFormatted = new Date(entry.changedAt).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return [
      '<td><strong>' + escapeXml(entry.issueKey) + '</strong></td>',
      '<td>' + escapeXml(entry.issueSummary) + '</td>',
      '<td>' + escapeXml(entry.fromValue) + '</td>',
      '<td>' + escapeXml(entry.toValue) + '</td>',
      '<td>' + escapeXml(entry.changedBy) + '</td>',
      '<td>' + escapeXml(changedAtFormatted) + '</td>',
    ].join('');
  }).map((cells) => '<tr>' + cells + '</tr>').join('');

  return '<table><tbody><tr>' + headerRow + '</tr>' + dataRows + '</tbody></table>';
}

/**
 * Renders a schedule entry list as a Confluence storage-format table.
 * Includes an extra "Field" column because Target Start, Target End, and Due Date
 * are combined into one section and the reader needs to distinguish them.
 *
 * Columns: Feature, Summary, Field, From, To, Changed By, Changed At.
 *
 * @param {Array}  entries
 * @param {string} emptyMessage
 * @returns {string}
 */
function renderScheduleChangeTable(entries, emptyMessage) {
  if (entries.length === 0) {
    return '<p><em>' + escapeXml(emptyMessage) + '</em></p>';
  }

  const headerRow = ['Feature', 'Summary', 'Field', 'From', 'To', 'Changed By', 'Changed At']
    .map((header) => '<th><strong>' + header + '</strong></th>')
    .join('');

  const dataRows = entries.map((entry) => {
    const changedAtFormatted = new Date(entry.changedAt).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return [
      '<td><strong>' + escapeXml(entry.issueKey) + '</strong></td>',
      '<td>' + escapeXml(entry.issueSummary) + '</td>',
      '<td>' + escapeXml(entry.fieldLabel) + '</td>',
      '<td>' + escapeXml(entry.fromValue) + '</td>',
      '<td>' + escapeXml(entry.toValue) + '</td>',
      '<td>' + escapeXml(entry.changedBy) + '</td>',
      '<td>' + escapeXml(changedAtFormatted) + '</td>',
    ].join('');
  }).map((cells) => '<tr>' + cells + '</tr>').join('');

  return '<table><tbody><tr>' + headerRow + '</tr>' + dataRows + '</tbody></table>';
}

/**
 * Builds the full Confluence storage-format body for a feature change report.
 * Three sections: Fix Version Changes, Status Changes, and Schedule Changes.
 *
 * @param {Array}  fixVersionEntries
 * @param {Array}  statusEntries
 * @param {Array}  scheduleEntries
 * @param {string} projectKey
 * @param {string} generatedAt - Human-readable timestamp string
 * @returns {string}
 */
function buildFeatureChangeBlogBody(fixVersionEntries, statusEntries, scheduleEntries, jiraLabel, generatedAt) {
  const fixVersionCount = fixVersionEntries.length;
  const statusCount     = statusEntries.length;
  const scheduleCount   = scheduleEntries.length;

  // Section headers include the change count in parentheses as a quick summary.
  const fixVersionHeading = '<h2>🏷️ Fix Version Changes (' + fixVersionCount + ' change' + (fixVersionCount !== 1 ? 's' : '') + ')</h2>';
  const statusHeading     = '<h2>🔄 Status Changes ('     + statusCount     + ' change' + (statusCount     !== 1 ? 's' : '') + ')</h2>';
  const scheduleHeading   = '<h2>📅 Schedule Changes ('   + scheduleCount   + ' change' + (scheduleCount   !== 1 ? 's' : '') + ')</h2>';

  return [
    '<p><strong>Label:</strong> ' + escapeXml(jiraLabel) +
      ' &nbsp;|&nbsp; <strong>Generated:</strong> ' + escapeXml(generatedAt) +
      ' &nbsp;|&nbsp; <strong>Window:</strong> Last 24 hours</p>',
    fixVersionHeading,
    renderSimpleChangeTable(fixVersionEntries, 'No fix version changes in the last 24 hours.'),
    statusHeading,
    renderSimpleChangeTable(statusEntries, 'No status changes in the last 24 hours.'),
    scheduleHeading,
    renderScheduleChangeTable(scheduleEntries, 'No schedule changes in the last 24 hours.'),
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
 * Both are needed to prepend new content while preserving the existing history.
 *
 * @param {string}  pageId
 * @param {object}  confluenceConfig
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
 * Prepends a new feature change report to an existing Confluence blog post.
 * Each run's output is separated by a horizontal rule so the page accumulates
 * a dated history rather than being overwritten each time.
 *
 * @param {string}  pageId
 * @param {string}  title
 * @param {string}  newReportHtml
 * @param {object}  confluenceConfig
 * @param {boolean} sslVerify
 * @returns {Promise<string>} Web URL of the updated post
 */
async function updateConfluenceBlogPost(pageId, title, newReportHtml, confluenceConfig, sslVerify) {
  const { versionNumber, existingBody, contentType } = await fetchConfluencePage(pageId, confluenceConfig, sslVerify);

  // Prepend the new report above existing content so the most recent run is always at the top.
  const separator    = '<hr/>';
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
 * Creates a new Confluence blog post in the given space.
 *
 * @param {string}  spaceKey
 * @param {string}  title
 * @param {string}  bodyHtml
 * @param {object}  confluenceConfig
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
 * Runs the full delivery pipeline for one feature change report config entry:
 * query Jira, extract changes, skip if empty, build the Confluence body,
 * create/update the blog post, and optionally fire a webhook.
 *
 * @param {object}  report         - Single featureChange.reports[] entry
 * @param {object}  jiraConfig
 * @param {object}  confluenceConfig
 * @param {boolean} sslVerify
 * @returns {Promise<{ skipped: boolean, message: string, postUrl?: string }>}
 */
async function runFeatureReportDelivery(report, jiraConfig, confluenceConfig, sslVerify) {
  const { teamName, projectKey, jiraLabel, confluenceSpaceKey, targetBlogUrl, triggerUrl, triggerSecret } = report;

  // jiraLabel is required for the label-based query; skip with a clear log if missing.
  const effectiveLabel = (jiraLabel || '').trim();
  if (!effectiveLabel) {
    console.warn('  ⚠ Feature Change [' + (teamName || projectKey) + ']: no jiraLabel configured — skipping. Set it in Admin Hub → Label Mapping.');
    return { skipped: true, message: 'No Jira label configured — delivery skipped.' };
  }

  // Use yesterday's date as the cutoff so a midnight-scheduled run still catches
  // anything that changed late the previous day.
  const cutoffDate       = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const cutoffDateString = cutoffDate.toISOString().slice(0, 10);

  console.log('  🔍 Feature Change [' + effectiveLabel + ']: querying Features updated since ' + cutoffDateString + '…');
  console.log('  🔗 Feature Change [' + effectiveLabel + ']: triggerUrl = ' + (triggerUrl || '(not set)'));

  const epicIssues = await fetchFeatureChangeCandidates(effectiveLabel, cutoffDateString, jiraConfig, sslVerify);
  const { fixVersionEntries, statusEntries, scheduleEntries } = extractFeatureChangeEntries(epicIssues, cutoffDate);

  const totalChangeCount = fixVersionEntries.length + statusEntries.length + scheduleEntries.length;

  // Nothing changed — avoid creating a noisy empty report.
  if (totalChangeCount === 0) {
    console.log('  ✅ Feature Change [' + effectiveLabel + ']: no changes — skipping');
    return { skipped: true, message: 'No feature changes found in the last 24 hours — delivery skipped.' };
  }

  const generatedAt = new Date().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
  const dateLabel    = new Date().toISOString().slice(0, 10);
  const teamLabel    = teamName || effectiveLabel;
  const targetPageId = targetBlogUrl ? extractPageIdFromUrl(targetBlogUrl) : null;
  // Omit date from title when updating an ongoing page — use dated title only for fresh posts.
  const postTitle    = targetPageId
    ? 'Feature Change Report — ' + teamLabel
    : 'Feature Change Report — ' + teamLabel + ' — ' + dateLabel;
  const bodyHtml  = buildFeatureChangeBlogBody(fixVersionEntries, statusEntries, scheduleEntries, effectiveLabel, generatedAt);
  console.log(
    '  🔗 Feature Change [' + effectiveLabel + ']: targetBlogUrl = ' +
    (targetBlogUrl || '(not set)') + ' → pageId = ' + (targetPageId || 'none')
  );

  let postUrl;
  if (targetPageId) {
    console.log('  📝 Feature Change [' + effectiveLabel + ']: updating page ' + targetPageId + '…');
    postUrl = await updateConfluenceBlogPost(targetPageId, postTitle, bodyHtml, confluenceConfig, sslVerify);
  } else {
    console.log('  📝 Feature Change [' + effectiveLabel + ']: creating post in space ' + confluenceSpaceKey + '…');
    postUrl = await createConfluenceBlogPost(confluenceSpaceKey, postTitle, bodyHtml, confluenceConfig, sslVerify);
  }
  console.log('  ✅ Feature Change [' + effectiveLabel + ']: delivered — ' + postUrl);

  // Fire the automation webhook if configured — non-fatal if it fails.
  if (triggerUrl) {
    const webhookPayload = {
      teamName:              teamName || effectiveLabel,
      jiraLabel:             effectiveLabel,
      postUrl,
      generatedAt:           new Date().toISOString(),
      fixVersionChangeCount: fixVersionEntries.length,
      statusChangeCount:     statusEntries.length,
      scheduleChangeCount:   scheduleEntries.length,
    };
    console.log('  🔔 Feature Change [' + effectiveLabel + ']: triggering webhook…');
    triggerWebhook(triggerUrl, webhookPayload, sslVerify, triggerSecret || undefined).catch((webhookError) => {
      console.error('  ⚠ Feature Change [' + effectiveLabel + ']: webhook trigger failed — ' + webhookError.message);
    });
  }

  return {
    skipped: false,
    message: 'Report delivered — ' +
      fixVersionEntries.length + ' fix version change(s), ' +
      statusEntries.length + ' status change(s), ' +
      scheduleEntries.length + ' schedule change(s).',
    postUrl,
  };
}

// ── ART Rollup delivery ──

/**
 * Delivers a single combined Feature Change report covering ALL configured ART teams.
 * Runs one Jira query for all team labels together, then groups results by team for display.
 * This is the "All Teams" equivalent for scheduled delivery — one Confluence page, all teams.
 *
 * @param {object} artRollup     - { confluenceSpaceKey, targetBlogUrl, triggerUrl, triggerSecret, scheduleTime, isEnabled }
 * @param {Array}  teamReports   - The per-team report configs (used to read jiraLabel + teamName)
 * @param {object} jiraConfig
 * @param {object} confluenceConfig
 * @param {boolean} sslVerify
 * @returns {Promise<{ skipped: boolean, message: string, postUrl?: string }>}
 */
async function runFeatureChangeArtRollupDelivery(artRollup, teamReports, jiraConfig, confluenceConfig, sslVerify) {
  const { confluenceSpaceKey, targetBlogUrl, triggerUrl, triggerSecret } = artRollup;

  // Collect only the teams that have a jiraLabel configured — others cannot be queried.
  const teamsWithLabels = (teamReports || []).filter((report) => {
    const label = (report.jiraLabel || '').trim();
    return label !== '';
  });

  if (teamsWithLabels.length === 0) {
    console.log('  ⚠ Feature Change ART Rollup: no teams have a Jira label configured — skipping');
    return { skipped: true, message: 'No teams have a Jira label configured — delivery skipped.' };
  }

  const cutoffDate       = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const cutoffDateString = cutoffDate.toISOString().slice(0, 10);

  // Single combined Jira query covering every team label — more efficient than N separate queries.
  const allLabelsList = teamsWithLabels.map((report) => '"' + report.jiraLabel.trim() + '"').join(', ');
  const combinedJql   = 'type = Feature AND labels in (' + allLabelsList + ') AND updated >= "' + cutoffDateString + ' 00:00" ORDER BY updated DESC';
  const queryPath     = '/rest/api/2/search?jql=' + encodeURIComponent(combinedJql) +
    '&fields=summary,issuetype,status,labels&expand=changelog&maxResults=' + JIRA_MAX_RESULTS;

  console.log('  🔍 Feature Change ART Rollup: querying all labels — ' + allLabelsList + '…');

  const queryResult = await makeJiraApiRequest('GET', queryPath, null, jiraConfig, sslVerify);
  const allIssues   = (queryResult.body && queryResult.body.issues) || [];

  // Build a label → team name lookup for fast grouping.
  const labelToTeamName = new Map(
    teamsWithLabels.map((report) => [report.jiraLabel.trim().toLowerCase(), report.teamName || report.jiraLabel.trim()])
  );

  // Group issues by team: each issue may carry multiple labels — assign to the first matched team.
  const issuesByTeam = new Map();
  for (const team of teamsWithLabels) {
    issuesByTeam.set(team.jiraLabel.trim().toLowerCase(), []);
  }
  for (const issue of allIssues) {
    const issueLabels = (issue.fields && issue.fields.labels) || [];
    for (const issueLabel of issueLabels) {
      const normalizedLabel = issueLabel.trim().toLowerCase();
      if (issuesByTeam.has(normalizedLabel)) {
        issuesByTeam.get(normalizedLabel).push(issue);
        break;
      }
    }
  }

  // Extract change entries per team and build the rollup result set.
  const teamResults = [];
  for (const [labelKey, issues] of issuesByTeam.entries()) {
    const teamName = labelToTeamName.get(labelKey) || labelKey;
    const { fixVersionEntries, statusEntries, scheduleEntries } = extractFeatureChangeEntries(issues, cutoffDate);
    teamResults.push({ teamName, jiraLabel: labelKey, fixVersionEntries, statusEntries, scheduleEntries });
  }

  const totalChangeCount = teamResults.reduce(
    (sum, team) => sum + team.fixVersionEntries.length + team.statusEntries.length + team.scheduleEntries.length,
    0,
  );

  if (totalChangeCount === 0) {
    console.log('  ✅ Feature Change ART Rollup: no changes across any team — skipping');
    return { skipped: true, message: 'No feature changes found across any ART team — delivery skipped.' };
  }

  const generatedAt  = new Date().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
  const dateLabel    = new Date().toISOString().slice(0, 10);
  const targetPageId = targetBlogUrl ? extractPageIdFromUrl(targetBlogUrl) : null;
  // Omit date from title when updating an ongoing page — use dated title only for fresh posts.
  const postTitle    = targetPageId
    ? 'ART Feature Change Rollup'
    : 'ART Feature Change Rollup — ' + dateLabel;
  const bodyHtml     = buildFeatureChangeArtRollupBody(teamResults, generatedAt);

  let postUrl;
  if (targetPageId) {
    console.log('  📝 Feature Change ART Rollup: updating page ' + targetPageId + '…');
    postUrl = await updateConfluenceBlogPost(targetPageId, postTitle, bodyHtml, confluenceConfig, sslVerify);
  } else {
    console.log('  📝 Feature Change ART Rollup: creating post in space ' + confluenceSpaceKey + '…');
    postUrl = await createConfluenceBlogPost(confluenceSpaceKey, postTitle, bodyHtml, confluenceConfig, sslVerify);
  }
  console.log('  ✅ Feature Change ART Rollup: delivered — ' + postUrl);

  // Fire the automation webhook if configured — non-fatal if it fails.
  if (triggerUrl) {
    const webhookPayload = {
      teamName:    'ART Feature Change Rollup',
      postUrl,
      generatedAt: new Date().toISOString(),
      teamCount:   teamResults.length,
      totalChanges: totalChangeCount,
    };
    console.log('  🔔 Feature Change ART Rollup: triggering webhook…');
    triggerWebhook(triggerUrl, webhookPayload, sslVerify, triggerSecret || undefined).catch((webhookError) => {
      console.error('  ⚠ Feature Change ART Rollup: webhook trigger failed — ' + webhookError.message);
    });
  }

  return {
    skipped: false,
    message: 'ART Rollup delivered — ' + totalChangeCount + ' change(s) across ' + teamResults.length + ' team(s).',
    postUrl,
  };
}

/**
 * Builds the HTML body for the ART Feature Change Rollup Confluence page.
 * Organises content by team, with each team's Fix Version, Status, and Schedule
 * change sub-sections. Teams with zero changes are omitted.
 *
 * @param {Array}  teamResults  - [{ teamName, fixVersionEntries, statusEntries, scheduleEntries }]
 * @param {string} generatedAt  - Human-readable timestamp string
 * @returns {string}
 */
function buildFeatureChangeArtRollupBody(teamResults, generatedAt) {
  const totalChanges = teamResults.reduce(
    (sum, team) => sum + team.fixVersionEntries.length + team.statusEntries.length + team.scheduleEntries.length,
    0,
  );
  const teamsWithChanges = teamResults.filter(
    (team) => team.fixVersionEntries.length + team.statusEntries.length + team.scheduleEntries.length > 0,
  );

  const headerHtml = '<p><strong>ART Feature Change Rollup</strong>' +
    ' &nbsp;|&nbsp; <strong>Teams with changes:</strong> ' + teamsWithChanges.length +
    ' &nbsp;|&nbsp; <strong>Total changes:</strong> ' + totalChanges +
    ' &nbsp;|&nbsp; <strong>Generated:</strong> ' + escapeXml(generatedAt) +
    ' &nbsp;|&nbsp; <strong>Window:</strong> Last 24 hours</p>';

  const teamSections = teamsWithChanges.map((team) => {
    const teamTotal      = team.fixVersionEntries.length + team.statusEntries.length + team.scheduleEntries.length;
    const fvCount        = team.fixVersionEntries.length;
    const stCount        = team.statusEntries.length;
    const scCount        = team.scheduleEntries.length;
    const teamHeading    = '<h2>' + escapeXml(team.teamName) + ' (' + teamTotal + ' change' + (teamTotal !== 1 ? 's' : '') + ')</h2>';
    const fvHeading      = '<h3>🏷️ Fix Version Changes (' + fvCount + ')</h3>';
    const stHeading      = '<h3>🔄 Status Changes (' + stCount + ')</h3>';
    const scHeading      = '<h3>📅 Schedule Changes (' + scCount + ')</h3>';

    return [
      teamHeading,
      fvHeading, renderSimpleChangeTable(team.fixVersionEntries,  'No fix version changes.'),
      stHeading,  renderSimpleChangeTable(team.statusEntries,       'No status changes.'),
      scHeading,  renderScheduleChangeTable(team.scheduleEntries,   'No schedule changes.'),
    ].join('\n');
  });

  return headerHtml + '\n' + teamSections.join('\n<hr/>\n');
}

// ── Run-now entry points (called from notifications route) ──

/**
 * Manually triggers a single feature change report delivery, bypassing the schedule.
 * Used by the Admin Hub "Run Now" button.
 *
 * @param {object} configuration
 * @param {number} reportIndex - Index into configuration.scheduler.featureChange.reports
 * @returns {Promise<{ skipped: boolean, message: string, postUrl?: string }>}
 */
async function runFeatureReportNow(configuration, reportIndex) {
  const featureChangeConfig = ((configuration.scheduler || {}).featureChange) || {};
  const reports             = featureChangeConfig.reports || [];
  const report              = reports[reportIndex];

  if (!report) {
    return { skipped: true, message: 'Feature report at index ' + reportIndex + ' not found.' };
  }

  const jiraConfig       = configuration.jira;
  const confluenceConfig = configuration.confluence;
  const sslVerify        = configuration.sslVerify !== false;

  return runFeatureReportDelivery(report, jiraConfig, confluenceConfig, sslVerify);
}

/**
 * Manually triggers the ART Feature Change Rollup delivery, bypassing the schedule.
 * Used by the Admin Hub "Run Now" button on the rollup config row.
 *
 * @param {object} configuration
 * @returns {Promise<{ skipped: boolean, message: string, postUrl?: string }>}
 */
async function runFeatureArtRollupNow(configuration) {
  const featureChangeConfig = ((configuration.scheduler || {}).featureChange) || {};
  const artRollup           = featureChangeConfig.artRollup || {};
  const reports             = featureChangeConfig.reports   || [];
  const jiraConfig          = configuration.jira;
  const confluenceConfig    = configuration.confluence;
  const sslVerify           = configuration.sslVerify !== false;

  return runFeatureChangeArtRollupDelivery(artRollup, reports, jiraConfig, confluenceConfig, sslVerify);
}

module.exports = {
  startFeatureChangeScheduler,
  runFeatureReportNow,
  runFeatureArtRollupNow,
  // Pure helpers exported for unit testing.
  getCurrentTimeHHMM,
  getTodayDateString,
  extractFeatureChangeEntries,
  escapeXml,
  extractPageIdFromUrl,
};
