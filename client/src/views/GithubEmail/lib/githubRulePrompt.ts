// githubRulePrompt.ts — The AI-assist rule generator: a prompt to hand an email to any AI, and a parser
// that reads the JSON rule back. Two pure functions, no React and no I/O.
//
// This lets a user finalize classification rules for new event types (PR opened / merged / branch created)
// WITHOUT sharing any email with anyone but their own in-house AI: they copy the prompt, paste it plus a
// real notification email into their AI, and paste the JSON rule it returns back into the app. The reply is
// validated against the same SerializedEmailRule shape the engine compiles, so a malformed or wrong-surface
// reply is rejected cleanly rather than silently misclassifying mail.

import { extractJsonPayload } from '../../../utils/extractJsonPayload.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';
import { getHeader, parseMime, type MimeMessage } from './parseMime.ts';
import {
  CLASSIFIABLE_EVENT_TYPES,
  validateSerializedRule,
  type SerializedEmailRule,
} from './githubEmailRules.ts';

/** The envelope kind for a single-rule reply, so a reply pasted from a different AI surface is caught. */
const RULE_REPLY_KIND = 'githubEmailRule';

/** The envelope kind for a bulk reply (an array of rules covering several email shapes at once). */
const RULE_SET_REPLY_KIND = 'githubEmailRuleSet';

/** How many distinct email "shapes" to embed in one bulk prompt before we stop, to keep it pasteable. */
const MAX_REPRESENTATIVES = 15;

/** How many characters of each email's plain-text BODY to embed — the classification clue is near the top. */
const MAX_BODY_CHARS = 1500;

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

// ── Bulk rule generation (many emails → one prompt → an array of rules) ────────────────────────────────
//
// The single-email flow above is repeated once per event type. The bulk flow lets an operator hand their
// in-house AI EVERY distinct kind of notification email at once and get back a whole rule set — so nothing
// leaves the corporate environment and the paste happens only once. To keep the prompt pasteable we send
// one REPRESENTATIVE per distinct email "shape" (grouped by signature) rather than every raw email.

/** One email the server read from the drop folder, with its current classification. */
export interface EmailSample {
  fileName: string;
  /** The event type the engine classified it as today ('unknown' means it needs a rule). */
  eventType: string;
  /** The full raw RFC-822 source, embedded in the prompt for the AI to analyse. */
  rawSource: string;
}

/** The outcome of building a bulk prompt: the prompt text plus counts the panel surfaces to the operator. */
export interface BulkRulePromptResult {
  /** The prompt to copy into the AI, or '' when there were no samples to bundle. */
  prompt: string;
  /** How many distinct email shapes were embedded (one representative each). */
  representativeCount: number;
  /** How many distinct shapes existed in total (before the MAX_REPRESENTATIVES cap). */
  groupCount: number;
  /** How many shapes were dropped because they exceeded the cap (groupCount - representativeCount). */
  omittedCount: number;
}

/**
 * Derives a coarse "shape" signature for an email so near-identical notifications collapse to one
 * representative. Prefers the X-GitHub-Reason header (GitHub's own event signal); otherwise it reduces the
 * Subject to a skeleton by stripping the [owner/repo] tag and blanking numbers (PR ids, counts) so
 * "Add thing (#41)" and "Fix bug (#87)" share a signature.
 */
export function emailSampleSignature(rawSource: string): string {
  const message = parseMime(rawSource);
  const reason = (getHeader(message, 'x-github-reason') || '').trim().toLowerCase();
  if (reason !== '') {
    return 'reason:' + reason;
  }
  const subject = (getHeader(message, 'subject') || '').toLowerCase();
  const skeleton = subject
    .replace(/\[[^\]]*\]/g, '')     // drop the [owner/repo] tag
    .replace(/#?\d+/g, '#')          // blank PR ids and counts
    .replace(/\s+/g, ' ')            // collapse whitespace
    .trim();
  return 'subject:' + skeleton;
}

/**
 * Reduces one raw email to the exact fields the classifier matches on, so those signals ALWAYS appear in the
 * prompt. GitHub notifications lead with very large DKIM/ARC/Received header blocks; a blind slice of the raw
 * source could spend its whole budget on that noise and cut off the Subject, X-GitHub-Reason header, and body
 * (GH #262). Distilling with the same parseMime the engine uses guarantees the AI sees — and writes regexes
 * against — the same Subject and plain-text body the engine will later match. Only the body is capped.
 */
function distillEmailForPrompt(rawSource: string): string {
  const message: MimeMessage = parseMime(rawSource);
  const subject = (getHeader(message, 'subject') || '').trim();
  const reason = (getHeader(message, 'x-github-reason') || '').trim();
  const listId = (getHeader(message, 'list-id') || '').trim();
  const sender = (getHeader(message, 'x-github-sender') || '').trim();
  // Match the engine's body choice: prefer text/plain, else flatten the HTML alternative with the shared helper.
  const bodyText = message.textPlain !== null
    ? message.textPlain
    : (message.textHtml !== null ? normalizeRichTextToPlainText(message.textHtml) : '');
  const cappedBody = bodyText.length > MAX_BODY_CHARS
    ? bodyText.slice(0, MAX_BODY_CHARS) + '\n… (body truncated)'
    : bodyText;

  const lines = [
    'Subject: ' + (subject || '(none)'),
    'X-GitHub-Reason: ' + (reason || '(none)'),
    'List-ID: ' + (listId || '(none)'),
  ];
  if (sender !== '') {
    lines.push('X-GitHub-Sender: ' + sender);
  }
  lines.push('', 'Body:', cappedBody.trim());
  return lines.join('\n');
}

/** Keeps the first sample of each distinct signature, preserving input order. */
function pickRepresentatives(samples: EmailSample[]): { representatives: EmailSample[]; groupCount: number } {
  const seenSignatures = new Set<string>();
  const representatives: EmailSample[] = [];
  for (const sample of samples) {
    const signature = emailSampleSignature(sample.rawSource);
    if (seenSignatures.has(signature)) {
      continue;
    }
    seenSignatures.add(signature);
    representatives.push(sample);
  }
  return { representatives, groupCount: seenSignatures.size };
}

/**
 * Builds ONE prompt from many drop-folder emails. Groups them by shape, embeds one representative per shape
 * (capped at MAX_REPRESENTATIVES), and asks the AI to return an ARRAY of rules — one per distinct event
 * type it recognises. The reply is validated by parseRuleReplyToList against the same rule shape the engine
 * compiles, so a malformed or wrong-surface reply is rejected cleanly.
 */
export function buildBulkRulePrompt(samples: EmailSample[]): BulkRulePromptResult {
  if (samples.length === 0) {
    return { prompt: '', representativeCount: 0, groupCount: 0, omittedCount: 0 };
  }
  const { representatives, groupCount } = pickRepresentatives(samples);
  const embedded = representatives.slice(0, MAX_REPRESENTATIVES);
  const eventList = CLASSIFIABLE_EVENT_TYPES.map((eventType) => '  - ' + eventType).join('\n');

  const emailBlocks = embedded.map((sample, index) => {
    return ['--- EMAIL ' + (index + 1) + ' ---', distillEmailForPrompt(sample.rawSource)].join('\n');
  }).join('\n\n');

  const prompt = [
    'You are helping classify GitHub notification emails into deterministic event types.',
    '',
    'Below are several DIFFERENT kinds of notification email. Analyze them and return a JSON object holding',
    'an ARRAY of rules — one rule per DISTINCT event type you recognise across the emails. Match on stable',
    'signals only: the X-GitHub-Reason header, and/or a regular expression over the Subject line, and/or a',
    'regular expression over the plain-text body. Prefer the X-GitHub-Reason header when present — it is the',
    'most reliable signal. Keep each regex narrow enough not to match a different event type.',
    '',
    'Each rule\'s eventType MUST be exactly one of:',
    eventList,
    '',
    'Return ONLY this JSON shape (each rule: include at least one of reasonHeaderIn, subjectPattern, or',
    'bodyPattern; omit any field you do not need; give each rule a unique short kebab-case id):',
    '{',
    '  "kind": "' + RULE_SET_REPLY_KIND + '",',
    '  "rules": [',
    '    {',
    '      "id": "a-short-kebab-case-id",',
    '      "eventType": "one of the event types above",',
    '      "reasonHeaderIn": ["values the X-GitHub-Reason header may hold"],',
    '      "subjectPattern": "a JavaScript regex source, matched case-insensitively (optional)",',
    '      "bodyPattern": "a JavaScript regex source, matched case-insensitively (optional)",',
    '      "requiresPrNumber": true',
    '    }',
    '  ]',
    '}',
    '',
    'Do not include backreferences, code, or explanation — only the JSON object.',
    '',
    'Each email below is shown distilled to exactly the fields the classifier matches — its Subject line, its',
    'X-GitHub-Reason header, and its plain-text body — so write subjectPattern / bodyPattern against this text.',
    '',
    'EMAILS:',
    emailBlocks,
  ].join('\n');

  return {
    prompt,
    representativeCount: embedded.length,
    groupCount,
    omittedCount: Math.max(0, groupCount - embedded.length),
  };
}

/** The outcome of reading a bulk (or single) AI reply into a validated list of rules. */
export interface RuleListResult {
  ok: boolean;
  /** Every rule that validated, de-duplicated by id (a later duplicate id replaces an earlier one). */
  rules: SerializedEmailRule[];
  /** How many candidate rules in the reply were rejected as invalid. */
  rejectedCount: number;
  error?: string;
}

/**
 * Parses an AI reply into a validated LIST of rules, tolerating every shape a reply might take: the bulk
 * envelope ({kind:'githubEmailRuleSet', rules:[…]}), the single envelope ({kind:'githubEmailRule', rule:{…}}),
 * a bare {rules:[…]} or {rule:{…}}, a bare array, or a bare object. This one parser therefore backs both the
 * "add one rule" and "add a whole rule set" buttons. Every failure returns a clear message rather than throwing.
 */
export function parseRuleReplyToList(replyText: string): RuleListResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonPayload(replyText));
  } catch (parseError) {
    return { ok: false, rules: [], rejectedCount: 0, error: parseError instanceof Error ? parseError.message : 'Could not read JSON from the reply.' };
  }

  const container = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed as Record<string, unknown> : null;
  if (container && 'kind' in container && container.kind !== RULE_REPLY_KIND && container.kind !== RULE_SET_REPLY_KIND) {
    return { ok: false, rules: [], rejectedCount: 0, error: 'This reply is for "' + String(container.kind) + '", not a GitHub email rule.' };
  }

  // Reduce whatever shape we got to a flat list of candidate rule objects.
  let candidates: unknown[];
  if (Array.isArray(parsed)) {
    candidates = parsed;
  } else if (container && Array.isArray(container.rules)) {
    candidates = container.rules;
  } else if (container && 'rule' in container) {
    candidates = [container.rule];
  } else {
    candidates = [parsed];
  }

  // Validate each and de-duplicate by id (last occurrence wins, so a refined re-paste replaces the earlier).
  const rulesById = new Map<string, SerializedEmailRule>();
  let rejectedCount = 0;
  for (const candidate of candidates) {
    const rule = validateSerializedRule(candidate);
    if (rule === null) {
      rejectedCount += 1;
      continue;
    }
    rulesById.set(rule.id, rule);
  }

  const rules = Array.from(rulesById.values());
  if (rules.length === 0) {
    return { ok: false, rules: [], rejectedCount, error: 'No valid rule was found in the reply — each rule needs an id, a known eventType, and at least one matcher.' };
  }
  return { ok: true, rules, rejectedCount };
}
