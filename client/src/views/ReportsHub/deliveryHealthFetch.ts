// deliveryHealthFetch.ts — One read of Jira that answers every question on the dashboard.
//
// Four reports asking the same scope four separate times is four waits, four chances to disagree with
// each other, and four places for somebody to wonder which one is current. The panels only look like a
// single view if they are built from a single read.
//
// So this fetches once, with changelog history, and derives both shapes from it: where open work is
// sitting right now (the queue), and what came back after reaching delivery (the rework). Everything
// on screen is therefore the same issues, at the same moment, by construction rather than by care.

import { jiraGet } from '../../services/jiraApi.ts';
import { resolveStoryPointsFieldIds } from '../Hygiene/checks/storyPointsField.ts';
import { buildScopedJql } from './reportScopeJql.ts';
import type { QueueIssueInput } from './queueScan.ts';
import type { ReworkIssue, ReworkStatusTransition } from './reworkScan.ts';

/** One page of issues per request. */
const ISSUE_PAGE_SIZE = 100;

/** A hard stop against an unbounded scope, well past what any team's quarter holds. */
export const MAX_DELIVERY_HEALTH_ISSUES = 800;

/** Statuses Jira considers finished — open work is everything else. */
const DONE_STATUS_CATEGORY_KEY = 'done';

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
    created?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    assignee?: { displayName?: string } | null;
    [fieldId: string]: unknown;
  };
  changelog?: { histories?: RawHistory[] };
}

/** Everything the dashboard draws, from one read. */
export interface DeliveryHealthData {
  /** Open work only — what is waiting somewhere right now. */
  queueIssues: QueueIssueInput[];
  /** Every issue in scope, with its history, for the rework scan. */
  reworkIssues: ReworkIssue[];
  /** How many issues were read in total. */
  issueCount: number;
  /** True when the cap was reached, so a sample is never presented as the whole scope. */
  wasTruncated: boolean;
}

/** Changelog entries with a readable timestamp, oldest first. */
function readSortedHistories(issue: RawIssue): RawHistory[] {
  return (issue.changelog?.histories ?? [])
    .filter((history): history is RawHistory & { created: string } => typeof history.created === 'string')
    .sort((first, second) => Date.parse(first.created) - Date.parse(second.created));
}

/** Every status change on an issue, oldest first, with the status it was created in. */
export function readStatusHistory(issue: RawIssue): {
  initialStatusName: string | null;
  statusTransitions: ReworkStatusTransition[];
} {
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

/**
 * When the issue entered the status it is in now.
 *
 * The LAST status change, not the first: an issue that went To Do → In Progress → Ready for Testing
 * has been in Ready for Testing since the third move, and dating it from the first would report a wait
 * that includes the time somebody spent working on it.
 *
 * An issue that never moved has been in its status since it was created, which is the honest answer
 * rather than a null.
 */
export function readCurrentStatusEntryIso(issue: RawIssue): string | null {
  const histories = readSortedHistories(issue);
  for (let historyIndex = histories.length - 1; historyIndex >= 0; historyIndex -= 1) {
    const hasStatusChange = (histories[historyIndex].items ?? []).some((item) => item.field === 'status');
    if (hasStatusChange) {
      return histories[historyIndex].created ?? null;
    }
  }
  return issue.fields?.created ?? null;
}

/** True when Jira considers the issue finished. */
function isDoneIssue(issue: RawIssue): boolean {
  return issue.fields?.status?.statusCategory?.key === DONE_STATUS_CATEGORY_KEY;
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

/** Turns the raw issues into the two shapes the dashboard's engines read. */
export function toDeliveryHealthData(
  rawIssues: readonly RawIssue[],
  storyPointsFieldId: string,
  wasTruncated: boolean,
): DeliveryHealthData {
  const queueIssues: QueueIssueInput[] = [];
  const reworkIssues: ReworkIssue[] = [];

  rawIssues.forEach((issue) => {
    const issueFields = (issue.fields ?? {}) as Record<string, unknown>;
    const storyPoints = readStoryPoints(issueFields, storyPointsFieldId);

    reworkIssues.push({
      key: issue.key ?? '',
      summary: issue.fields?.summary ?? '',
      storyPoints,
      assigneeName: issue.fields?.assignee?.displayName ?? null,
      ...readStatusHistory(issue),
    });

    // Only open work can be waiting. A finished issue's "time in status" is time since it shipped.
    if (!isDoneIssue(issue)) {
      queueIssues.push({
        key: issue.key ?? '',
        summary: issue.fields?.summary ?? '',
        statusName: issue.fields?.status?.name ?? 'Unknown',
        assigneeName: issue.fields?.assignee?.displayName ?? null,
        enteredStatusIso: readCurrentStatusEntryIso(issue),
        storyPoints,
      });
    }
  });

  return { queueIssues, reworkIssues, issueCount: rawIssues.length, wasTruncated };
}

/** The search path for one page. */
function buildSearchPath(scopeJql: string, windowDays: number, storyPointsFieldId: string, startAt: number): string {
  const fields = ['summary', 'status', 'assignee', 'created', storyPointsFieldId].join(',');
  const jql = buildScopedJql(scopeJql, `updated >= -${windowDays}d ORDER BY updated DESC`);
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}`
    + `&expand=changelog&fields=${fields}&startAt=${startAt}&maxResults=${ISSUE_PAGE_SIZE}`;
}

/**
 * Reads the scope once, with history, and hands back everything the dashboard draws.
 *
 * Paged to the cap, and says when it hit it: a dashboard that silently described the first hundred
 * issues of a thousand would be worse than one that refused, because nothing on screen would say so.
 */
export async function fetchDeliveryHealth(
  scopeJql: string,
  windowDays: number,
  storyPointsFieldId = '',
): Promise<DeliveryHealthData> {
  const [resolvedFieldId] = resolveStoryPointsFieldIds(storyPointsFieldId);
  const rawIssues: RawIssue[] = [];
  let startAt = 0;

  for (;;) {
    const response = await jiraGet<{ issues?: RawIssue[] }>(
      buildSearchPath(scopeJql, windowDays, resolvedFieldId, startAt),
    );
    const pageIssues = response.issues ?? [];
    pageIssues.forEach((issue) => rawIssues.push(issue));

    if (pageIssues.length < ISSUE_PAGE_SIZE || rawIssues.length >= MAX_DELIVERY_HEALTH_ISSUES) {
      return toDeliveryHealthData(rawIssues, resolvedFieldId, rawIssues.length >= MAX_DELIVERY_HEALTH_ISSUES);
    }
    startAt += ISSUE_PAGE_SIZE;
  }
}
