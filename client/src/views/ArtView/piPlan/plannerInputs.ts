// plannerInputs.ts — Pure adapters that turn live PI Review data (reconciled Feature rows + Jira issues)
// into the planner's FeatureInput contract, plus small date/sprint helpers the container needs (spec 028,
// US1 mount). Kept pure so the mapping is unit-tested; the container does the I/O and passes the results in.

import { extractPiReviewFeatureKey } from '../piReviewJira.ts';
import type { PiReviewRow } from '../piReviewTable.ts';
import type { FeatureInput } from './piPlanTypes.ts';

/** The minimal Jira issue shape the mapper reads (structural — the real JiraIssue satisfies it).
 *  Both fields are nullable because Jira returns `null` (not just absent) for an unset priority/version. */
export interface FeatureIssueLike {
  fields?: {
    fixVersions?: Array<{ name?: string }> | null;
    priority?: { name?: string } | null;
  };
}

const JIRA_KEY_PATTERN = /[A-Z][A-Z0-9]+-\d+/g;

/** Formats a local-midnight Date as 'YYYY-MM-DD' (en-CA yields ISO order). */
export function toIsoDate(date: Date): string {
  return date.toLocaleDateString('en-CA');
}

/** Parses a point-estimate cell to a number, or null when it is blank/non-numeric. */
export function parsePoints(pointEstimate: string): number | null {
  const parsed = Number.parseFloat(pointEstimate);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pulls any Jira issue keys out of a dependency cell (best-effort — the cell is free text). */
export function parseDependencyKeys(dependencyCell: string): string[] {
  return dependencyCell.match(JIRA_KEY_PATTERN) ?? [];
}

/** Strips the leading key from a "KEY summary" feature cell, leaving just the summary text. */
function deriveSummary(featureCell: string, key: string): string {
  const trimmed = featureCell.trim();
  return trimmed.startsWith(key) ? trimmed.slice(key.length).trim() : trimmed;
}

/** Maps reconciled PI Review rows + their Jira issues into FeatureInput[] for the planner. */
export function buildFeatureInputs(rows: PiReviewRow[], jiraIssueMap: Record<string, FeatureIssueLike>): FeatureInput[] {
  return rows.map((row, index) => {
    const key = extractPiReviewFeatureKey(row.feature) ?? row.feature.trim();
    const jiraIssue = jiraIssueMap[key.toUpperCase()];
    return {
      key,
      summary: deriveSummary(row.feature, key),
      sizePoints: parsePoints(row.pointEstimate),
      priorityRank: index + 1,
      priorityName: (row.priority && row.priority.trim() !== '') ? row.priority : (jiraIssue?.fields?.priority?.name ?? null),
      isCommitted: /yes/i.test(row.committed ?? ''),
      dependencyKeys: parseDependencyKeys(row.dependency ?? ''),
      targetFixVersion: jiraIssue?.fields?.fixVersions?.[0]?.name ?? null,
      existingChildren: [],
    };
  });
}

/** Splits a PI window into sequential sprints of the given length, for the prompt's sprint calendar. */
export function deriveSprints(piStartIso: string, piEndIso: string, sprintLengthDays: number): { name: string; startIso: string; endIso: string }[] {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const sprints: { name: string; startIso: string; endIso: string }[] = [];
  let cursor = new Date(`${piStartIso}T00:00:00Z`).getTime();
  const end = new Date(`${piEndIso}T00:00:00Z`).getTime();
  let index = 1;
  while (cursor <= end && index <= 12) {
    const startIso = new Date(cursor).toISOString().slice(0, 10);
    const sprintEnd = Math.min(cursor + (sprintLengthDays - 1) * millisecondsPerDay, end);
    sprints.push({ name: `Sprint ${index}`, startIso, endIso: new Date(sprintEnd).toISOString().slice(0, 10) });
    cursor += sprintLengthDays * millisecondsPerDay;
    index += 1;
  }
  return sprints;
}
