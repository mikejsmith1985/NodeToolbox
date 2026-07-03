// canvasAiAssist.ts — The hidden, passphrase-gated copy-paste AI round-trip for the canvas.
//
// This mirrors the hardened release-notes AI Assist pattern: the tool GENERATES a prompt the
// operator pastes into an external assistant, then INGESTS a strict JSON reply. It is an
// accelerator only — every suggestion is an editable proposal defaulting to un-accepted, and
// the coaching workflow is fully operable without it. No AI service is called from here.

import type { MoscowBucket } from '../overlay/overlayModel.ts';

/** The analyses the accelerator can pre-fill. */
export type AiSuggestionKind = 'priorityOrder' | 'staleCandidates' | 'duplicateCandidates' | 'sprintGrouping';

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

/** Minimal context a prompt needs: the candidate issues currently on the canvas. */
export interface AiPromptIssue {
  issueKey: string;
  summary: string;
  status: string;
  storyPoints: number | null;
}

const MOSCOW_BUCKETS: readonly MoscowBucket[] = ['Must', 'Should', 'Could', 'Wont'];

/** Human-readable instruction per analysis kind, embedded in the generated prompt. */
const PROMPT_INSTRUCTIONS: Record<AiSuggestionKind, string> = {
  priorityOrder:
    'Assign each issue a MoSCoW bucket (Must, Should, Could, Wont). Respond ONLY with valid JSON: '
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
};

/** Builds the copy-paste prompt for one analysis over the given candidate issues. */
export function buildCanvasAiPrompt(kind: AiSuggestionKind, issues: readonly AiPromptIssue[]): string {
  const issueLines = issues
    .map((issue) => `- ${issue.issueKey} [${issue.status}${issue.storyPoints !== null ? `, ${issue.storyPoints}pt` : ''}] ${issue.summary}`)
    .join('\n');
  return `${PROMPT_INSTRUCTIONS[kind]}\n\nIssues:\n${issueLines}`;
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
