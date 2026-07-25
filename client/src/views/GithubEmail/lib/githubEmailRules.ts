// githubEmailRules.ts — The declarative classification table for GitHub notification emails.
//
// This is the FINALIZATION SEAM. Each rule maps signals in an email (the X-GitHub-Reason header, a
// Subject marker, a body marker) to one internal event type. The classifier walks this ordered list
// and the FIRST rule whose present predicates ALL match wins. Adding or correcting a pattern once you
// have real sample emails is a table edit here — never a change to the MIME parser or the classifier.
//
// ⚠️ The seed markers below are best-effort placeholders based on GitHub's documented notification
// format. They MUST be validated (and likely refined) against the team's real emails during the
// dry-run rollout. Order matters: more specific events come first (a merge email also mentions the PR).

/** The internal event vocabulary, aligned 1:1 with the repo monitor's Jira-output event types. */
export type GithubEmailEventType =
  | 'branch_created'
  | 'commit_pushed'
  | 'pr_opened'
  | 'pr_merged'
  | 'review_requested'
  | 'unknown';

/** One classification rule. A predicate that is omitted is simply not tested. */
export interface EmailClassificationRule {
  /** Stable id, surfaced on the event as matchedRuleId for auditing which rule fired. */
  id: string;
  eventType: GithubEmailEventType;
  /** Match when the X-GitHub-Reason header is one of these (case-insensitive). */
  reasonHeaderIn?: string[];
  /** Match when the Subject matches this pattern. */
  subjectMarker?: RegExp;
  /** Match when the plain-text body matches this pattern. */
  bodyMarker?: RegExp;
  /** When true, the email must carry a PR number for the rule to apply. */
  requiresPrNumber?: boolean;
}

/**
 * The ordered rule set. First match wins, so keep the most specific events (merge) above the more
 * general ones (a merge email also says "pull request"). `review_requested` sits above `commit_pushed`
 * so a review notification is not mistaken for a push.
 */
export const GITHUB_EMAIL_RULES: EmailClassificationRule[] = [
  {
    id: 'pr-merged',
    eventType: 'pr_merged',
    bodyMarker: /\bmerged\b/i,
    requiresPrNumber: true,
  },
  {
    id: 'pr-opened',
    eventType: 'pr_opened',
    bodyMarker: /opened this pull request/i,
    requiresPrNumber: true,
  },
  {
    id: 'review-requested',
    eventType: 'review_requested',
    reasonHeaderIn: ['review_requested'],
  },
  {
    id: 'review-requested-body',
    eventType: 'review_requested',
    bodyMarker: /requested your review/i,
  },
  {
    id: 'commit-pushed-reason',
    eventType: 'commit_pushed',
    reasonHeaderIn: ['push'],
  },
  {
    id: 'commit-pushed-body',
    eventType: 'commit_pushed',
    bodyMarker: /pushed \d+ commit/i,
  },
  {
    id: 'branch-created',
    eventType: 'branch_created',
    bodyMarker: /created (?:a |the )?branch/i,
  },
];
