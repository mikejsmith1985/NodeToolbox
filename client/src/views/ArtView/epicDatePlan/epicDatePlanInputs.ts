// epicDatePlanInputs.ts — Reads the Epics to plan out of the PI Review table and the Jira data it already loaded.
//
// The PI Review page is the plan's source of truth: its row order is the priority order, and its Point
// Estimate is the effort still to deliver (for a carried-over Epic, the remaining effort rather than the
// original size). Jira supplies only what the page does not hold — whether work has started, and the
// Target Start a started Epic already carries.

import type { JiraIssue } from '../../../types/jira.ts';
import { extractPiReviewFeatureKey, readPiReviewTargetDates } from '../piReviewJira.ts';
import type { PiReviewRow } from '../piReviewTable.ts';
import type { EpicToSchedule } from './epicDateSchedule.ts';

// Jira's status category for work not yet begun; every other category means Implementing or beyond.
const NOT_STARTED_STATUS_CATEGORY = 'new';

/** A positive point estimate from a PI Review cell, or null for a blank, zero or non-numeric one. */
export function readPointEstimate(rawEstimate: string): number | null {
  const parsedPoints = Number(rawEstimate.trim());
  return rawEstimate.trim() !== '' && Number.isFinite(parsedPoints) && parsedPoints > 0 ? parsedPoints : null;
}

/** True when Jira shows the Epic already past "not started" — its start date is history, not a plan. */
function readIsStarted(jiraIssue: JiraIssue | undefined): boolean {
  const statusCategoryKey = jiraIssue?.fields?.status?.statusCategory?.key;
  return statusCategoryKey !== undefined && statusCategoryKey !== NOT_STARTED_STATUS_CATEGORY;
}

/** Every Epic on the page, once each, in page (priority) order; rows without an issue key are skipped. */
export function buildEpicsToSchedule(rows: readonly PiReviewRow[], jiraIssueMap: Readonly<Record<string, JiraIssue>>): EpicToSchedule[] {
  const seenKeys = new Set<string>();
  const epics: EpicToSchedule[] = [];
  for (const row of rows) {
    const epicKey = extractPiReviewFeatureKey(row.feature);
    if (epicKey === null || seenKeys.has(epicKey)) {
      continue;
    }
    seenKeys.add(epicKey);
    const jiraIssue = jiraIssueMap[epicKey];
    epics.push({
      epicKey,
      summary: jiraIssue?.fields?.summary?.trim() || row.feature.trim(),
      points: readPointEstimate(row.pointEstimate),
      isStarted: readIsStarted(jiraIssue),
      existingTargetStart: readPiReviewTargetDates(jiraIssue).targetStart,
    });
  }
  return epics;
}
