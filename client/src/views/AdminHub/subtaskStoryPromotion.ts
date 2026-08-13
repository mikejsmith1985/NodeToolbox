// subtaskStoryPromotion.ts — Promotes Jira sub-tasks into Stories that link back to their old parent.
//
// Jira has no REST route that changes an issue's type from Sub-task to Story. In the Jira UI that is the
// "Move" wizard, and Atlassian never exposed it to the API. So a promotion here is really: create a new
// Story carrying the sub-task's field values, link it back to the parent, and only then retire the
// original. Nothing is mutated in place, which is also what makes the operation reviewable before it runs.
//
// The subtle part is the LINK DIRECTION. "Contained within" is one half of a paired link type — the other
// half reads "contains" — and Jira decides which phrase a person sees from which side of the link an
// issue sits on. Put the Story on the wrong side and every promoted Story reads "contains its parent",
// which is backwards and tedious to unpick in bulk. That direction is resolved from the instance's own
// link-type catalogue here, never assumed.

import type { JiraIssue } from '../../types/jira.ts';

// ── Named constants ──

/** The relationship the promoted Story should show when a person opens it. */
export const DEFAULT_CONTAINMENT_PHRASE = 'contained within';

/** Fields carried from the sub-task onto the new Story. Anything not listed is deliberately dropped. */
export const CARRIED_FIELD_NAMES = ['summary', 'description', 'assignee', 'priority', 'labels'] as const;

// ── Reporting a failed request ──

/** Marks the end of the request description and the start of what Jira actually said. */
const JIRA_FAILURE_SEPARATOR = ' failed: ';

/**
 * Pulls the readable complaint out of a failed Jira request message.
 *
 * `jiraApi` throws "GET <url> failed: <status> — <what Jira said>". For a bad JQL that url carries the
 * entire percent-encoded query, which shoves Jira's actual sentence hundreds of characters to the right
 * and makes a one-character typo — an unclosed quote, say — read like a system fault. The status and
 * Jira's own words are kept; the encoded url is dropped, because the operator can already see their
 * query in the box they typed it into.
 */
export function describeJiraFailure(rawErrorMessage: string): string {
  const rawMessage = String(rawErrorMessage || '').trim();
  const separatorIndex = rawMessage.indexOf(JIRA_FAILURE_SEPARATOR);
  if (separatorIndex === -1) return rawMessage;

  const failureDetail = rawMessage.slice(separatorIndex + JIRA_FAILURE_SEPARATOR.length).trim();
  return failureDetail || rawMessage;
}

// ── Link direction ──

/** One entry of GET /rest/api/2/issueLinkType. */
export interface JiraIssueLinkType {
  id?: string;
  name?: string;
  inward?: string;
  outward?: string;
}

/** Which side of a new issue link each issue must occupy for the phrase to read correctly. */
export interface ContainmentLinkDirection {
  linkTypeName: string;
  /** The phrase a person will see on the promoted Story. */
  storySeesPhrase: string;
  /** True when the Story belongs in `inwardIssue` and the old parent in `outwardIssue`. */
  isStoryTheInwardIssue: boolean;
}

/** Loosens a link phrase so "is contained within" and "Contained within" compare equal. */
function normalizeLinkPhrase(linkPhrase: string): string {
  return String(linkPhrase || '')
    .toLowerCase()
    .replace(/^is\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Finds the link type that expresses containment and works out which side the new Story goes on.
 *
 * Jira stores a link as outwardIssue --(outward phrase)--> inwardIssue. Whoever sits in `inwardIssue`
 * is the one who reads the INWARD phrase. So if "contained within" is the type's inward phrase, the
 * Story is the inward issue; if it is the outward phrase, the Story is the outward issue instead.
 *
 * @returns The resolved direction, or null when this instance has no such link type — in which case the
 *          caller must stop and say so rather than fall back to some other relationship.
 */
export function resolveContainmentLinkDirection(
  linkTypeCatalog: readonly JiraIssueLinkType[],
  desiredPhrase: string = DEFAULT_CONTAINMENT_PHRASE,
): ContainmentLinkDirection | null {
  const wantedPhrase = normalizeLinkPhrase(desiredPhrase);

  for (const linkType of linkTypeCatalog ?? []) {
    const linkTypeName = String(linkType.name || '');
    if (!linkTypeName) continue;

    if (normalizeLinkPhrase(linkType.inward || '') === wantedPhrase) {
      return { linkTypeName, storySeesPhrase: String(linkType.inward), isStoryTheInwardIssue: true };
    }
    if (normalizeLinkPhrase(linkType.outward || '') === wantedPhrase) {
      return { linkTypeName, storySeesPhrase: String(linkType.outward), isStoryTheInwardIssue: false };
    }
  }

  return null;
}

/**
 * Builds the issue-link request that makes the new Story read "contained within" its old parent.
 *
 * Jira's create payload does NOT name each issue by the phrase it will display — it is the other way
 * round, and getting that backwards is what produced links reading "the Dev story is contained within
 * the SL story". Posting `{ inwardIssue: I, outwardIssue: O }` creates a link that reads:
 *
 *     I <outward phrase> O          and equivalently          O <inward phrase> I
 *
 * So the issue that should DISPLAY the inward phrase — here the new Story, which must read "contained
 * within" — has to be sent as the `outwardIssue`. Confirmed against a real link on this instance: we
 * posted the Story as `inwardIssue` and Jira showed the PARENT as the contained one.
 */
export function buildContainmentLinkInput(
  direction: ContainmentLinkDirection,
  newStoryKey: string,
  parentKey: string,
): { type: { name: string }; inwardIssue: { key: string }; outwardIssue: { key: string } } {
  // `isStoryTheInwardIssue` means the story should show the link type's INWARD phrase, which — per the
  // note above — makes it the outwardIssue of the request.
  return {
    type: { name: direction.linkTypeName },
    inwardIssue: { key: direction.isStoryTheInwardIssue ? parentKey : newStoryKey },
    outwardIssue: { key: direction.isStoryTheInwardIssue ? newStoryKey : parentKey },
  };
}

// ── Building the new Story ──

export interface StoryCreateOptions {
  /** Jira issue type id for the target type, read from the project's create metadata. */
  storyIssueTypeId: string;
  /** Project the Story is created in. Defaults to the sub-task's own project. */
  projectKey?: string;
  /** Appends a line naming the sub-task and parent this Story came from. */
  shouldRecordProvenance?: boolean;
}

/** The project a sub-task belongs to, derived from its key when Jira did not expand the project field. */
function readProjectKey(subtaskIssue: JiraIssue): string {
  const issueFields = subtaskIssue.fields as unknown as { project?: { key?: string } };
  if (issueFields.project?.key) return String(issueFields.project.key);
  return String(subtaskIssue.key || '').split('-')[0];
}

/** One line recording where this Story came from, so the promotion is never guesswork later. */
function buildProvenanceNote(subtaskIssue: JiraIssue, parentKey: string): string {
  const statusName = (subtaskIssue.fields as unknown as { status?: { name?: string } }).status?.name;
  const statusNote = statusName ? `, status "${statusName}"` : '';
  return `\n\n---\nPromoted from sub-task ${subtaskIssue.key} of ${parentKey}${statusNote}.`;
}

/**
 * Builds the create payload for the Story that replaces one sub-task.
 *
 * Only the fields in CARRIED_FIELD_NAMES cross over. A new issue cannot be created directly into a
 * chosen status — Jira always starts it at the workflow's first step — so the original status is
 * recorded in the description rather than quietly lost.
 */
export function buildStoryCreatePayload(
  subtaskIssue: JiraIssue,
  parentKey: string,
  options: StoryCreateOptions,
): { fields: Record<string, unknown> } {
  const issueFields = subtaskIssue.fields as unknown as Record<string, unknown>;
  const assignee = issueFields.assignee as { name?: string; key?: string; accountId?: string } | null;
  const priority = issueFields.priority as { id?: string } | null;

  const description = String(issueFields.description || '')
    + (options.shouldRecordProvenance === false ? '' : buildProvenanceNote(subtaskIssue, parentKey));

  const createFields: Record<string, unknown> = {
    project: { key: options.projectKey || readProjectKey(subtaskIssue) },
    issuetype: { id: options.storyIssueTypeId },
    summary: String(issueFields.summary || '').replace(/\s+/g, ' ').trim(),
    description,
  };

  // Data Center identifies a user by username; `accountId` is a Jira Cloud concept and is not accepted.
  const assigneeUserId = assignee?.name || assignee?.key || assignee?.accountId;
  if (assigneeUserId) createFields.assignee = { name: assigneeUserId };
  if (priority?.id) createFields.priority = { id: priority.id };
  if (Array.isArray(issueFields.labels) && issueFields.labels.length > 0) {
    createFields.labels = [...(issueFields.labels as string[])];
  }

  return { fields: createFields };
}

// ── Matching the original status ──

/** One entry of GET /rest/api/2/issue/{key}/transitions. */
export interface JiraTransition {
  id?: string;
  name?: string;
  to?: { name?: string };
}

/**
 * Finds the transition that lands the new Story on the same status the sub-task held.
 *
 * A brand-new issue always starts at the first workflow step, so without this every promoted Story would
 * silently reset to "To Do" no matter how far the sub-task had got. Where no single transition reaches
 * that status, null is returned and the caller reports it rather than leaving the Story somewhere
 * arbitrary.
 */
export function findTransitionToStatus(
  availableTransitions: readonly JiraTransition[],
  targetStatusName: string,
): JiraTransition | null {
  const wantedStatus = String(targetStatusName || '').trim().toLowerCase();
  if (!wantedStatus) return null;

  return (availableTransitions ?? []).find(
    (transition) => String(transition.to?.name || '').trim().toLowerCase() === wantedStatus,
  ) ?? null;
}

// ── The promotion plan ──

export interface SubtaskPromotionRow {
  subtaskKey: string;
  parentKey: string | null;
  summary: string;
  statusName: string;
  assigneeDisplayName: string | null;
  /** Reasons this row cannot be promoted; empty means it is ready to run. */
  blockingReasons: string[];
}

export interface SubtaskPromotionPlan {
  rows: SubtaskPromotionRow[];
  promotableCount: number;
  blockedCount: number;
}

/** Reads the parent key Jira returned for a sub-task, or null when it has none. */
function readParentKey(subtaskIssue: JiraIssue): string | null {
  const parentKey = (subtaskIssue.fields as unknown as { parent?: { key?: string } }).parent?.key;
  return parentKey ? String(parentKey) : null;
}

/**
 * Turns the selected sub-tasks into the preview a person approves before anything is created.
 *
 * Every reason a row cannot run is collected rather than thrown, so one unusable sub-task never hides
 * the rest of the batch — the operator sees the whole picture in one pass.
 */
export function buildPromotionPlan(
  subtaskIssues: readonly JiraIssue[],
  direction: ContainmentLinkDirection | null,
): SubtaskPromotionPlan {
  const rows = subtaskIssues.map((subtaskIssue) => {
    const issueFields = subtaskIssue.fields as unknown as {
      summary?: string;
      status?: { name?: string };
      assignee?: { displayName?: string };
    };
    const parentKey = readParentKey(subtaskIssue);
    const blockingReasons: string[] = [];

    if (!parentKey) blockingReasons.push('No parent issue to link back to');
    if (!direction) blockingReasons.push(`No "${DEFAULT_CONTAINMENT_PHRASE}" link type on this Jira`);
    if (!String(issueFields.summary || '').trim()) blockingReasons.push('No summary');

    return {
      subtaskKey: String(subtaskIssue.key),
      parentKey,
      summary: String(issueFields.summary || ''),
      statusName: String(issueFields.status?.name || ''),
      assigneeDisplayName: issueFields.assignee?.displayName ?? null,
      blockingReasons,
    };
  });

  return {
    rows,
    promotableCount: rows.filter((row) => row.blockingReasons.length === 0).length,
    blockedCount: rows.filter((row) => row.blockingReasons.length > 0).length,
  };
}
