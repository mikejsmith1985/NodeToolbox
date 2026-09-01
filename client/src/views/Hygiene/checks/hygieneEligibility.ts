// hygieneEligibility.ts — How many issues in scope each hygiene check actually applies to.
//
// A hygiene tile showing "0" has always meant three different things at once: every issue passed,
// no issue in scope was the kind of issue the check governs, or the Jira field it reads does not
// exist on this instance. Rendered identically, the honest zeros are indistinguishable from the
// hollow ones — and a wall of zeros beside a real backlog reads as a tool that is not checking
// anything, which is precisely the report this module exists to answer (GH #377).
//
// The remedy is a denominator. Each check declares the population it governs, this counts how much
// of that population is in scope, and the tile can then say "0 of 12 checked" or "no issues in
// scope this applies to" instead of a bare, unreadable 0.
//
// Eligibility here is APPLICABILITY only — the issue-type and field gates that decide whether a
// check looks at an issue at all. It is deliberately not the condition being checked: "12 stories
// were checked for a fix version and all 12 had one" is a trustworthy zero, and must read as one.

import {
  carriesAcceptanceCriteria,
  carriesDeliveryDates,
  carriesFixVersion,
  carriesOwnDueDate,
  carriesStoryPoints,
  isFeatureLikeIssue,
  requiresFeatureLink,
  type HygieneFieldConfig,
  type JiraIssue,
} from './hygieneChecks.ts';

/** What a tile needs in order to say what its number means. */
export interface HygieneCheckApplicability {
  /** Issues in scope this check actually governs — the denominator behind its count. */
  eligibleIssueCount: number;
  /** False when the check reads a Jira field this instance does not have, so it never ran at all. */
  isFieldConfigured: boolean;
}

/** Every issue is governed by these — they read fields Jira always has. */
function appliesToEveryIssue(): boolean {
  return true;
}

/**
 * The population each built-in check governs.
 *
 * Each entry pairs with the gate inside the check itself, and both sides call the SAME exported
 * predicate rather than re-stating the issue-type list. A property test in this module's suite
 * proves no check raises a flag against an issue this table counts as ineligible.
 */
const CHECK_POPULATION: Record<string, (issue: JiraIssue) => boolean> = {
  'missing-summary': appliesToEveryIssue,
  'missing-feature-link': requiresFeatureLink,
  'missing-parent-link': isFeatureLikeIssue,
  'missing-product-owner': isFeatureLikeIssue,
  'missing-initiative-type': isFeatureLikeIssue,
  'missing-pi': isFeatureLikeIssue,
  'missing-target-start': carriesDeliveryDates,
  'missing-target-end': carriesDeliveryDates,
  'missing-application': isFeatureLikeIssue,
  'missing-fix-version': carriesFixVersion,
  'missing-due-date': carriesDeliveryDates,
  'target-start-ready': isFeatureLikeIssue,
  'target-end-overdue': carriesFixVersion,
  'due-date-overdue': carriesOwnDueDate,
  'dates-out-of-sync': carriesDeliveryDates,
  'missing-child-story-points': isFeatureLikeIssue,
  'missing-sp': carriesStoryPoints,
  stale: appliesToEveryIssue,
  'no-assignee': appliesToEveryIssue,
  'no-ac': carriesAcceptanceCriteria,
  'old-in-sprint': appliesToEveryIssue,
};

/**
 * The checks that read a custom field this instance may simply not have.
 *
 * These skip themselves silently when their field list is empty, which is correct behaviour and an
 * indefensible thing to render as 0.
 */
const CHECK_REQUIRED_FIELD_FAMILY: Record<string, keyof HygieneFieldConfig> = {
  'missing-product-owner': 'productOwnerFieldIds',
  'missing-initiative-type': 'initiativeTypeFieldIds',
  'missing-application': 'applicationFieldIds',
};

/**
 * Counts, for each check, how many of the scanned issues it governs and whether it could run.
 *
 * An unrecognised check id — an admin's own required-field rule — is treated as governing every
 * issue. That is what those rules do, and guessing "nothing" would put a real rule's honest zero
 * back to reading as "never checked".
 */
export function summarizeCheckApplicability(
  issues: readonly JiraIssue[],
  fieldConfig: HygieneFieldConfig,
  checkIds: readonly string[],
): Record<string, HygieneCheckApplicability> {
  const applicabilityByCheck: Record<string, HygieneCheckApplicability> = {};

  checkIds.forEach((checkId) => {
    const governsIssue = CHECK_POPULATION[checkId] ?? appliesToEveryIssue;
    const requiredFieldFamily = CHECK_REQUIRED_FIELD_FAMILY[checkId];
    const isFieldConfigured = requiredFieldFamily === undefined
      || (fieldConfig[requiredFieldFamily] ?? []).length > 0;

    applicabilityByCheck[checkId] = {
      eligibleIssueCount: issues.filter((issue) => governsIssue(issue)).length,
      isFieldConfigured,
    };
  });

  return applicabilityByCheck;
}
