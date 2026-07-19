// hygieneRules.js — Server-side port of the client hygiene predicates.
//
// A plain-JS, dependency-free evaluation of the same 20 hygiene check functions
// defined in client/src/views/Hygiene/checks/hygieneChecks.ts. The inputs mirror
// what the Jira REST API returns; the outputs mirror HygieneFlag objects so the
// hygiene monitor scheduler can use the same check IDs the UI already displays.
//
// Rule: add logic here in lockstep with hygieneChecks.ts — never diverge.

'use strict';

// ── Constants ─────────────────────────────────────────────────────────────────

// Business days of no update before an in-progress issue is flagged stale. 5 = one work week, matching the
// app-wide default every client surface already uses (hygieneChecks' STALE_THRESHOLD_DAYS fallback, the ART /
// Sprint Dashboard stale-days default, the enterprise-rules copy). Keep in lockstep with that client default so
// the server hygiene monitor and the UI never disagree on what "stale" means. GH #167 aligned the client from
// 14 to 5; this brings the server monitor in line, now that both count business days rather than calendar days.
const STALE_THRESHOLD_DAYS = 5;
const OLD_IN_SPRINT_THRESHOLD_DAYS = 30;

const MODERN_STORY_POINTS_FIELD = 'customfield_10028';
const LEGACY_STORY_POINTS_FIELD = 'customfield_10016';
const SPRINT_FIELD = 'customfield_10020';

const FEATURE_LIKE_ISSUE_TYPES = new Set(['feature', 'epic']);
const STORY_LIKE_ISSUE_TYPES = new Set(['story', 'task', 'bug', 'defect', 'spike']);
const STORY_POINTS_UNSUPPORTED_TYPES = new Set(['risk']);

const DONE_STATUS_NAMES = new Set(['done', 'closed', 'resolved', 'complete']);
const IMPLEMENTING_STATUS_NAME = 'implementing';

// ── Helper functions ──────────────────────────────────────────────────────────

/**
 * Reads a field value from the Jira issue, handling the special 'parent' key.
 *
 * @param {object} issue - Jira REST API issue object.
 * @param {string} fieldId - Field ID or 'parent'.
 * @returns {*} The raw field value.
 */
function readIssueFieldValue(issue, fieldId) {
  if (fieldId === 'parent') {
    return issue.fields.parent;
  }
  return issue.fields[fieldId];
}

/**
 * Returns true when any field in the provided list has a meaningful (non-empty) value.
 *
 * @param {object} issue - Jira REST API issue object.
 * @param {string[]} fieldIds - Field ID list to check.
 * @returns {boolean}
 */
function hasMeaningfulValueForAnyField(issue, fieldIds) {
  return (fieldIds || []).some((fieldId) => hasMeaningfulValue(readIssueFieldValue(issue, fieldId)));
}

/**
 * Returns true when a Jira field value is non-empty, non-zero, and non-null.
 * Handles strings, numbers, booleans, arrays, and objects recursively.
 *
 * @param {*} fieldValue - Raw Jira field value.
 * @returns {boolean}
 */
function hasMeaningfulValue(fieldValue) {
  if (fieldValue === null || fieldValue === undefined) return false;
  if (typeof fieldValue === 'boolean') return fieldValue;
  if (typeof fieldValue === 'number') return fieldValue !== 0;
  if (typeof fieldValue === 'string') return fieldValue.trim().length > 0;
  if (Array.isArray(fieldValue)) return fieldValue.length > 0;
  if (typeof fieldValue === 'object') return Object.keys(fieldValue).length > 0;
  return false;
}

/**
 * Returns the integer number of days elapsed since the given ISO date string.
 *
 * @param {string} dateText - ISO date/datetime string.
 * @returns {number} Days elapsed (0 if the date is today).
 */
function calculateAgeInDays(dateText) {
  const parsedDate = new Date(dateText);
  if (Number.isNaN(parsedDate.getTime())) return 0;
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((Date.now() - parsedDate.getTime()) / msPerDay);
}

/**
 * Counts whole BUSINESS days (Mon–Fri, UTC) elapsed since the given ISO date — the staleness measure, so an
 * issue left over a weekend is not counted stale for those idle days. Mirrors `businessDaysElapsedSince` in
 * client/src/utils/businessDays.ts; keep the two in lockstep.
 *
 * @param {string} dateText - ISO date/datetime string.
 * @returns {number} Whole business days elapsed (0 for a missing/unparseable or future date).
 */
function businessDaysElapsedSince(dateText) {
  const fromMs = new Date(dateText).getTime();
  const nowMs = Date.now();
  if (Number.isNaN(fromMs) || fromMs >= nowMs) return 0;
  const msPerDay = 24 * 60 * 60 * 1000;
  const wholeDaysElapsed = Math.floor((nowMs - fromMs) / msPerDay);
  let businessDayCount = 0;
  const cursor = new Date(fromMs);
  for (let dayIndex = 0; dayIndex < wholeDaysElapsed; dayIndex += 1) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dayOfWeek = cursor.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) businessDayCount += 1;
  }
  return businessDayCount;
}

/**
 * Returns true when the date string represents today or a date in the past.
 *
 * @param {string} fieldValue - ISO date or datetime string.
 * @returns {boolean}
 */
function isDateTodayOrPast(fieldValue) {
  if (!fieldValue) return false;
  const parsedDate = new Date(String(fieldValue).split('T')[0]);
  const todayDate = new Date(new Date().toISOString().split('T')[0]);
  return parsedDate <= todayDate;
}

/**
 * Returns true when the story points field value is empty, zero, or a placeholder.
 *
 * @param {*} fieldValue - Raw story points field value.
 * @returns {boolean}
 */
function hasEmptyStoryPoints(fieldValue) {
  if (fieldValue === null || fieldValue === undefined) return true;
  if (typeof fieldValue === 'number') return fieldValue === 0;
  if (typeof fieldValue === 'string') return fieldValue.trim() === '' || fieldValue.trim() === '0';
  if (typeof fieldValue === 'object' && fieldValue.value !== undefined) {
    return hasEmptyStoryPoints(fieldValue.value);
  }
  return true;
}

/**
 * Returns true when the issue has an active sprint in its sprint field.
 *
 * @param {*} sprintValue - Raw sprint field value.
 * @returns {boolean}
 */
function hasActiveSprint(sprintValue) {
  if (!sprintValue) return false;
  const sprintArray = Array.isArray(sprintValue) ? sprintValue : [sprintValue];
  return sprintArray.some((sprint) => {
    if (typeof sprint === 'string') return sprint.includes('state=ACTIVE');
    if (typeof sprint === 'object' && sprint !== null) return sprint.state === 'ACTIVE';
    return false;
  });
}

/** Returns true when the issue is a Feature or Epic. */
function isFeatureLikeIssue(issue) {
  return FEATURE_LIKE_ISSUE_TYPES.has((issue.fields.issuetype?.name ?? '').toLowerCase());
}

/** Returns true when the issue is In Progress (by status name or category). */
function isInProgressIssue(issue) {
  const statusName = (issue.fields.status?.name ?? '').toLowerCase();
  const categoryKey = (issue.fields.status?.statusCategory?.key ?? '').toLowerCase();
  return statusName === 'in progress' || categoryKey === 'indeterminate';
}

/** Returns true when the issue is in a To Do state. */
function isTodoIssue(issue) {
  const statusName = (issue.fields.status?.name ?? '').toLowerCase();
  const categoryKey = (issue.fields.status?.statusCategory?.key ?? '').toLowerCase();
  return categoryKey === 'new' || statusName === 'to do';
}

/** Returns true when the issue status is "Implementing". */
function isImplementingIssue(issue) {
  return (issue.fields.status?.name ?? '').toLowerCase() === IMPLEMENTING_STATUS_NAME;
}

/** Returns true when the issue is in a Done state. */
function isDoneIssue(issue) {
  const statusName = (issue.fields.status?.name ?? '').toLowerCase();
  const categoryKey = (issue.fields.status?.statusCategory?.key ?? '').toLowerCase();
  return categoryKey === 'done' || DONE_STATUS_NAMES.has(statusName);
}

/** Returns true when the acceptance-criteria field text is a known placeholder. */
function isAcceptanceCriteriaPlaceholder(fieldText) {
  const normalizedText = (fieldText ?? '').trim().toLowerCase();
  return normalizedText === 'tbd' || normalizedText === 'to be determined';
}

// ── Individual check functions ────────────────────────────────────────────────

function checkMissingSummary(issue) {
  if (!hasMeaningfulValue(issue.fields.summary)) {
    return { checkId: 'missing-summary', label: 'Missing summary', severity: 'error' };
  }
  return null;
}

function checkMissingFeatureLink(issue, fieldConfig) {
  const issueLower = (issue.fields.issuetype?.name ?? '').toLowerCase();
  if (!STORY_LIKE_ISSUE_TYPES.has(issueLower)) return null;
  const configuredIds = fieldConfig.featureLinkFieldIds || [];
  if (configuredIds.length === 0) return null;
  if (hasMeaningfulValueForAnyField(issue, configuredIds)) return null;
  return { checkId: 'missing-feature-link', label: 'Missing feature link', severity: 'warn' };
}

function checkMissingParentLink(issue, fieldConfig) {
  if (!isFeatureLikeIssue(issue)) return null;
  const configuredIds = fieldConfig.parentLinkFieldIds || [];
  if (configuredIds.length === 0) return null;
  if (hasMeaningfulValueForAnyField(issue, configuredIds)) return null;
  return { checkId: 'missing-parent-link', label: 'Missing parent link', severity: 'warn' };
}

function checkMissingProductOwner(issue, fieldConfig) {
  if (!isFeatureLikeIssue(issue)) return null;
  const configuredIds = fieldConfig.productOwnerFieldIds || [];
  if (configuredIds.length === 0) return null;
  if (hasMeaningfulValueForAnyField(issue, configuredIds)) return null;
  return { checkId: 'missing-product-owner', label: 'Missing product owner', severity: 'warn' };
}

function checkMissingInitiativeType(issue, fieldConfig) {
  if (!isFeatureLikeIssue(issue)) return null;
  const configuredIds = fieldConfig.initiativeTypeFieldIds || [];
  if (configuredIds.length === 0) return null;
  if (hasMeaningfulValueForAnyField(issue, configuredIds)) return null;
  return { checkId: 'missing-initiative-type', label: 'Missing initiative type', severity: 'warn' };
}

function checkMissingProgramIncrement(issue, fieldConfig) {
  if (!isFeatureLikeIssue(issue)) return null;
  const configuredIds = fieldConfig.programIncrementFieldIds || [];
  if (configuredIds.length === 0) return null;
  if (hasMeaningfulValueForAnyField(issue, configuredIds)) return null;
  return { checkId: 'missing-pi', label: 'Missing Program Increment', severity: 'warn' };
}

function checkMissingTargetStart(issue, fieldConfig) {
  if (!isFeatureLikeIssue(issue)) return null;
  const configuredIds = fieldConfig.targetStartFieldIds || [];
  if (configuredIds.length === 0) return null;
  if (hasMeaningfulValueForAnyField(issue, configuredIds)) return null;
  return { checkId: 'missing-target-start', label: 'Missing target start date', severity: 'warn' };
}

function checkMissingTargetEnd(issue, fieldConfig) {
  if (!isFeatureLikeIssue(issue)) return null;
  const configuredIds = fieldConfig.targetEndFieldIds || [];
  if (configuredIds.length === 0) return null;
  if (hasMeaningfulValueForAnyField(issue, configuredIds)) return null;
  return { checkId: 'missing-target-end', label: 'Missing target end date', severity: 'warn' };
}

function checkMissingApplication(issue, fieldConfig) {
  if (!isFeatureLikeIssue(issue)) return null;
  const configuredIds = fieldConfig.applicationFieldIds || [];
  if (configuredIds.length === 0) return null;
  if (hasMeaningfulValueForAnyField(issue, configuredIds)) return null;
  return { checkId: 'missing-application', label: 'Missing application', severity: 'warn' };
}

function checkMissingFixVersion(issue) {
  if (!isFeatureLikeIssue(issue)) return null;
  const fixVersions = issue.fields.fixVersions ?? [];
  if (fixVersions.length > 0) return null;
  return { checkId: 'missing-fix-version', label: 'Missing fix version', severity: 'warn' };
}

function checkMissingDueDate(issue) {
  if (!isFeatureLikeIssue(issue)) return null;
  if (hasMeaningfulValue(issue.fields.duedate)) return null;
  return { checkId: 'missing-due-date', label: 'Missing due date', severity: 'warn' };
}

function checkTargetStartReady(issue, fieldConfig) {
  if (!isFeatureLikeIssue(issue) || !isTodoIssue(issue)) return null;
  const configuredIds = fieldConfig.targetStartFieldIds || [];
  const targetStartValue = configuredIds.length > 0
    ? readIssueFieldValue(issue, configuredIds[0])
    : null;
  if (!targetStartValue || !isDateTodayOrPast(targetStartValue)) return null;
  return { checkId: 'target-start-ready', label: 'Target start date reached — still To Do', severity: 'warn' };
}

function checkTargetEndOverdue(issue, fieldConfig) {
  if (!isFeatureLikeIssue(issue)) return null;
  if (!isTodoIssue(issue) && !isImplementingIssue(issue)) return null;
  const configuredIds = fieldConfig.targetEndFieldIds || [];
  const targetEndValue = configuredIds.length > 0
    ? readIssueFieldValue(issue, configuredIds[0])
    : null;
  if (!targetEndValue || !isDateTodayOrPast(targetEndValue)) return null;
  return { checkId: 'target-end-overdue', label: 'Target end date overdue', severity: 'error' };
}

function checkDueDateOverdue(issue) {
  if (!isFeatureLikeIssue(issue)) return null;
  if (isDoneIssue(issue)) return null;
  if (!isDateTodayOrPast(issue.fields.duedate)) return null;
  return { checkId: 'due-date-overdue', label: 'Due date overdue', severity: 'error' };
}

function checkMissingStoryPoints(issue) {
  const issueLower = (issue.fields.issuetype?.name ?? '').toLowerCase();
  if (!STORY_LIKE_ISSUE_TYPES.has(issueLower)) return null;
  if (STORY_POINTS_UNSUPPORTED_TYPES.has(issueLower)) return null;
  const modernValue = issue.fields[MODERN_STORY_POINTS_FIELD];
  const legacyValue = issue.fields[LEGACY_STORY_POINTS_FIELD];
  if (!hasEmptyStoryPoints(modernValue)) return null;
  if (!hasEmptyStoryPoints(legacyValue)) return null;
  return { checkId: 'missing-sp', label: 'Missing story points', severity: 'warn' };
}

function checkStaleIssue(issue) {
  if (!isInProgressIssue(issue)) return null;
  // Staleness is measured in BUSINESS days so a weekend never makes an issue stale; the threshold denotes
  // business days. Kept in lockstep with the client checkStaleIssue default.
  if (businessDaysElapsedSince(issue.fields.updated) < STALE_THRESHOLD_DAYS) return null;
  // Label derives from the constant so the wording can never drift from the threshold it describes.
  return { checkId: 'stale-issue', label: `Stale — no update in ${STALE_THRESHOLD_DAYS}+ business days`, severity: 'warn' };
}

function checkNoAssignee(issue) {
  if (isDoneIssue(issue)) return null;
  if (hasMeaningfulValue(issue.fields.assignee)) return null;
  return { checkId: 'no-assignee', label: 'No assignee', severity: 'warn' };
}

function checkNoAcceptanceCriteria(issue, fieldConfig) {
  const issueLower = (issue.fields.issuetype?.name ?? '').toLowerCase();
  const isTargetType = issueLower === 'story' || FEATURE_LIKE_ISSUE_TYPES.has(issueLower);
  if (!isTargetType) return null;
  const configuredIds = fieldConfig.acceptanceCriteriaFieldIds || [];
  // When no AC fields are configured for this project, the check cannot
  // evaluate — skip rather than false-flag every issue.
  if (configuredIds.length === 0) return null;
  const hasContent = configuredIds.some((fieldId) => {
    const rawValue = readIssueFieldValue(issue, fieldId);
    const textValue = typeof rawValue === 'string' ? rawValue : (rawValue?.content ? JSON.stringify(rawValue.content) : '');
    return textValue.trim().length > 0 && !isAcceptanceCriteriaPlaceholder(textValue);
  });
  if (hasContent) return null;
  return { checkId: 'no-ac', label: 'No acceptance criteria', severity: 'warn' };
}

function checkOldInSprint(issue) {
  const sprintValue = issue.fields[SPRINT_FIELD];
  if (!hasActiveSprint(sprintValue)) return null;
  if (isDoneIssue(issue)) return null;
  if (calculateAgeInDays(issue.fields.created) < OLD_IN_SPRINT_THRESHOLD_DAYS) return null;
  return { checkId: 'old-in-sprint', label: 'Old issue still in sprint', severity: 'warn' };
}

// ── Check missing child story points (Feature/Epic with no child stories) ────

function checkMissingChildStoryPoints(issue) {
  if (!isFeatureLikeIssue(issue)) return null;
  // The Jira REST API v2 does not directly embed subtasks with story points.
  // This check requires a separate subtask query, so it is deferred in the server-side
  // port (marked as a known gap — see T021 notes in tasks.md).
  return null;
}

// ── Ordered check pipeline ────────────────────────────────────────────────────

/** All registered checks, in evaluation order. */
const ALL_CHECKS = [
  checkMissingSummary,
  (issue, fc) => checkMissingFeatureLink(issue, fc),
  (issue, fc) => checkMissingParentLink(issue, fc),
  (issue, fc) => checkMissingProductOwner(issue, fc),
  (issue, fc) => checkMissingInitiativeType(issue, fc),
  (issue, fc) => checkMissingProgramIncrement(issue, fc),
  (issue, fc) => checkMissingTargetStart(issue, fc),
  (issue, fc) => checkMissingTargetEnd(issue, fc),
  (issue, fc) => checkMissingApplication(issue, fc),
  checkMissingFixVersion,
  checkMissingDueDate,
  (issue, fc) => checkTargetStartReady(issue, fc),
  (issue, fc) => checkTargetEndOverdue(issue, fc),
  checkDueDateOverdue,
  checkMissingChildStoryPoints,
  checkMissingStoryPoints,
  checkStaleIssue,
  checkNoAssignee,
  (issue, fc) => checkNoAcceptanceCriteria(issue, fc),
  checkOldInSprint,
];

/**
 * Evaluates all active hygiene rules against a single Jira issue and returns
 * the list of flags that fired. Returns an empty array when the issue is clean.
 *
 * @param {object} issue - Jira REST API issue object (fields.issuetype, fields.status, etc.).
 * @param {object} fieldConfig - Custom field ID configuration (mirrors HygieneFieldConfig).
 * @returns {Array<{ checkId: string, label: string, severity: 'warn' | 'error' }>}
 */
function evaluateHygieneRules(issue, fieldConfig) {
  const flags = [];
  for (const check of ALL_CHECKS) {
    const flag = check(issue, fieldConfig);
    if (flag !== null) {
      flags.push(flag);
    }
  }
  return flags;
}

module.exports = { evaluateHygieneRules };
