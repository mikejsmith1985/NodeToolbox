// reworkFetch.ts — Reading the changelog history the rework scan measures.
//
// The evidence for rework is already in Jira: every status change, with its timestamp, on every issue.
// Nothing here computes anything — it turns the raw changelog into the shape `reworkScan` reads, and
// nothing else, so the counting rules live in exactly one place.
//
// Status NAMES are read rather than ids, because the delivery line the scan tests against is a name
// the team chose ("Ready for QA"). Matching on ids would mean carrying a status map for no gain.

import { jiraGet } from '../../services/jiraApi.ts';
import { resolveStoryPointsFieldIds } from '../Hygiene/checks/storyPointsField.ts';
import { buildScopedJql } from './reportScopeJql.ts';
import type { ReworkIssue, ReworkStatusTransition } from './reworkScan.ts';

/** One page of issues per request. Jira caps this well below what a quarter of history returns. */
const ISSUE_PAGE_SIZE = 100;

/** More history than any conversation needs, and a hard stop against an unbounded scope. */
export const MAX_REWORK_ISSUES = 600;

/** One changelog entry, reduced to what reading status history needs. */
interface RawHistory {
  created?: string;
  items?: { field?: string; fromString?: string | null; toString?: string | null }[];
}

/** One issue as Jira returns it with `expand=changelog`. */
interface RawIssue {
  key?: string;
  fields?: {
    summary?: string;
    status?: { name?: string };
    assignee?: { displayName?: string } | null;
    [fieldId: string]: unknown;
  };
  changelog?: { histories?: RawHistory[] };
}

/** The JQL a rework scan runs: everything touched in the window, newest activity first. */
export function buildReworkJql(scopeJql: string, windowDays: number): string {
  return buildScopedJql(scopeJql, `updated >= -${windowDays}d ORDER BY updated DESC`);
}

/** The search path, with the changelog expanded and one page requested. */
function buildSearchPath(scopeJql: string, windowDays: number, storyPointsFieldId: string, startAt: number): string {
  const fields = ['summary', 'status', 'assignee', storyPointsFieldId].join(',');
  return `/rest/api/2/search?jql=${encodeURIComponent(buildReworkJql(scopeJql, windowDays))}`
    + `&expand=changelog&fields=${fields}&startAt=${startAt}&maxResults=${ISSUE_PAGE_SIZE}`;
}

/** Changelog entries with a readable timestamp, oldest first. */
function readSortedHistories(issue: RawIssue): RawHistory[] {
  return (issue.changelog?.histories ?? [])
    .filter((history): history is RawHistory & { created: string } => typeof history.created === 'string')
    .sort((first, second) => Date.parse(first.created) - Date.parse(second.created));
}

/**
 * Reconstructs an issue's status history: what it was created in, and every move after.
 *
 * The status at creation comes from the FIRST change's `fromString`. An issue that never moved has no
 * history at all, so its current status is the only one it has ever had.
 */
export function readStatusHistory(issue: RawIssue): Pick<ReworkIssue, 'initialStatusName' | 'statusTransitions'> {
  const statusTransitions: ReworkStatusTransition[] = [];
  let initialStatusName: string | null = null;
  let hasSeenStatusChange = false;

  readSortedHistories(issue).forEach((history) => {
    (history.items ?? []).forEach((changeItem) => {
      if (changeItem.field !== 'status') {
        return;
      }
      if (!hasSeenStatusChange) {
        initialStatusName = changeItem.fromString ?? null;
        hasSeenStatusChange = true;
      }
      if (changeItem.toString != null) {
        statusTransitions.push({ toStatusName: changeItem.toString, atIso: history.created ?? '' });
      }
    });
  });

  if (!hasSeenStatusChange) {
    initialStatusName = issue.fields?.status?.name ?? null;
  }
  return { initialStatusName, statusTransitions };
}

/** Reads a story-point value, tolerating the string form some Jira configurations return. */
function readStoryPoints(issueFields: Record<string, unknown>, storyPointsFieldId: string): number | null {
  const rawValue = issueFields[storyPointsFieldId];
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    return rawValue;
  }
  const parsedValue = typeof rawValue === 'string' ? Number.parseFloat(rawValue) : Number.NaN;
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

/** Turns one raw issue into the shape the scan reads. */
export function toReworkIssue(issue: RawIssue, storyPointsFieldId: string): ReworkIssue {
  return {
    key: issue.key ?? '',
    summary: issue.fields?.summary ?? '',
    storyPoints: readStoryPoints((issue.fields ?? {}) as Record<string, unknown>, storyPointsFieldId),
    assigneeName: issue.fields?.assignee?.displayName ?? null,
    ...readStatusHistory(issue),
  };
}

/** What a fetch returned, and whether it stopped short of the whole scope. */
export interface ReworkFetchResult {
  issues: ReworkIssue[];
  /** True when the cap was reached, so a partial answer is never presented as a complete one. */
  wasTruncated: boolean;
}

/**
 * Fetches the issues in scope with their status history.
 *
 * Paged to the cap, and says when it hit it. A report that silently described the first hundred issues
 * of a thousand would be worse than one that refused, because nothing on screen would say so.
 */
export async function fetchReworkIssues(
  scopeJql: string,
  windowDays: number,
  storyPointsFieldId = '',
): Promise<ReworkFetchResult> {
  // Resolved, never named: the field-mapping boundary exists so a custom field id lives in one place,
  // and the resolver always yields at least its own default.
  const [resolvedFieldId] = resolveStoryPointsFieldIds(storyPointsFieldId);
  const issues: ReworkIssue[] = [];
  let startAt = 0;

  for (;;) {
    const response = await jiraGet<{ issues?: RawIssue[]; total?: number }>(
      buildSearchPath(scopeJql, windowDays, resolvedFieldId, startAt),
    );
    const pageIssues = response.issues ?? [];
    pageIssues.forEach((issue) => issues.push(toReworkIssue(issue, resolvedFieldId)));

    if (pageIssues.length < ISSUE_PAGE_SIZE || issues.length >= MAX_REWORK_ISSUES) {
      return { issues, wasTruncated: issues.length >= MAX_REWORK_ISSUES };
    }
    startAt += ISSUE_PAGE_SIZE;
  }
}
