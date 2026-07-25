// githubRulePrompt.ts — The AI-assist rule generator: a prompt to hand an email to any AI, and a parser
// that reads the JSON rule back. Two pure functions, no React and no I/O.
//
// This lets a user finalize classification rules for new event types (PR opened / merged / branch created)
// WITHOUT sharing any email with anyone but their own in-house AI: they copy the prompt, paste it plus a
// real notification email into their AI, and paste the JSON rule it returns back into the app. The reply is
// validated against the same SerializedEmailRule shape the engine compiles, so a malformed or wrong-surface
// reply is rejected cleanly rather than silently misclassifying mail.

import { extractJsonPayload } from '../../../utils/extractJsonPayload.ts';
import {
  CLASSIFIABLE_EVENT_TYPES,
  validateSerializedRule,
  type SerializedEmailRule,
} from './githubEmailRules.ts';

/** The envelope kind, so a reply pasted from a different AI surface is caught rather than misread. */
const RULE_REPLY_KIND = 'githubEmailRule';

/** Where the user pastes their real email inside the generated prompt. */
const EMAIL_PLACEHOLDER = '<<< PASTE THE FULL RAW GITHUB NOTIFICATION EMAIL HERE >>>';

/**
 * Builds the prompt to hand an AI along with a real notification email. It states the exact event
 * vocabulary, the JSON rule shape the app will accept, how the engine matches (X-GitHub-Reason header,
 * Subject regex, body regex — all optional, first match wins), and asks for a single JSON object back.
 */
export function buildRulePrompt(): string {
  const eventList = CLASSIFIABLE_EVENT_TYPES.map((eventType) => '  - ' + eventType).join('\n');
  return [
    'You are helping classify GitHub notification emails into one deterministic event type.',
    '',
    'Analyze the email below and return ONE JSON object describing a rule that would classify THIS kind of',
    'email. Match on stable signals only: the X-GitHub-Reason header, and/or a regular expression over the',
    'Subject line, and/or a regular expression over the plain-text body. Prefer the X-GitHub-Reason header',
    'when present — it is the most reliable signal. Keep regexes narrow enough not to match other event types.',
    '',
    'The event type MUST be exactly one of:',
    eventList,
    '',
    'Return ONLY this JSON shape (omit any field you do not need; include at least one of reasonHeaderIn,',
    'subjectPattern, or bodyPattern):',
    '{',
    '  "kind": "' + RULE_REPLY_KIND + '",',
    '  "rule": {',
    '    "id": "a-short-kebab-case-id",',
    '    "eventType": "one of the event types above",',
    '    "reasonHeaderIn": ["values the X-GitHub-Reason header may hold"],',
    '    "subjectPattern": "a JavaScript regex source, matched case-insensitively (optional)",',
    '    "bodyPattern": "a JavaScript regex source, matched case-insensitively (optional)",',
    '    "requiresPrNumber": true',
    '  }',
    '}',
    '',
    'Do not include backreferences, code, or explanation — only the JSON object.',
    '',
    'EMAIL:',
    EMAIL_PLACEHOLDER,
  ].join('\n');
}

/** The outcome of reading an AI reply: a validated rule, or a human-readable error. */
export interface RuleReplyResult {
  ok: boolean;
  rule?: SerializedEmailRule;
  error?: string;
}

/**
 * Parses an AI reply into a validated SerializedEmailRule. Tolerates prose/fences around the JSON (via the
 * shared extractJsonPayload) and both an enveloped `{kind, rule}` reply and a bare rule object. Every
 * failure returns a clear message rather than throwing, so the panel can show it.
 */
export function parseRuleReply(replyText: string): RuleReplyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(replyText));
  } catch (parseError) {
    return { ok: false, error: parseError instanceof Error ? parseError.message : 'Could not read JSON from the reply.' };
  }

  // Accept either the enveloped form ({kind, rule}) or a bare rule object.
  const container = parsed as Record<string, unknown>;
  const candidate = container && typeof container === 'object' && 'rule' in container ? container.rule : parsed;
  if (container && typeof container === 'object' && 'kind' in container && container.kind !== RULE_REPLY_KIND) {
    return { ok: false, error: 'This reply is for "' + String(container.kind) + '", not a GitHub email rule.' };
  }

  const rule = validateSerializedRule(candidate);
  if (rule === null) {
    return { ok: false, error: 'The rule is invalid: it needs an id, a known eventType, and at least one valid matcher (reason, subject, or body).' };
  }
  return { ok: true, rule };
}
