// chgRiskCheckPrompt.ts — The Release Manager's pre-approval check of a whole change, as a copy-out prompt (GH #395).
//
// The Step 6 "Risk check with AI Assist" button used to send only four text fields and ask for "gaps". A
// Release Manager checks far more than that: every field on the Formula Card, against the record's own
// facts. This builds that review as one prompt the user copies out and whose reply they paste back — the
// same round trip every AI Assist surface uses; nothing is sent anywhere automatically.

import { buildChgContextText, type ChgPromptContext } from './chgPromptContext.ts';
import {
  CHG_TEXT_FIELD_LABELS,
  renderFormulaCardChecklist,
  type ChgTextFieldKey,
} from './formulaCard.ts';

/** The seven drafted text fields as the change currently holds them. */
export type ChgTextFieldValues = Readonly<Record<ChgTextFieldKey, string>>;

// The order a reviewer reads a change in, which is also the order of the Formula Card.
const REVIEW_FIELD_ORDER: readonly ChgTextFieldKey[] = [
  'shortDescription',
  'description',
  'justification',
  'riskImpact',
  'implementationPlan',
  'testPlan',
  'backoutPlan',
];

// Shown for a text field that is still empty, so the reviewer flags it rather than skipping it.
const EMPTY_FIELD_TEXT = '(not set)';

/** Each text field under its form label, with the full text beneath it. */
function renderChangeText(fieldValues: ChgTextFieldValues): string {
  return REVIEW_FIELD_ORDER.map((fieldKey) => {
    const fieldText = fieldValues[fieldKey].trim();
    return `${CHG_TEXT_FIELD_LABELS[fieldKey]}:\n${fieldText === '' ? EMPTY_FIELD_TEXT : fieldText}`;
  }).join('\n\n');
}

// The reply format. One line per card field keeps the review scannable and makes every gap point at the
// exact text box it must be fixed in.
const REPLY_FORMAT_LINES: readonly string[] = [
  'Reply in plain text, in exactly this format and card order, with no other commentary:',
  'One line per Formula Card field (sections 1-7), each starting with one of:',
  'PASS | <field> — <why it meets the minimum acceptable>',
  'GAP | <field> — <what is missing or wrong> — Fix: <the specific text to add, and which change field it belongs in>',
  'N/A | <field> — <why this field does not apply to this change>',
  'Then one line per Front-Page Quality Gate question: YES | <question> or NO | <question> — <why>.',
  'Finish with exactly one line: VERDICT: READY FOR APPROVAL, or VERDICT: NOT READY — <number> gap(s).',
  'Treat any [CONFIRM: ...] placeholder as a GAP until it is filled in.',
];

/**
 * The whole pre-approval check as one prompt: the record facts and delivery path, all seven text fields,
 * then the Formula Card checklist and the reply format.
 */
export function buildChgRiskCheckPrompt(context: ChgPromptContext, fieldValues: ChgTextFieldValues): string {
  return [
    'You are a Release Manager reviewing a ServiceNow Change Request before it enters approval.',
    'Review it strictly against the Change Request Formula Card below. Apply each reviewer test literally; '
      + 'vague wording such as "implement change", "monitor", "validate" or "revert the change" does not pass.',
    '',
    buildChgContextText(context),
    '',
    'The change as written:',
    renderChangeText(fieldValues),
    '',
    'Change Request Formula Card:',
    renderFormulaCardChecklist(),
    '',
    ...REPLY_FORMAT_LINES,
  ].join('\n');
}
