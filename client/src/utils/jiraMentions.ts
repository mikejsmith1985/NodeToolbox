// jiraMentions.ts — Detects @-mentions of the current user inside Jira comment bodies.
//
// Jira Server stores mentions as wiki markup ("[~username]") while newer
// Atlassian Document Format (ADF) bodies embed a mention node carrying the
// user's accountId and display text. To cover both, we flatten the body to a
// searchable string and look for any token that identifies the current user.

import type { JiraComment, JiraIssue } from '../types/jira.ts';
import { normalizeRichTextToPlainText } from './richTextPlainText.ts';

const EXCERPT_MAX_LENGTH = 280;

/** The identifiers that distinguish the current user, as returned by /rest/api/2/myself. */
export interface MentionIdentity {
  /** Jira Cloud account id (absent on some Server instances). */
  accountId?: string | null;
  /** Jira Server username (absent on Cloud). */
  name?: string | null;
  /** Jira Server user key (absent on Cloud). */
  key?: string | null;
  /** Human-readable name used as a last-resort match against "@Display Name" text. */
  displayName: string;
}

/** A single comment in which the current user was @-mentioned. */
export interface JiraMention {
  /** Stable identity for the mention: `${issueKey}#${commentId}`. Used as the "addressed" key. */
  mentionKey: string;
  issueKey: string;
  commentId: string;
  issueSummary: string;
  /** Display name of whoever wrote the mentioning comment. */
  authorDisplayName: string;
  /** ISO timestamp the comment was created. */
  createdIso: string;
  /** Plain-text preview of the comment body. */
  excerpt: string;
  /** The full issue, so the UI can render the shared IssueDetailPanel for reply + context. */
  issue: JiraIssue;
}

/**
 * Returns true when a comment body @-mentions the user described by `identity`.
 * Matches Jira Server wiki markup, ADF mention nodes (by accountId), and a
 * final "@Display Name" fallback for bodies that only carry the rendered text.
 */
export function bodyContainsUserMention(body: unknown, identity: MentionIdentity): boolean {
  const haystack = flattenBodyToSearchableText(body).toLowerCase();
  if (!haystack) {
    return false;
  }
  return buildMentionTokens(identity).some((token) => haystack.includes(token));
}

/**
 * Walks every issue's comments and returns one JiraMention per comment that
 * mentions the user and was created within [windowStartMs, nowMs]. Results
 * preserve issue order, then comment order within each issue.
 */
export function collectUserMentions(
  issues: JiraIssue[],
  identity: MentionIdentity,
  windowStartMs: number,
  nowMs: number = Date.now(),
): JiraMention[] {
  const mentions: JiraMention[] = [];

  for (const issue of issues) {
    const comments = issue.fields.comment?.comments ?? [];
    for (const comment of comments) {
      if (!isCommentInWindow(comment, windowStartMs, nowMs)) {
        continue;
      }
      if (!bodyContainsUserMention(comment.body, identity)) {
        continue;
      }
      mentions.push(buildMention(issue, comment));
    }
  }

  return mentions;
}

// ── Helpers ──

/** Builds the lowercase tokens that uniquely identify the user inside a flattened body. */
function buildMentionTokens(identity: MentionIdentity): string[] {
  const tokens: string[] = [];
  if (identity.name) {
    tokens.push(`[~${identity.name}]`.toLowerCase());
  }
  if (identity.key) {
    tokens.push(`[~${identity.key}]`.toLowerCase());
  }
  if (identity.accountId) {
    // Wiki form "[~accountid:ID]" plus the JSON-quoted id form found in ADF mention nodes.
    tokens.push(`[~accountid:${identity.accountId}]`.toLowerCase());
    tokens.push(`"${identity.accountId}"`.toLowerCase());
  }
  if (identity.displayName) {
    tokens.push(`@${identity.displayName}`.toLowerCase());
  }
  return tokens.filter(Boolean);
}

/**
 * Reduces any body shape to a single searchable string. ADF/object bodies are
 * JSON-serialized so embedded mention attributes (id, text) remain matchable.
 */
function flattenBodyToSearchableText(body: unknown): string {
  if (typeof body === 'string') {
    return body;
  }
  if (body === null || body === undefined) {
    return '';
  }
  return JSON.stringify(body);
}

/** Returns true when a comment's creation time lies within the report window. */
function isCommentInWindow(comment: JiraComment, windowStartMs: number, nowMs: number): boolean {
  if (!comment.created) {
    return false;
  }
  const createdMs = new Date(comment.created).getTime();
  if (Number.isNaN(createdMs)) {
    return false;
  }
  return createdMs >= windowStartMs && createdMs <= nowMs;
}

/** Assembles the JiraMention record the UI consumes from an issue + comment pair. */
function buildMention(issue: JiraIssue, comment: JiraComment): JiraMention {
  return {
    mentionKey: `${issue.key}#${comment.id}`,
    issueKey: issue.key,
    commentId: comment.id,
    issueSummary: issue.fields.summary,
    authorDisplayName: comment.author?.displayName ?? 'Unknown',
    createdIso: comment.created ?? '',
    excerpt: normalizeRichTextToPlainText(comment.body).slice(0, EXCERPT_MAX_LENGTH),
    issue,
  };
}
