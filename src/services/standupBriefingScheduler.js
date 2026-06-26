// src/services/standupBriefingScheduler.js — Pre-standup briefing scheduler.
//
// Queries Jira for all activity in the last N days and produces a structured
// plain-text briefing covering status changes, blockers, defects, risks, and
// completions. Delivers to Confluence (HTML tables) and fires an optional
// trigger webhook. The plain-text markdown version is also returned to the
// API for in-app display and copy-paste.
//
// Supports multiple team reports and an ART-wide rollup report.
// A single setInterval fires every 60 seconds and checks all configured
// scheduleTime values against the current HH:MM local time.

'use strict';

const { makeJiraApiRequest, makeConfluenceApiRequest, triggerWebhook } = require('../utils/httpClient');
const { requestAiAssistText, isAiAssistEnabled } = require('./aiAssistEnrichment');
const { loadFiredDates, recordFiredDate, isScheduledTimeReached } = require('./schedulerFiredState');

// ── Constants ──

/** Stable name under which this scheduler's fired dates are persisted to disk. */
const FIRED_STATE_SCHEDULER_NAME = 'standupBriefing';

/** How often (ms) the scheduler checks for briefings to fire. */
const SCHEDULE_CHECK_INTERVAL_MS = 60 * 1000;

/** How many issues to fetch per Jira query. */
const JIRA_MAX_RESULTS = 200;

/** Default time to fire if a team report has no scheduleTime set. */
const DEFAULT_SCHEDULE_TIME = '08:45';

/** Default lookback window in days. */
const DEFAULT_DAYS_BACK = 1;

/** Jira fields to request — covers all five analysis buckets. */
const JIRA_FIELDS = [
  'summary', 'status', 'issuetype', 'priority', 'assignee',
  'issuelinks', 'labels', 'updated', 'fixVersions', 'customfield_10016',
].join(',');

/** Status name substrings treated as "blocked" regardless of issue link presence. */
const BLOCKED_STATUS_SUBSTRINGS = ['block', 'impede', 'on hold'];

/** Issue link type substrings that indicate a blocking relationship. */
const BLOCKER_LINK_TYPE_SUBSTRINGS = ['block', 'impede'];

/** Issue type names (lowercase) treated as defects. */
const DEFECT_ISSUE_TYPES = new Set(['bug', 'defect']);

/** Issue type names (lowercase) treated as risks. */
const RISK_ISSUE_TYPES = new Set(['risk']);

/** Label values (lowercase) that classify an issue as a risk. */
const RISK_LABEL = 'risk';

/** Status category keys and name substrings that indicate done/completed work. */
const DONE_STATUS_CATEGORY = 'done';
const DONE_STATUS_NAME_SUBSTRINGS = ['done', 'closed', 'resolved', 'complete', 'accepted'];

// ── Schedule tracking ──

// Tracks the last date (YYYY-MM-DD) each config fired — prevents double-firing.
// Hydrated from the persistent fired-state file when the scheduler starts, so a restart
// later the same day does not re-deliver a briefing that already went out.
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
 * Returns today's local date as "YYYY-MM-DD".
 * @returns {string}
 */
function getTodayDateString() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

/**
 * Returns true if the config key has already fired today.
 * @param {string} configKey
 * @returns {boolean}
 */
function hasAlreadyFiredToday(configKey) {
  return lastFiredDates.get(configKey) === getTodayDateString();
}

/**
 * Records that the config key fired today, both in memory and on disk. Persisting the
 * date lets a restart later the same day recognise the slot as already satisfied.
 * @param {string} configKey
 */
function markFiredToday(configKey) {
  const today = getTodayDateString();
  lastFiredDates.set(configKey, today);
  recordFiredDate(FIRED_STATE_SCHEDULER_NAME, configKey, today);
}

// ── Scheduler entry point ──

/**
 * Starts the standup briefing scheduler. Fires a check every 60 seconds.
 * Each check iterates all team reports and the ART rollup, firing any whose
 * scheduleTime matches the current minute and have not yet run today.
 *
 * @param {object} configuration - Live server config (read at fire time, not capture time)
 * @returns {Function} Stop function — clears the interval
 */
function startStandupBriefingScheduler(configuration) {
  if (schedulerIntervalHandle) {
    clearInterval(schedulerIntervalHandle);
  }
  console.log('  📋 Standup Briefing scheduler started — checking every minute');

  // Seed the in-memory tracker from disk so today's already-delivered briefings are not
  // re-sent after a restart, while any slot still due today can still catch up.
  lastFiredDates = loadFiredDates(FIRED_STATE_SCHEDULER_NAME);

  schedulerIntervalHandle = setInterval(() => {
    checkAndFireScheduledBriefings(configuration);
  }, SCHEDULE_CHECK_INTERVAL_MS);

  return () => clearInterval(schedulerIntervalHandle);
}

/**
 * Iterates all team reports and the ART rollup, firing any whose scheduleTime
 * matches the current minute and have not already fired today.
 *
 * @param {object} configuration
 */
function checkAndFireScheduledBriefings(configuration) {
  const standupConfig = ((configuration.scheduler || {}).standupBriefing) || {};
  const teamReports   = standupConfig.teamReports || [];
  const artRollup     = standupConfig.artRollup   || {};
  const currentTime   = getCurrentTimeHHMM();

  for (let teamIndex = 0; teamIndex < teamReports.length; teamIndex++) {
    const teamReport = teamReports[teamIndex];
    if (!teamReport.isEnabled) continue;

    // Fire when the scheduled time has been reached OR passed today (catch-up) and
    // the briefing has not already fired today — not only on an exact minute match.
    const scheduledTime = teamReport.scheduleTime || DEFAULT_SCHEDULE_TIME;
    if (!isScheduledTimeReached(scheduledTime, currentTime)) continue;

    const configKey = 'standup-team-' + teamIndex + '-' + (teamReport.projectKeys || []).join(',');
    if (hasAlreadyFiredToday(configKey)) continue;

    markFiredToday(configKey);
    console.log('  📤 Standup Briefing: firing team report for ' + (teamReport.teamName || teamIndex));
    runTeamBriefingDelivery(teamReport, configuration).catch((deliveryError) => {
      console.error('  ⚠ Standup Briefing team report error (' + teamReport.teamName + '):', deliveryError.message);
    });
  }

  if (artRollup.isEnabled) {
    const rollupTime = artRollup.scheduleTime || DEFAULT_SCHEDULE_TIME;
    if (isScheduledTimeReached(rollupTime, currentTime) && !hasAlreadyFiredToday('standup-art-rollup')) {
      markFiredToday('standup-art-rollup');
      console.log('  📤 Standup Briefing: firing ART rollup');
      runArtRollupDelivery(artRollup, configuration).catch((deliveryError) => {
        console.error('  ⚠ Standup Briefing ART rollup error:', deliveryError.message);
      });
    }
  }
}

// ── Jira data fetching ──

/**
 * Fetches all issues updated within the last daysBack days for the given project keys.
 * A single query with changelog expansion covers all five analysis buckets.
 *
 * @param {string[]} projectKeys
 * @param {number}   daysBack
 * @param {object}   jiraConfig
 * @param {boolean}  sslVerify
 * @returns {Promise<Array>}
 */
async function fetchStandupIssues(projectKeys, daysBack, jiraConfig, sslVerify) {
  const projectList = projectKeys.map((projectKey) => '"' + projectKey + '"').join(', ');
  const jql  = 'project in (' + projectList + ') AND updated >= "-' + daysBack + 'd" ORDER BY updated DESC';
  const path = '/rest/api/2/search'
    + '?jql='      + encodeURIComponent(jql)
    + '&fields='   + encodeURIComponent(JIRA_FIELDS)
    + '&expand=changelog'
    + '&maxResults=' + JIRA_MAX_RESULTS;
  const result = await makeJiraApiRequest('GET', path, null, jiraConfig, sslVerify);
  return (result.body && result.body.issues) || [];
}

// ── Issue analysis helpers ──

/**
 * Returns the display name of the issue's assignee, or 'Unassigned'.
 * @param {object} issue
 * @returns {string}
 */
function resolveAssigneeName(issue) {
  return (issue.fields.assignee && issue.fields.assignee.displayName) || 'Unassigned';
}

/**
 * Returns the issue type name (lowercase) for category checks.
 * @param {object} issue
 * @returns {string}
 */
function resolveIssueTypeLower(issue) {
  return ((issue.fields.issuetype && issue.fields.issuetype.name) || '').toLowerCase();
}

/**
 * Returns true if the status name matches a "done" category (case-insensitive).
 * @param {string} statusName
 * @returns {boolean}
 */
function isCompletedStatus(statusName) {
  const lowerName = statusName.toLowerCase();
  return DONE_STATUS_NAME_SUBSTRINGS.some((doneTerm) => lowerName.includes(doneTerm));
}

/**
 * Returns true if the status name indicates a blocked state.
 * @param {string} statusName
 * @returns {boolean}
 */
function isBlockedStatus(statusName) {
  const lowerName = statusName.toLowerCase();
  return BLOCKED_STATUS_SUBSTRINGS.some((blockedTerm) => lowerName.includes(blockedTerm));
}

/**
 * Returns true if the issue has an active blocking link (inward or outward).
 * Checks link type names for "block" or "impede" substrings.
 * @param {object} issue
 * @returns {boolean}
 */
function hasBlockingLink(issue) {
  const issueLinks = issue.fields.issuelinks || [];
  return issueLinks.some((issueLink) => {
    const linkTypeName = (
      (issueLink.type && issueLink.type.inward) ||
      (issueLink.type && issueLink.type.outward) ||
      ''
    ).toLowerCase();
    return BLOCKER_LINK_TYPE_SUBSTRINGS.some((blockerTerm) => linkTypeName.includes(blockerTerm));
  });
}

/**
 * Calculates how many whole days have elapsed since the issue first entered
 * a blocked status, by scanning the full changelog in reverse chronological order.
 * Returns 0 if no blocked transition is found.
 *
 * @param {object} issue
 * @returns {number}
 */
function calculateDaysBlocked(issue) {
  const histories = (issue.changelog && issue.changelog.histories) || [];
  // Scan newest → oldest to find the most recent transition INTO a blocked state.
  for (let historyIndex = histories.length - 1; historyIndex >= 0; historyIndex--) {
    const history = histories[historyIndex];
    for (const changeItem of (history.items || [])) {
      if (
        changeItem.field.toLowerCase() === 'status' &&
        changeItem.toString &&
        isBlockedStatus(changeItem.toString)
      ) {
        const blockedSinceMs = Date.now() - new Date(history.created).getTime();
        return Math.floor(blockedSinceMs / (1000 * 60 * 60 * 24));
      }
    }
  }
  return 0;
}

/**
 * Extracts status change entries from a single issue's changelog that fall
 * within the reporting window (after cutoffDate).
 *
 * @param {object} issue
 * @param {Date}   cutoffDate
 * @returns {Array<object>}
 */
function extractStatusChanges(issue, cutoffDate) {
  const statusChanges = [];
  const histories = (issue.changelog && issue.changelog.histories) || [];

  for (const history of histories) {
    if (new Date(history.created) < cutoffDate) continue;
    for (const changeItem of (history.items || [])) {
      if (changeItem.field.toLowerCase() !== 'status') continue;
      if (!changeItem.toString) continue;
      statusChanges.push({
        issueKey:   issue.key,
        summary:    issue.fields.summary,
        assignee:   resolveAssigneeName(issue),
        fromStatus: changeItem.fromString || '—',
        toStatus:   changeItem.toString,
        changedAt:  history.created,
      });
    }
  }

  return statusChanges;
}

/**
 * Extracts completions: status changes within the window that landed in a done-category status.
 *
 * @param {object} issue
 * @param {Date}   cutoffDate
 * @returns {Array<object>}
 */
function extractCompletions(issue, cutoffDate) {
  return extractStatusChanges(issue, cutoffDate)
    .filter((statusChange) => isCompletedStatus(statusChange.toStatus))
    .map((statusChange) => ({
      issueKey:    issue.key,
      summary:     issue.fields.summary,
      issueType:   (issue.fields.issuetype && issue.fields.issuetype.name) || 'Unknown',
      assignee:    statusChange.assignee,
      completedAt: statusChange.changedAt,
    }));
}

/**
 * Builds all five analysis buckets from the raw issue list.
 *
 * @param {Array} issues
 * @param {Date}  cutoffDate
 * @returns {{ statusChanges: Array, blockers: Array, defects: Array, risks: Array, completions: Array }}
 */
function analyseIssues(issues, cutoffDate) {
  const statusChanges = [];
  const blockers      = [];
  const defects       = [];
  const risks         = [];
  const completions   = [];

  for (const issue of issues) {
    const fields        = issue.fields || {};
    const issueTypeLower = resolveIssueTypeLower(issue);
    const statusName    = (fields.status && fields.status.name) || '';
    const labels        = (fields.labels || []).map((labelValue) => labelValue.toLowerCase());
    const priority      = (fields.priority && fields.priority.name) || '—';
    const lastUpdated   = fields.updated ? new Date(fields.updated).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    const assignee      = resolveAssigneeName(issue);

    // Bucket 1: Status changes within the window
    statusChanges.push(...extractStatusChanges(issue, cutoffDate));

    // Bucket 2: Blockers — blocked status OR blocking issuelink
    const isBlockedByStatus = isBlockedStatus(statusName);
    const isBlockedByLink   = hasBlockingLink(issue);
    if (isBlockedByStatus || isBlockedByLink) {
      const blockerType = isBlockedByLink ? 'Linked Blocker' : 'Blocked Status';
      blockers.push({
        issueKey:     issue.key,
        summary:      fields.summary,
        blockerType,
        assignee,
        daysBlocked:  calculateDaysBlocked(issue),
      });
    }

    // Bucket 3: Defects — issue type is Bug or Defect
    if (DEFECT_ISSUE_TYPES.has(issueTypeLower)) {
      defects.push({ issueKey: issue.key, summary: fields.summary, priority, status: statusName, assignee });
    }

    // Bucket 4: Risks — issue type is Risk OR label includes 'risk'
    const isRiskIssueType = RISK_ISSUE_TYPES.has(issueTypeLower);
    const hasRiskLabel    = labels.includes(RISK_LABEL);
    if (isRiskIssueType || hasRiskLabel) {
      risks.push({ issueKey: issue.key, summary: fields.summary, priority, status: statusName, lastUpdated });
    }

    // Bucket 5: Completions — status changes landing in done category
    completions.push(...extractCompletions(issue, cutoffDate));
  }

  return { statusChanges, blockers, defects, risks, completions };
}

/**
 * Extracts the active sprint name from the customfield_10016 sprint field.
 * Handles both object-form (Jira Cloud) and string-form (Jira Server) values.
 * Returns 'Unknown Sprint' when the field is absent or unparseable.
 *
 * @param {Array} issues
 * @returns {string}
 */
function extractSprintName(issues) {
  for (const issue of issues) {
    const sprintField = issue.fields && issue.fields.customfield_10016;
    if (!Array.isArray(sprintField) || sprintField.length === 0) continue;

    const sprintValue = sprintField[0];
    // Jira Cloud returns an object with a name property
    if (typeof sprintValue === 'object' && sprintValue !== null && sprintValue.name) {
      return sprintValue.name;
    }
    // Jira Server returns a serialised string like "com.atlassian.greenhopper.service.sprint.Sprint@...name=Sprint 24,state=..."
    if (typeof sprintValue === 'string') {
      const sprintNameMatch = sprintValue.match(/name=([^,\]]+)/);
      if (sprintNameMatch) return sprintNameMatch[1];
    }
  }
  return 'Unknown Sprint';
}

// ── Plain-text markdown output ──

/**
 * Renders an array of row objects as a GitHub-flavored markdown table.
 * Pipe characters in cell values are escaped to prevent table breakage.
 *
 * @param {string[]} headers  - Column display names
 * @param {string[]} fieldKeys - Object property names aligned to headers
 * @param {Array}    rows
 * @param {string}   emptyMessage - Text shown when rows is empty
 * @returns {string}
 */
function renderMarkdownTable(headers, fieldKeys, rows, emptyMessage) {
  if (rows.length === 0) {
    return '_' + emptyMessage + '_\n';
  }

  const headerRow    = '| ' + headers.join(' | ') + ' |';
  const separatorRow = '|' + headers.map(() => '---').join('|') + '|';
  const dataRows     = rows.map((row) =>
    '| ' + fieldKeys.map((fieldKey) => String(row[fieldKey] ?? '—').replace(/\|/g, '\\|')).join(' | ') + ' |'
  );

  return [headerRow, separatorRow, ...dataRows].join('\n') + '\n';
}

/**
 * Assembles the complete plain-text standup briefing with markdown tables.
 * This is the format returned to the API for UI display, copy-paste, and webhook delivery.
 *
 * @param {{ statusChanges: Array, blockers: Array, defects: Array, risks: Array, completions: Array }} buckets
 * @param {string} teamName
 * @param {string} sprintName
 * @param {number} daysBack
 * @returns {string}
 */
function buildBriefingMarkdown(buckets, teamName, sprintName, daysBack) {
  const { statusChanges, blockers, defects, risks, completions } = buckets;
  const generatedAt = new Date().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
  const dateLabel = new Date().toISOString().slice(0, 10);
  const period    = daysBack === 1 ? 'Last 24 hours' : 'Last ' + daysBack + ' days';

  const sections = [
    '=== PRE-STANDUP BRIEFING — ' + dateLabel + ' ===',
    'Generated: ' + generatedAt + ' | Team: ' + teamName + ' | Sprint: ' + sprintName + ' | Period: ' + period,
    '',
    '📋 STATUS CHANGES (' + statusChanges.length + ')',
    renderMarkdownTable(
      ['Key', 'Summary', 'From', 'To', 'Assignee'],
      ['issueKey', 'summary', 'fromStatus', 'toStatus', 'assignee'],
      statusChanges,
      'No status changes in the reporting period.'
    ),
    '🚨 BLOCKERS (' + blockers.length + ')',
    renderMarkdownTable(
      ['Key', 'Summary', 'Blocker Type', 'Assignee', 'Days Blocked'],
      ['issueKey', 'summary', 'blockerType', 'assignee', 'daysBlocked'],
      blockers,
      'No blockers detected.'
    ),
    '🐛 DEFECT ACTIVITY (' + defects.length + ')',
    renderMarkdownTable(
      ['Key', 'Summary', 'Priority', 'Status', 'Assignee'],
      ['issueKey', 'summary', 'priority', 'status', 'assignee'],
      defects,
      'No defect activity in the reporting period.'
    ),
    '⚠️ RISKS (' + risks.length + ')',
    renderMarkdownTable(
      ['Key', 'Summary', 'Priority', 'Status', 'Last Updated'],
      ['issueKey', 'summary', 'priority', 'status', 'lastUpdated'],
      risks,
      'No risks identified.'
    ),
    '✅ COMPLETIONS (' + completions.length + ')',
    renderMarkdownTable(
      ['Key', 'Summary', 'Type', 'Assignee', 'Completed At'],
      ['issueKey', 'summary', 'issueType', 'assignee', 'completedAt'],
      completions,
      'No completions in the reporting period.'
    ),
  ];

  return sections.join('\n');
}

// ── Confluence HTML output ──

/**
 * Escapes a value for safe inclusion in Confluence storage format XML.
 * @param {string} text
 * @returns {string}
 */
function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds the prompt asking AI Assist to summarise the briefing into a short insight block.
 * Sends the already-generated plain-text briefing so AI Assist synthesises the urgent items.
 *
 * @param {string} briefingText - The markdown/plain briefing already produced for this run.
 * @param {string} teamName
 * @returns {string} The AI Assist prompt.
 */
function buildStandupAiAssistPrompt(briefingText, teamName) {
  return [
    `You are a release train assistant. Below is today's standup briefing for team "${teamName}".`,
    'Write a concise insight block (2-3 sentences, plain prose, no preamble or headings)',
    'highlighting the single most urgent item(s) the team should act on today.',
    '',
    briefingText,
  ].join('\n');
}

/**
 * Wraps AI Assist's insight text in a Confluence "info" panel for prepending above the
 * data tables. Text is XML-escaped; blank-line groups become separate paragraphs.
 *
 * @param {string} insightText - Plain-text insight returned by AI Assist.
 * @returns {string} Confluence storage-format markup.
 */
function buildAiAssistInsightPanel(insightText) {
  const paragraphs = String(insightText)
    .trim()
    .split(/\n{2,}/)
    .map((paragraph) => '<p>' + escapeXml(paragraph).replace(/\n/g, '<br/>') + '</p>')
    .join('');
  return '<ac:structured-macro ac:name="info"><ac:rich-text-body>'
    + '<p><strong>🤖 AI Assist insight</strong></p>' + paragraphs
    + '</ac:rich-text-body></ac:structured-macro>';
}

/**
 * Renders an array of row objects as a Confluence storage-format HTML table.
 * Returns an italic empty-state paragraph when rows is empty.
 *
 * @param {string[]} headers
 * @param {string[]} fieldKeys
 * @param {Array}    rows
 * @param {string}   emptyMessage
 * @returns {string}
 */
function renderConfluenceTable(headers, fieldKeys, rows, emptyMessage) {
  if (rows.length === 0) {
    return '<p><em>' + escapeXml(emptyMessage) + '</em></p>';
  }

  const headerCells = headers.map((header) => '<th><strong>' + escapeXml(header) + '</strong></th>').join('');
  const dataRows    = rows.map((row) => {
    const cells = fieldKeys.map((fieldKey) => '<td>' + escapeXml(String(row[fieldKey] ?? '—')) + '</td>').join('');
    return '<tr>' + cells + '</tr>';
  }).join('');

  return '<table><tbody><tr>' + headerCells + '</tr>' + dataRows + '</tbody></table>';
}

/**
 * Builds the Confluence storage-format HTML body for a team standup briefing.
 *
 * @param {{ statusChanges, blockers, defects, risks, completions }} buckets
 * @param {string} teamName
 * @param {string} sprintName
 * @param {number} daysBack
 * @param {string} generatedAt
 * @returns {string}
 */
function buildBriefingConfluenceBody(buckets, teamName, sprintName, daysBack, generatedAt) {
  const { statusChanges, blockers, defects, risks, completions } = buckets;
  const period = daysBack === 1 ? 'Last 24 hours' : 'Last ' + daysBack + ' days';
  const badge  = (count) => '(' + count + ')';

  return [
    '<p><strong>Team:</strong> ' + escapeXml(teamName) +
    ' &nbsp;|&nbsp; <strong>Sprint:</strong> ' + escapeXml(sprintName) +
    ' &nbsp;|&nbsp; <strong>Generated:</strong> ' + escapeXml(generatedAt) +
    ' &nbsp;|&nbsp; <strong>Period:</strong> ' + escapeXml(period) + '</p>',

    '<h2>📋 Status Changes ' + badge(statusChanges.length) + '</h2>',
    renderConfluenceTable(
      ['Key', 'Summary', 'From', 'To', 'Assignee'],
      ['issueKey', 'summary', 'fromStatus', 'toStatus', 'assignee'],
      statusChanges,
      'No status changes in the reporting period.'
    ),

    '<h2>🚨 Blockers ' + badge(blockers.length) + '</h2>',
    renderConfluenceTable(
      ['Key', 'Summary', 'Blocker Type', 'Assignee', 'Days Blocked'],
      ['issueKey', 'summary', 'blockerType', 'assignee', 'daysBlocked'],
      blockers,
      'No blockers detected.'
    ),

    '<h2>🐛 Defect Activity ' + badge(defects.length) + '</h2>',
    renderConfluenceTable(
      ['Key', 'Summary', 'Priority', 'Status', 'Assignee'],
      ['issueKey', 'summary', 'priority', 'status', 'assignee'],
      defects,
      'No defect activity in the reporting period.'
    ),

    '<h2>⚠️ Risks ' + badge(risks.length) + '</h2>',
    renderConfluenceTable(
      ['Key', 'Summary', 'Priority', 'Status', 'Last Updated'],
      ['issueKey', 'summary', 'priority', 'status', 'lastUpdated'],
      risks,
      'No risks identified.'
    ),

    '<h2>✅ Completions ' + badge(completions.length) + '</h2>',
    renderConfluenceTable(
      ['Key', 'Summary', 'Type', 'Assignee', 'Completed At'],
      ['issueKey', 'summary', 'issueType', 'assignee', 'completedAt'],
      completions,
      'No completions in the reporting period.'
    ),
  ].join('\n');
}

/**
 * Builds the ART rollup Confluence body by combining all teams' buckets.
 * Adds a Team column to each table and a per-team summary section.
 *
 * @param {Array<{ teamName, buckets }>} teamResults
 * @param {number} daysBack
 * @param {string} generatedAt
 * @returns {string}
 */
function buildArtRollupConfluenceBody(teamResults, daysBack, generatedAt) {
  const period = daysBack === 1 ? 'Last 24 hours' : 'Last ' + daysBack + ' days';
  const badge  = (count) => '(' + count + ')';

  // Flatten all buckets, tagging each item with its team name
  const allStatusChanges = teamResults.flatMap(({ teamName, buckets }) =>
    buckets.statusChanges.map((item) => Object.assign({ teamName }, item))
  );
  const allBlockers = teamResults.flatMap(({ teamName, buckets }) =>
    buckets.blockers.map((item) => Object.assign({ teamName }, item))
  );
  const allDefects = teamResults.flatMap(({ teamName, buckets }) =>
    buckets.defects.map((item) => Object.assign({ teamName }, item))
  );
  const allRisks = teamResults.flatMap(({ teamName, buckets }) =>
    buckets.risks.map((item) => Object.assign({ teamName }, item))
  );
  const allCompletions = teamResults.flatMap(({ teamName, buckets }) =>
    buckets.completions.map((item) => Object.assign({ teamName }, item))
  );

  // Per-team summary table
  const teamSummaryRows = teamResults.map(({ teamName, buckets }) =>
    '<tr><td><strong>' + escapeXml(teamName) + '</strong></td>' +
    '<td>' + buckets.statusChanges.length + '</td>' +
    '<td>' + buckets.blockers.length + '</td>' +
    '<td>' + buckets.defects.length + '</td>' +
    '<td>' + buckets.risks.length + '</td>' +
    '<td>' + buckets.completions.length + '</td></tr>'
  ).join('');

  const teamSummaryTable = '<table><tbody>' +
    '<tr><th><strong>Team</strong></th><th><strong>Status Changes</strong></th>' +
    '<th><strong>Blockers</strong></th><th><strong>Defects</strong></th>' +
    '<th><strong>Risks</strong></th><th><strong>Completions</strong></th></tr>' +
    teamSummaryRows + '</tbody></table>';

  return [
    '<p><strong>ART Standup Rollup</strong> &nbsp;|&nbsp; <strong>Generated:</strong> ' + escapeXml(generatedAt) +
    ' &nbsp;|&nbsp; <strong>Period:</strong> ' + escapeXml(period) + '</p>',

    '<h2>📊 Team Summary</h2>',
    teamSummaryTable,

    '<h2>📋 Status Changes ' + badge(allStatusChanges.length) + '</h2>',
    renderConfluenceTable(
      ['Team', 'Key', 'Summary', 'From', 'To', 'Assignee'],
      ['teamName', 'issueKey', 'summary', 'fromStatus', 'toStatus', 'assignee'],
      allStatusChanges,
      'No status changes across any team.'
    ),

    '<h2>🚨 Blockers ' + badge(allBlockers.length) + '</h2>',
    renderConfluenceTable(
      ['Team', 'Key', 'Summary', 'Blocker Type', 'Assignee', 'Days Blocked'],
      ['teamName', 'issueKey', 'summary', 'blockerType', 'assignee', 'daysBlocked'],
      allBlockers,
      'No blockers detected across any team.'
    ),

    '<h2>🐛 Defect Activity ' + badge(allDefects.length) + '</h2>',
    renderConfluenceTable(
      ['Team', 'Key', 'Summary', 'Priority', 'Status', 'Assignee'],
      ['teamName', 'issueKey', 'summary', 'priority', 'status', 'assignee'],
      allDefects,
      'No defect activity across any team.'
    ),

    '<h2>⚠️ Risks ' + badge(allRisks.length) + '</h2>',
    renderConfluenceTable(
      ['Team', 'Key', 'Summary', 'Priority', 'Status', 'Last Updated'],
      ['teamName', 'issueKey', 'summary', 'priority', 'status', 'lastUpdated'],
      allRisks,
      'No risks across any team.'
    ),

    '<h2>✅ Completions ' + badge(allCompletions.length) + '</h2>',
    renderConfluenceTable(
      ['Team', 'Key', 'Summary', 'Type', 'Assignee', 'Completed At'],
      ['teamName', 'issueKey', 'summary', 'issueType', 'assignee', 'completedAt'],
      allCompletions,
      'No completions across any team.'
    ),
  ].join('\n');
}

/**
 * Builds the ART rollup plain-text markdown version.
 *
 * @param {Array<{ teamName, buckets }>} teamResults
 * @param {number} daysBack
 * @returns {string}
 */
function buildArtRollupMarkdown(teamResults, daysBack) {
  const generatedAt = new Date().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
  const dateLabel = new Date().toISOString().slice(0, 10);
  const period    = daysBack === 1 ? 'Last 24 hours' : 'Last ' + daysBack + ' days';

  const allStatusChanges = teamResults.flatMap(({ teamName, buckets }) =>
    buckets.statusChanges.map((item) => Object.assign({ teamName }, item))
  );
  const allBlockers    = teamResults.flatMap(({ teamName, buckets }) =>
    buckets.blockers.map((item) => Object.assign({ teamName }, item))
  );
  const allDefects     = teamResults.flatMap(({ teamName, buckets }) =>
    buckets.defects.map((item) => Object.assign({ teamName }, item))
  );
  const allRisks       = teamResults.flatMap(({ teamName, buckets }) =>
    buckets.risks.map((item) => Object.assign({ teamName }, item))
  );
  const allCompletions = teamResults.flatMap(({ teamName, buckets }) =>
    buckets.completions.map((item) => Object.assign({ teamName }, item))
  );

  const sections = [
    '=== ART PRE-STANDUP BRIEFING — ' + dateLabel + ' ===',
    'Generated: ' + generatedAt + ' | Period: ' + period + ' | Teams: ' + teamResults.map((result) => result.teamName).join(', '),
    '',
    '📋 STATUS CHANGES (' + allStatusChanges.length + ')',
    renderMarkdownTable(
      ['Team', 'Key', 'Summary', 'From', 'To', 'Assignee'],
      ['teamName', 'issueKey', 'summary', 'fromStatus', 'toStatus', 'assignee'],
      allStatusChanges,
      'No status changes across any team.'
    ),
    '🚨 BLOCKERS (' + allBlockers.length + ')',
    renderMarkdownTable(
      ['Team', 'Key', 'Summary', 'Blocker Type', 'Assignee', 'Days Blocked'],
      ['teamName', 'issueKey', 'summary', 'blockerType', 'assignee', 'daysBlocked'],
      allBlockers,
      'No blockers detected across any team.'
    ),
    '🐛 DEFECT ACTIVITY (' + allDefects.length + ')',
    renderMarkdownTable(
      ['Team', 'Key', 'Summary', 'Priority', 'Status', 'Assignee'],
      ['teamName', 'issueKey', 'summary', 'priority', 'status', 'assignee'],
      allDefects,
      'No defect activity across any team.'
    ),
    '⚠️ RISKS (' + allRisks.length + ')',
    renderMarkdownTable(
      ['Team', 'Key', 'Summary', 'Priority', 'Status', 'Last Updated'],
      ['teamName', 'issueKey', 'summary', 'priority', 'status', 'lastUpdated'],
      allRisks,
      'No risks across any team.'
    ),
    '✅ COMPLETIONS (' + allCompletions.length + ')',
    renderMarkdownTable(
      ['Team', 'Key', 'Summary', 'Type', 'Assignee', 'Completed At'],
      ['teamName', 'issueKey', 'summary', 'issueType', 'assignee', 'completedAt'],
      allCompletions,
      'No completions across any team.'
    ),
  ];

  return sections.join('\n');
}

// ── Confluence delivery (reused from scopeChangeScheduler pattern) ──

/**
 * Extracts the numeric Confluence page/blog ID from a full page URL.
 * @param {string} url
 * @returns {string|null}
 */
function extractPageIdFromUrl(url) {
  const idMatch = url.match(/\/(\d{6,})(?:\/|$)/);
  return idMatch ? idMatch[1] : null;
}

/**
 * Fetches a Confluence page's current version number and body so new content
 * can be prepended without losing the accumulated history.
 *
 * @param {string} pageId
 * @param {object} confluenceConfig
 * @param {boolean} sslVerify
 * @returns {Promise<{ versionNumber: number, existingBody: string, contentType: string }>}
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
    throw new Error('Could not fetch Confluence page: ' + errorDetail);
  }
  return {
    versionNumber: (result.body.version && result.body.version.number) || 1,
    existingBody:  (result.body.body && result.body.body.storage && result.body.body.storage.value) || '',
    contentType:   result.body.type || 'page',
  };
}

/**
 * Prepends a new standup briefing to an existing Confluence page or blog post.
 * Runs accumulate mode — each delivery is separated by a horizontal rule.
 *
 * @param {string} pageId
 * @param {string} pageTitle
 * @param {string} newBodyHtml
 * @param {object} confluenceConfig
 * @param {boolean} sslVerify
 * @returns {Promise<string>} Web URL of the updated post
 */
async function updateConfluenceBlogPost(pageId, pageTitle, newBodyHtml, confluenceConfig, sslVerify) {
  const { versionNumber, existingBody, contentType } = await fetchConfluencePage(pageId, confluenceConfig, sslVerify);

  const combinedBody = existingBody
    ? newBodyHtml + '\n<hr/>\n' + existingBody
    : newBodyHtml;

  const payload = {
    id:      pageId,
    type:    contentType,
    title:   pageTitle,
    version: { number: versionNumber + 1 },
    body:    { storage: { value: combinedBody, representation: 'storage' } },
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
 * Creates a new Confluence blog post with the standup briefing content.
 *
 * @param {string} spaceKey
 * @param {string} pageTitle
 * @param {string} bodyHtml
 * @param {object} confluenceConfig
 * @param {boolean} sslVerify
 * @returns {Promise<string>} URL of the created post
 */
async function createConfluenceBlogPost(spaceKey, pageTitle, bodyHtml, confluenceConfig, sslVerify) {
  const payload = {
    type:  'blogpost',
    title: pageTitle,
    space: { key: spaceKey },
    body:  { storage: { value: bodyHtml, representation: 'storage' } },
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

// ── Delivery functions ──

/**
 * Runs a standup briefing delivery for a single team.
 * Queries Jira, analyses results, delivers to Confluence (if configured),
 * fires a trigger webhook (if configured), and returns the plain-text briefing.
 *
 * @param {object} teamReport - { teamName, projectKeys, scheduleTime, confluenceSpaceKey, targetBlogUrl, triggerUrl, triggerSecret, daysBack, isEnabled }
 * @param {object} configuration - Live server config
 * @returns {Promise<{ skipped: boolean, message: string, briefingText: string, counts: object, postUrl?: string }>}
 */
async function runTeamBriefingDelivery(teamReport, configuration) {
  const { teamName, projectKeys, confluenceSpaceKey, targetBlogUrl, triggerUrl, triggerSecret } = teamReport;
  const jiraConfig       = configuration.jira;
  const confluenceConfig = configuration.confluence;
  const sslVerify        = configuration.sslVerify !== false;
  const daysBack         = teamReport.daysBack || DEFAULT_DAYS_BACK;
  const cutoffDate       = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  if (!projectKeys || projectKeys.length === 0) {
    return { skipped: true, message: 'No project keys configured.', briefingText: '', counts: buildEmptyCounts() };
  }

  console.log('  🔍 Standup Briefing [' + teamName + ']: querying ' + projectKeys.join(', ') + '…');

  const issues     = await fetchStandupIssues(projectKeys, daysBack, jiraConfig, sslVerify);
  const buckets    = analyseIssues(issues, cutoffDate);
  const sprintName = extractSprintName(issues);

  const generatedAt = new Date().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
  const dateLabel = new Date().toISOString().slice(0, 10);

  const briefingText     = buildBriefingMarkdown(buckets, teamName, sprintName, daysBack);
  let   confluenceHtml   = buildBriefingConfluenceBody(buckets, teamName, sprintName, daysBack, generatedAt);

  // Optional, non-blocking AI Assist enrichment: prepend an insight block above the
  // tables. Skipped silently when AI Assist is disabled/unavailable so the briefing
  // always publishes on schedule (FR-001, SC-008).
  if (isAiAssistEnabled(configuration)) {
    const aiAssistInsight = await requestAiAssistText(configuration, buildStandupAiAssistPrompt(briefingText, teamName), { label: 'standup' });
    if (aiAssistInsight) {
      confluenceHtml = buildAiAssistInsightPanel(aiAssistInsight) + confluenceHtml;
    }
  }

  const targetPageId     = targetBlogUrl ? extractPageIdFromUrl(targetBlogUrl) : null;
  const postTitle        = targetPageId
    ? 'Standup Briefing — ' + teamName
    : 'Standup Briefing — ' + teamName + ' — ' + dateLabel;

  let postUrl;
  if (confluenceSpaceKey || targetPageId) {
    try {
      if (targetPageId) {
        console.log('  📝 Standup Briefing [' + teamName + ']: updating Confluence page ' + targetPageId + '…');
        postUrl = await updateConfluenceBlogPost(targetPageId, postTitle, confluenceHtml, confluenceConfig, sslVerify);
      } else {
        console.log('  📝 Standup Briefing [' + teamName + ']: creating Confluence post in space ' + confluenceSpaceKey + '…');
        postUrl = await createConfluenceBlogPost(confluenceSpaceKey, postTitle, confluenceHtml, confluenceConfig, sslVerify);
      }
      console.log('  ✅ Standup Briefing [' + teamName + ']: Confluence delivered — ' + postUrl);
    } catch (confluenceError) {
      console.error('  ⚠ Standup Briefing [' + teamName + ']: Confluence delivery failed — ' + confluenceError.message);
    }
  }

  // Fire the trigger webhook — non-fatal if it fails.
  if (triggerUrl) {
    const webhookPayload = {
      teamName,
      projectKeys,
      text:         briefingText,
      postUrl:      postUrl || null,
      generatedAt:  new Date().toISOString(),
      counts:       buildCountsFromBuckets(buckets),
    };
    triggerWebhook(triggerUrl, webhookPayload, sslVerify, triggerSecret || undefined).catch((webhookError) => {
      console.error('  ⚠ Standup Briefing [' + teamName + ']: webhook trigger failed — ' + webhookError.message);
    });
  }

  const counts   = buildCountsFromBuckets(buckets);
  const totalCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  console.log('  ✅ Standup Briefing [' + teamName + ']: generated — ' + totalCount + ' item(s)');

  return {
    skipped:     false,
    message:     'Briefing generated — ' + totalCount + ' item(s) across 5 sections.',
    briefingText,
    counts,
    postUrl,
  };
}

/**
 * Runs the ART rollup standup briefing by fetching all enabled teams in parallel
 * and combining their results into a single cross-team report.
 *
 * @param {object} artRollupConfig - { scheduleTime, confluenceSpaceKey, targetBlogUrl, triggerUrl, triggerSecret, isEnabled }
 * @param {object} configuration
 * @returns {Promise<{ skipped: boolean, message: string, briefingText: string, counts: object, postUrl?: string }>}
 */
async function runArtRollupDelivery(artRollupConfig, configuration) {
  const standupConfig = ((configuration.scheduler || {}).standupBriefing) || {};
  const enabledTeams  = (standupConfig.teamReports || []).filter((team) => team.isEnabled);

  if (enabledTeams.length === 0) {
    return { skipped: true, message: 'No enabled teams configured for ART rollup.', briefingText: '', counts: buildEmptyCounts() };
  }

  const jiraConfig  = configuration.jira;
  const sslVerify   = configuration.sslVerify !== false;

  // Fetch all teams in parallel to minimise wall-clock time.
  const teamResults = await Promise.all(enabledTeams.map(async (teamReport) => {
    const daysBack   = teamReport.daysBack || DEFAULT_DAYS_BACK;
    const cutoffDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const issues     = await fetchStandupIssues(teamReport.projectKeys, daysBack, jiraConfig, sslVerify);
    return {
      teamName: teamReport.teamName,
      buckets:  analyseIssues(issues, cutoffDate),
    };
  }));

  const daysBack      = enabledTeams[0].daysBack || DEFAULT_DAYS_BACK;
  const briefingText  = buildArtRollupMarkdown(teamResults, daysBack);
  const generatedAt   = new Date().toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  });
  const dateLabel     = new Date().toISOString().slice(0, 10);
  const confluenceHtml = buildArtRollupConfluenceBody(teamResults, daysBack, generatedAt);

  const { confluenceSpaceKey, targetBlogUrl, triggerUrl, triggerSecret } = artRollupConfig;
  const confluenceConfig = configuration.confluence;
  const targetPageId     = targetBlogUrl ? extractPageIdFromUrl(targetBlogUrl) : null;
  const postTitle        = targetPageId
    ? 'ART Standup Briefing Rollup'
    : 'ART Standup Briefing Rollup — ' + dateLabel;

  let postUrl;
  if (confluenceSpaceKey || targetPageId) {
    try {
      if (targetPageId) {
        postUrl = await updateConfluenceBlogPost(targetPageId, postTitle, confluenceHtml, confluenceConfig, sslVerify);
      } else {
        postUrl = await createConfluenceBlogPost(confluenceSpaceKey, postTitle, confluenceHtml, confluenceConfig, sslVerify);
      }
      console.log('  ✅ Standup Briefing ART Rollup: Confluence delivered — ' + postUrl);
    } catch (confluenceError) {
      console.error('  ⚠ Standup Briefing ART Rollup: Confluence failed — ' + confluenceError.message);
    }
  }

  if (triggerUrl) {
    const teamSummaries = teamResults.map(({ teamName, buckets }) => ({
      teamName,
      counts: buildCountsFromBuckets(buckets),
    }));
    triggerWebhook(triggerUrl, { text: briefingText, postUrl: postUrl || null, generatedAt: new Date().toISOString(), teamSummaries }, sslVerify, triggerSecret || undefined).catch((webhookError) => {
      console.error('  ⚠ Standup Briefing ART Rollup: webhook failed — ' + webhookError.message);
    });
  }

  const combinedCounts = teamResults.reduce((aggregate, { buckets }) => {
    const teamCounts = buildCountsFromBuckets(buckets);
    return {
      statusChanges: aggregate.statusChanges + teamCounts.statusChanges,
      blockers:      aggregate.blockers      + teamCounts.blockers,
      defects:       aggregate.defects       + teamCounts.defects,
      risks:         aggregate.risks         + teamCounts.risks,
      completions:   aggregate.completions   + teamCounts.completions,
    };
  }, buildEmptyCounts());

  const totalCount = Object.values(combinedCounts).reduce((sum, count) => sum + count, 0);

  return {
    skipped:     false,
    message:     'ART rollup generated — ' + totalCount + ' item(s) across ' + enabledTeams.length + ' team(s).',
    briefingText,
    counts:      combinedCounts,
    postUrl,
  };
}

// ── Count helpers ──

/**
 * Builds a counts object from an analysis buckets result.
 * @param {{ statusChanges, blockers, defects, risks, completions }} buckets
 * @returns {{ statusChanges: number, blockers: number, defects: number, risks: number, completions: number }}
 */
function buildCountsFromBuckets(buckets) {
  return {
    statusChanges: buckets.statusChanges.length,
    blockers:      buckets.blockers.length,
    defects:       buckets.defects.length,
    risks:         buckets.risks.length,
    completions:   buckets.completions.length,
  };
}

/**
 * Returns a zero-filled counts object, used as the base for reductions.
 * @returns {{ statusChanges: number, blockers: number, defects: number, risks: number, completions: number }}
 */
function buildEmptyCounts() {
  return { statusChanges: 0, blockers: 0, defects: 0, risks: 0, completions: 0 };
}

// ── Run-now entry points (called from the standup briefing route) ──

/**
 * Runs an ad-hoc standup briefing for any set of project keys without requiring
 * a saved team config entry. Used by the Team Dashboard "Briefing" mode so the
 * current team's sprint data can be scanned on demand, bypassing the Confluence
 * and webhook delivery steps that only make sense for scheduled runs.
 *
 * @param {object}   configuration
 * @param {string[]} projectKeys - Jira project keys to query (e.g. ['MYPROJ'])
 * @param {string}   teamName    - Display name for the briefing header
 * @param {number}   daysBack    - How many days of history to scan (default 1)
 * @returns {Promise<{ skipped: boolean, message: string, briefingText: string, counts: object, sprintName: string }>}
 */
async function runAdhocBriefing(configuration, projectKeys, teamName, daysBack) {
  const resolvedDaysBack = Number.isInteger(daysBack) && daysBack > 0 ? daysBack : DEFAULT_DAYS_BACK;
  const resolvedTeamName = teamName || 'Unknown Team';

  if (!Array.isArray(projectKeys) || projectKeys.length === 0) {
    return { skipped: true, message: 'No project keys provided.', briefingText: '', counts: buildEmptyCounts(), sprintName: '' };
  }

  const jiraConfig  = configuration.jira;
  const sslVerify   = configuration.sslVerify !== false;
  const cutoffDate  = new Date(Date.now() - resolvedDaysBack * 24 * 60 * 60 * 1000);

  console.log('  🔍 Standup Briefing (ad-hoc) [' + resolvedTeamName + ']: querying ' + projectKeys.join(', ') + '…');

  const issues     = await fetchStandupIssues(projectKeys, resolvedDaysBack, jiraConfig, sslVerify);
  const buckets    = analyseIssues(issues, cutoffDate);
  const sprintName = extractSprintName(issues);
  const counts     = buildCountsFromBuckets(buckets);
  const briefingText = buildBriefingMarkdown(buckets, resolvedTeamName, sprintName, resolvedDaysBack);

  const totalCount = Object.values(counts).reduce((sum, count) => sum + count, 0);
  console.log('  ✅ Standup Briefing (ad-hoc) [' + resolvedTeamName + ']: ' + totalCount + ' item(s)');

  return {
    skipped:     false,
    message:     'Briefing generated — ' + totalCount + ' item(s) across 5 sections.',
    briefingText,
    counts,
    sprintName,
  };
}

/**
 * Manually triggers a standup briefing for a specific team.
 *
 * @param {object} configuration
 * @param {number} teamIndex - Index into configuration.scheduler.standupBriefing.teamReports
 * @returns {Promise<{ skipped: boolean, message: string, briefingText: string, counts: object, postUrl?: string }>}
 */
async function runTeamBriefingNow(configuration, teamIndex) {
  const standupConfig = ((configuration.scheduler || {}).standupBriefing) || {};
  const teamReport    = (standupConfig.teamReports || [])[teamIndex];

  if (!teamReport) {
    return { skipped: true, message: 'Team report at index ' + teamIndex + ' not found.', briefingText: '', counts: buildEmptyCounts() };
  }

  return runTeamBriefingDelivery(teamReport, configuration);
}

/**
 * Manually triggers the ART standup rollup.
 *
 * @param {object} configuration
 * @returns {Promise<{ skipped: boolean, message: string, briefingText: string, counts: object, postUrl?: string }>}
 */
async function runArtRollupNow(configuration) {
  const standupConfig = ((configuration.scheduler || {}).standupBriefing) || {};
  const artRollup     = standupConfig.artRollup || {};

  return runArtRollupDelivery(artRollup, configuration);
}

module.exports = {
  startStandupBriefingScheduler,
  runTeamBriefingNow,
  runArtRollupNow,
  runAdhocBriefing,
  // Exported for unit testing:
  renderMarkdownTable,
  extractStatusChanges,
  extractCompletions,
  analyseIssues,
  buildBriefingMarkdown,
  extractSprintName,
  calculateDaysBlocked,
  isCompletedStatus,
  isBlockedStatus,
  hasBlockingLink,
  buildStandupAiAssistPrompt,
  buildAiAssistInsightPanel,
};
