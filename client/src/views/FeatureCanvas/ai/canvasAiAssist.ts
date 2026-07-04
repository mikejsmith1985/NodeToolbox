// canvasAiAssist.ts — The hidden, passphrase-gated copy-paste AI round-trip for the canvas.
//
// This mirrors the hardened release-notes AI Assist pattern: the tool GENERATES a prompt the
// operator pastes into an external assistant, then INGESTS a strict JSON reply. It is an
// accelerator only — every suggestion is an editable proposal defaulting to un-accepted, and
// the coaching workflow is fully operable without it. No AI service is called from here.

import type { MoscowBucket } from '../overlay/overlayModel.ts';

/** The analyses the accelerator can pre-fill. */
export type AiSuggestionKind = 'priorityOrder' | 'staleCandidates' | 'duplicateCandidates' | 'sprintGrouping' | 'wipReduction';

/** One proposed change the operator may accept or reject; never applied until accepted. */
export interface AiSuggestion {
  issueKey: string;
  proposedValue: string;
  rationale: string;
  accepted: boolean;
}

/** The validated result of ingesting an assistant reply, plus a count of ignored unknown keys. */
export interface AiSuggestionSet {
  kind: AiSuggestionKind;
  items: AiSuggestion[];
  ignoredUnknownKeyCount: number;
}

/**
 * The candidate issue context a prompt needs. Beyond key/summary/status it carries every REAL
 * signal the canvas already has — Business Value, effort, MoSCoW, feature health, completion, active
 * story load, and blocker count — so the assistant reasons from actual data instead of guessing. The
 * enrichment fields are optional; the descriptor omits any that are absent.
 */
export interface AiPromptIssue {
  issueKey: string;
  summary: string;
  status: string;
  storyPoints: number | null;
  /** Business Value score from Jira; higher means more valuable. Null when the field is unset. */
  businessValue: number | null;
  /** MoSCoW priority already set on the canvas; drives the Reduce-WIP park order. Null when unset. */
  priority: MoscowBucket | null;
  /** Feature health signal (e.g. green/yellow/red). */
  health?: string;
  /** Percent of child work complete (0–100). */
  completionPercent?: number;
  /** In-progress child stories — the live execution load on the feature. */
  activeChildCount?: number;
  /** Total child stories. */
  totalChildCount?: number;
  /** Number of issue links/blockers surfaced on the feature. */
  blockerCount?: number;
  /** Feature description (plain text) — the richest content signal for a priority call. */
  description?: string | null;
  /** Acceptance-criteria text (plain text). */
  acceptanceCriteria?: string | null;
}

// Descriptions and acceptance criteria can be long; cap each so a big canvas still yields a prompt
// small enough to paste, while keeping enough text for the assistant to judge scope and value.
const MAX_TEXT_SIGNAL_LENGTH = 300;

/** Trims and collapses whitespace in a free-text signal, truncating to keep the prompt manageable. */
function condenseText(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_TEXT_SIGNAL_LENGTH ? `${collapsed.slice(0, MAX_TEXT_SIGNAL_LENGTH)}…` : collapsed;
}

/** Builds one data-rich issue block, including only the signals that are actually present. */
function buildIssueDescriptor(issue: AiPromptIssue): string {
  const parts: string[] = [issue.issueKey, `status ${issue.status}`];
  if (issue.priority !== null) parts.push(`MoSCoW ${issue.priority}`);
  if (issue.businessValue !== null) parts.push(`BV ${issue.businessValue}`);
  if (issue.storyPoints !== null) parts.push(`${issue.storyPoints}pt`);
  if (issue.health) parts.push(`health ${issue.health}`);
  if (typeof issue.completionPercent === 'number' && issue.completionPercent > 0) parts.push(`${issue.completionPercent}% done`);
  if (issue.totalChildCount) parts.push(`${issue.activeChildCount ?? 0}/${issue.totalChildCount} stories active`);
  if (issue.blockerCount) parts.push(`${issue.blockerCount} blocker/link`);

  // The one-line header carries the structured signals; description and acceptance criteria (the
  // richest content) follow as indented sub-lines so the assistant can judge scope and intent.
  const lines = [`- ${parts.join(' · ')} — ${issue.summary}`];
  const description = issue.description ? condenseText(issue.description) : '';
  const acceptanceCriteria = issue.acceptanceCriteria ? condenseText(issue.acceptanceCriteria) : '';
  if (description) lines.push(`    description: ${description}`);
  if (acceptanceCriteria) lines.push(`    acceptance criteria: ${acceptanceCriteria}`);
  return lines.join('\n');
}

/** Extra framing some analyses need beyond the issue list (e.g. the WIP limit for Reduce WIP). */
export interface AiPromptContext {
  wipLimit: number | null;
  inProgressCount: number;
}

const MOSCOW_BUCKETS: readonly MoscowBucket[] = ['Must', 'Should', 'Could', 'Wont'];

/** Human-readable instruction per analysis kind, embedded in the generated prompt. */
const PROMPT_INSTRUCTIONS: Record<AiSuggestionKind, string> = {
  priorityOrder:
    'Assign each issue a MoSCoW bucket (Must, Should, Could, Wont). Base every decision ONLY on the '
    + 'data given for each issue below (status, feature health, completion, active stories, blockers, '
    + 'the description and acceptance criteria, and Business Value / story points when present). Weigh '
    + 'the description/acceptance criteria for scope and intent, and Business Value (higher is more valuable) '
    + 'against effort — high value with low effort ranks highest. If Business Value or effort is not '
    + 'shown for an issue, reason from the other signals and note that in the rationale; do NOT invent '
    + 'values. Respond ONLY with valid JSON: '
    + '{"kind":"priorityOrder","items":[{"issueKey":"KEY","bucket":"Must","rationale":"..."}]}',
  staleCandidates:
    'List issues that look stale or abandoned. Respond ONLY with valid JSON: '
    + '{"kind":"staleCandidates","items":[{"issueKey":"KEY","reason":"..."}]}',
  duplicateCandidates:
    'List likely duplicate pairs. Respond ONLY with valid JSON: '
    + '{"kind":"duplicateCandidates","items":[{"issueKey":"KEY","duplicateOfKey":"KEY2","confidence":"high"}]}',
  sprintGrouping:
    'Propose sprint groupings. Respond ONLY with valid JSON: '
    + '{"kind":"sprintGrouping","groups":[{"containerTitle":"Sprint 25","issueKeys":["KEY"]}]}',
  wipReduction:
    'These features are all in progress. Recommend which to PARK (defer) to reduce work in progress. '
    + 'Base your choice ONLY on the data shown per issue. Park the lowest MoSCoW priority first (Wont, '
    + 'then Could, then Should) and, within a bucket, the lowest Business Value; do not park a Must '
    + 'unless unavoidable. If MoSCoW/Business Value are absent, prefer parking the least-progressed and '
    + 'least-blocked features and say so in the reason; do NOT invent values. Respond ONLY with valid '
    + 'JSON: {"kind":"wipReduction","items":[{"issueKey":"KEY","reason":"..."}]}',
};

/** Builds the copy-paste prompt for one analysis over the given candidate issues. */
export function buildCanvasAiPrompt(kind: AiSuggestionKind, issues: readonly AiPromptIssue[], context?: AiPromptContext): string {
  const issueLines = issues.map(buildIssueDescriptor).join('\n');
  return `${buildContextHeader(kind, context)}${PROMPT_INSTRUCTIONS[kind]}\n\nIssues:\n${issueLines}`;
}

/**
 * Builds the leading context line for analyses that need it. Reduce WIP states the limit and how
 * many features must be parked to reach it; every other analysis needs no header.
 */
function buildContextHeader(kind: AiSuggestionKind, context?: AiPromptContext): string {
  if (kind !== 'wipReduction' || context === undefined) {
    return '';
  }
  const limitText = context.wipLimit === null ? 'not set' : String(context.wipLimit);
  const parkTarget = context.wipLimit === null ? null : Math.max(0, context.inProgressCount - context.wipLimit);
  const targetText = parkTarget === null ? '' : ` Park at least ${parkTarget} feature(s) to reach the limit.`;
  return `WIP limit: ${limitText}. Features in progress: ${context.inProgressCount}.${targetText}\n\n`;
}

/**
 * Strips assistant chatter and markdown fences and narrows to the outermost JSON object, so a
 * reply wrapped in prose or ```json fences still parses. Returns the raw JSON substring.
 */
export function extractJsonPayload(responseText: string): string {
  const withoutFences = responseText.replace(/```(?:json)?/gi, '');
  const firstBrace = withoutFences.indexOf('{');
  const lastBrace = withoutFences.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error('No JSON object found in the assistant response.');
  }
  return withoutFences.slice(firstBrace, lastBrace + 1);
}

/** Reads a required non-empty string field, throwing a descriptive error when absent. */
function readRequiredString(source: Record<string, unknown>, fieldName: string): string {
  const value = source[fieldName];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing or empty "${fieldName}" in an AI suggestion item.`);
  }
  return value.trim();
}

/** Validates a priorityOrder item into a suggestion, enforcing a valid MoSCoW bucket. */
function readPriorityItem(rawItem: Record<string, unknown>): AiSuggestion {
  const issueKey = readRequiredString(rawItem, 'issueKey');
  const bucket = readRequiredString(rawItem, 'bucket') as MoscowBucket;
  if (!MOSCOW_BUCKETS.includes(bucket)) {
    throw new Error(`Invalid bucket "${bucket}" for ${issueKey}; expected Must/Should/Could/Wont.`);
  }
  return { issueKey, proposedValue: bucket, rationale: (rawItem.rationale as string) ?? '', accepted: false };
}

/** Validates a generic single-key item (stale/duplicate) into a suggestion. */
function readGenericItem(rawItem: Record<string, unknown>, valueField: string): AiSuggestion {
  const issueKey = readRequiredString(rawItem, 'issueKey');
  const proposedValue = valueField in rawItem ? String(rawItem[valueField] ?? '') : '';
  const rationale = (rawItem.reason as string) ?? (rawItem.confidence as string) ?? '';
  return { issueKey, proposedValue, rationale, accepted: false };
}

/**
 * Parses and strictly validates an assistant reply for the given analysis kind. Throws with a
 * descriptive message on malformed input (changing nothing); unknown issue keys are filtered by
 * the caller against the live canvas, so this returns every well-formed item un-accepted.
 */
export function parseCanvasAiResponse(kind: AiSuggestionKind, responseText: string): AiSuggestionSet {
  const parsed = JSON.parse(extractJsonPayload(responseText)) as Record<string, unknown>;
  if (parsed.kind !== kind) {
    throw new Error(`Response kind "${String(parsed.kind)}" does not match the requested "${kind}".`);
  }

  if (kind === 'sprintGrouping') {
    const groups = Array.isArray(parsed.groups) ? parsed.groups : [];
    const items: AiSuggestion[] = [];
    for (const rawGroup of groups) {
      const group = rawGroup as { containerTitle?: unknown; issueKeys?: unknown };
      const containerTitle = typeof group.containerTitle === 'string' ? group.containerTitle : '';
      const issueKeys = Array.isArray(group.issueKeys) ? group.issueKeys : [];
      for (const issueKey of issueKeys) {
        if (typeof issueKey === 'string' && issueKey.trim() !== '') {
          items.push({ issueKey: issueKey.trim(), proposedValue: containerTitle, rationale: '', accepted: false });
        }
      }
    }
    return { kind, items, ignoredUnknownKeyCount: 0 };
  }

  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items = rawItems.map((rawItem) => {
    const itemRecord = rawItem as Record<string, unknown>;
    if (kind === 'priorityOrder') {
      return readPriorityItem(itemRecord);
    }
    if (kind === 'duplicateCandidates') {
      return readGenericItem(itemRecord, 'duplicateOfKey');
    }
    return readGenericItem(itemRecord, 'reason');
  });
  return { kind, items, ignoredUnknownKeyCount: 0 };
}

// ── NL → JQL scope query (Surface scope helper) ──
//
// A distinct round-trip from the suggestion kinds above: the reply is a single JQL string, not a
// list of per-issue suggestions. Used only by the passphrase-gated NL→JQL control on the scope bar.

/** Builds the prompt that turns a natural-language scope description into one JQL query. */
export function buildScopeQueryPrompt(context: { projectKey: string; piName: string; description: string }): string {
  return [
    'Convert this request into a single Jira JQL query that selects features/epics.',
    `Project: ${context.projectKey || '(any)'}. Program Increment: ${context.piName || '(any)'}.`,
    `Request: ${context.description}`,
    'Respond ONLY with valid JSON: {"kind":"scopeQuery","jql":"<the JQL>"}',
  ].join('\n');
}

/** Parses the NL→JQL reply into a proposed query string. Throws a descriptive error on malformed input. */
export function parseScopeQueryResponse(responseText: string): { jql: string } {
  const parsed = JSON.parse(extractJsonPayload(responseText)) as Record<string, unknown>;
  if (parsed.kind !== 'scopeQuery') {
    throw new Error(`Response kind "${String(parsed.kind)}" does not match the requested "scopeQuery".`);
  }
  const jql = typeof parsed.jql === 'string' ? parsed.jql.trim() : '';
  if (jql === '') {
    throw new Error('Missing or empty "jql" in the scopeQuery response.');
  }
  return { jql };
}
