// sprintDashboardIssueUtils.ts — Shared Sprint Dashboard issue classification helpers for parity-sensitive tabs.

import type { JiraIssue, JiraIssueLink } from '../../../types/jira.ts';

const MS_PER_DAY = 86_400_000;
const BLOCKED_STATUS_TOKENS = ['blocked', 'impeded', 'on hold'];
const BLOCK_LINK_TOKEN = 'block';
const LEGACY_STORY_POINTS_FIELD_ID = 'customfield_10016';
const DONE_STATUS_NAMES = ['done', 'closed', 'resolved', 'complete', 'accepted'];

function readCustomFieldValue(issue: JiraIssue, fieldId: string): unknown {
  return (issue.fields as Record<string, unknown>)[fieldId];
}

function parseNumericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsedNumber = Number(value);
    return Number.isFinite(parsedNumber) ? parsedNumber : null;
  }

  return null;
}

function readIssueLinks(issue: JiraIssue): JiraIssueLink[] {
  return issue.fields.issuelinks ?? [];
}

/** Returns the configured story-point estimate, falling back to the legacy Jira field when needed. */
export function readStoryPointsValue(issue: JiraIssue, customStoryPointsFieldId: string): number | null {
  const configuredValue = parseNumericValue(readCustomFieldValue(issue, customStoryPointsFieldId));
  if (configuredValue !== null) {
    return configuredValue;
  }

  return parseNumericValue(readCustomFieldValue(issue, LEGACY_STORY_POINTS_FIELD_ID));
}

/** Returns story points as a number so aggregate math can ignore null handling. */
export function readStoryPoints(issue: JiraIssue, customStoryPointsFieldId: string): number {
  return readStoryPointsValue(issue, customStoryPointsFieldId) ?? 0;
}

/** Calculates whole-day issue age from the last updated timestamp. */
export function calculateIssueAgeDays(updatedDateString: string): number {
  return Math.floor((Date.now() - new Date(updatedDateString).getTime()) / MS_PER_DAY);
}

/** Returns true when Jira issue links indicate this issue is blocked by another issue. */
export function hasBlockingLink(issue: JiraIssue): boolean {
  return readIssueLinks(issue).some((issueLink) => {
    const linkName = issueLink.type?.name?.toLowerCase() ?? '';
    return Boolean(issueLink.inwardIssue) && linkName.includes(BLOCK_LINK_TOKEN);
  });
}

/** Returns true when the current Jira status itself indicates the issue is blocked. */
export function isStatusBlockedIssue(issue: JiraIssue): boolean {
  const normalizedStatusName = issue.fields.status.name.toLowerCase();
  return BLOCKED_STATUS_TOKENS.some((blockedStatusToken) => normalizedStatusName.includes(blockedStatusToken));
}

/** Returns true when the issue is blocked either by status or by linked blocker relationship. */
export function isBlockedIssue(issue: JiraIssue): boolean {
  return isStatusBlockedIssue(issue) || hasBlockingLink(issue);
}

/** Returns true when the issue should be treated as completed in legacy dashboard logic. */
export function isDoneIssue(issue: JiraIssue): boolean {
  return issue.fields.status.statusCategory.key === 'done'
    || DONE_STATUS_NAMES.includes(issue.fields.status.name.toLowerCase());
}

/** Returns true when an in-progress issue has been stale for at least the configured number of days. */
export function isStaleIssue(issue: JiraIssue, staleDaysThreshold: number): boolean {
  return issue.fields.status.statusCategory.key === 'indeterminate'
    && calculateIssueAgeDays(issue.fields.updated) >= staleDaysThreshold;
}
