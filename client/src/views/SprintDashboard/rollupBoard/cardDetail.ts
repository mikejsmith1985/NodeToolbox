// cardDetail.ts — The extra context a card shows once a column is opened up to full width.
//
// The board's normal card is deliberately terse: a dozen lanes times a dozen columns means anything
// longer than a summary turns the board into a wall. Focusing one status removes that constraint —
// there is a whole board's width for one column — so the card can finally answer the questions that
// otherwise cost a click each: what is this actually about, does it have attachments, and what was
// the last thing anybody said about it.
//
// These fields are NOT part of the board's normal fetch. A description and a comment thread on every
// issue would be a large payload for information nobody is looking at, so they are read only for the
// column being focused, and only when it is.

// ── Named constants ──

/** How much description to show before it stops being a card and starts being a document. */
const DESCRIPTION_EXCERPT_LENGTH = 400;

/** How much of the last comment to show. Shorter than the description: it is context, not content. */
const COMMENT_EXCERPT_LENGTH = 280;

/** What the detailed card shows beyond the terse one. */
export interface CardDetail {
  /** Trimmed description, or null when the issue has none. */
  descriptionExcerpt: string | null;
  attachmentCount: number;
  /** The most recent comment, whoever wrote it. */
  lastComment: { authorDisplayName: string; createdAt: string; excerpt: string } | null;
}

/** An empty detail, used before the fetch lands so a card never renders half-built. */
export const EMPTY_CARD_DETAIL: CardDetail = {
  descriptionExcerpt: null,
  attachmentCount: 0,
  lastComment: null,
};

/** Fields the detail read asks for — everything the terse card does not already have. */
export const CARD_DETAIL_FIELDS = ['description', 'attachment', 'comment'];

/** Collapses whitespace and cuts to length on a word boundary where one is near enough. */
export function excerpt(rawText: string, maxLength: number): string {
  const collapsed = String(rawText ?? '').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;

  const cut = collapsed.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  // Only break on a word if that word is near the end; otherwise a long token would gut the excerpt.
  const trimmed = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${trimmed}…`;
}

/**
 * Reads the detail off one Jira issue.
 *
 * The LAST comment is deliberately the most recent one whoever wrote it, including automation. A
 * thread's newest line is what tells you where something stands, and filtering bots out would hide
 * exactly the build and deployment notices that often are the latest news.
 */
export function readCardDetail(issue: { fields?: Record<string, unknown> } | undefined): CardDetail {
  const issueFields = issue?.fields ?? {};

  const rawDescription = typeof issueFields.description === 'string' ? issueFields.description : '';
  const descriptionText = excerpt(rawDescription, DESCRIPTION_EXCERPT_LENGTH);

  const attachments = Array.isArray(issueFields.attachment) ? issueFields.attachment : [];

  const comments = (issueFields.comment as { comments?: unknown[] } | undefined)?.comments ?? [];
  const newestComment = comments.length > 0
    ? comments[comments.length - 1] as {
      author?: { displayName?: string };
      created?: string;
      body?: string;
    }
    : null;

  return {
    descriptionExcerpt: descriptionText === '' ? null : descriptionText,
    attachmentCount: attachments.length,
    lastComment: newestComment
      ? {
        authorDisplayName: String(newestComment.author?.displayName ?? 'Unknown'),
        createdAt: String(newestComment.created ?? ''),
        excerpt: excerpt(String(newestComment.body ?? ''), COMMENT_EXCERPT_LENGTH),
      }
      : null,
  };
}

/** Indexes the detail reads by issue key, so a card can look up its own. */
export function buildCardDetailIndex(
  issues: readonly { key: string; fields?: Record<string, unknown> }[],
): Record<string, CardDetail> {
  const detailByIssueKey: Record<string, CardDetail> = {};
  for (const issue of issues) detailByIssueKey[issue.key] = readCardDetail(issue);
  return detailByIssueKey;
}

/** A short, readable date for a comment. Falls back to the raw value rather than inventing one. */
export function formatCommentDate(createdAt: string): string {
  const parsedDate = new Date(createdAt);
  if (Number.isNaN(parsedDate.getTime())) return createdAt;
  return parsedDate.toLocaleDateString();
}
