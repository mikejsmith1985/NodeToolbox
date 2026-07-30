// classifyGithubEmail.ts — Turns a parsed GitHub notification email into a normalized event.
//
// Pure and deterministic (no AI). It reads stable GitHub email conventions — the List-ID header for
// the repo, the Subject for the title and PR number, X-GitHub-Reason as a coarse hint — and applies
// the ordered rules in githubEmailRules.ts to pick an event type. The Jira key is pulled from the
// branch/subject/body with the same key pattern the PI Review tools use.

import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';
import { getHeader, parseMime, type MimeMessage } from './parseMime.ts';
import {
  compileCustomRules,
  GITHUB_EMAIL_RULES,
  type EmailClassificationRule,
  type GithubEmailEventType,
  type SerializedEmailRule,
} from './githubEmailRules.ts';

/** The robust Jira key pattern, copied from piReviewJira.ts to keep this lib browser-free. */
const JIRA_KEY_PATTERN = /\b[A-Z][A-Z0-9]+-\d+\b/i;

/** One normalized GitHub event, ready to drive a Jira comment + transition. */
export interface GitHubEmailEvent {
  eventType: GithubEmailEventType;
  jiraKey: string | null;
  repo: string | null;
  prNumber: number | null;
  branch: string | null;
  actor: string | null;
  /** ISO-8601 time the event occurred, from the email Date header; used only for comment text. */
  occurredAtIso: string | null;
  /** The email's Message-ID — the primary idempotency key. */
  sourceMessageId: string | null;
  subjectTitle: string | null;
  matchedRuleId: string | null;
}

/** Reads the "owner/repo" from the List-ID header (`<repo.owner.github.com>`) or the Subject `[owner/repo]`. */
function readRepo(message: MimeMessage, subject: string): string | null {
  const listId = getHeader(message, 'list-id');
  if (listId) {
    const bracketMatch = listId.match(/<([^>]+)>/);
    const host = bracketMatch ? bracketMatch[1] : listId;
    const withoutSuffix = host.replace(/\.github\.com$/i, '').trim();
    const segments = withoutSuffix.split('.');
    if (segments.length >= 2) {
      const repo = segments[0];
      const owner = segments[1];
      return `${owner}/${repo}`;
    }
  }
  const subjectMatch = subject.match(/\[([^\]/]+\/[^\]]+)\]/);
  return subjectMatch ? subjectMatch[1] : null;
}

/** Strips the `[owner/repo]` prefix and trailing `(#123)` from a Subject to get a readable title. */
function readSubjectTitle(subject: string): string | null {
  const title = subject
    .replace(/^\s*(?:re:\s*)?\[[^\]]+\]\s*/i, '')
    .replace(/\s*\(#\d+\)\s*$/i, '')
    .trim();
  return title === '' ? null : title;
}

/** Finds the PR number in the Subject `(#123)` or the body `#123`. */
function readPrNumber(subject: string, bodyText: string): number | null {
  const subjectMatch = subject.match(/\(#(\d+)\)/) || subject.match(/#(\d+)/);
  if (subjectMatch) {
    return Number(subjectMatch[1]);
  }
  const bodyMatch = bodyText.match(/#(\d+)/);
  return bodyMatch ? Number(bodyMatch[1]) : null;
}

/**
 * Finds a branch reference in the body — only from HIGH-CONFIDENCE phrases. A GitHub notification body is
 * full of footer and commit-message prose, so a loose "from <word>" match grabs junk (e.g. "from an email"
 * → "an") and, worse, could turn "revert change from PROJ-1" into a branch that then yields a wrong Jira
 * key. This matches only the real branch phrasings GitHub uses.
 */
function readBranch(bodyText: string): string | null {
  // Trailing sentence punctuation must not become part of the branch name.
  const stripTrailingPunctuation = (value: string): string => value.replace(/[.,;:]+$/, '');
  // Cross-fork PRs name the head as "owner:branch" — require that colon form so ordinary prose cannot match.
  const forkMatch = bodyText.match(/\bfrom\s+([\w.-]+:[\w./-]+)/i);
  if (forkMatch) {
    return stripTrailingPunctuation(forkMatch[1]);
  }
  // Same-repo PRs: the "into <base> from <head>" phrase, anchored by "into … from".
  const intoFromMatch = bodyText.match(/\binto\s+[\w./-]+\s+from\s+([\w./-]+)/i);
  if (intoFromMatch) {
    return stripTrailingPunctuation(intoFromMatch[1]);
  }
  // A feature-style branch reference anywhere.
  const featureMatch = bodyText.match(/\b(feature\/[\w./-]+)/i);
  return featureMatch ? stripTrailingPunctuation(featureMatch[1]) : null;
}

/** Extracts the first Jira key from any of the candidate strings, upper-cased. */
function readJiraKey(candidates: Array<string | null>): string | null {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const match = candidate.match(JIRA_KEY_PATTERN);
    if (match) {
      return match[0].toUpperCase();
    }
  }
  return null;
}

/** Parses the Date header into an ISO string, or null when it is missing/unparseable. */
function readOccurredAtIso(message: MimeMessage): string | null {
  const dateHeader = getHeader(message, 'date');
  if (!dateHeader) {
    return null;
  }
  const parsedMs = Date.parse(dateHeader);
  return Number.isNaN(parsedMs) ? null : new Date(parsedMs).toISOString();
}

/** Reads the acting user from X-GitHub-Sender, or the first `@login` mention in the body. */
function readActor(message: MimeMessage, bodyText: string): string | null {
  const sender = getHeader(message, 'x-github-sender');
  if (sender) {
    return sender;
  }
  const mentionMatch = bodyText.match(/@([A-Za-z0-9-]+)/);
  return mentionMatch ? mentionMatch[1] : null;
}

/** Applies the ordered rule table; returns the matched event type and rule id, or 'unknown'. */
function classifyEventType(
  reason: string | null,
  subject: string,
  bodyText: string,
  prNumber: number | null,
  rules: readonly EmailClassificationRule[],
): { eventType: GithubEmailEventType; matchedRuleId: string | null } {
  const normalizedReason = (reason || '').trim().toLowerCase();
  for (const rule of rules) {
    if (rule.requiresPrNumber && prNumber === null) {
      continue;
    }
    if (rule.reasonHeaderIn && !rule.reasonHeaderIn.some((value) => value.toLowerCase() === normalizedReason)) {
      continue;
    }
    if (rule.subjectMarker && !rule.subjectMarker.test(subject)) {
      continue;
    }
    if (rule.bodyMarker && !rule.bodyMarker.test(bodyText)) {
      continue;
    }
    // A rule with NO predicates would match everything; the seed table never has one, but guard anyway.
    if (!rule.reasonHeaderIn && !rule.subjectMarker && !rule.bodyMarker) {
      continue;
    }
    return { eventType: rule.eventType, matchedRuleId: rule.id };
  }
  return { eventType: 'unknown', matchedRuleId: null };
}

/**
 * Classifies a parsed GitHub notification email into a normalized, deterministic event. Any config-driven
 * custom rules are evaluated BEFORE the built-in table, so a user-authored rule can override or extend the
 * seed without a code change.
 */
export function classifyGithubEmail(
  message: MimeMessage,
  customRules: readonly SerializedEmailRule[] = [],
): GitHubEmailEvent {
  const subject = getHeader(message, 'subject') || '';
  // Prefer the plain-text body; fall back to flattening the HTML alternative with the shared helper.
  const bodyText = message.textPlain !== null
    ? message.textPlain
    : (message.textHtml !== null ? normalizeRichTextToPlainText(message.textHtml) : '');

  const repo = readRepo(message, subject);
  const subjectTitle = readSubjectTitle(subject);
  const prNumber = readPrNumber(subject, bodyText);
  const branch = readBranch(bodyText);
  const reason = getHeader(message, 'x-github-reason');
  // Custom rules first (user overrides win), then the built-in seed table. A custom rule that reuses a built-in's
  // id SUPERSEDES that built-in entirely — this is how "customizing a default" works: an editable copy (with the
  // same id) fully replaces the code default, so disabling that copy truly disables the classification.
  const supersededBuiltinIds = new Set((customRules || []).map((customRule) => customRule.id));
  const activeBuiltinRules = GITHUB_EMAIL_RULES.filter((builtinRule) => !supersededBuiltinIds.has(builtinRule.id));
  const rules = [...compileCustomRules(customRules), ...activeBuiltinRules];
  const { eventType, matchedRuleId } = classifyEventType(reason, subject, bodyText, prNumber, rules);

  return {
    eventType,
    // The key is read from the SUBJECT (the PR title, where this team puts it, and the most reliable source)
    // then the extracted BRANCH — never the free-text body. A key referenced in a commit message or footer
    // ("revert change from PROJ-9") must not attach the event to the wrong ticket; a PR with no key in its
    // title or branch safely classifies as no-jira-key and is skipped rather than mis-attributed.
    jiraKey: readJiraKey([subject, branch]),
    repo,
    prNumber,
    branch,
    actor: readActor(message, bodyText),
    occurredAtIso: readOccurredAtIso(message),
    sourceMessageId: getHeader(message, 'message-id'),
    subjectTitle,
    matchedRuleId,
  };
}

/** Convenience: parse a raw email source and classify it in one call, with optional custom rules. */
export function parseGithubEmail(
  rawSource: string,
  customRules: readonly SerializedEmailRule[] = [],
): GitHubEmailEvent {
  return classifyGithubEmail(parseMime(rawSource), customRules);
}
