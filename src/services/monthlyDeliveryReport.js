// monthlyDeliveryReport.js — Monthly Delivery Report data layer (feature 018): fetches each team's
// prior-month Stories/Tasks from Jira, classifies them into Production / External Test using the SAME
// delivery ladder the Team Dashboard uses (bundled engine — never reimplemented), groups them under
// their parent Features, and renders the single AI-ready prompt (contracts/prompt-format.md).

'use strict';

const {
  isDeliveredIssue,
  resolveDeliveryDateIso,
  resolveDoneEntryDateIso,
  extractFeatureKeyFromIssueFields,
  FEATURE_LINK_DEFAULT_FIELD,
  EPIC_LINK_FIELD,
} = require('./generated/monthlyDeliveryEngine.cjs');

// ── Constants ──

/** Issues fetched per Jira search page. Pagination loops until the reported total is reached —
 * the older schedulers stop at one page, but silent truncation would break this report's
 * every-delivery-accounted-for guarantee (drift justification, research.md D3). */
const JIRA_SEARCH_PAGE_SIZE = 200;

/** Hard ceiling on pagination requests per query — guards against a runaway loop on a bad total. */
const JIRA_SEARCH_MAX_PAGES = 20;

/** The two issue types this report covers (spec FR-007). */
const REPORTED_ISSUE_TYPES = '(Story, Task)';

/** Prompt bucket phrasing, shared by the section headers and the per-issue lines. */
const PRODUCTION_BUCKET = 'production';
const EXTERNAL_TEST_BUCKET = 'externalTest';

/** Length of the YYYY-MM-DD prefix used when rendering qualifying dates in the prompt. */
const DATE_ONLY_LENGTH = 10;

// ── Classification (data-model.md rules 1–4) ──

/** True when the ISO timestamp falls inside the covered-month window. */
function isIsoInsideWindow(isoTimestamp, window) {
  const timestampMs = Date.parse(isoTimestamp);
  return Number.isFinite(timestampMs) && timestampMs >= window.startMs && timestampMs <= window.endMs;
}

/** Returns the in-window release date of the first of the issue's fix versions that released this month, or null. */
function findInWindowReleaseDate(issue, releasedVersionsInWindow) {
  const fixVersions = (issue.fields && issue.fields.fixVersions) || [];
  for (const fixVersion of fixVersions) {
    const releaseDate = releasedVersionsInWindow.get(fixVersion && fixVersion.name);
    if (releaseDate) {
      return releaseDate;
    }
  }
  return null;
}

/**
 * Classifies one issue against the covered month. Returns { bucket, qualifyingDateIso } or null when
 * the issue earns no credit this month. Production always wins over External Test, so an issue can
 * appear in exactly one bucket:
 *   1. Production (status path): the issue entered its current done run inside the window.
 *   2. Production (release path): the issue is delivered now and a fix version released inside the window.
 *   3. External Test: the issue entered its current delivered run ("Ready for QA"+) inside the window.
 * Issues without a fetched changelog are excluded — attribution is never guessed (SC-003).
 */
function classifyIssueDelivery(issue, window, releasedVersionsInWindow) {
  const doneEntryIso = resolveDoneEntryDateIso(issue);
  if (doneEntryIso !== null && isIsoInsideWindow(doneEntryIso, window)) {
    return { bucket: PRODUCTION_BUCKET, qualifyingDateIso: doneEntryIso };
  }

  const inWindowReleaseDate = findInWindowReleaseDate(issue, releasedVersionsInWindow);
  if (inWindowReleaseDate !== null && isDeliveredIssue(issue)) {
    return { bucket: PRODUCTION_BUCKET, qualifyingDateIso: inWindowReleaseDate };
  }

  const deliveredEntryIso = resolveDeliveryDateIso(issue);
  if (deliveredEntryIso !== null && issue.changelog !== undefined && isIsoInsideWindow(deliveredEntryIso, window)) {
    return { bucket: EXTERNAL_TEST_BUCKET, qualifyingDateIso: deliveredEntryIso };
  }

  return null;
}

/** Builds one DeliveryRecord from a classified issue, resolving its parent Feature key. */
function buildDeliveryRecord(issue, classification, featureLinkFieldId) {
  return {
    issueKey: issue.key,
    summary: (issue.fields && issue.fields.summary) || '',
    bucket: classification.bucket,
    qualifyingDateIso: classification.qualifyingDateIso,
    featureKey: extractFeatureKeyFromIssueFields(issue.fields || {}, featureLinkFieldId),
  };
}

// ── Feature grouping ──

/**
 * Groups delivery records by parent Feature key, sorted for deterministic output:
 * Feature groups alphabetically, the synthetic "No Feature" group (featureKey null) always last,
 * and each group's records sorted by issue key.
 */
function groupRecordsByFeature(records) {
  const recordsByFeatureKey = new Map();
  for (const record of records) {
    const groupKey = record.featureKey; // null groups together as "No Feature"
    const groupRecords = recordsByFeatureKey.get(groupKey) || [];
    groupRecords.push(record);
    recordsByFeatureKey.set(groupKey, groupRecords);
  }

  const sortedFeatureKeys = Array.from(recordsByFeatureKey.keys())
    .filter((featureKey) => featureKey !== null)
    .sort();
  const orderedKeys = recordsByFeatureKey.has(null) ? [...sortedFeatureKeys, null] : sortedFeatureKeys;

  return orderedKeys.map((featureKey) => ({
    featureKey,
    featureSummary: '',
    records: (recordsByFeatureKey.get(featureKey) || [])
      .slice()
      .sort((leftRecord, rightRecord) => leftRecord.issueKey.localeCompare(rightRecord.issueKey)),
  }));
}

// ── Jira fetch layer ──

/** Converts a "YYYY-MM-DD" date into Jira JQL's "YYYY/MM/DD" literal form. */
function toJqlDate(dateString) {
  return dateString.replace(/-/g, '/');
}

/** The issue fields both searches request — enough for classification, grouping, and the prompt. */
function buildSearchFieldList(featureLinkFieldId) {
  const fieldIds = new Set([
    'summary', 'status', 'issuetype', 'created', 'fixVersions', 'parent',
    featureLinkFieldId, FEATURE_LINK_DEFAULT_FIELD, EPIC_LINK_FIELD,
  ]);
  return Array.from(fieldIds).join(',');
}

/** Runs one JQL search with startAt pagination until the reported total (or the page cap) is reached. */
async function searchIssuesPaginated(requestJira, jql, featureLinkFieldId) {
  const collectedIssues = [];
  for (let pageIndex = 0; pageIndex < JIRA_SEARCH_MAX_PAGES; pageIndex += 1) {
    const searchPath = '/rest/api/2/search?jql=' + encodeURIComponent(jql)
      + '&fields=' + buildSearchFieldList(featureLinkFieldId)
      + '&expand=changelog&maxResults=' + JIRA_SEARCH_PAGE_SIZE
      + '&startAt=' + (pageIndex * JIRA_SEARCH_PAGE_SIZE);
    const searchResult = await requestJira(searchPath);
    if (searchResult.status !== 200) {
      throw new Error('Jira search failed: ' + searchResult.status);
    }
    const pageIssues = (searchResult.body && searchResult.body.issues) || [];
    collectedIssues.push(...pageIssues);
    const reportedTotal = Number((searchResult.body && searchResult.body.total) || 0);
    if (collectedIssues.length >= reportedTotal || pageIssues.length === 0) {
      break;
    }
  }
  return collectedIssues;
}

/** Keeps only released project versions whose release date falls inside the window (name → releaseDate). */
function selectReleasedVersionsInWindow(projectVersions, window) {
  const releasedVersionsInWindow = new Map();
  for (const projectVersion of projectVersions || []) {
    const isReleasedInWindow = !!(projectVersion && projectVersion.released && projectVersion.releaseDate
      && projectVersion.releaseDate >= window.firstDayDate
      && projectVersion.releaseDate <= window.lastDayDate);
    if (isReleasedInWindow) {
      releasedVersionsInWindow.set(projectVersion.name, projectVersion.releaseDate);
    }
  }
  return releasedVersionsInWindow;
}

/** Escapes double quotes inside a JQL string literal. */
function escapeJqlValue(rawValue) {
  return String(rawValue).replace(/"/g, '\\"');
}

/**
 * Fetches one team's candidate issues for the covered month: the status-change query (anything whose
 * status changed during the month) plus the released-version query (anything on a version released
 * during the month, which may have had no in-month transition — spec FR-010). Results are deduped by
 * issue key; classification decides what actually qualifies.
 */
async function fetchTeamDeliveryData(team, window, featureLinkFieldId, deps) {
  const requestJira = deps.requestJira;
  const projectClause = 'project = "' + escapeJqlValue(team.projectKey) + '" AND issuetype in ' + REPORTED_ISSUE_TYPES;

  const statusChangeJql = projectClause
    + ' AND status CHANGED DURING ("' + toJqlDate(window.firstDayDate) + '", "' + toJqlDate(window.lastDayDate) + '")';
  const statusChangeIssues = await searchIssuesPaginated(requestJira, statusChangeJql, featureLinkFieldId);

  const versionsResult = await requestJira('/rest/api/2/project/' + encodeURIComponent(team.projectKey) + '/versions');
  if (versionsResult.status !== 200) {
    throw new Error('Jira project versions fetch failed: ' + versionsResult.status);
  }
  const releasedVersionsInWindow = selectReleasedVersionsInWindow(versionsResult.body, window);

  let releasedVersionIssues = [];
  if (releasedVersionsInWindow.size > 0) {
    const versionNameList = Array.from(releasedVersionsInWindow.keys())
      .map((versionName) => '"' + escapeJqlValue(versionName) + '"')
      .join(', ');
    const releasedVersionJql = projectClause + ' AND fixVersion in (' + versionNameList + ')';
    releasedVersionIssues = await searchIssuesPaginated(requestJira, releasedVersionJql, featureLinkFieldId);
  }

  const issuesByKey = new Map();
  for (const issue of [...statusChangeIssues, ...releasedVersionIssues]) {
    issuesByKey.set(issue.key, issue);
  }
  return { issues: Array.from(issuesByKey.values()), releasedVersionsInWindow };
}

/**
 * Batch-fetches the summaries of the given Feature keys (one "key in (...)" search, no changelog).
 * Returns a Map key → summary; on ANY failure returns an empty map so grouping degrades to bare keys
 * rather than failing the run.
 */
async function fetchFeatureSummaries(requestJira, featureKeys) {
  if (featureKeys.length === 0) {
    return new Map();
  }
  try {
    const keyList = featureKeys.map((featureKey) => '"' + escapeJqlValue(featureKey) + '"').join(', ');
    const searchPath = '/rest/api/2/search?jql=' + encodeURIComponent('key in (' + keyList + ')')
      + '&fields=summary&maxResults=' + JIRA_SEARCH_PAGE_SIZE;
    const searchResult = await requestJira(searchPath);
    if (searchResult.status !== 200) {
      return new Map();
    }
    const summariesByKey = new Map();
    for (const featureIssue of (searchResult.body && searchResult.body.issues) || []) {
      summariesByKey.set(featureIssue.key, (featureIssue.fields && featureIssue.fields.summary) || '');
    }
    return summariesByKey;
  } catch (_summaryError) {
    return new Map();
  }
}

// ── Prompt builder (contracts/prompt-format.md) ──

/** The fixed agent-instruction block. Wording is tunable post-launch (spec A6); structure is not. */
const PROMPT_INSTRUCTIONS = [
  'You are reviewing one month of software delivery data for several agile teams.',
  '',
  'For EACH team below, provide a bulleted analysis answering:',
  '"What was accomplished? Provide a summary of the achievement focusing on what was',
  'delivered that benefited the business or major technical improvement."',
  '',
  'Rules:',
  '- One section per team, in the order given, each starting with the team name as a heading.',
  '- Bullets only — no paragraphs. Lead each bullet with the business benefit or technical',
  '  improvement, not the ticket number.',
  '- Use the Feature groupings to describe initiative-level accomplishments; roll individual',
  "  stories/tasks up into their Feature's story where possible.",
  '- Work under "Delivered to Production" is live; work under "Delivered to External Test" is',
  '  complete and in final verification — describe it as such, never as live.',
  '- A team marked "No recorded deliveries this month." gets exactly one bullet saying so.',
  '- A team marked "DATA UNAVAILABLE" gets exactly one bullet stating the data could not be',
  '  collected — do not guess at what the team did.',
].join('\n');

const PROMPT_BANNER_RULE = '════════════════════════════════════════';

/** Formats "YYYY-MM" as a human month label like "June 2026". */
function formatMonthLabel(coveredMonth) {
  const year = Number(coveredMonth.slice(0, 4));
  const monthIndex = Number(coveredMonth.slice(5, 7)) - 1;
  return new Date(year, monthIndex, 1).toLocaleString('en-US', { month: 'long' }) + ' ' + year;
}

/** Renders one Feature group's heading + issue lines for a bucket. */
function renderFeatureGroupLines(group, bucketPhrase) {
  const headingLine = group.featureKey === null
    ? 'No Feature:'
    : 'Feature ' + group.featureKey + ' — ' + (group.featureSummary || group.featureKey) + ':';
  const issueLines = group.records.map((record) =>
    '- ' + record.issueKey + ': ' + record.summary
    + ' (reached ' + bucketPhrase + ' ' + record.qualifyingDateIso.slice(0, DATE_ONLY_LENGTH) + ')');
  return [headingLine, ...issueLines];
}

/** Renders one team's section: buckets in fixed order, or the explicit empty / error line. */
function renderTeamSection(teamSection) {
  const sectionLines = ['=== Team: ' + teamSection.teamName + ' ===', ''];
  if (teamSection.status === 'error') {
    sectionLines.push('DATA UNAVAILABLE: ' + teamSection.message);
    return sectionLines;
  }
  const hasAnyRecords = teamSection.production.length > 0 || teamSection.externalTest.length > 0;
  if (!hasAnyRecords) {
    sectionLines.push('No recorded deliveries this month.');
    return sectionLines;
  }
  if (teamSection.production.length > 0) {
    sectionLines.push('-- Delivered to Production --');
    for (const group of teamSection.production) {
      sectionLines.push(...renderFeatureGroupLines(group, 'production'));
    }
    sectionLines.push('');
  }
  if (teamSection.externalTest.length > 0) {
    sectionLines.push('-- Delivered to External Test --');
    for (const group of teamSection.externalTest) {
      sectionLines.push(...renderFeatureGroupLines(group, 'external test'));
    }
  }
  return sectionLines;
}

/**
 * Renders the complete prompt artifact: agent instructions, the metadata banner, then every team's
 * data section in config order. Deterministic for identical input (snapshot-testable).
 */
function buildMonthlyDeliveryPrompt(runContext, teamSections) {
  const bannerLines = [
    PROMPT_BANNER_RULE,
    'MONTHLY DELIVERY DATA — ' + formatMonthLabel(runContext.coveredMonth)
      + ' (covered month: ' + runContext.coveredMonth + ')',
    'Generated: ' + runContext.ranAtIso + ' · Trigger: ' + runContext.trigger,
    PROMPT_BANNER_RULE,
  ];
  const teamBlocks = teamSections.map((teamSection) => renderTeamSection(teamSection).join('\n'));
  return [PROMPT_INSTRUCTIONS, '', bannerLines.join('\n'), '', teamBlocks.join('\n\n')].join('\n');
}

module.exports = {
  classifyIssueDelivery,
  buildDeliveryRecord,
  groupRecordsByFeature,
  selectReleasedVersionsInWindow,
  searchIssuesPaginated,
  fetchTeamDeliveryData,
  fetchFeatureSummaries,
  buildMonthlyDeliveryPrompt,
  PRODUCTION_BUCKET,
  EXTERNAL_TEST_BUCKET,
};
