// agingTriage.ts — The hidden, passphrase-gated AI round-trip for the open-item Aging report.
//
// Following the established canvas AI-assist pattern, this module GENERATES a copy-paste prompt that
// asks an external assistant to triage a NOT-Done backlog, then INGESTS a strict JSON reply. For each
// open issue the assistant returns one of three verdicts — "cancel-safe" (stale/low-value work that can
// be safely canceled), "review" (a human should look before deciding), or "must-remain" (keep it) —
// each with a plain-English rationale. It is advisory only: nothing here writes to Jira, and no AI
// service is called from here. The report is fully usable without ever unlocking this feature.
//
// The reply form is a fill-in table with every issue pre-listed, because Google's AI Mode — the team's only
// assistant (GH #499) — ignores a JSON reply format but completes a table. The table is read back into the same
// {kind, items[]} JSON, so every validation rule below still applies; a JSON reply is still read. A reply that is
// neither, or that leaves issues out, gets a follow-up for the same chat — a missing verdict is never guessed.

import {
  buildRecordFormatFixPrompt,
  buildRecordReplyInstructions,
  extractRecordReplyPayload,
  readRecordTableItems,
  type ReplyRecordSpec,
} from '../../utils/aiReplyRecords.ts';

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * The three triage outcomes, matching the user's mental model of a backlog cleanup:
 *   • cancel-safe  — stale, low-importance work whose feature is done/abandoned; safe to cancel.
 *   • review       — ambiguous; a human should confirm before canceling or keeping.
 *   • must-remain  — clearly still needed; keep it in the backlog.
 */
export type AgingTriageVerdict = 'cancel-safe' | 'review' | 'must-remain';

/** The verdicts the parser will accept, in the natural cancel → keep order. */
const AGING_TRIAGE_VERDICTS: readonly AgingTriageVerdict[] = ['cancel-safe', 'review', 'must-remain'];

/** The fill-in table the prompt ends with: each issue by key and summary, its verdict and rationale blank. */
export const AGING_TRIAGE_REPLY_SPEC: ReplyRecordSpec = {
  kind: 'agingTriage',
  replyMarker: 'TRIAGE_TABLE:',
  columns: [
    { field: 'issueKey', header: 'Issue key' },
    { field: 'summary', header: 'Summary', isNamingOnly: true },
    { field: 'verdict', header: 'Verdict', answerHint: AGING_TRIAGE_VERDICTS.join(', ') },
    { field: 'rationale', header: 'Rationale', answerHint: 'one plain-English line on why' },
  ],
};
// A table cell must stay on one line and never hold the "|" that separates cells.
const TABLE_CELL_BREAK_PATTERN = /\s*[|\r\n]+\s*/g;
// Spaces or underscores an assistant writes inside a verdict: "Cancel safe", "must_remain".
const VERDICT_SEPARATOR_PATTERN = /[\s_]+/g;

/**
 * One open backlog issue with every real signal the triage decision leans on: how old it is, how long it
 * has sat in its current status, how recently it saw any activity, whether anyone owns it, how big it is
 * (story points), how important it looks (Jira priority), whether it is even defined (description /
 * acceptance criteria), and which parent feature it belongs to plus that feature's status. Nullable signals
 * are absent for that issue (no assignee, no estimate, no parent) rather than merely unknown.
 */
export interface AgingTriageIssue {
  issueKey: string;
  issueType: string;
  summary: string;
  status: string;
  /** Calendar days since the issue was created — the report's aging measure. */
  ageDays: number;
  /** Calendar days the issue has sat in its current status category — the sharpest staleness signal. Null when unknown. */
  daysInStatus: number | null;
  /** Calendar days since the issue was last updated — a coarse "any activity" signal. Null when unknown. */
  daysSinceUpdate: number | null;
  /** Who the issue is assigned to. Null when unassigned — an unowned, long-idle issue is a strong cancel signal. */
  assignee: string | null;
  /** The issue's story-point estimate — its size/effort. Null when unestimated. */
  storyPoints: number | null;
  /** Whether the issue has any description text — an empty issue looks like abandoned scaffolding. */
  hasDescription: boolean;
  /** Whether the issue has any acceptance-criteria content — an undefined issue favors cancel-safe. */
  hasAcceptanceCriteria: boolean;
  /** Jira priority name (e.g. High/Low) — the "importance" signal. Null when unset. */
  priority: string | null;
  /** The parent feature/epic key this issue rolls up to. Null when the issue has no parent. */
  featureKey: string | null;
  /** The parent feature's summary, for context. Null when there is no parent. */
  featureSummary: string | null;
  /** The parent feature's status — a done/abandoned feature is a strong cancel signal. Null when none. */
  featureStatus: string | null;
}

/** One assistant verdict for one issue: the recommendation plus why, never applied to Jira automatically. */
export interface AgingTriageSuggestion {
  issueKey: string;
  verdict: AgingTriageVerdict;
  rationale: string;
}

// ── Prompt construction ────────────────────────────────────────────────────────

// The task instruction embedded at the top of every generated prompt. It defines each verdict and the
// signals to weigh; the prompt then ends with the fill-in table the reply is read from.
//
// Posture: AGGRESSIVE. The point of this report is to CLEAN UP a bloated backlog, so the assistant must
// actively look for cancellation candidates instead of defaulting to "keep". "must-remain" has to be
// EARNED by a positive sign of ongoing need; staleness, no owner, and no definition are on their own
// enough to pull an issue down to at least "review".
const AGING_TRIAGE_INSTRUCTION =
  'You are aggressively triaging a team\'s NOT-Done Jira backlog to CLEAN IT UP — this backlog is bloated '
  + 'and the goal is to cancel or flag as much dead weight as the evidence supports, NOT to preserve it. '
  + 'For EACH issue below, assign exactly one verdict:\n'
  + '  • "cancel-safe" — dead weight that can be safely canceled: long-idle AND (unassigned OR undefined — '
  + 'no description and no acceptance criteria OR low/None priority), or its parent feature is already '
  + 'Done/abandoned. Age alone counts: an issue sitting untouched in the same status for many weeks is a '
  + 'prime cancel candidate;\n'
  + '  • "review" — a cleanup candidate that is not clear-cut: it looks stale or neglected but has some '
  + 'sign of value (an assignee, a high priority, an active parent), so a human should confirm;\n'
  + '  • "must-remain" — EARNS its place: there is a positive, current sign it is active work — assigned AND '
  + 'recently moved status, OR high priority with recent activity, OR a clearly in-progress parent. Absent '
  + 'such a sign, do NOT choose must-remain.\n'
  + 'Do NOT default to must-remain when a signal is missing — missing owner, missing description, missing '
  + 'acceptance criteria, and long time-in-status all push AWAY from must-remain. Weigh how long it has sat '
  + 'in its current status and how recently it saw any activity (long-idle → cancel), whether anyone is '
  + 'assigned (unassigned → cancel), its size (story points), how important it looks (priority), how old it '
  + 'is, whether it is even defined at all (no description and no acceptance criteria → cancel), and its '
  + 'parent feature\'s status (Done/abandoned → cancel). Use ONLY the data shown for each issue; do NOT '
  + 'invent values, and when a signal is missing treat its absence as the (cancel-leaning) signal it is '
  + 'rather than guessing a value.';

/** Builds one issue's data line, including only the signals that are actually present. */
function buildTriageIssueLine(issue: AgingTriageIssue): string {
  const hasAssignee = issue.assignee !== null && issue.assignee.trim() !== '';
  const parts: string[] = [
    `${issue.issueKey} (${issue.issueType})`,
    `status ${issue.status}`,
    // Ownership is a first-class triage signal, so we always state it explicitly: an unowned, long-idle
    // issue is a strong cancel candidate, and silently omitting the assignee would hide that.
    hasAssignee ? `assignee ${issue.assignee}` : 'unassigned',
    `${formatDays(issue.ageDays)} old`,
  ];
  if (issue.daysInStatus !== null) {
    parts.push(`in status ${formatDays(issue.daysInStatus)}`);
  }
  if (issue.daysSinceUpdate !== null) {
    parts.push(`updated ${formatDays(issue.daysSinceUpdate)} ago`);
  }
  if (issue.storyPoints !== null) {
    parts.push(`${issue.storyPoints} pts`);
  }
  if (issue.priority !== null && issue.priority.trim() !== '') {
    parts.push(`priority ${issue.priority}`);
  }
  // For definition, EMPTINESS is the signal: a ticket with no description and no acceptance criteria looks
  // like low-value or abandoned scaffolding, so we flag the absence rather than the (normal) presence.
  if (!issue.hasDescription) {
    parts.push('no description');
  }
  if (!issue.hasAcceptanceCriteria) {
    parts.push('no acceptance criteria');
  }
  if (issue.featureKey !== null && issue.featureKey.trim() !== '') {
    // The parent feature and its status are the strongest cancel signal, so they ride the same line.
    const featureStatus = issue.featureStatus ? ` [${issue.featureStatus}]` : '';
    parts.push(`feature ${issue.featureKey}${featureStatus}`);
  }
  return `- ${parts.join(' · ')} — ${issue.summary}`;
}

/** Formats a day count as a whole number followed by "d" (e.g. 210 → "210d"). */
function formatDays(days: number): string {
  return `${Math.round(days)}d`;
}

/**
 * Builds the full copy-paste triage prompt: the instruction and JSON contract, then one data line per
 * open issue. Read this into a textarea the operator copies into an external assistant.
 */
export function buildAgingTriagePrompt(issues: readonly AgingTriageIssue[]): string {
  const issueLines = issues.map(buildTriageIssueLine).join('\n');
  const replyForm = buildRecordReplyInstructions(AGING_TRIAGE_REPLY_SPEC, buildTriageRowNamingCells(issues));
  return `${AGING_TRIAGE_INSTRUCTION}\n\nIssues:\n${issueLines}\n\n${replyForm}`;
}

/** Each issue's pre-filled cells: its key and its summary kept to one line without a "|". */
function buildTriageRowNamingCells(issues: readonly AgingTriageIssue[]): string[][] {
  return issues.map((issue) => [issue.issueKey, issue.summary.replace(TABLE_CELL_BREAK_PATTERN, ' / ').trim()]);
}

/** The shown issues a reply gave no verdict for — what a follow-up asks about, never filled in by guessing. */
export function findMissingTriageKeys(
  issues: readonly AgingTriageIssue[],
  suggestions: readonly AgingTriageSuggestion[],
): string[] {
  const answeredKeys = new Set(suggestions.map((suggestion) => suggestion.issueKey));
  return issues.map((issue) => issue.issueKey).filter((issueKey) => !answeredKeys.has(issueKey));
}

/**
 * The follow-up for the same AI chat: the whole table again when the reply could not be read, or only the
 * rows for the issues it left without a verdict. '' when nothing is missing.
 */
export function buildAgingTriageFollowUpPrompt(
  issues: readonly AgingTriageIssue[],
  missingIssueKeys: readonly string[],
  wasReplyUnreadable: boolean,
): string {
  if (wasReplyUnreadable) return buildRecordFormatFixPrompt(AGING_TRIAGE_REPLY_SPEC, buildTriageRowNamingCells(issues));
  const missingIssues = issues.filter((issue) => missingIssueKeys.includes(issue.issueKey));
  if (missingIssues.length === 0) return '';
  return [
    `Your last reply gave no verdict for ${missingIssues.map((issue) => issue.issueKey).join(', ')}. Answer only these now, in the same table.`,
    buildRecordReplyInstructions(AGING_TRIAGE_REPLY_SPEC, buildTriageRowNamingCells(missingIssues)),
  ].join('\n');
}

// ── Reply ingestion ──────────────────────────────────────────────────────────

/** Reads a required non-empty string field from a raw item, throwing a descriptive error when absent. */
function readRequiredString(source: Record<string, unknown>, fieldName: string): string {
  const value = source[fieldName];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing or empty "${fieldName}" in an aging-triage item.`);
  }
  return value.trim();
}

/** Validates one raw reply item into a suggestion, enforcing a known verdict. */
function readTriageItem(rawItem: Record<string, unknown>): AgingTriageSuggestion {
  const issueKey = readRequiredString(rawItem, 'issueKey');
  // "Cancel safe" / "Must_Remain" are the same verdicts written loosely; anything else is still refused.
  const verdict = readRequiredString(rawItem, 'verdict').toLowerCase().replace(VERDICT_SEPARATOR_PATTERN, '-') as AgingTriageVerdict;
  if (!AGING_TRIAGE_VERDICTS.includes(verdict)) {
    throw new Error(`Invalid verdict "${verdict}" for ${issueKey}; expected ${AGING_TRIAGE_VERDICTS.join('/')}.`);
  }
  const rationale = typeof rawItem.rationale === 'string' ? rawItem.rationale.trim() : '';
  return { issueKey, verdict, rationale };
}

/**
 * Parses and strictly validates an assistant reply into per-issue triage verdicts. Tolerates prose and
 * markdown fences around the JSON, but throws a descriptive error (changing nothing) when the JSON is
 * unreadable, the kind does not match, or any item carries an unknown verdict or no issue key. Unknown
 * issue keys are filtered by the caller against the issues that were actually shown.
 */
export function parseAgingTriageResponse(responseText: string): AgingTriageSuggestion[] {
  const parsed = JSON.parse(extractRecordReplyPayload(responseText, AGING_TRIAGE_REPLY_SPEC)) as Record<string, unknown>;
  if (parsed.kind !== 'agingTriage') {
    throw new Error(`Response kind "${String(parsed.kind)}" does not match the requested "agingTriage".`);
  }
  const rawItems = (Array.isArray(parsed.items) ? parsed.items : []) as Record<string, unknown>[];
  // A table row left at ___ has no verdict: the issue was not answered, so it becomes a follow-up row rather
  // than failing the whole reply. A JSON item without a verdict is still refused, exactly as before.
  const isTableReply = (readRecordTableItems(responseText, AGING_TRIAGE_REPLY_SPEC)?.length ?? 0) > 0;
  const answeredItems = isTableReply ? rawItems.filter((rawItem) => rawItem.verdict !== undefined) : rawItems;
  return answeredItems.map((rawItem) => readTriageItem(rawItem));
}
