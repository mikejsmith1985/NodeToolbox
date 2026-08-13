// changeAudit.ts — Reconstructs how a status change actually happened, so an operator can tell
// their own hand-made edits apart from ones this application made on their behalf.
//
// The problem it solves: the application authenticates to Jira as the operator, so Jira's history
// credits every change to them either way. Looking at one issue's history proves nothing. What DOES
// distinguish the two is corroborating evidence around the change:
//
//   • this machine's local write journal — the definitive record, but only covers the period since
//     journalling started, so its silence is only meaningful within that window;
//   • the operator's short comment marker sitting next to the change;
//   • timing — several issues changed identically within seconds is a batch, not a person clicking.
//
// Every verdict below states which of those it rests on, and reports honest uncertainty rather than
// guessing when the evidence does not reach.

import { jiraGet } from '../../services/jiraApi.ts';

// ── Tuning constants ─────────────────────────────────────────────────────────

/** How close a local journal entry must sit to a Jira change to be treated as the same event. */
const JOURNAL_MATCH_WINDOW_MS = 3 * 60 * 1000;

/** How close a signed comment must sit to a status change to be treated as accompanying it. */
const SIGNED_COMMENT_WINDOW_MS = 3 * 60 * 1000;

/** Changes by one person within this window are a batch — nobody clicks two issues that fast. */
const BURST_WINDOW_MS = 10 * 1000;

/** How many issues must share a burst window before it counts as a batch. */
const BURST_MINIMUM_SIZE = 2;

const AUDIT_SEARCH_FIELDS = 'summary,status,comment';
const AUDIT_MAX_RESULTS = 200;

// The operator marker as a standalone trailing token (see src/services/operatorSignature.js).
const OPERATOR_SIGNATURE_PATTERN = /(?:^|\s)-ms\s*$/;

// ── Public types ─────────────────────────────────────────────────────────────

/** Where a status change most likely came from, and what that conclusion rests on. */
export type ChangeOrigin =
  | 'assisted-confirmed'   // this machine recorded making the write
  | 'assisted-signed'      // a marked comment accompanies the change
  | 'batch'                // several issues changed together — a bulk operation
  | 'hand-made'            // no corroborating evidence, and the journal covers this moment
  | 'indeterminate';       // the journal does not reach back this far — cannot say

export interface StatusChangeEvent {
  issueKey: string;
  issueSummary: string;
  atIso: string;
  fromStatus: string;
  toStatus: string;
  authorDisplayName: string;
  /** Every field touched in the SAME changegroup — a wide set points at a bulk edit screen. */
  companionFields: string[];
}

export interface AuditedChange extends StatusChangeEvent {
  origin: ChangeOrigin;
  /** Plain-language justification naming the evidence the verdict rests on. */
  evidence: string;
  /** Other issues changed inside the same burst window, when this change is part of a batch. */
  burstPartnerKeys: string[];
}

/** One local write-journal record, as served by /api/jira-write-journal. */
export interface JournalEntry {
  atIso: string;
  method: string;
  path: string;
  issueKey: string | null;
  kind: string;
  source: string;
}

interface JiraChangelogItem {
  field?: string;
  fromString?: string | null;
  toString?: string | null;
}

interface JiraChangelogHistory {
  created?: string;
  author?: { displayName?: string };
  items?: JiraChangelogItem[];
}

interface JiraAuditIssue {
  key?: string;
  fields?: {
    summary?: string;
    comment?: { comments?: Array<{ body?: string; created?: string }> };
  };
  changelog?: { histories?: JiraChangelogHistory[] };
}

interface JiraAuditSearchResponse {
  issues?: JiraAuditIssue[];
}

// ── JQL ──────────────────────────────────────────────────────────────────────

/**
 * Builds the search for "issues this person moved into the given status since the given date".
 *
 * Uses Jira's CHANGED TO ... BY ... AFTER form so the server does the history filtering — a plain
 * `status = Cancelled` search would also return issues cancelled by somebody else, or long ago.
 */
export function buildStatusChangeAuditJql(
  targetStatusName: string,
  sinceDate: string,
  projectKeys: readonly string[] = [],
): string {
  const normalizedKeys = projectKeys
    .map((projectKey) => projectKey.trim().toUpperCase())
    .filter((projectKey) => projectKey !== '');
  const projectClause = normalizedKeys.length > 0 ? `project in (${normalizedKeys.join(', ')}) AND ` : '';
  return `${projectClause}status CHANGED TO "${targetStatusName}" BY currentUser() AFTER "${sinceDate}" ORDER BY updated DESC`;
}

// ── Changelog reading ────────────────────────────────────────────────────────

/** Reports whether a comment body carries the operator's trailing marker. */
export function hasOperatorSignature(commentBody: string): boolean {
  return OPERATOR_SIGNATURE_PATTERN.test((commentBody ?? '').trimEnd());
}

/**
 * Pulls out every changegroup in which this issue entered the target status, keeping the other
 * fields that moved in the same group. Those companions matter: a lone status+resolution pair looks
 * like one transition, while a wide set points at a bulk edit screen.
 */
export function extractStatusChangeEvents(issue: JiraAuditIssue, targetStatusName: string): StatusChangeEvent[] {
  const normalizedTarget = targetStatusName.trim().toLowerCase();
  const histories = issue.changelog?.histories ?? [];
  const events: StatusChangeEvent[] = [];

  for (const history of histories) {
    const items = history.items ?? [];
    const statusItem = items.find(
      (item) => item.field === 'status' && (item.toString ?? '').trim().toLowerCase() === normalizedTarget,
    );
    if (!statusItem) continue;

    events.push({
      issueKey: issue.key ?? '',
      issueSummary: issue.fields?.summary ?? '',
      atIso: history.created ?? '',
      fromStatus: statusItem.fromString ?? '',
      toStatus: statusItem.toString ?? '',
      authorDisplayName: history.author?.displayName ?? '',
      companionFields: items.map((item) => item.field ?? '').filter((fieldName) => fieldName !== '' && fieldName !== 'status'),
    });
  }
  return events;
}

// ── Burst detection ──────────────────────────────────────────────────────────

/**
 * Groups changes that one person made within seconds of each other across DIFFERENT issues.
 *
 * This is the signal that needs no cooperation from the tooling: a person working through the issue
 * view cannot open, transition and confirm two issues inside ten seconds, so a cluster is a bulk
 * operation of some kind. Returns, per event index, the keys of its burst partners.
 */
export function findBurstPartners(events: readonly StatusChangeEvent[]): string[][] {
  return events.map((candidate) => {
    const candidateTime = Date.parse(candidate.atIso);
    if (Number.isNaN(candidateTime)) return [];
    const partners = events.filter((other) => {
      if (other.issueKey === candidate.issueKey) return false;
      if (other.authorDisplayName !== candidate.authorDisplayName) return false;
      const otherTime = Date.parse(other.atIso);
      return !Number.isNaN(otherTime) && Math.abs(otherTime - candidateTime) <= BURST_WINDOW_MS;
    });
    return Array.from(new Set(partners.map((partner) => partner.issueKey)));
  });
}

// ── Verdict ──────────────────────────────────────────────────────────────────

/**
 * Weighs the available evidence for one status change and returns a verdict with its justification.
 *
 * Order matters: a local journal record is direct proof and outranks everything else. A marker in an
 * adjacent comment is strong but indirect. Timing alone establishes only that a change was part of a
 * batch, not what drove the batch. When nothing corroborates and the journal does not even reach
 * back to the moment in question, the honest answer is that this cannot be determined — NOT that the
 * operator made the change by hand.
 */
export function classifyChangeOrigin(
  event: StatusChangeEvent,
  burstPartnerKeys: readonly string[],
  journalEntries: readonly JournalEntry[],
  signedCommentIsoTimes: readonly string[],
  journalCoverageStartIso: string | null,
): { origin: ChangeOrigin; evidence: string } {
  const eventTime = Date.parse(event.atIso);

  const matchingJournalEntry = journalEntries.find((entry) => {
    if (entry.issueKey !== event.issueKey) return false;
    const entryTime = Date.parse(entry.atIso);
    return !Number.isNaN(entryTime) && Math.abs(entryTime - eventTime) <= JOURNAL_MATCH_WINDOW_MS;
  });
  if (matchingJournalEntry) {
    return {
      origin: 'assisted-confirmed',
      evidence: `This machine recorded a ${matchingJournalEntry.kind} write to ${event.issueKey} `
        + `at ${matchingJournalEntry.atIso} from the ${matchingJournalEntry.source} path.`,
    };
  }

  const hasAdjacentSignedComment = signedCommentIsoTimes.some((commentIso) => {
    const commentTime = Date.parse(commentIso);
    return !Number.isNaN(commentTime) && Math.abs(commentTime - eventTime) <= SIGNED_COMMENT_WINDOW_MS;
  });
  if (hasAdjacentSignedComment) {
    return { origin: 'assisted-signed', evidence: 'A marked comment sits beside this change on the same issue.' };
  }

  if (burstPartnerKeys.length + 1 >= BURST_MINIMUM_SIZE && burstPartnerKeys.length > 0) {
    return {
      origin: 'batch',
      evidence: `Changed within ${BURST_WINDOW_MS / 1000}s of ${burstPartnerKeys.length} other issue(s) `
        + `by the same person (${burstPartnerKeys.join(', ')}) — a bulk operation.`,
    };
  }

  const isWithinJournalCoverage = journalCoverageStartIso !== null && event.atIso >= journalCoverageStartIso;
  if (!isWithinJournalCoverage) {
    return {
      origin: 'indeterminate',
      evidence: journalCoverageStartIso === null
        ? 'No local write record exists yet, so this change cannot be attributed either way.'
        : `The local write record only reaches back to ${journalCoverageStartIso}, before which nothing can be ruled out.`,
    };
  }

  return {
    origin: 'hand-made',
    evidence: 'Within the covered period, this machine recorded no write to this issue and no marker accompanies it.',
  };
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface ChangeAuditResult {
  changes: AuditedChange[];
  scannedIssueCount: number;
  jql: string;
  journalCoverageStartIso: string | null;
}

/**
 * Runs the full review: find the issues, read their histories, then weigh each status change against
 * the local journal, adjacent markers and timing.
 */
export async function auditStatusChanges(
  targetStatusName: string,
  sinceDate: string,
  projectKeys: readonly string[],
  journalEntries: readonly JournalEntry[],
): Promise<ChangeAuditResult> {
  const auditJql = buildStatusChangeAuditJql(targetStatusName, sinceDate, projectKeys);
  const searchPath =
    `/rest/api/2/search?jql=${encodeURIComponent(auditJql)}`
    + `&fields=${encodeURIComponent(AUDIT_SEARCH_FIELDS)}&expand=changelog&maxResults=${AUDIT_MAX_RESULTS}`;

  const searchResponse = await jiraGet<JiraAuditSearchResponse>(searchPath);
  const candidateIssues = searchResponse.issues ?? [];

  const events = candidateIssues.flatMap((issue) => extractStatusChangeEvents(issue, targetStatusName));
  const burstPartnersByIndex = findBurstPartners(events);
  const journalCoverageStartIso = resolveJournalCoverageStart(journalEntries);

  const signedCommentTimesByIssueKey = new Map<string, string[]>();
  for (const issue of candidateIssues) {
    const signedTimes = (issue.fields?.comment?.comments ?? [])
      .filter((comment) => hasOperatorSignature(comment.body ?? ''))
      .map((comment) => comment.created ?? '');
    signedCommentTimesByIssueKey.set(issue.key ?? '', signedTimes);
  }

  const changes: AuditedChange[] = events.map((event, eventIndex) => {
    const burstPartnerKeys = burstPartnersByIndex[eventIndex] ?? [];
    const { origin, evidence } = classifyChangeOrigin(
      event,
      burstPartnerKeys,
      journalEntries,
      signedCommentTimesByIssueKey.get(event.issueKey) ?? [],
      journalCoverageStartIso,
    );
    return { ...event, origin, evidence, burstPartnerKeys };
  });

  changes.sort((firstChange, secondChange) => secondChange.atIso.localeCompare(firstChange.atIso));
  return { changes, scannedIssueCount: candidateIssues.length, jql: auditJql, journalCoverageStartIso };
}

/**
 * The moment the local write record starts. Before it, the journal's silence proves nothing, and
 * every verdict that would rest on that silence has to be reported as undetermined instead.
 */
export function resolveJournalCoverageStart(journalEntries: readonly JournalEntry[]): string | null {
  if (journalEntries.length === 0) return null;
  return journalEntries.reduce(
    (earliestIso, entry) => (entry.atIso && entry.atIso < earliestIso ? entry.atIso : earliestIso),
    journalEntries[0].atIso,
  );
}

/** Reads this machine's local write journal. A server without the route yet reads as empty. */
export async function fetchWriteJournal(sinceIso: string): Promise<JournalEntry[]> {
  try {
    const response = await fetch(`/api/jira-write-journal?sinceIso=${encodeURIComponent(sinceIso)}`);
    if (!response.ok) return [];
    const payload = (await response.json()) as { entries?: JournalEntry[] };
    return payload.entries ?? [];
  } catch (_fetchError) {
    return [];
  }
}
