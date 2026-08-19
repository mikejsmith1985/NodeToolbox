// hygieneChecks.ts — Pure Jira issue health checks for the Hygiene view.
//
// The Hygiene screen evaluates issue health from Jira data only. This module keeps the
// rule predicates small and deterministic so the state hook can compose them and tests
// can prove each default hygiene signal independently.

import { businessDaysElapsedSince } from '../../../utils/businessDays.ts';
import { isOnOrBeforeToday } from '../../../utils/calendarDate.ts';
import { deriveIssueDates } from './issueDateRules.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';
import type { EnterpriseRequiredFieldRule } from '../../AdminHub/enterpriseRules.ts';

// Fallback only — every live surface passes the team's configured staleDaysThreshold (dashboard
// default 5). The threshold now counts BUSINESS days (weekends never make an issue stale). Keeping
// this aligned with that default means a caller that forgets the argument cannot quietly apply a
// different staleness rule than every other surface (GH #167).
const STALE_THRESHOLD_DAYS = 5;
const OLD_IN_SPRINT_THRESHOLD_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const MODERN_STORY_POINTS_FIELD = 'customfield_10028';
const LEGACY_STORY_POINTS_FIELD = 'customfield_10016';
const SPRINT_FIELD = 'customfield_10020';
const FEATURE_ISSUE_TYPE_NAMES = new Set(['feature', 'epic']);

/**
 * The delivery work items — the things a team commits to and ships.
 *
 * One set, asked two questions: "should this carry a release fix version?" and "should this warn
 * when its due date passes?" They are the same question about the same population, and keeping two
 * lists is how they would eventually disagree about, say, Spikes. Sub-tasks are deliberately out:
 * they inherit the dates on their parent, so warning about both is warning twice. "Defect" is this
 * instance's defect type (not "Bug"). "Epic" is out because this instance's hierarchy tops out at
 * Feature, and naming a non-existent issue type makes the generated Jira JQL error (GH #200).
 *
 * If these two rules ever genuinely need to differ, split the set — deliberately, in one edit.
 */
const DELIVERY_ISSUE_TYPE_NAMES = new Set(['story', 'task', 'defect', 'feature']);

/**
 * Status names that mean the Feature has reached testing or later.
 *
 * Article VII note: `workflowDelivery.ts` answers a neighbouring question and was checked first,
 * but it encodes the STORY workflow (Ready for Testing → Ready for QA → Ready to Accept). The
 * Feature workflow this rule polices is a different vocabulary that tops out at Integrated Test, so
 * the two cannot share a predicate without one of them lying. The overlap below is intentional:
 * a Feature that somehow carries a story-workflow status has still reached testing.
 */
const FEATURE_TESTING_REACHED_STATUS_KEYWORDS = ['test', 'ready for qa', 'ready to accept'];
// The delivery work items expected to carry a release fix version (GH #200). Exported so the Jira-link JQL clause
// (US2) reuses the SAME list — the count and the "open in Jira" search can never disagree on scope. "Defect" is this
// instance's defect type (not "Bug"); Sub-tasks are excluded because they inherit their parent's release. "Epic" is
// excluded because this instance's hierarchy tops out at Feature — including a non-existent issue type makes the
// generated Jira JQL error out (GH #200 follow-up).
export const FIX_VERSION_ISSUE_TYPE_NAMES = DELIVERY_ISSUE_TYPE_NAMES;
const FEATURE_LINK_REQUIRED_ISSUE_TYPE_NAMES = new Set(['story', 'task', 'bug', 'defect', 'spike']);
// Issue types that do not have a story-points field on their Jira screen; the missing-sp check must skip them.
const STORY_POINTS_UNSUPPORTED_ISSUE_TYPE_NAMES = new Set(['risk']);
const ACCEPTANCE_CRITERIA_PLACEHOLDER_VALUES = new Set(['tbd', 'to be determined']);

export type BuiltInHygieneCheckId =
  | 'missing-summary'
  | 'missing-feature-link'
  | 'missing-parent-link'
  | 'missing-product-owner'
  | 'missing-initiative-type'
  | 'missing-pi'
  | 'missing-target-start'
  | 'missing-target-end'
  | 'missing-application'
  | 'missing-fix-version'
  | 'missing-due-date'
  | 'target-start-ready'
  | 'target-end-overdue'
  | 'due-date-overdue'
  | 'dates-out-of-sync'
  | 'missing-child-story-points'
  | 'missing-sp'
  | 'stale'
  | 'no-assignee'
  | 'no-ac'
  | 'old-in-sprint';
export type HygieneCheckId = BuiltInHygieneCheckId | `custom-${string}`;
export type HygieneSeverity = 'warn' | 'error';

export interface HygieneFlag {
  checkId: HygieneCheckId;
  label: string;
  severity: HygieneSeverity;
}

export interface HygieneFieldConfig {
  acceptanceCriteriaFieldIds: string[];
  applicationFieldIds: string[];
  featureLinkFieldIds: string[];
  initiativeTypeFieldIds: string[];
  parentLinkFieldIds: string[];
  productOwnerFieldIds: string[];
  programIncrementFieldIds: string[];
  targetEndFieldIds: string[];
  targetStartFieldIds: string[];
  /**
   * Feature "Estimate (NF)" size field — configured-only; backs the 021 Readiness estimate alert.
   * Optional so pre-021 config literals stay valid; resolveHygieneFieldConfig always returns [].
   */
  estimateFieldIds?: string[];
  /** Spark ID / PCode field — configured-only; backs the 021 Readiness PCode alert (see above). */
  pcodeFieldIds?: string[];
  /**
   * Sub-status field — configured-only. The Roll-Up Board maps its columns to a status + sub-status
   * pair; an empty list means this instance has no such field, so columns degrade to status alone and
   * the board says so rather than pretending to a precision it cannot deliver.
   */
  subStatusFieldIds?: string[];
  /** Jira's impediment "Flagged" field — configured-only; backs the Roll-Up Board's flagged indicator. */
  flaggedFieldIds?: string[];
}

export interface HygieneEvaluationContext {
  featureKeysWithPointedStories?: ReadonlySet<string>;
  fieldConfig?: Partial<HygieneFieldConfig>;
  enabledBuiltInCheckIds?: ReadonlySet<string>;
  customRules?: readonly EnterpriseRequiredFieldRule[];
  /** Jira custom field ID configured in Settings for story points (e.g. customfield_10236). */
  customStoryPointsFieldId?: string;
  /**
   * Days an in-progress issue may sit without an update before it is stale. Sourced from the
   * Sprint Dashboard's configured threshold so the Hygiene tab and the Blockers tab agree on
   * what counts as stale. Falls back to STALE_THRESHOLD_DAYS when the caller omits it.
   */
  staleDaysThreshold?: number;
}

export interface HygieneFinding {
  issue: JiraIssue;
  flags: HygieneFlag[];
  programIncrement?: string | null;
}

export interface HygieneSummary {
  totalIssues: number;
  totalFlags: number;
  countByCheck: Record<string, number>;
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
    duedate?: string | null;
    /** Release date and released flag included: the date policy derives every date from them. */
    fixVersions?: Array<{ name?: string; releaseDate?: string; released?: boolean }> | null;
    parent?: { key?: string } | null;
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

const DEFAULT_HYGIENE_FIELD_CONFIG: HygieneFieldConfig = {
  acceptanceCriteriaFieldIds: ['customfield_10200', 'description'],
  applicationFieldIds: [],
  featureLinkFieldIds: ['customfield_10108', 'customfield_10014'],
  initiativeTypeFieldIds: [],
  parentLinkFieldIds: ['parent', 'customfield_10100'],
  productOwnerFieldIds: [],
  programIncrementFieldIds: ['customfield_10301'],
  targetEndFieldIds: ['customfield_10102'],
  targetStartFieldIds: ['customfield_10101'],
  estimateFieldIds: [],
  pcodeFieldIds: [],
  subStatusFieldIds: [],
  flaggedFieldIds: [],
};

const BUILT_IN_HYGIENE_FLAGS: Record<BuiltInHygieneCheckId, HygieneFlag> = {
  'missing-summary': { checkId: 'missing-summary', label: 'Missing Feature Name / Summary', severity: 'error' },
  'missing-feature-link': { checkId: 'missing-feature-link', label: 'Missing Feature Link', severity: 'error' },
  'missing-parent-link': { checkId: 'missing-parent-link', label: 'Missing Parent Link', severity: 'warn' },
  'missing-product-owner': { checkId: 'missing-product-owner', label: 'Missing Product Owner', severity: 'warn' },
  'missing-initiative-type': { checkId: 'missing-initiative-type', label: 'Missing Initiative Type', severity: 'warn' },
  'missing-pi': { checkId: 'missing-pi', label: 'Missing PI', severity: 'warn' },
  'missing-target-start': { checkId: 'missing-target-start', label: 'Missing Target Start', severity: 'warn' },
  'missing-target-end': { checkId: 'missing-target-end', label: 'Missing Target End', severity: 'warn' },
  'missing-application': { checkId: 'missing-application', label: 'Missing Application', severity: 'warn' },
  'missing-fix-version': { checkId: 'missing-fix-version', label: 'Missing Fix Version', severity: 'warn' },
  'missing-due-date': { checkId: 'missing-due-date', label: 'Missing Due Date', severity: 'warn' },
  'target-start-ready': { checkId: 'target-start-ready', label: 'Target Start reached while still To Do', severity: 'warn' },
  'target-end-overdue': { checkId: 'target-end-overdue', label: 'Target End reached before testing transition', severity: 'warn' },
  'due-date-overdue': { checkId: 'due-date-overdue', label: 'Due Date reached before completion', severity: 'warn' },
  'dates-out-of-sync': { checkId: 'dates-out-of-sync', label: 'Dates do not match the fix version', severity: 'warn' },
  'missing-child-story-points': { checkId: 'missing-child-story-points', label: 'Missing Pointed Child Story', severity: 'warn' },
  'missing-sp': { checkId: 'missing-sp', label: 'Missing SP', severity: 'warn' },
  stale: { checkId: 'stale', label: 'Stale', severity: 'warn' },
  'no-assignee': { checkId: 'no-assignee', label: 'No assignee', severity: 'error' },
  'no-ac': { checkId: 'no-ac', label: 'Missing AC', severity: 'warn' },
  'old-in-sprint': { checkId: 'old-in-sprint', label: 'Old in sprint', severity: 'warn' },
};

export const HYGIENE_CHECK_IDS: BuiltInHygieneCheckId[] = [
  'missing-feature-link',
  'missing-parent-link',
  'missing-product-owner',
  'missing-initiative-type',
  'missing-pi',
  'missing-target-start',
  'missing-target-end',
  'missing-application',
  'missing-fix-version',
  'missing-due-date',
  'target-start-ready',
  'target-end-overdue',
  'due-date-overdue',
  'dates-out-of-sync',
  'missing-child-story-points',
  'missing-summary',
  'no-assignee',
  'no-ac',
  'missing-sp',
  'stale',
  'old-in-sprint',
];

export const HYGIENE_CHECK_LABELS: Record<string, string> = HYGIENE_CHECK_IDS.reduce(
  (labelLookup, checkId) => ({ ...labelLookup, [checkId]: BUILT_IN_HYGIENE_FLAGS[checkId].label }),
  {} as Record<string, string>,
);

/** Flags issues that are missing the Jira summary users rely on as the feature name. */
export function checkMissingSummary(issue: JiraIssue): HygieneFlag | null {
  return issue.fields.summary?.trim() ? null : BUILT_IN_HYGIENE_FLAGS['missing-summary'];
}

/** Flags delivery issues that are missing the feature link required for roll-up and planning. */
export function checkMissingFeatureLink(issue: JiraIssue, fieldConfig: HygieneFieldConfig): HygieneFlag | null {
  if (!FEATURE_LINK_REQUIRED_ISSUE_TYPE_NAMES.has(readIssueTypeName(issue))) {
    return null;
  }

  return hasMeaningfulValueForAnyField(issue, fieldConfig.featureLinkFieldIds) ? null : BUILT_IN_HYGIENE_FLAGS['missing-feature-link'];
}

/** Flags feature issues that are missing the parent link required by the enterprise workflow. */
export function checkMissingParentLink(issue: JiraIssue, fieldConfig: HygieneFieldConfig): HygieneFlag | null {
  if (!isFeatureLikeIssue(issue)) {
    return null;
  }

  return hasMeaningfulValueForAnyField(issue, fieldConfig.parentLinkFieldIds) ? null : BUILT_IN_HYGIENE_FLAGS['missing-parent-link'];
}

/** Flags feature issues that are missing an accountable product owner value. */
export function checkMissingProductOwner(issue: JiraIssue, fieldConfig: HygieneFieldConfig): HygieneFlag | null {
  if (!isFeatureLikeIssue(issue) || fieldConfig.productOwnerFieldIds.length === 0) {
    return null;
  }

  return hasMeaningfulValueForAnyField(issue, fieldConfig.productOwnerFieldIds) ? null : BUILT_IN_HYGIENE_FLAGS['missing-product-owner'];
}

/** Flags feature issues that are missing the initiative type required by the workflow. */
export function checkMissingInitiativeType(issue: JiraIssue, fieldConfig: HygieneFieldConfig): HygieneFlag | null {
  if (!isFeatureLikeIssue(issue) || fieldConfig.initiativeTypeFieldIds.length === 0) {
    return null;
  }

  return hasMeaningfulValueForAnyField(issue, fieldConfig.initiativeTypeFieldIds)
    ? null
    : BUILT_IN_HYGIENE_FLAGS['missing-initiative-type'];
}

/** Flags feature issues that are missing their Program Increment assignment. */
export function checkMissingProgramIncrement(issue: JiraIssue, fieldConfig: HygieneFieldConfig): HygieneFlag | null {
  if (!isFeatureLikeIssue(issue)) {
    return null;
  }

  return hasMeaningfulValueForAnyField(issue, fieldConfig.programIncrementFieldIds) ? null : BUILT_IN_HYGIENE_FLAGS['missing-pi'];
}

/**
 * Flags delivery work items missing their target start date.
 *
 * Widened from Feature/Epic to every delivery type. The narrow gate was a blind spot rather than a
 * policy: a board of Stories and Defects reported zero missing target dates because nothing was
 * asking, which read as clean rather than unexamined.
 */
export function checkMissingTargetStart(issue: JiraIssue, fieldConfig: HygieneFieldConfig): HygieneFlag | null {
  if (!carriesDeliveryDates(issue)) {
    return null;
  }

  return hasMeaningfulValueForAnyField(issue, fieldConfig.targetStartFieldIds)
    ? null
    : BUILT_IN_HYGIENE_FLAGS['missing-target-start'];
}

/** Flags delivery work items missing their target end date (see checkMissingTargetStart). */
export function checkMissingTargetEnd(issue: JiraIssue, fieldConfig: HygieneFieldConfig): HygieneFlag | null {
  if (!carriesDeliveryDates(issue)) {
    return null;
  }

  return hasMeaningfulValueForAnyField(issue, fieldConfig.targetEndFieldIds) ? null : BUILT_IN_HYGIENE_FLAGS['missing-target-end'];
}

/** Flags feature issues that are missing their application / CMDB identifier. */
export function checkMissingApplication(issue: JiraIssue, fieldConfig: HygieneFieldConfig): HygieneFlag | null {
  if (!isFeatureLikeIssue(issue) || fieldConfig.applicationFieldIds.length === 0) {
    return null;
  }

  return hasMeaningfulValueForAnyField(issue, fieldConfig.applicationFieldIds) ? null : BUILT_IN_HYGIENE_FLAGS['missing-application'];
}

/** Flags delivery issues (Story/Task/Defect/Feature/Epic) that are missing the release fix version (GH #200). */
export function checkMissingFixVersion(issue: JiraIssue): HygieneFlag | null {
  if (!carriesFixVersion(issue)) {
    return null;
  }

  return issue.fields.fixVersions?.length ? null : BUILT_IN_HYGIENE_FLAGS['missing-fix-version'];
}

/**
 * Flags delivery work items missing their committed due date.
 *
 * Previously Feature-only, deliberately, to avoid burying the signal. That reasoning no longer
 * holds: the due date is now DERIVED from the fix version, so a missing one is both detectable and
 * fixable in one action rather than a hundred manual edits.
 */
export function checkMissingDueDate(issue: JiraIssue): HygieneFlag | null {
  if (!carriesDeliveryDates(issue)) {
    return null;
  }

  return hasMeaningfulValue(issue.fields.duedate) ? null : BUILT_IN_HYGIENE_FLAGS['missing-due-date'];
}

/**
 * True for the issue types the date policy governs.
 *
 * The same delivery set that carries a fix version, because the fix version is what the dates are
 * derived FROM — a type without one cannot be dated by this policy and must not be asked for dates.
 */
export function carriesDeliveryDates(issue: JiraIssue): boolean {
  return DELIVERY_ISSUE_TYPE_NAMES.has(readIssueTypeName(issue))
    || FEATURE_ISSUE_TYPE_NAMES.has(readIssueTypeName(issue));
}

/**
 * Flags an issue whose dates disagree with the release it is committed to.
 *
 * Only the dates the policy can actually derive are compared: an issue with no dated, unreleased fix
 * version says nothing here, because "we cannot tell" is not "it is wrong". Target Start is not
 * compared — deriving it needs the changelog, which the scan does not fetch; the fix reads it for
 * the issues that need it.
 */
export function checkDatesOutOfSync(issue: JiraIssue, fieldConfig: HygieneFieldConfig): HygieneFlag | null {
  if (!carriesDeliveryDates(issue) || isDoneIssue(issue)) {
    return null;
  }

  const derived = deriveIssueDates({
    fixVersions: issue.fields.fixVersions ?? [],
    readyToWorkEnteredIso: null,
    currentDueDate: readDateFieldText(issue.fields.duedate),
    currentTargetEnd: readDateFieldText(readFirstConfiguredFieldValue(issue, fieldConfig.targetEndFieldIds)),
    // Not derivable without the changelog, so it is passed as already-agreeing and never mismatches.
    currentTargetStart: null,
  });

  return derived.mismatchedFieldNames.length > 0 ? BUILT_IN_HYGIENE_FLAGS['dates-out-of-sync'] : null;
}

/** Reads a possibly-object Jira field value as its date text, or null. */
function readDateFieldText(fieldValue: unknown): string | null {
  return typeof fieldValue === 'string' && fieldValue.trim() !== '' ? fieldValue.trim() : null;
}

/** Flags features that should have started implementation because Target Start has arrived. */
export function checkTargetStartReady(issue: JiraIssue, fieldConfig: HygieneFieldConfig): HygieneFlag | null {
  if (!isFeatureLikeIssue(issue) || !isTodoIssue(issue)) {
    return null;
  }

  const targetStartValue = readFirstConfiguredFieldValue(issue, fieldConfig.targetStartFieldIds);
  return isDateTodayOrPast(targetStartValue) ? BUILT_IN_HYGIENE_FLAGS['target-start-ready'] : null;
}

/**
 * Flags features whose Target End has arrived while they have still not reached testing.
 *
 * This used to be an allowlist of exactly two states: the To Do category, or the literal status
 * name "Implementing". Every other status fell through silently — so a Feature sitting in
 * "In Progress" or "Blocked", months past its Target End, produced no warning at all. The rule's
 * own remedy has always been "move it to Integrated Test or update Target End", which is a
 * statement about what the Feature has NOT reached; it now asks that question directly.
 */
export function checkTargetEndOverdue(issue: JiraIssue, fieldConfig: HygieneFieldConfig): HygieneFlag | null {
  if (!isFeatureLikeIssue(issue) || hasReachedFeatureTesting(issue)) {
    return null;
  }

  const targetEndValue = readFirstConfiguredFieldValue(issue, fieldConfig.targetEndFieldIds);
  return isDateTodayOrPast(targetEndValue) ? BUILT_IN_HYGIENE_FLAGS['target-end-overdue'] : null;
}

/** Flags any delivery work item whose Due Date has arrived before it reached a done state. */
export function checkDueDateOverdue(issue: JiraIssue): HygieneFlag | null {
  if (!carriesOwnDueDate(issue) || isDoneIssue(issue)) {
    return null;
  }

  return isDateTodayOrPast(issue.fields.duedate) ? BUILT_IN_HYGIENE_FLAGS['due-date-overdue'] : null;
}

/** Flags feature issues that have no child Story with positive story points. */
export function checkMissingChildStoryPoints(
  issue: JiraIssue,
  featureKeysWithPointedStories: ReadonlySet<string>,
): HygieneFlag | null {
  if (!isFeatureLikeIssue(issue)) {
    return null;
  }

  return featureKeysWithPointedStories.has(issue.key) ? null : BUILT_IN_HYGIENE_FLAGS['missing-child-story-points'];
}

/**
 * Flags Story and Task issues that are missing story points.
 * When the team has configured a real Jira custom field (starts with "customfield_"), ONLY that
 * field is checked — matching the pointing queue's source-of-truth logic so both surfaces agree
 * on which issues are genuinely unpointed. Without a real custom field, the check falls back to
 * the modern and legacy built-in fields.
 */
export function checkMissingStoryPoints(issue: JiraIssue, customStoryPointsFieldId?: string): HygieneFlag | null {
  const issueTypeName = readIssueTypeName(issue);
  // Skip issue types that do not have a story-points field on their Jira screen at all.
  if (STORY_POINTS_UNSUPPORTED_ISSUE_TYPE_NAMES.has(issueTypeName)) return null;
  const shouldCheckStoryPoints = issueTypeName === 'story' || issueTypeName === 'task';
  if (!shouldCheckStoryPoints) return null;

  // When a real Jira custom field is configured, treat it as the authoritative source.
  const isRealCustomField = customStoryPointsFieldId?.startsWith('customfield_') ?? false;
  if (isRealCustomField && customStoryPointsFieldId) {
    const configuredValue = issue.fields[customStoryPointsFieldId];
    return hasEmptyStoryPoints(configuredValue) ? BUILT_IN_HYGIENE_FLAGS['missing-sp'] : null;
  }

  // Fallback: no real custom field configured — check both built-in fields.
  const modernStoryPoints = issue.fields[MODERN_STORY_POINTS_FIELD];
  const legacyStoryPoints = issue.fields[LEGACY_STORY_POINTS_FIELD];
  return hasEmptyStoryPoints(modernStoryPoints) && hasEmptyStoryPoints(legacyStoryPoints)
    ? BUILT_IN_HYGIENE_FLAGS['missing-sp']
    : null;
}

/**
 * Flags in-progress issues that have not been updated within the active-work threshold. Staleness is measured
 * in BUSINESS days (Mon–Fri) so an issue left over a weekend is not counted as stale for those idle days; the
 * threshold therefore denotes business days. The threshold is configurable so this matches the Blockers tab's
 * stale rule exactly; the comparison is inclusive (>=) so an issue that hits the threshold on the dot is
 * flagged, mirroring sprintDashboardIssueUtils.isStaleIssue.
 */
export function checkStaleIssue(issue: JiraIssue, staleDaysThreshold: number = STALE_THRESHOLD_DAYS): HygieneFlag | null {
  if (!isInProgressIssue(issue)) return null;
  return businessDaysElapsedSince(issue.fields.updated) >= staleDaysThreshold ? BUILT_IN_HYGIENE_FLAGS.stale : null;
}

/**
 * Flags IN-PROGRESS issues that still have no accountable assignee — active work nobody owns.
 * To Do items are intentionally excluded: an un-started backlog item having no owner yet is not a
 * hygiene problem, and flagging it produced noise (a To Do card appearing in the unassigned report).
 */
export function checkNoAssignee(issue: JiraIssue): HygieneFlag | null {
  const hasAssignee = issue.fields.assignee !== null && issue.fields.assignee !== undefined;
  return !hasAssignee && isInProgressIssue(issue) ? BUILT_IN_HYGIENE_FLAGS['no-assignee'] : null;
}

/** Flags stories and features whose acceptance criteria field is blank or only contains a placeholder. */
export function checkNoAcceptanceCriteria(issue: JiraIssue, fieldConfig: HygieneFieldConfig): HygieneFlag | null {
  const issueTypeName = readIssueTypeName(issue);
  if (issueTypeName !== 'story' && !isFeatureLikeIssue(issue)) {
    return null;
  }

  const acceptanceCriteriaTexts = fieldConfig.acceptanceCriteriaFieldIds
    .map((fieldId) => readIssueFieldText(issue, fieldId))
    .filter((fieldText) => fieldText !== '');
  if (acceptanceCriteriaTexts.length === 0) {
    return BUILT_IN_HYGIENE_FLAGS['no-ac'];
  }

  const hasRealAcceptanceCriteria = acceptanceCriteriaTexts.some((fieldText) => !isAcceptanceCriteriaPlaceholder(fieldText));
  return hasRealAcceptanceCriteria ? null : BUILT_IN_HYGIENE_FLAGS['no-ac'];
}

/** Flags active-sprint issues that have been open long enough to deserve team review. */
export function checkOldInSprint(issue: JiraIssue): HygieneFlag | null {
  const isOldActiveSprintIssue = hasActiveSprint(issue.fields[SPRINT_FIELD])
    && !isDoneIssue(issue)
    && calculateAgeInDays(issue.fields.created) > OLD_IN_SPRINT_THRESHOLD_DAYS;
  return isOldActiveSprintIssue ? BUILT_IN_HYGIENE_FLAGS['old-in-sprint'] : null;
}

/** Identifies the feature-like Jira issue types that the enterprise rule set applies to. */
export function isFeatureLikeIssue(issue: JiraIssue): boolean {
  return FEATURE_ISSUE_TYPE_NAMES.has(readIssueTypeName(issue));
}

/** True for the delivery issue types expected to carry a release fix version (see DELIVERY_ISSUE_TYPE_NAMES). */
export function carriesFixVersion(issue: JiraIssue): boolean {
  return DELIVERY_ISSUE_TYPE_NAMES.has(readIssueTypeName(issue));
}

/**
 * True for the issue types whose own due date is a commitment worth warning about.
 *
 * Deliberately WIDER than `isFeatureLikeIssue`, which this check used to be gated to. A Story two
 * weeks past its due date is exactly the thing a Scrum Master needs to see on a Monday morning, and
 * gating to Feature/Epic meant the Today card and the Hygiene tab both reported zero beside a board
 * full of them.
 *
 * The union is a STRICT superset of the old behaviour — Epic is carried over from the feature-like
 * set even though it is absent from the delivery set (where it is excluded for a JQL reason of its
 * own). Broadening a warning must never quietly stop warning about something it used to catch.
 */
export function carriesOwnDueDate(issue: JiraIssue): boolean {
  const issueTypeName = readIssueTypeName(issue);
  return DELIVERY_ISSUE_TYPE_NAMES.has(issueTypeName) || FEATURE_ISSUE_TYPE_NAMES.has(issueTypeName);
}

/** Reads the configured field config with defaults applied so checks can stay deterministic. */
/**
 * Merges a caller's configured field ids with the built-in defaults, configured ids FIRST.
 *
 * Order carries meaning. Every hygiene check asks "does ANY of these fields have a value?", so order
 * cannot change whether an issue is flagged. But the direct-fix controls write to the FIRST id in the
 * list — so if a default led, an admin could configure their team's Program Increment field and watch
 * fixes populate the built-in default instead, leaving the field they actually use empty.
 *
 * The default is kept as a fallback rather than dropped: an instance may hold the value in either, and a
 * check should still find it.
 */
function buildFieldIdsPreferringConfigured(
  configuredFieldIds: readonly string[] | undefined,
  defaultFieldIds: readonly string[],
): string[] {
  return buildUniqueFieldIds([...(configuredFieldIds ?? []), ...defaultFieldIds]);
}

export function resolveHygieneFieldConfig(fieldConfig?: Partial<HygieneFieldConfig>): HygieneFieldConfig {
  return {
    acceptanceCriteriaFieldIds: buildFieldIdsPreferringConfigured(
      fieldConfig?.acceptanceCriteriaFieldIds,
      DEFAULT_HYGIENE_FIELD_CONFIG.acceptanceCriteriaFieldIds,
    ),
    // Fields with no built-in default stay configured-only: an instance that does not define them must
    // resolve to an empty list, which is how the matching check knows to skip itself.
    applicationFieldIds: buildUniqueFieldIds(fieldConfig?.applicationFieldIds ?? []),
    featureLinkFieldIds: buildFieldIdsPreferringConfigured(
      fieldConfig?.featureLinkFieldIds,
      DEFAULT_HYGIENE_FIELD_CONFIG.featureLinkFieldIds,
    ),
    initiativeTypeFieldIds: buildUniqueFieldIds(fieldConfig?.initiativeTypeFieldIds ?? []),
    parentLinkFieldIds: buildFieldIdsPreferringConfigured(
      fieldConfig?.parentLinkFieldIds,
      DEFAULT_HYGIENE_FIELD_CONFIG.parentLinkFieldIds,
    ),
    productOwnerFieldIds: buildUniqueFieldIds(fieldConfig?.productOwnerFieldIds ?? []),
    programIncrementFieldIds: buildFieldIdsPreferringConfigured(
      fieldConfig?.programIncrementFieldIds,
      DEFAULT_HYGIENE_FIELD_CONFIG.programIncrementFieldIds,
    ),
    targetEndFieldIds: buildFieldIdsPreferringConfigured(
      fieldConfig?.targetEndFieldIds,
      DEFAULT_HYGIENE_FIELD_CONFIG.targetEndFieldIds,
    ),
    targetStartFieldIds: buildFieldIdsPreferringConfigured(
      fieldConfig?.targetStartFieldIds,
      DEFAULT_HYGIENE_FIELD_CONFIG.targetStartFieldIds,
    ),
    // No built-in default: an instance without these resolves to [], so the Readiness alert renders
    // "not checked — no matching field" rather than flagging every feature.
    estimateFieldIds: buildUniqueFieldIds(fieldConfig?.estimateFieldIds ?? []),
    pcodeFieldIds: buildUniqueFieldIds(fieldConfig?.pcodeFieldIds ?? []),
    subStatusFieldIds: buildUniqueFieldIds(fieldConfig?.subStatusFieldIds ?? []),
    flaggedFieldIds: buildUniqueFieldIds(fieldConfig?.flaggedFieldIds ?? []),
  };
}

/** Runs every default Hygiene predicate and returns only the flags that apply to the issue. */
export function evaluateHygieneIssue(issue: JiraIssue, evaluationContext: HygieneEvaluationContext = {}): HygieneFlag[] {
  const fieldConfig = resolveHygieneFieldConfig(evaluationContext.fieldConfig);
  const featureKeysWithPointedStories = evaluationContext.featureKeysWithPointedStories ?? new Set<string>();
  const enabledBuiltInCheckIds = evaluationContext.enabledBuiltInCheckIds ?? new Set(HYGIENE_CHECK_IDS);
  const builtInFlags = [
    checkMissingSummary(issue),
    checkMissingFeatureLink(issue, fieldConfig),
    checkMissingParentLink(issue, fieldConfig),
    checkMissingProductOwner(issue, fieldConfig),
    checkMissingInitiativeType(issue, fieldConfig),
    checkMissingProgramIncrement(issue, fieldConfig),
    checkMissingTargetStart(issue, fieldConfig),
    checkMissingTargetEnd(issue, fieldConfig),
    checkMissingApplication(issue, fieldConfig),
    checkMissingFixVersion(issue),
    checkMissingDueDate(issue),
    checkTargetStartReady(issue, fieldConfig),
    checkTargetEndOverdue(issue, fieldConfig),
    checkDueDateOverdue(issue),
    checkDatesOutOfSync(issue, fieldConfig),
    checkMissingChildStoryPoints(issue, featureKeysWithPointedStories),
    checkMissingStoryPoints(issue, evaluationContext.customStoryPointsFieldId),
    checkStaleIssue(issue, evaluationContext.staleDaysThreshold),
    checkNoAssignee(issue),
    checkNoAcceptanceCriteria(issue, fieldConfig),
    checkOldInSprint(issue),
  ]
    .filter((flag): flag is HygieneFlag => flag !== null)
    .filter((flag) => enabledBuiltInCheckIds.has(flag.checkId as BuiltInHygieneCheckId));
  const customRuleFlags = (evaluationContext.customRules ?? [])
    .map((customRule) => checkRequiredFieldRule(issue, customRule))
    .filter((flag): flag is HygieneFlag => flag !== null);

  return [...builtInFlags, ...customRuleFlags];
}

/** Aggregates per-issue findings into the summary tiles shown at the top of the view. */
export function summarizeHygieneFindings(findings: HygieneFinding[], checkIds: readonly string[] = HYGIENE_CHECK_IDS): HygieneSummary {
  const countByCheck = createEmptyCheckCounts(checkIds);
  let totalFlags = 0;

  findings.forEach((finding) => {
    finding.flags.forEach((flag) => {
      countByCheck[flag.checkId] ??= 0;
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

function createEmptyCheckCounts(checkIds: readonly string[]): Record<string, number> {
  return checkIds.reduce(
    (countLookup, checkId) => ({ ...countLookup, [checkId]: 0 }),
    {} as Record<string, number>,
  );
}

function checkRequiredFieldRule(issue: JiraIssue, customRule: EnterpriseRequiredFieldRule): HygieneFlag | null {
  if (!shouldApplyCustomRuleToIssue(issue, customRule.issueTypeNames) || hasMeaningfulValue(readIssueFieldValue(issue, customRule.fieldId))) {
    return null;
  }

  return {
    checkId: customRule.id as HygieneCheckId,
    label: customRule.name,
    severity: customRule.severity,
  };
}

function shouldApplyCustomRuleToIssue(issue: JiraIssue, issueTypeNames: readonly string[]): boolean {
  if (issueTypeNames.length === 0) {
    return true;
  }

  const normalizedIssueTypeName = readIssueTypeName(issue);
  return issueTypeNames.some((issueTypeName) => issueTypeName.trim().toLowerCase() === normalizedIssueTypeName);
}

function readFirstConfiguredFieldValue(issue: JiraIssue, fieldIds: readonly string[]): unknown {
  for (const fieldId of fieldIds) {
    const fieldValue = readIssueFieldValue(issue, fieldId);
    if (fieldValue !== undefined) {
      return fieldValue;
    }
  }

  return null;
}

function buildUniqueFieldIds(fieldIds: readonly string[]): string[] {
  return Array.from(new Set(fieldIds.filter(Boolean)));
}

function readIssueTypeName(issue: JiraIssue): string {
  return issue.fields.issuetype?.name?.toLowerCase() ?? '';
}

function isInProgressIssue(issue: JiraIssue): boolean {
  const statusName = issue.fields.status?.name?.toLowerCase() ?? '';
  const statusCategoryKey = issue.fields.status?.statusCategory?.key?.toLowerCase() ?? '';
  return statusName === 'in progress' || statusCategoryKey === 'indeterminate';
}

function isTodoIssue(issue: JiraIssue): boolean {
  const statusCategoryKey = issue.fields.status?.statusCategory?.key?.toLowerCase() ?? '';
  const statusCategoryName = issue.fields.status?.statusCategory?.name?.toLowerCase() ?? '';
  return statusCategoryKey === 'new' || statusCategoryName === 'to do';
}

/**
 * True once a Feature has reached the testing stage — Integrated Test, either story-workflow
 * testing status, or any done status. Reaching it IS the remedy this rule asks for, so a Feature
 * that has complied stops being warned about.
 */
function hasReachedFeatureTesting(issue: JiraIssue): boolean {
  if (isDoneIssue(issue)) {
    return true;
  }

  const statusName = issue.fields.status?.name?.toLowerCase() ?? '';
  return FEATURE_TESTING_REACHED_STATUS_KEYWORDS.some((statusKeyword) => statusName.includes(statusKeyword));
}

function isDoneIssue(issue: JiraIssue): boolean {
  const statusName = issue.fields.status?.name?.toLowerCase() ?? '';
  const statusCategoryKey = issue.fields.status?.statusCategory?.key?.toLowerCase() ?? '';
  return statusCategoryKey === 'done' || ['done', 'closed', 'resolved', 'complete'].includes(statusName);
}

function hasMeaningfulValueForAnyField(issue: JiraIssue, fieldIds: readonly string[]): boolean {
  return fieldIds.some((fieldId) => hasMeaningfulValue(readIssueFieldValue(issue, fieldId)));
}

function readIssueFieldValue(issue: JiraIssue, fieldId: string): unknown {
  if (fieldId === 'parent') {
    return issue.fields.parent;
  }

  return issue.fields[fieldId];
}

function readIssueFieldText(issue: JiraIssue, fieldId: string): string {
  return normalizeRichTextToPlainText(readIssueFieldValue(issue, fieldId)).trim();
}

function isAcceptanceCriteriaPlaceholder(fieldText: string): boolean {
  const normalizedFieldText = fieldText.trim().toLowerCase().replace(/[.!?]+$/g, '');
  return ACCEPTANCE_CRITERIA_PLACEHOLDER_VALUES.has(normalizedFieldText);
}

function hasMeaningfulValue(fieldValue: unknown): boolean {
  if (fieldValue === null || fieldValue === undefined) {
    return false;
  }

  if (typeof fieldValue === 'string') {
    return fieldValue.trim() !== '';
  }

  if (typeof fieldValue === 'number') {
    return fieldValue > 0;
  }

  if (typeof fieldValue === 'boolean') {
    return fieldValue;
  }

  if (Array.isArray(fieldValue)) {
    return fieldValue.length > 0;
  }

  if (!isRecord(fieldValue)) {
    return false;
  }

  return Object.values(fieldValue).some((nestedValue) => hasMeaningfulValue(nestedValue));
}

/**
 * True when a date field names today or an earlier day, for the person reading the screen.
 *
 * Delegates to the shared calendar comparator so this and the Readiness scan cannot answer the same
 * question differently — they used to, for several hours every evening, because one compared
 * calendar days and the other compared instants.
 */
function isDateTodayOrPast(fieldValue: unknown): boolean {
  return isOnOrBeforeToday(fieldValue);
}

function hasEmptyStoryPoints(fieldValue: unknown): boolean {
  if (fieldValue === null || fieldValue === undefined || fieldValue === '') return true;
  if (typeof fieldValue === 'number') return fieldValue <= 0;
  // A string is only non-empty when it parses as a positive finite number.
  // Non-numeric placeholder values like "None" that Jira returns for an explicitly-cleared
  // Select field are treated as empty — consistent with how parseNumericValue works.
  if (typeof fieldValue === 'string') {
    const parsedNumber = Number(fieldValue);
    return !Number.isFinite(parsedNumber) || parsedNumber <= 0;
  }
  if (Array.isArray(fieldValue)) return fieldValue.length === 0;
  // Jira Select-type fields return {id, value} objects — extract and re-evaluate the numeric value.
  if (typeof fieldValue === 'object') {
    return hasEmptyStoryPoints((fieldValue as Record<string, unknown>).value);
  }
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

function isRecord(candidateValue: unknown): candidateValue is Record<string, unknown> {
  return typeof candidateValue === 'object' && candidateValue !== null;
}
