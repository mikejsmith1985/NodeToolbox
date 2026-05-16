// hygieneChecks.ts — Pure Jira issue health checks for the Hygiene view.
//
// The legacy Hygiene screen mixed Jira parsing, rule evaluation, and rendering in one
// browser file. This module keeps the rule predicates small and deterministic so the
// React hook can compose them and tests can prove each health signal independently.

import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';

const STALE_THRESHOLD_DAYS = 14;
const OLD_IN_SPRINT_THRESHOLD_DAYS = 30;
const ACCEPTANCE_CRITERIA_MINIMUM_LENGTH = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const MODERN_STORY_POINTS_FIELD = 'customfield_10028';
const LEGACY_STORY_POINTS_FIELD = 'customfield_10016';
const SPRINT_FIELD = 'customfield_10020';
const ACCEPTANCE_CRITERIA_PATTERN = /given|when|then|acceptance|criteria/i;

export type HygieneCheckId = 'missing-sp' | 'stale' | 'no-assignee' | 'no-ac' | 'old-in-sprint';
export type HygieneSeverity = 'warn' | 'error';

export interface HygieneFlag {
  checkId: HygieneCheckId;
  label: string;
  severity: HygieneSeverity;
}

export interface HygieneFinding {
  issue: JiraIssue;
  flags: HygieneFlag[];
}

export interface HygieneSummary {
  totalIssues: number;
  totalFlags: number;
  countByCheck: Record<HygieneCheckId, number>;
}

export interface JiraIssue {
  key: string;
  self?: string;
  fields: {
    summary?: string;
    status?: JiraStatus | null;
    assignee?: JiraAssignee | null;
    issuetype?: JiraIssueType | null;
    priority?: JiraPriority | null;
    created?: string;
    updated?: string;
    description?: unknown;
    customfield_10028?: unknown;
    customfield_10016?: unknown;
    customfield_10020?: unknown;
    [fieldId: string]: unknown;
  };
}

export interface JiraAssignee {
  displayName?: string;
}

export interface JiraIssueType {
  name?: string;
}

export interface JiraPriority {
  name?: string;
}

export interface JiraStatus {
  name?: string;
  statusCategory?: {
    key?: string;
    name?: string;
  } | null;
}

const HYGIENE_FLAGS: Record<HygieneCheckId, HygieneFlag> = {
  'missing-sp': { checkId: 'missing-sp', label: 'Missing SP', severity: 'warn' },
  stale: { checkId: 'stale', label: 'Stale', severity: 'warn' },
  'no-assignee': { checkId: 'no-assignee', label: 'No assignee', severity: 'error' },
  'no-ac': { checkId: 'no-ac', label: 'No AC', severity: 'warn' },
  'old-in-sprint': { checkId: 'old-in-sprint', label: 'Old in sprint', severity: 'warn' },
};

export const HYGIENE_CHECK_IDS: HygieneCheckId[] = [
  'missing-sp',
  'stale',
  'no-assignee',
  'no-ac',
  'old-in-sprint',
];

export const HYGIENE_CHECK_LABELS: Record<HygieneCheckId, string> = HYGIENE_CHECK_IDS.reduce(
  (labelLookup, checkId) => ({ ...labelLookup, [checkId]: HYGIENE_FLAGS[checkId].label }),
  {} as Record<HygieneCheckId, string>,
);

/** Flags Story and Task issues that have neither known Jira story-points field populated. */
export function checkMissingStoryPoints(issue: JiraIssue): HygieneFlag | null {
  const issueTypeName = readIssueTypeName(issue);
  const shouldCheckStoryPoints = issueTypeName === 'story' || issueTypeName === 'task';
  if (!shouldCheckStoryPoints) return null;

  const modernStoryPoints = issue.fields[MODERN_STORY_POINTS_FIELD];
  const legacyStoryPoints = issue.fields[LEGACY_STORY_POINTS_FIELD];
  return hasEmptyStoryPoints(modernStoryPoints) && hasEmptyStoryPoints(legacyStoryPoints)
    ? HYGIENE_FLAGS['missing-sp']
    : null;
}

/** Flags in-progress issues that have not been updated within the active-work threshold. */
export function checkStaleIssue(issue: JiraIssue): HygieneFlag | null {
  if (!isInProgressIssue(issue)) return null;
  return calculateAgeInDays(issue.fields.updated) > STALE_THRESHOLD_DAYS ? HYGIENE_FLAGS.stale : null;
}

/** Flags in-progress issues that are actively moving but have no accountable assignee. */
export function checkNoAssignee(issue: JiraIssue): HygieneFlag | null {
  const hasAssignee = issue.fields.assignee !== null && issue.fields.assignee !== undefined;
  return !hasAssignee && isInProgressIssue(issue) ? HYGIENE_FLAGS['no-assignee'] : null;
}

/** Flags stories whose description does not provide recognizable acceptance criteria. */
export function checkNoAcceptanceCriteria(issue: JiraIssue): HygieneFlag | null {
  if (readIssueTypeName(issue) !== 'story') return null;

  const descriptionText = readPlainTextDescription(issue.fields.description).trim();
  const hasUsefulAcceptanceCriteria = descriptionText.length >= ACCEPTANCE_CRITERIA_MINIMUM_LENGTH
    && ACCEPTANCE_CRITERIA_PATTERN.test(descriptionText);
  return hasUsefulAcceptanceCriteria ? null : HYGIENE_FLAGS['no-ac'];
}

/** Flags active-sprint issues that have been open long enough to deserve team review. */
export function checkOldInSprint(issue: JiraIssue): HygieneFlag | null {
  const isOldActiveSprintIssue = hasActiveSprint(issue.fields[SPRINT_FIELD])
    && !isDoneIssue(issue)
    && calculateAgeInDays(issue.fields.created) > OLD_IN_SPRINT_THRESHOLD_DAYS;
  return isOldActiveSprintIssue ? HYGIENE_FLAGS['old-in-sprint'] : null;
}

/** Runs every Hygiene predicate and returns only the flags that apply to the issue. */
export function evaluateHygieneIssue(issue: JiraIssue): HygieneFlag[] {
  return [
    checkMissingStoryPoints(issue),
    checkStaleIssue(issue),
    checkNoAssignee(issue),
    checkNoAcceptanceCriteria(issue),
    checkOldInSprint(issue),
  ].filter((flag): flag is HygieneFlag => flag !== null);
}

/** Aggregates per-issue findings into the summary tiles shown at the top of the view. */
export function summarizeHygieneFindings(findings: HygieneFinding[]): HygieneSummary {
  const countByCheck = createEmptyCheckCounts();
  let totalFlags = 0;

  findings.forEach((finding) => {
    finding.flags.forEach((flag) => {
      countByCheck[flag.checkId] += 1;
      totalFlags += 1;
    });
  });

  return {
    totalIssues: findings.filter((finding) => finding.flags.length > 0).length,
    totalFlags,
    countByCheck,
  };
}

function createEmptyCheckCounts(): Record<HygieneCheckId, number> {
  return HYGIENE_CHECK_IDS.reduce(
    (countLookup, checkId) => ({ ...countLookup, [checkId]: 0 }),
    {} as Record<HygieneCheckId, number>,
  );
}

function readIssueTypeName(issue: JiraIssue): string {
  return issue.fields.issuetype?.name?.toLowerCase() ?? '';
}

function isInProgressIssue(issue: JiraIssue): boolean {
  const statusName = issue.fields.status?.name?.toLowerCase() ?? '';
  const statusCategoryKey = issue.fields.status?.statusCategory?.key?.toLowerCase() ?? '';
  return statusName === 'in progress' || statusCategoryKey === 'indeterminate';
}

function isDoneIssue(issue: JiraIssue): boolean {
  const statusName = issue.fields.status?.name?.toLowerCase() ?? '';
  const statusCategoryKey = issue.fields.status?.statusCategory?.key?.toLowerCase() ?? '';
  return statusCategoryKey === 'done' || ['done', 'closed', 'resolved', 'complete'].includes(statusName);
}

function hasEmptyStoryPoints(fieldValue: unknown): boolean {
  if (fieldValue === null || fieldValue === undefined || fieldValue === '') return true;
  if (typeof fieldValue === 'number') return fieldValue <= 0;
  if (Array.isArray(fieldValue)) return fieldValue.length === 0;
  return false;
}

function calculateAgeInDays(dateText: string | undefined): number {
  if (!dateText) return 0;
  const timestamp = new Date(dateText).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.floor((Date.now() - timestamp) / MILLISECONDS_PER_DAY);
}

function hasActiveSprint(sprintValue: unknown): boolean {
  const sprintEntries = Array.isArray(sprintValue) ? sprintValue : [sprintValue];
  return sprintEntries.some((sprintEntry) => isActiveSprintEntry(sprintEntry));
}

function isActiveSprintEntry(sprintEntry: unknown): boolean {
  if (typeof sprintEntry === 'string') return /state=ACTIVE|state=active/i.test(sprintEntry);
  if (!isRecord(sprintEntry)) return false;
  const sprintState = typeof sprintEntry.state === 'string' ? sprintEntry.state.toLowerCase() : '';
  return sprintState === 'active';
}

function readPlainTextDescription(descriptionValue: unknown): string {
  return normalizeRichTextToPlainText(descriptionValue);
}

function isRecord(candidateValue: unknown): candidateValue is Record<string, unknown> {
  return typeof candidateValue === 'object' && candidateValue !== null;
}
