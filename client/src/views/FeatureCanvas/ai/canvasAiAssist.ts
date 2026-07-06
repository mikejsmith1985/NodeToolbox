// canvasAiAssist.ts — The hidden, passphrase-gated copy-paste AI round-trip for the canvas.
//
// This mirrors the hardened release-notes AI Assist pattern: the tool GENERATES a prompt the
// operator pastes into an external assistant, then INGESTS a strict JSON reply. It is an
// accelerator only — every suggestion is an editable proposal defaulting to un-accepted, and
// the coaching workflow is fully operable without it. No AI service is called from here.

import type { MoscowBucket, TshirtSize } from '../overlay/overlayModel.ts';
import { TSHIRT_SIZES } from '../logic/sizing.ts';

/** The analyses the accelerator can pre-fill. `masterPlan` runs all phases in one round-trip. */
export type AiSuggestionKind = 'priorityOrder' | 'sizeEstimate' | 'sprintGrouping' | 'parkCandidates' | 'masterPlan';

/** The per-item action a triage (parkCandidates) suggestion recommends. */
export type TriageAction = 'park' | 'complete' | 'breakout';
const TRIAGE_ACTIONS: readonly TriageAction[] = ['park', 'complete', 'breakout'];

/** A master-plan action per feature: keep active, park, complete, or flag for break-out. */
export type MasterTriage = 'keep' | TriageAction;
const MASTER_TRIAGE: readonly MasterTriage[] = ['keep', 'park', 'complete', 'breakout'];

/** One feature's full cross-phase plan: size + priority + triage + sprint, all at once. */
export interface MasterPlanItem {
  issueKey: string;
  size: TshirtSize | null;
  bucket: MoscowBucket | null;
  triage: MasterTriage;
  /** Sprint name to sequence into; null when parked/complete/not ready. */
  sprint: string | null;
  reason: string;
}

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

/** Extra framing some analyses need beyond the issue list (WIP limit, PI time remaining). */
export interface AiPromptContext {
  wipLimit: number | null;
  inProgressCount: number;
  /** Whole days left until the PI ends (from the PI name's date range); null when unknown. */
  daysRemainingInPi?: number | null;
  /** The PI name, for naming the deadline in the prompt. */
  piName?: string;
  /** The real sprint boxes on the canvas — the ONLY sprint names the master plan may sequence into. */
  availableSprints?: readonly string[];
}

const MOSCOW_BUCKETS: readonly MoscowBucket[] = ['Must', 'Should', 'Could', 'Wont'];

/** Human-readable instruction per analysis kind, embedded in the generated prompt. */
const PROMPT_INSTRUCTIONS: Record<AiSuggestionKind, string> = {
  priorityOrder:
    'Assign each issue a MoSCoW bucket (Must, Should, Could, Wont). Base every decision ONLY on the '
    + 'data given for each issue below (status, feature health, completion, active stories, blockers, '
    + 'the description and acceptance criteria, and Business Value / story points when present). Weigh '
    + 'the description/acceptance criteria for scope and intent, and Business Value (higher is more valuable) '
    + 'against effort — high value with low effort ranks highest. When PI time-remaining is shown above, '
    + 'also favor features that can realistically reach Definition of Done (dev-complete + delivered to '
    + 'integration testing, not production) within the days left. If Business Value or effort is not '
    + 'shown for an issue, reason from the other signals and note that in the rationale; do NOT invent '
    + 'values. Respond ONLY with valid JSON: '
    + '{"kind":"priorityOrder","items":[{"issueKey":"KEY","bucket":"Must","rationale":"..."}]}',
  sizeEstimate:
    'Assign each issue a relative t-shirt size (S, M, L, XL) for effort, judging scope ONLY from the '
    + 'data shown — description, acceptance criteria, story counts, and points when present. Larger '
    + 'scope / more stories / higher points = larger size. If scope is unclear from the data, say so in '
    + 'the rationale rather than guessing. Respond ONLY with valid JSON: '
    + '{"kind":"sizeEstimate","items":[{"issueKey":"KEY","size":"L","rationale":"..."}]}',
  sprintGrouping:
    'Propose sprint groupings. Respond ONLY with valid JSON: '
    + '{"kind":"sprintGrouping","groups":[{"containerTitle":"Sprint 25","issueKeys":["KEY"]}]}',
  parkCandidates:
    'Triage the features that should leave the active flow. For each, choose an action: "park" (defer '
    + 'stale, duplicate, or over-WIP work — favor lowest MoSCoW/Business Value and least progress), '
    + '"complete" (already meets Definition of Done — dev-complete and delivered to integration testing, '
    + 'not necessarily in production; e.g. 100% or an integration-test/done status — move it to the '
    + 'Complete box), or "breakout" '
    + '(marked complete but still has active/open child stories — needs splitting). Prefer parking down '
    + 'to the WIP limit shown above. NEVER park a feature that is nearly done or would take little effort '
    + 'to finish (high completion % and/or small size) — finishing it clears WIP faster than parking. Use '
    + 'ONLY the data shown; do NOT invent values. Leave a feature out if it should stay active. Respond '
    + 'ONLY with valid JSON: '
    + '{"kind":"parkCandidates","items":[{"issueKey":"KEY","action":"park","reason":"..."}]}',
  masterPlan:
    'Produce a COMPLETE plan for EVERY feature in one pass, as if running all five phases. For each '
    + 'feature return: "size" (S/M/L/XL, from scope); "bucket" (Must/Should/Could/Wont, weighing value '
    + 'against size and PI time-to-DoD); "triage" ("keep" to keep active, "park" to defer stale/duplicate/'
    + 'over-WIP work, "complete" if it already meets Definition of Done — dev-complete + delivered to '
    + 'integration testing, not production, "breakout" if marked done but has open child stories); and '
    + '"sprint" (one of the EXACT sprint names listed above to sequence it into, or null when '
    + 'parked/complete/not ready — never invent a sprint name). Honor the '
    + 'WIP limit and PI days-left shown above; NEVER sequence a parked or complete feature, and never park '
    + 'work that is nearly done. Use ONLY the data shown; do NOT invent values. Respond ONLY with valid '
    + 'JSON: {"kind":"masterPlan","items":[{"issueKey":"KEY","size":"L","bucket":"Must","triage":"keep","sprint":"Sprint 25","reason":"..."}]}',
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
  if (context === undefined) {
    return '';
  }
  const lines: string[] = [];

  // PI time pressure informs prioritization and triage (not sizing/grouping). Definition of Done is
  // dev-complete + delivered to integration testing — NOT production — so time-to-DoD is what counts.
  if ((kind === 'priorityOrder' || kind === 'parkCandidates' || kind === 'masterPlan') && context.daysRemainingInPi !== null && context.daysRemainingInPi !== undefined) {
    lines.push(
      `PI "${context.piName ?? ''}" has ${context.daysRemainingInPi} day(s) left. A feature meets Definition `
      + 'of Done when it is dev-complete and delivered to integration testing (it does NOT need to be in '
      + 'production). Favor features that can realistically reach DoD in the days left; deprioritize (or park) '
      + 'work that cannot finish in time.',
    );
  }

  if (kind === 'parkCandidates' || kind === 'masterPlan') {
    const limitText = context.wipLimit === null ? 'not set' : String(context.wipLimit);
    const parkTarget = context.wipLimit === null ? null : Math.max(0, context.inProgressCount - context.wipLimit);
    const targetText = parkTarget === null ? '' : ` Aim to park at least ${parkTarget} in-progress feature(s) to reach the limit.`;
    lines.push(`WIP limit: ${limitText}. Features in progress: ${context.inProgressCount}.${targetText}`);
  }

  // The master plan may only sequence into the team's REAL sprints (pulled from the board), never
  // invented names — so list them and constrain the "sprint" field to this exact set. With no sprints
  // pulled, tell the model to leave every "sprint" null (those features land in Later on ingest).
  if (kind === 'masterPlan') {
    const sprints = context.availableSprints ?? [];
    if (sprints.length > 0) {
      lines.push(`Available sprints (use one of these EXACT names for "sprint", or null): ${sprints.map((name) => `"${name}"`).join(', ')}. Never invent a sprint name.`);
    } else {
      lines.push('No sprints are available — set "sprint" to null for every feature (they will be placed in Later). Do NOT invent sprint names.');
    }
  }

  return lines.length > 0 ? `${lines.join('\n')}\n\n` : '';
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

/** Validates a sizeEstimate item into a suggestion, enforcing a valid t-shirt size. */
function readSizeItem(rawItem: Record<string, unknown>): AiSuggestion {
  const issueKey = readRequiredString(rawItem, 'issueKey');
  const size = readRequiredString(rawItem, 'size') as TshirtSize;
  if (!TSHIRT_SIZES.includes(size)) {
    throw new Error(`Invalid size "${size}" for ${issueKey}; expected ${TSHIRT_SIZES.join('/')}.`);
  }
  return { issueKey, proposedValue: size, rationale: (rawItem.rationale as string) ?? '', accepted: false };
}

/** Validates a triage (parkCandidates) item, enforcing a known action; proposedValue holds the action. */
function readActionItem(rawItem: Record<string, unknown>): AiSuggestion {
  const issueKey = readRequiredString(rawItem, 'issueKey');
  const action = readRequiredString(rawItem, 'action') as TriageAction;
  if (!TRIAGE_ACTIONS.includes(action)) {
    throw new Error(`Invalid action "${action}" for ${issueKey}; expected ${TRIAGE_ACTIONS.join('/')}.`);
  }
  return { issueKey, proposedValue: action, rationale: (rawItem.reason as string) ?? '', accepted: false };
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
    if (kind === 'sizeEstimate') {
      return readSizeItem(itemRecord);
    }
    if (kind === 'parkCandidates') {
      return readActionItem(itemRecord);
    }
    return readPriorityItem(itemRecord);
  });
  return { kind, items, ignoredUnknownKeyCount: 0 };
}

/**
 * Parses a master-plan reply into per-feature plans. Lenient by design (it applies to the whole
 * canvas at once): an absent or invalid size/bucket is dropped to null rather than failing the batch,
 * and an unknown triage falls back to "keep". Only a missing issueKey skips the item. Throws only when
 * the JSON is unreadable or the kind does not match.
 */
export function parseMasterPlan(responseText: string): MasterPlanItem[] {
  const parsed = JSON.parse(extractJsonPayload(responseText)) as Record<string, unknown>;
  if (parsed.kind !== 'masterPlan') {
    throw new Error(`Response kind "${String(parsed.kind)}" does not match the requested "masterPlan".`);
  }
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const plans: MasterPlanItem[] = [];
  for (const rawItem of rawItems) {
    const item = rawItem as Record<string, unknown>;
    const issueKey = typeof item.issueKey === 'string' ? item.issueKey.trim() : '';
    if (issueKey === '') {
      continue;
    }
    const size = TSHIRT_SIZES.includes(item.size as TshirtSize) ? (item.size as TshirtSize) : null;
    const bucket = MOSCOW_BUCKETS.includes(item.bucket as MoscowBucket) ? (item.bucket as MoscowBucket) : null;
    const triage = MASTER_TRIAGE.includes(item.triage as MasterTriage) ? (item.triage as MasterTriage) : 'keep';
    const sprint = typeof item.sprint === 'string' && item.sprint.trim() !== '' ? item.sprint.trim() : null;
    plans.push({ issueKey, size, bucket, triage, sprint, reason: typeof item.reason === 'string' ? item.reason : '' });
  }
  return plans;
}

/**
 * Returns a clear, human-readable statement of what accepting a suggestion will DO, so the operator
 * is never guessing behind an Accept/Reject. Each kind maps to its concrete overlay action.
 */
export function describeSuggestionAction(kind: AiSuggestionKind, suggestion: AiSuggestion): string {
  switch (kind) {
    case 'priorityOrder':
      return `Set priority to ${suggestion.proposedValue}`;
    case 'sizeEstimate':
      return `Set size to ${suggestion.proposedValue}`;
    case 'sprintGrouping':
      return `Assign to sprint “${suggestion.proposedValue}”`;
    case 'parkCandidates':
      if (suggestion.proposedValue === 'complete') {
        return 'Move to Complete box (already done)';
      }
      if (suggestion.proposedValue === 'breakout') {
        return 'Break out — marked done but has open work';
      }
      return 'Park (defer)';
    default:
      return 'Apply suggestion';
  }
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
