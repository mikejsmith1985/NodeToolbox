// checkInModel.ts — One developer's assigned work, reduced to what a status conversation needs.
//
// The question this answers is the one a lead asks a developer every few days: "where are these
// actually at?". Asking it well means arriving with the facts already in hand — how long each item
// has sat where it is, when anyone last touched it, whether it is now past its due date, what it is
// meant to be delivering, and what the last thing said about it was. Asking it badly means opening
// the board together and reading it out.
//
// Two decisions shape what is gathered:
//
//   - TIME IS MEASURED FROM `statuscategorychangedate`, Jira's own record of when the issue last
//     changed STAGE. It costs no changelog fetch, and it measures the thing that actually matters:
//     an item shuffled between two in-progress statuses has not started moving again, and this does
//     not pretend it has.
//   - THE LAST FEW COMMENTS COME ALONG. A status question whose answer is already written in the
//     ticket is a question that wastes somebody's afternoon, and the most recent comment is very
//     often exactly that answer.
//
// Pure: no fetch, no storage, and the clock is passed in.

import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';
import { extractFeatureKeyFromIssueFields } from '../../../utils/featureLink.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const MILLISECONDS_PER_DAY = 86_400_000;

/** How many recent comments travel with an issue. Enough for the current thread, not the history. */
export const MAX_COMMENTS_PER_ISSUE = 3;

/** How much of one comment is kept. Long enough to carry a decision, short enough for many issues. */
export const MAX_COMMENT_CHARS = 400;

/** How much of a description is kept — the opening, which is where the intent almost always is. */
export const MAX_DESCRIPTION_CHARS = 600;

/** One comment, reduced to who said it and what they said. */
export interface CheckInComment {
  authorName: string;
  createdIso: string;
  text: string;
}

/** One issue on a person's plate, as a status conversation needs it. */
export interface CheckInIssue {
  issueKey: string;
  issueType: string;
  summary: string;
  status: string;
  /** Days since the issue last changed stage. Null when Jira reported no such date. */
  daysInStage: number | null;
  /** Days since anything at all changed on the issue. Null when Jira reported no update date. */
  daysSinceUpdate: number | null;
  /** The due date as Jira holds it, or null when none is set. */
  dueDateIso: string | null;
  /** Days past due — positive when overdue, negative when still ahead, null when no due date. */
  daysPastDue: number | null;
  priority: string | null;
  storyPoints: number | null;
  /** The Feature this delivers, so the conversation can be about outcomes rather than tickets. */
  featureKey: string | null;
  featureSummary: string | null;
  description: string;
  comments: CheckInComment[];
}

/** Whole days between an ISO timestamp and now, or null when the timestamp is missing or unreadable. */
export function calendarDaysSince(isoTimestamp: string | null | undefined, nowMs: number): number | null {
  if (!isoTimestamp) {
    return null;
  }
  const thenMs = Date.parse(isoTimestamp);
  if (Number.isNaN(thenMs)) {
    return null;
  }
  return Math.max(0, Math.round((nowMs - thenMs) / MILLISECONDS_PER_DAY));
}

/**
 * Days past a due date: positive when overdue, negative when there is still time.
 *
 * Not clamped at zero, unlike the elapsed measures above. "Due in three days" and "due today" lead to
 * different conversations, and collapsing both to zero would lose the distinction that matters most.
 */
export function daysPastDueDate(dueDateIso: string | null, nowMs: number): number | null {
  if (!dueDateIso) {
    return null;
  }
  // Midday UTC, not midday local: a date-only due date parsed as local time is compared against a
  // clock that may be a whole day off it, which is exactly the off-by-one this cushion exists to stop.
  const dueMs = Date.parse(`${dueDateIso}T12:00:00Z`);
  if (Number.isNaN(dueMs)) {
    return null;
  }
  return Math.round((nowMs - dueMs) / MILLISECONDS_PER_DAY);
}

/** Trims text to a budget and says plainly when it was cut. */
function capText(text: string, budgetChars: number): string {
  const trimmed = text.trim();
  return trimmed.length <= budgetChars ? trimmed : `${trimmed.slice(0, budgetChars)}…`;
}

/**
 * Reads the most recent comments, newest first.
 *
 * Newest first because the current state of a conversation is what a status question is about; the
 * oldest comment on a long-running ticket is usually its creation, which says nothing about now.
 */
export function readRecentComments(issue: JiraIssue, nowMs: number): CheckInComment[] {
  const commentField = (issue.fields as { comment?: { comments?: unknown[] } }).comment;
  const rawComments = commentField?.comments ?? [];

  return rawComments
    .map((rawComment) => {
      const comment = rawComment as { author?: { displayName?: string }; created?: string; body?: unknown };
      return {
        authorName: comment.author?.displayName ?? 'Unknown',
        createdIso: comment.created ?? '',
        text: capText(normalizeRichTextToPlainText(comment.body), MAX_COMMENT_CHARS),
      };
    })
    .filter((comment) => comment.text !== '')
    .sort((leftComment, rightComment) => {
      const leftDays = calendarDaysSince(leftComment.createdIso, nowMs) ?? Number.MAX_SAFE_INTEGER;
      const rightDays = calendarDaysSince(rightComment.createdIso, nowMs) ?? Number.MAX_SAFE_INTEGER;
      return leftDays - rightDays;
    })
    .slice(0, MAX_COMMENTS_PER_ISSUE);
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

/** Shapes one Jira issue into the form a check-in conversation reads. */
export function buildCheckInIssue(
  issue: JiraIssue,
  options: {
    nowMs: number;
    storyPointsFieldId: string;
    featureLinkFieldId: string;
    featureSummaryByKey: ReadonlyMap<string, string>;
  },
): CheckInIssue {
  const issueFields = (issue.fields ?? {}) as Record<string, unknown>;
  const dueDateIso = (issueFields.duedate as string | null) ?? null;
  const featureKey = extractFeatureKeyFromIssueFields(issueFields, options.featureLinkFieldId);

  return {
    issueKey: issue.key,
    issueType: (issueFields.issuetype as { name?: string })?.name ?? 'Unknown',
    summary: (issueFields.summary as string) ?? '',
    status: (issueFields.status as { name?: string })?.name ?? 'Unknown',
    daysInStage: calendarDaysSince(issueFields.statuscategorychangedate as string, options.nowMs),
    daysSinceUpdate: calendarDaysSince(issueFields.updated as string, options.nowMs),
    dueDateIso,
    daysPastDue: daysPastDueDate(dueDateIso, options.nowMs),
    priority: (issueFields.priority as { name?: string })?.name ?? null,
    storyPoints: readStoryPoints(issueFields, options.storyPointsFieldId),
    featureKey,
    featureSummary: featureKey === null ? null : options.featureSummaryByKey.get(featureKey) ?? null,
    description: capText(normalizeRichTextToPlainText(issueFields.description), MAX_DESCRIPTION_CHARS),
    comments: readRecentComments(issue, options.nowMs),
  };
}

/**
 * Sorts the plate so the items most likely to need talking about come first.
 *
 * Overdue first, then whatever has sat longest without changing stage. A check-in that opens with the
 * thing due last week is a useful conversation; one that opens alphabetically is a list.
 */
export function sortByConversationUrgency(issues: readonly CheckInIssue[]): CheckInIssue[] {
  return [...issues].sort((leftIssue, rightIssue) => {
    const leftOverdue = (leftIssue.daysPastDue ?? Number.NEGATIVE_INFINITY) > 0;
    const rightOverdue = (rightIssue.daysPastDue ?? Number.NEGATIVE_INFINITY) > 0;
    if (leftOverdue !== rightOverdue) {
      return leftOverdue ? -1 : 1;
    }
    return (rightIssue.daysInStage ?? 0) - (leftIssue.daysInStage ?? 0);
  });
}
