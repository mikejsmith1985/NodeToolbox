// issuePlanningDates.ts — The three dates that say when a piece of work is meant to happen.
//
// Target Start, Due and Target End are the fields every date flag on this page is about, and the card
// showed exactly one of them. A reader deciding whether a date is wrong had to open the issue in Jira
// to see the other two — which is the opposite of the point of a hygiene page.
//
// Pure on purpose: reading a date out of an issue and knowing which field to write it to are separate
// questions from rendering an input, and only the first two are worth testing without a browser.

import type { HygieneFieldConfig, JiraIssue } from './checks/hygieneChecks.ts';

/** Matches a value that OPENS with a calendar day, whatever time or zone may follow it. */
const LEADING_DATE_PATTERN = /^(\d{4}-\d{2}-\d{2})/;

/** One planning date: what to call it, where it lives, and what it currently holds. */
export interface IssuePlanningDate {
  /** Stable id used for test targeting and React keys. */
  id: 'targetStart' | 'dueDate' | 'targetEnd';
  label: string;
  /** The Jira field to write, or null when this instance has not configured one. */
  fieldId: string | null;
  /** The stored value as a calendar day, or null when empty or unreadable. */
  value: string | null;
}

/**
 * Reads a date field as the day written on its face.
 *
 * Not the same as "which day was this instant" — Jira sometimes returns a date field as a datetime at
 * UTC midnight, and converting that to a local day yields the day BEFORE for everyone west of
 * Greenwich. The leading day is taken as-is for exactly that reason.
 */
export function readPlanningDateValue(fieldValue: unknown): string | null {
  if (typeof fieldValue !== 'string') {
    return null;
  }
  const leadingDate = LEADING_DATE_PATTERN.exec(fieldValue.trim());
  return leadingDate ? leadingDate[1] : null;
}

/**
 * The three planning dates for one issue, in the order the work happens.
 *
 * Start, then due, then end — a reader scanning left to right is reading a timeline, which is the
 * only ordering that makes a wrong date obvious at a glance.
 *
 * A field this instance has not configured comes back with `fieldId: null` rather than being omitted.
 * Dropping it would let a screen show two dates and look complete; showing it unwritable says what is
 * actually true, which is that nobody has told Toolbox where that date lives.
 */
export function readIssuePlanningDates(
  issue: JiraIssue,
  fieldConfig: HygieneFieldConfig,
): IssuePlanningDate[] {
  const issueFields = issue.fields as unknown as Record<string, unknown>;
  const targetStartFieldId = fieldConfig.targetStartFieldIds[0] ?? null;
  const targetEndFieldId = fieldConfig.targetEndFieldIds[0] ?? null;

  return [
    {
      id: 'targetStart',
      label: 'Target Start',
      fieldId: targetStartFieldId,
      value: targetStartFieldId ? readPlanningDateValue(issueFields[targetStartFieldId]) : null,
    },
    {
      id: 'dueDate',
      label: 'Due',
      // `duedate` is a Jira SYSTEM field: it needs no configuration and is never absent.
      fieldId: 'duedate',
      value: readPlanningDateValue(issueFields.duedate),
    },
    {
      id: 'targetEnd',
      label: 'Target End',
      fieldId: targetEndFieldId,
      value: targetEndFieldId ? readPlanningDateValue(issueFields[targetEndFieldId]) : null,
    },
  ];
}
