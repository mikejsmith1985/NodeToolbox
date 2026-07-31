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

/**
 * The internal event vocabulary. The named types align 1:1 with the repo monitor's Jira-output event types;
 * the open `(string & {})` arm lets an operator add a NEW bucket via an AI-authored rule (e.g. `pr_approved`,
 * `pr_closed`) without a code change. A custom bucket is comment-only — it posts a plain Jira comment and never
 * triggers a status transition, which only the named types with a configured transition do.
 */
export type GithubEmailEventType =
  | 'branch_created'
  | 'commit_pushed'
  | 'pr_opened'
  | 'pr_merged'
  | 'review_requested'
  | 'unknown'
  | (string & {});

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
    // GitHub's merge notification body is "Merged #N into <base>." Require the "merged … into" shape rather
    // than a bare "merged", so a PUSH email whose commit message merely mentions "merged" is not misread as
    // a merge. (Refine against a real merged sample during rollout.)
    bodyMarker: /\bmerged\b[^\n]*\binto\b/i,
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

// ── Custom rules (config-driven, AI-authored) ────────────────────────────────────────────────────────
//
// The built-in table above is the seed. A user can add their OWN rules — authored with the AI-assist rule
// generator and stored in config — WITHOUT a code change. Because config is JSON, a custom rule stores its
// Subject/body patterns as regex SOURCE STRINGS (not RegExp objects), compiled here. Custom rules are
// evaluated BEFORE the built-ins (see classifyGithubEmail), so a user rule can override or extend the seed.

/** The known event types offered in the AI prompt. A custom rule MAY also coin its OWN new slug (below). */
export const CLASSIFIABLE_EVENT_TYPES: string[] = [
  'branch_created', 'commit_pushed', 'pr_opened', 'pr_merged', 'review_requested',
];

/** Longest a custom event-type slug may be, so a bucket id stays a short readable label. */
const MAX_EVENT_TYPE_LENGTH = 40;
/** A safe event-type slug: letter-led, then letters/digits in snake or kebab groups — no spaces or symbols. */
const EVENT_TYPE_SLUG = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/i;
/** 'unknown' is the reserved catch-all a rule must never classify TO. */
const RESERVED_EVENT_TYPES = ['unknown'];

/**
 * True when a value is a usable event type: any known type, OR a NEW safe custom slug. This is what lets the
 * AI intake form new buckets — a rule may name an event type outside the built-in set as long as it is a tidy
 * snake/kebab slug and not the reserved 'unknown'. Rejecting odd characters keeps a custom bucket safe to
 * render and to use as a dedup-key fragment.
 */
export function isClassifiableEventType(value: unknown): boolean {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_EVENT_TYPE_LENGTH
    && EVENT_TYPE_SLUG.test(value)
    && !RESERVED_EVENT_TYPES.includes(value.toLowerCase());
}

/** A JSON-safe custom rule as stored in config and produced by the AI-assist generator. */
export interface SerializedEmailRule {
  id: string;
  eventType: GithubEmailEventType;
  reasonHeaderIn?: string[];
  /** Regex SOURCE for the Subject (compiled case-insensitively). */
  subjectPattern?: string;
  /** Regex SOURCE for the body (compiled case-insensitively). */
  bodyPattern?: string;
  requiresPrNumber?: boolean;
  // ── Operator-controlled action fields (set in the Rules panel, NOT asked of the AI) ──
  /** When false the rule is kept but SKIPPED during classification (an operator on/off switch). */
  isEnabled?: boolean;
  /** Operator's Jira comment text for this rule; overrides the built-in template for the event type. */
  comment?: string;
  /** Operator's Jira status to transition to when this rule fires; blank/absent = comment only. */
  transitionStatus?: string;
  // ── Parent-story actions (the merged branch names the dev SUB-TASK; the story is what the team tracks) ──
  /** Status to move the matched issue's PARENT story to (e.g. "Ready for Testing"); absent = no parent move. */
  parentTransitionStatus?: string;
  /** Option to set on the parent's Sub-status dropdown; absent = no Sub-status write. */
  parentSubStatusValue?: string;
  /** When false, the parent moves on the FIRST merge instead of waiting for every coding sub-task to be Done. */
  parentRequiresAllDevDone?: boolean;
}

/** True when a string is a valid regular expression (so an AI-authored pattern can't crash the engine). */
function isCompilableRegex(pattern: string): boolean {
  try {
    RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates and normalizes an untrusted object into a SerializedEmailRule, or returns null. A rule must
 * name a known event type, carry at least one predicate, and have only compilable patterns — so a
 * malformed AI reply or a hand-edited config entry is rejected cleanly rather than misclassifying mail.
 */
export function validateSerializedRule(candidate: unknown): SerializedEmailRule | null {
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }
  const raw = candidate as Record<string, unknown>;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const eventType = typeof raw.eventType === 'string' ? raw.eventType.trim() : '';
  // A known type OR a new custom slug is accepted; only an empty id or an unusable event type is rejected.
  if (id === '' || !isClassifiableEventType(eventType)) {
    return null;
  }

  const rule: SerializedEmailRule = { id, eventType };
  if (Array.isArray(raw.reasonHeaderIn)) {
    const reasons = raw.reasonHeaderIn.filter((value): value is string => typeof value === 'string' && value.trim() !== '');
    if (reasons.length > 0) {
      rule.reasonHeaderIn = reasons;
    }
  }
  if (typeof raw.subjectPattern === 'string' && raw.subjectPattern !== '' && isCompilableRegex(raw.subjectPattern)) {
    rule.subjectPattern = raw.subjectPattern;
  }
  if (typeof raw.bodyPattern === 'string' && raw.bodyPattern !== '' && isCompilableRegex(raw.bodyPattern)) {
    rule.bodyPattern = raw.bodyPattern;
  }
  if (raw.requiresPrNumber === true) {
    rule.requiresPrNumber = true;
  }
  // Operator action fields survive a round-trip through validation (the AI never sets these; the Rules panel
  // does). Only a meaningful "off" is stored for isEnabled so the common enabled case stays absent/clean.
  if (raw.isEnabled === false) {
    rule.isEnabled = false;
  }
  if (typeof raw.comment === 'string' && raw.comment.trim() !== '') {
    rule.comment = raw.comment;
  }
  if (typeof raw.transitionStatus === 'string' && raw.transitionStatus.trim() !== '') {
    rule.transitionStatus = raw.transitionStatus;
  }
  // Parent-story action fields round-trip like the other operator fields; the guard defaults ON, so
  // only a meaningful "off" is stored.
  if (typeof raw.parentTransitionStatus === 'string' && raw.parentTransitionStatus.trim() !== '') {
    rule.parentTransitionStatus = raw.parentTransitionStatus.trim();
  }
  if (typeof raw.parentSubStatusValue === 'string' && raw.parentSubStatusValue.trim() !== '') {
    rule.parentSubStatusValue = raw.parentSubStatusValue.trim();
  }
  if (raw.parentRequiresAllDevDone === false) {
    rule.parentRequiresAllDevDone = false;
  }

  // A rule with no predicates would match every email — reject it.
  if (rule.reasonHeaderIn === undefined && rule.subjectPattern === undefined && rule.bodyPattern === undefined) {
    return null;
  }
  return rule;
}

/** Compiles one serialized rule to a runnable EmailClassificationRule, or null when it is invalid or disabled. */
export function compileCustomRule(candidate: unknown): EmailClassificationRule | null {
  const serialized = validateSerializedRule(candidate);
  if (serialized === null) {
    return null;
  }
  // A disabled rule stays in config but is never applied — as if it were not there.
  if (serialized.isEnabled === false) {
    return null;
  }
  const rule: EmailClassificationRule = { id: serialized.id, eventType: serialized.eventType };
  if (serialized.reasonHeaderIn) {
    rule.reasonHeaderIn = serialized.reasonHeaderIn;
  }
  if (serialized.subjectPattern) {
    rule.subjectMarker = new RegExp(serialized.subjectPattern, 'i');
  }
  if (serialized.bodyPattern) {
    rule.bodyMarker = new RegExp(serialized.bodyPattern, 'i');
  }
  if (serialized.requiresPrNumber) {
    rule.requiresPrNumber = true;
  }
  return rule;
}

/**
 * A stable signature of what a rule MATCHES — its event type plus its predicates — ignoring the id and the
 * operator action fields (comment / transition / on-off). Two rules with the same signature are duplicates:
 * they classify the same emails the same way, so keeping both only clutters the list. Used to reject a rule
 * whose matcher already exists under a different id.
 */
export function ruleSignature(rule: SerializedEmailRule): string {
  const reasons = (rule.reasonHeaderIn ?? []).map((value) => value.trim().toLowerCase()).sort().join('|');
  return [
    'type:' + String(rule.eventType).trim().toLowerCase(),
    'reason:' + reasons,
    'subject:' + (rule.subjectPattern ?? ''),
    'body:' + (rule.bodyPattern ?? ''),
    'pr:' + (rule.requiresPrNumber ? '1' : '0'),
  ].join('§');
}

/** Compiles a list of serialized custom rules, dropping any that are invalid. */
export function compileCustomRules(candidates: unknown): EmailClassificationRule[] {
  const list = Array.isArray(candidates) ? candidates : [];
  return list.map(compileCustomRule).filter((rule): rule is EmailClassificationRule => rule !== null);
}

/** One event type that more than one running rule produces — surfaced as a soft, non-blocking warning. */
export interface EventTypeOverlap {
  eventType: string;
  ruleCount: number;
}

/**
 * Finds event types that more than one RUNNING rule produces, so the panel can softly warn about overlap
 * (first match wins, so a later rule only applies when the earlier one misses — usually fine, occasionally a
 * mistake). "Running" = enabled custom rules plus built-ins not superseded by a custom id. Only overlaps that
 * a CUSTOM rule takes part in are reported: the shipped built-in pairs (two ways to spot review_requested /
 * commit_pushed) are intentional and would otherwise warn on a fresh install for no reason.
 */
export function findEventTypeOverlaps(
  customRules: readonly SerializedEmailRule[],
  defaultRules: readonly SerializedEmailRule[],
): EventTypeOverlap[] {
  const customIds = new Set(customRules.map((rule) => rule.id));
  const runningCustom = customRules.filter((rule) => rule.isEnabled !== false);
  const runningBuiltins = defaultRules.filter((rule) => !customIds.has(rule.id));

  const countByEventType = new Map<string, number>();
  for (const rule of [...runningCustom, ...runningBuiltins]) {
    const eventType = String(rule.eventType);
    countByEventType.set(eventType, (countByEventType.get(eventType) ?? 0) + 1);
  }
  // Only event types a custom rule contributes to are worth flagging.
  const customEventTypes = new Set(runningCustom.map((rule) => String(rule.eventType)));

  const overlaps: EventTypeOverlap[] = [];
  for (const [eventType, ruleCount] of countByEventType) {
    if (ruleCount >= 2 && customEventTypes.has(eventType)) {
      overlaps.push({ eventType, ruleCount });
    }
  }
  return overlaps.sort((first, second) => first.eventType.localeCompare(second.eventType));
}

/**
 * Returns the built-in seed rules in JSON-safe serialized form, so the Rules panel can SHOW the defaults and,
 * on "Customize", seed an editable copy. Because a custom rule that reuses a built-in's id supersedes that
 * built-in (see classifyGithubEmail), a seeded copy keeps the same id and fully takes over — its comment,
 * transition, and on/off switch then apply exactly as for any custom rule.
 */
export function getDefaultSerializedRules(): SerializedEmailRule[] {
  return GITHUB_EMAIL_RULES.map((rule) => {
    const serialized: SerializedEmailRule = { id: rule.id, eventType: rule.eventType };
    if (rule.reasonHeaderIn) {
      serialized.reasonHeaderIn = [...rule.reasonHeaderIn];
    }
    if (rule.subjectMarker) {
      serialized.subjectPattern = rule.subjectMarker.source;
    }
    if (rule.bodyMarker) {
      serialized.bodyPattern = rule.bodyMarker.source;
    }
    if (rule.requiresPrNumber) {
      serialized.requiresPrNumber = true;
    }
    return serialized;
  });
}
