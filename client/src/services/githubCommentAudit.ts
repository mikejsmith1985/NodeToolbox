// githubCommentAudit.ts — Finds every Jira comment posted by the GitHub email intake automation
// so its behaviour can be quality-checked. Candidate issues come from a JQL comment search (Jira
// text search cannot use leading wildcards, so the exact word "GitHub" is the index key); precise
// matching then happens client-side against the automation's own comment signature — an emoji
// prefix followed by "GitHub: " (see EVENT_COMMENT_TEMPLATES in githubEmailIntakeScheduler.js).

import { jiraGet } from './jiraApi.ts';
import {
  correlateAutomationMoves,
  type ChangelogHistoryEntry,
  type MoveAuditRow,
} from './automationMoveAudit.ts';

// The automation's templates all open with a single emoji, a space, then "GitHub: ". Allowing the
// token to start within the first few characters keeps the match tight enough to exclude human
// comments that merely mention GitHub mid-sentence.
const SIGNATURE_TOKEN = 'GitHub: ';
const SIGNATURE_MAX_START_INDEX = 8;
// Status joins the fetch so an audited issue can say where it stands NOW, and the changelog joins it
// so a status change can be matched to the comment that accompanied it (see automationMoveAudit).
const AUDIT_SEARCH_FIELDS = 'summary,comment,status';
const AUDIT_MAX_RESULTS = 200;

export type { MoveAuditRow } from './automationMoveAudit.ts';

export interface AutomationCommentRow {
  issueKey: string;
  issueSummary: string;
  commentBody: string;
  authorDisplayName: string;
  createdIso: string;
}

export interface GithubCommentAuditResult {
  rows: AutomationCommentRow[];
  /** How many candidate issues the JQL sweep returned — surfaced so users know the search breadth. */
  scannedIssueCount: number;
  /** One row per audited ISSUE: where it stands now, and which moves the automation made. */
  moveRows: MoveAuditRow[];
}

/**
 * Builds the per-issue view: current status, and the status changes made alongside the automation's
 * own comments. Separate from the per-comment rows because the question is different — "where has it
 * commented" versus "what did it MOVE" — and the second was the half nobody could answer.
 */
export function collectAutomationMoveRows(issues: JiraAuditIssue[]): MoveAuditRow[] {
  return issues
    .map((candidateIssue) => {
      const automationCommentIsos = (candidateIssue.fields?.comment?.comments ?? [])
        .filter((issueComment) => isAutomationComment(issueComment.body ?? ''))
        .map((issueComment) => issueComment.created ?? '');
      const statusCategoryKey = candidateIssue.fields?.status?.statusCategory?.key ?? '';

      return {
        issueKey: candidateIssue.key ?? '',
        issueSummary: candidateIssue.fields?.summary ?? '',
        currentStatus: candidateIssue.fields?.status?.name ?? '(unknown)',
        isCurrentStatusDone: statusCategoryKey.toLowerCase() === 'done',
        commentCount: automationCommentIsos.length,
        automationMoves: correlateAutomationMoves(
          automationCommentIsos,
          candidateIssue.changelog?.histories ?? [],
        ),
      };
    })
    .filter((moveRow) => moveRow.commentCount > 0);
}

interface JiraCommentEnvelope {
  body?: string;
  created?: string;
  author?: { displayName?: string };
}

interface JiraAuditIssue {
  key?: string;
  fields?: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    comment?: { comments?: JiraCommentEnvelope[] };
  };
  changelog?: { histories?: ChangelogHistoryEntry[] };
}

interface JiraAuditSearchResponse {
  issues?: JiraAuditIssue[];
}

/**
 * Builds the candidate-issue JQL. Jira's text index cannot search with a leading wildcard
 * (`comment ~ "*GitHub*"` silently returns nothing) — the plain word match is the correct form.
 */
export function buildGithubCommentAuditJql(projectKeys: string[], lookbackDays: number): string {
  const normalizedKeys = projectKeys
    .map((projectKey) => projectKey.trim().toUpperCase())
    .filter((projectKey) => projectKey !== '');
  const projectClause = normalizedKeys.length > 0 ? `project in (${normalizedKeys.join(', ')}) AND ` : '';
  return `${projectClause}comment ~ "GitHub" AND updated >= -${lookbackDays}d ORDER BY updated DESC`;
}

/** Returns true when a comment body carries the automation's emoji-prefixed "GitHub: " signature. */
export function isAutomationComment(commentBody: string): boolean {
  const trimmedBody = commentBody.trimStart();
  const tokenIndex = trimmedBody.indexOf(SIGNATURE_TOKEN);
  return tokenIndex >= 0 && tokenIndex <= SIGNATURE_MAX_START_INDEX;
}

/** Flattens candidate issues into automation-comment rows, newest first. */
export function collectAutomationComments(issues: JiraAuditIssue[]): AutomationCommentRow[] {
  const auditRows: AutomationCommentRow[] = [];
  for (const candidateIssue of issues) {
    const issueComments = candidateIssue.fields?.comment?.comments ?? [];
    for (const issueComment of issueComments) {
      const commentBody = issueComment.body ?? '';
      if (!isAutomationComment(commentBody)) continue;
      auditRows.push({
        issueKey: candidateIssue.key ?? '',
        issueSummary: candidateIssue.fields?.summary ?? '',
        commentBody,
        authorDisplayName: issueComment.author?.displayName ?? '',
        createdIso: issueComment.created ?? '',
      });
    }
  }
  return auditRows.sort((firstRow, secondRow) => secondRow.createdIso.localeCompare(firstRow.createdIso));
}

/** Runs the audit sweep: JQL candidate search, then client-side signature matching per comment. */
export async function fetchGithubAutomationComments(
  projectKeys: string[],
  lookbackDays: number,
): Promise<GithubCommentAuditResult> {
  const auditJql = buildGithubCommentAuditJql(projectKeys, lookbackDays);
  const searchPath =
    `/rest/api/2/search?jql=${encodeURIComponent(auditJql)}` +
    `&fields=${encodeURIComponent(AUDIT_SEARCH_FIELDS)}&expand=changelog&maxResults=${AUDIT_MAX_RESULTS}`;
  const searchResponse = await jiraGet<JiraAuditSearchResponse>(searchPath);
  const candidateIssues = searchResponse.issues ?? [];
  return {
    rows: collectAutomationComments(candidateIssues),
    scannedIssueCount: candidateIssues.length,
    moveRows: collectAutomationMoveRows(candidateIssues),
  };
}
