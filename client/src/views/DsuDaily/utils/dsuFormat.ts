// dsuFormat.ts — Pure formatting and classification helpers for DSU Daily standup drafts.

const DEFAULT_EMPTY_BULLET_TEXT = '• (no items)';
const ISO_DATE_LENGTH = 10;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const DONE_STATUS_CATEGORY_KEY = 'done';

export interface DsuIssue {
  key: string;
  fields: {
    summary?: string | null;
    updated?: string | null;
    status?: {
      statusCategory?: {
        key?: string | null;
      } | null;
    } | null;
  };
}

export interface DsuDraft {
  yesterday: string;
  today: string;
  blockers: string;
}

export interface ClassifiedDsuIssues {
  yesterdayList: DsuIssue[];
  todayList: DsuIssue[];
}

/** Builds the Jira-ready bullet list users can edit before sharing their standup. */
export function buildBulletList(issues: DsuIssue[], fallbackText = DEFAULT_EMPTY_BULLET_TEXT): string {
  if (issues.length === 0) return fallbackText;
  return issues.map((issue) => `• ${issue.key} - ${issue.fields.summary ?? ''}`).join('\n');
}

/** Formats the complete Jira comment body so copy and post always share the same text. */
export function formatStandupText(draft: DsuDraft): string {
  const blockersText = draft.blockers.trim() ? draft.blockers : 'None';
  return `*Yesterday*\n${draft.yesterday}\n\n*Today*\n${draft.today}\n\n*Blockers*\n${blockersText}`;
}

/** Splits Jira activity into yesterday's updates and all currently assigned non-done work. */
export function classifyByDate(issues: DsuIssue[], todayIso: string): ClassifiedDsuIssues {
  const yesterdayIso = calculatePreviousIsoDate(todayIso);
  return {
    yesterdayList: issues.filter((issue) => getUpdatedIsoDate(issue) === yesterdayIso),
    todayList: issues.filter((issue) => !isDoneIssue(issue)),
  };
}

function calculatePreviousIsoDate(todayIso: string): string {
  const todayDate = new Date(`${todayIso}T00:00:00.000Z`);
  return new Date(todayDate.getTime() - MILLISECONDS_PER_DAY).toISOString().slice(0, ISO_DATE_LENGTH);
}

function getUpdatedIsoDate(issue: DsuIssue): string {
  return (issue.fields.updated ?? '').slice(0, ISO_DATE_LENGTH);
}

function isDoneIssue(issue: DsuIssue): boolean {
  return issue.fields.status?.statusCategory?.key === DONE_STATUS_CATEGORY_KEY;
}
