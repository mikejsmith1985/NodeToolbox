// agingTriage.ts — The hidden, passphrase-gated AI round-trip for the open-item Aging report.
//
// Following the established canvas AI-assist pattern, this module GENERATES a copy-paste prompt that
// asks an external assistant to triage a NOT-Done backlog, then INGESTS a strict JSON reply. For each
// open issue the assistant returns one of three verdicts — "cancel-safe" (stale/low-value work that can
// be safely canceled), "review" (a human should look before deciding), or "must-remain" (keep it) —
// each with a plain-English rationale. It is advisory only: nothing here writes to Jira, and no AI
// service is called from here. The report is fully usable without ever unlocking this feature.

import { extractJsonPayload } from '../../utils/extractJsonPayload.ts';

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
// signals to weigh, then pins the reply to a single strict JSON shape so ingestion can validate it.
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
  + 'rather than guessing a value. Respond ONLY with '
  + 'valid JSON: {"kind":"agingTriage","items":[{"issueKey":"KEY","verdict":"cancel-safe","rationale":"..."}]}';

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
  return `${AGING_TRIAGE_INSTRUCTION}\n\nIssues:\n${issueLines}`;
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
  const verdict = readRequiredString(rawItem, 'verdict') as AgingTriageVerdict;
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
  const parsed = JSON.parse(extractJsonPayload(responseText)) as Record<string, unknown>;
  if (parsed.kind !== 'agingTriage') {
    throw new Error(`Response kind "${String(parsed.kind)}" does not match the requested "agingTriage".`);
  }
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  return rawItems.map((rawItem) => readTriageItem(rawItem as Record<string, unknown>));
}
