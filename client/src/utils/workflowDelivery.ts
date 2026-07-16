// workflowDelivery.ts — ART-wide status taxonomy: display buckets, In Progress sub-groups, and
// the "delivered" credit rule shared by every Team Dashboard / ART tab.
//
// Business rules (agreed with the Product Owner, applies to every team across the ART):
//   • Display buckets follow Jira statusCategory exactly: new → To Do, indeterminate → In Progress,
//     done → Done. Status NAMES never decide the bucket — that was the source of the "Working shows
//     as To Do" bug.
//   • Inside In Progress, the approved workflow statuses surface as sub-groups:
//     "Ready for Testing" → Internal Testing, "Ready for QA" → External Testing,
//     "Ready to Accept" → Ready to Accept. Everything else is plain Active work.
//   • The team's Definition of Done is satisfied at External Testing: an issue is DELIVERED once its
//     current status is "Ready for QA" or later ("Ready to Accept", or any statusCategory-done status
//     such as "Accepted"). Delivered drives all completion metrics — NOT statusCategory done.
//   • Credit is earned in the PI whose dates contain the issue's entry into its CURRENT uninterrupted
//     delivered run. Regressing (e.g. back to "Working" for a fix) loses the credit until the issue
//     re-reaches "Ready for QA"; the re-entry date then decides which PI gets the credit (carry-over).

import type { JiraIssue } from '../types/jira.ts';

// ── Approved workflow status names (identical for every team across the ART) ─────────────────────

/** Internal-testing status: the team is testing in a lower environment. */
export const INTERNAL_TESTING_STATUS_NAME = 'Ready for Testing';
/** External-testing status: handed to QA — this is the team's Definition-of-Done point. */
export const EXTERNAL_TESTING_STATUS_NAME = 'Ready for QA';
/** Post-QA holding status before production acceptance. */
export const READY_TO_ACCEPT_STATUS_NAME = 'Ready to Accept';

/**
 * Status names that mean "at or past External Testing" while statusCategory is still In Progress.
 * Together with any statusCategory-done status these form the delivered set.
 */
const DELIVERED_IN_PROGRESS_STATUS_NAMES = [
  EXTERNAL_TESTING_STATUS_NAME.toLowerCase(),
  READY_TO_ACCEPT_STATUS_NAME.toLowerCase(),
];

/**
 * Done-category status names used to date changelog transitions, where only the status NAME is
 * available (the changelog does not carry statusCategory). Mirrors the legacy dashboard list.
 */
export const DONE_CATEGORY_STATUS_NAMES = ['done', 'closed', 'resolved', 'complete', 'accepted'];

/** Jira statusCategory keys — the only three categories Jira defines. */
const STATUS_CATEGORY_DONE = 'done';
const STATUS_CATEGORY_IN_PROGRESS = 'indeterminate';

/** Changelog field identifier for a status transition entry. */
const CHANGELOG_STATUS_FIELD = 'status';

// ── Public types ──────────────────────────────────────────────────────────────────────────────────

/** The three Overview display buckets, mirroring Jira's three status categories. */
export type OverviewStatusBucket = 'To Do' | 'In Progress' | 'Done';

/** Display sub-groups inside the In Progress bucket, in workflow order. */
export type InProgressSubGroup = 'Active' | 'Internal Testing' | 'External Testing' | 'Ready to Accept';

/** Sub-group render order: earlier workflow stages first. */
export const IN_PROGRESS_SUB_GROUP_ORDER: readonly InProgressSubGroup[] = [
  'Active',
  'Internal Testing',
  'External Testing',
  'Ready to Accept',
];

// ── Display classification ────────────────────────────────────────────────────────────────────────

/**
 * Buckets an issue for display purely by Jira statusCategory.
 * Unknown categories fall into To Do so no issue ever disappears from the board.
 */
export function classifyStatusBucket(issue: JiraIssue): OverviewStatusBucket {
  const statusCategoryKey = issue.fields.status.statusCategory.key;
  if (statusCategoryKey === STATUS_CATEGORY_DONE) {
    return 'Done';
  }
  if (statusCategoryKey === STATUS_CATEGORY_IN_PROGRESS) {
    return 'In Progress';
  }
  return 'To Do';
}

/**
 * Maps an In Progress status name onto its ART display sub-group.
 * Only the three approved workflow statuses get named sub-groups; anything else is Active work.
 */
export function classifyInProgressSubGroup(statusName: string): InProgressSubGroup {
  const normalizedStatusName = statusName.toLowerCase();
  if (normalizedStatusName === INTERNAL_TESTING_STATUS_NAME.toLowerCase()) {
    return 'Internal Testing';
  }
  if (normalizedStatusName === EXTERNAL_TESTING_STATUS_NAME.toLowerCase()) {
    return 'External Testing';
  }
  if (normalizedStatusName === READY_TO_ACCEPT_STATUS_NAME.toLowerCase()) {
    return 'Ready to Accept';
  }
  return 'Active';
}

/** Issues grouped into the three Overview display buckets. */
export type IssuesByStatusBucket = Record<OverviewStatusBucket, JiraIssue[]>;

/** Groups issues into the three display buckets purely by statusCategory. */
export function groupIssuesByStatusBucket(issues: JiraIssue[]): IssuesByStatusBucket {
  const groupedIssues: IssuesByStatusBucket = { 'To Do': [], 'In Progress': [], Done: [] };
  for (const issue of issues) {
    groupedIssues[classifyStatusBucket(issue)].push(issue);
  }
  return groupedIssues;
}

/** One rendered In Progress sub-group: its display label and the issues inside it. */
export interface InProgressSubGroupIssues {
  subGroup: InProgressSubGroup;
  issues: JiraIssue[];
}

/**
 * Splits In Progress issues into their display sub-groups, in workflow order,
 * omitting empty sub-groups so the board never renders hollow headers.
 */
export function groupInProgressIssuesBySubGroup(issues: JiraIssue[]): InProgressSubGroupIssues[] {
  const issuesBySubGroup = new Map<InProgressSubGroup, JiraIssue[]>();
  for (const issue of issues) {
    const subGroup = classifyInProgressSubGroup(issue.fields.status.name);
    const subGroupIssues = issuesBySubGroup.get(subGroup) ?? [];
    subGroupIssues.push(issue);
    issuesBySubGroup.set(subGroup, subGroupIssues);
  }

  return IN_PROGRESS_SUB_GROUP_ORDER
    .filter((subGroup) => issuesBySubGroup.has(subGroup))
    .map((subGroup) => ({ subGroup, issues: issuesBySubGroup.get(subGroup) ?? [] }));
}

// ── Delivered-credit rule ─────────────────────────────────────────────────────────────────────────

/**
 * Returns true when a status NAME belongs to the delivered set (External Testing or later).
 * Exported for callers that only have names — changelog entries and JQL carry no statusCategory.
 */
export function isDeliveredWorkflowStatusName(statusName: string): boolean {
  const normalizedStatusName = statusName.toLowerCase();
  return (
    DELIVERED_IN_PROGRESS_STATUS_NAMES.includes(normalizedStatusName)
    || DONE_CATEGORY_STATUS_NAMES.includes(normalizedStatusName)
  );
}

/**
 * Returns true when the issue currently satisfies the team's Definition of Done:
 * at or past External Testing ("Ready for QA"), or in any statusCategory-done status.
 */
export function isDeliveredIssue(issue: JiraIssue): boolean {
  return (
    issue.fields.status.statusCategory.key === STATUS_CATEGORY_DONE
    || isDeliveredWorkflowStatusName(issue.fields.status.name)
  );
}

/** One status transition extracted from the changelog: the status moved to and when. */
interface StatusTransition {
  toStatusName: string;
  atIso: string;
}

/** Flattens changelog histories into chronologically ordered status transitions. */
function readStatusTransitions(issue: JiraIssue): StatusTransition[] | null {
  const histories = issue.changelog?.histories;
  if (histories === undefined) {
    return null; // Changelog was never fetched — attribution is unknowable, not "empty".
  }

  const statusTransitions: StatusTransition[] = [];
  for (const history of histories) {
    for (const historyItem of history.items) {
      if (historyItem.field === CHANGELOG_STATUS_FIELD && historyItem.toString !== null) {
        statusTransitions.push({ toStatusName: historyItem.toString, atIso: history.created });
      }
    }
  }
  statusTransitions.sort((leftTransition, rightTransition) => leftTransition.atIso.localeCompare(rightTransition.atIso));
  return statusTransitions;
}

/**
 * Returns the ISO timestamp at which the issue ENTERED its current uninterrupted delivered run —
 * the moment PI credit is earned. Returns null when:
 *   • the issue is not currently delivered (including after a regression — credit is lost), or
 *   • the changelog was never fetched, so attribution is unknown.
 * A delivered issue whose changelog holds no status transitions falls back to its created date
 * (it has lived in a delivered status since creation).
 */
export function resolveDeliveryDateIso(issue: JiraIssue): string | null {
  if (!isDeliveredIssue(issue)) {
    return null;
  }

  const statusTransitions = readStatusTransitions(issue);
  if (statusTransitions === null) {
    return null;
  }
  if (statusTransitions.length === 0) {
    return issue.fields.created;
  }

  // Walk the timeline tracking the start of each uninterrupted delivered run; a move back out of
  // the delivered set (regression) resets the anchor, so only the CURRENT run's entry survives.
  let deliveredRunEntryIso: string | null = null;
  for (const statusTransition of statusTransitions) {
    if (isDeliveredWorkflowStatusName(statusTransition.toStatusName)) {
      deliveredRunEntryIso = deliveredRunEntryIso ?? statusTransition.atIso;
    } else {
      deliveredRunEntryIso = null;
    }
  }
  return deliveredRunEntryIso;
}

/** Returns true when a status NAME belongs to the done category (changelogs carry no statusCategory). */
function isDoneCategoryStatusName(statusName: string): boolean {
  return DONE_CATEGORY_STATUS_NAMES.includes(statusName.toLowerCase());
}

/** Returns true when the issue's CURRENT status is done — by category, or by name for changelog parity. */
function isCurrentStatusDone(issue: JiraIssue): boolean {
  return (
    issue.fields.status.statusCategory.key === STATUS_CATEGORY_DONE
    || isDoneCategoryStatusName(issue.fields.status.name)
  );
}

/**
 * Returns the ISO timestamp at which the issue ENTERED its current uninterrupted DONE run — the moment
 * production credit is earned (Monthly Delivery Report, feature 018). Same walk as
 * resolveDeliveryDateIso but anchored on done-category statuses instead of the delivered set:
 *   • hops between done statuses (Resolved → Closed) keep the original entry date, and
 *   • a reopen resets the anchor, so a re-done issue is credited to its re-done month.
 * Returns null when the issue never reached done, regressed out of done, or has no changelog
 * (attribution unknown). A done issue with zero transitions falls back to its created date.
 */
export function resolveDoneEntryDateIso(issue: JiraIssue): string | null {
  const statusTransitions = readStatusTransitions(issue);
  if (statusTransitions === null) {
    return null;
  }
  if (statusTransitions.length === 0) {
    return isCurrentStatusDone(issue) ? issue.fields.created : null;
  }

  let doneRunEntryIso: string | null = null;
  for (const statusTransition of statusTransitions) {
    if (isDoneCategoryStatusName(statusTransition.toStatusName)) {
      doneRunEntryIso = doneRunEntryIso ?? statusTransition.atIso;
    } else {
      doneRunEntryIso = null;
    }
  }
  return doneRunEntryIso;
}

/** Length of a date-only ISO string (YYYY-MM-DD), used to detect day-precision window bounds. */
const DATE_ONLY_ISO_LENGTH = 10;

/** Expands a date-only window end (YYYY-MM-DD) to the last instant of that day, making it inclusive. */
function toInclusiveWindowEndIso(windowEndIso: string): string {
  return windowEndIso.length === DATE_ONLY_ISO_LENGTH ? `${windowEndIso}T23:59:59.999Z` : windowEndIso;
}

/**
 * Returns true when the issue earns delivery credit inside the given PI window
 * ("delivered on or before the last day of the PI", last day inclusive).
 * When the changelog was never fetched, a currently-delivered issue gets the benefit of the doubt —
 * live current-PI views without changelog data keep counting it.
 */
export function isDeliveredWithinWindow(issue: JiraIssue, windowStartIso: string, windowEndIso: string): boolean {
  if (!isDeliveredIssue(issue)) {
    return false;
  }

  const deliveryDateIso = resolveDeliveryDateIso(issue);
  if (deliveryDateIso === null) {
    return true; // Delivered now, but no changelog to date it — assume in-window.
  }

  return deliveryDateIso >= windowStartIso && deliveryDateIso <= toInclusiveWindowEndIso(windowEndIso);
}

/** A PI (or sprint) date window in ISO form; null when the view has no window to attribute against. */
export interface DeliveryWindow {
  startIso: string;
  endIso: string;
}

/**
 * The single credit predicate every metric should call: applies the PI window when one is known,
 * and falls back to the plain delivered rule when the view has no window (e.g. unbounded scopes).
 */
export function isDeliveredForCredit(issue: JiraIssue, deliveryWindow: DeliveryWindow | null): boolean {
  if (deliveryWindow === null) {
    return isDeliveredIssue(issue);
  }
  return isDeliveredWithinWindow(issue, deliveryWindow.startIso, deliveryWindow.endIso);
}
