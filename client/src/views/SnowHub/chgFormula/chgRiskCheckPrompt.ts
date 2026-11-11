// chgRiskCheckPrompt.ts — The Release Manager's pre-approval check of a whole change, as a copy-out prompt (GH #395).
//
// The Step 6 "Risk check with AI Assist" button used to send only four text fields and ask for "gaps". A
// Release Manager checks far more than that: every field on the Formula Card, against the record's own
// facts. This builds that review as one prompt the user copies out and whose reply they paste back — the
// same round trip every AI Assist surface uses; nothing is sent anywhere automatically.

import {
  CHG_FIELD_REPLY_MARKERS,
  CODE_BLOCK_REPLY_INSTRUCTION,
  restoreMarkerLineBreaks,
  stripCodeFences,
} from './assistantReplyText.ts';
import { buildChgContextText, type ChgPromptContext, type ExtraPromptPart } from './chgPromptContext.ts';
import { buildRiskCheckTableLines, listFullCheckItems } from './riskCheckTable.ts';
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

/** Each text field under its form label, with the full text beneath it. Shared with the gap-fix round. */
export function renderChangeText(fieldValues: ChgTextFieldValues): string {
  return REVIEW_FIELD_ORDER.map((fieldKey) => {
    const fieldText = fieldValues[fieldKey].trim();
    return `${CHG_TEXT_FIELD_LABELS[fieldKey]}:\n${fieldText === '' ? EMPTY_FIELD_TEXT : fieldText}`;
  }).join('\n\n');
}

/**
 * The bar every check and re-check holds a field to, and the five answers it may give. Shared so the full
 * check and the targeted re-check never disagree about what passes.
 *
 * Why it is shaped this way: the loop used to judge each field against the card's IDEAL (its full formula
 * and evidence — named people, contacts, test records) and to count every [CONFIRM: …] as a gap, while the fix
 * round was told to write [CONFIRM: …] wherever a fact was missing. Each fix therefore created new gaps, and
 * record fields no rewrite can touch failed forever — so the gap count never reached zero. Now a field passes
 * at its Minimum acceptable; a fact only the owner has is INFO (a question, not a gap); a record field is
 * RECORD (set it in the form). Only what a rewrite of the text can close is a GAP.
 */
/**
 * The most questions one review may put to the owner. Fifteen-plus questions on a change whose plans already
 * answered them taught the owner to ignore the list; a short list is one they will actually answer (GH #415).
 */
export const MAX_OWNER_QUESTIONS = 5;

export const REVIEW_STATUS_RULES: readonly string[] = [
  'PASS when the field meets its Minimum acceptable. The Formula, Reviewer test and Evidence describe what good '
    + 'looks like — do not fail a field for lacking them.',
  'N/A when the field\'s [when required] condition does not apply to this change (for example a Moderate/High-only '
    + 'field on a Low-risk change).',
  'GAP only when the change text itself falls short of the minimum and can be rewritten from the facts given here.',
  'A fact stated anywhere — any change field, the record facts, the change tasks (their people and minutes), the '
    + 'Jira work or the attached files — counts for every card field it serves. Read it in other words too.',
  'INFO only when nothing given here meets the minimum (a name, time, count, contact or test result): ask it as one '
    + 'short question. Never ask for more detail than the Minimum acceptable — contact methods, response commitments, '
    + 'test dates, volumes or extra named roles are not minimums. Any [CONFIRM: ...] placeholder is INFO.',
  'The Formula and Evidence lines describe an ideal answer — never turn them into questions. Ask at most '
    + `${MAX_OWNER_QUESTIONS} INFO questions in all, only for facts whose absence would block approval; judge every `
    + 'other field at its minimum from what is given.',
  'RECORD when the problem is a record field (configuration item, category, environment, assignment group, change '
    + 'owner, risk, impact, planned start or end): say what to set in the change form.',
  'YES or NO for a Front-Page Quality Gate question; a NO counts as a gap.',
];

// The review part of the reply. One row per card field keeps the review scannable and makes every gap point at the
// exact text box it must be fixed in. The answer is a fill-in table listing every item, because Google's AI Mode — the
// team's only assistant — ignores a line format but completes a table (GH #499). Toolbox counts the verdict itself.
const REVIEW_INTRO_LINES: readonly string[] = [
  'Judge every Formula Card field (sections 1-7) and every Front-Page Quality Gate question by these rules:',
  ...REVIEW_STATUS_RULES,
];

/**
 * Marks corrected fields inside a pasted review. The risk-check prompt no longer asks for them — asking one
 * reply to review fifty card fields AND rewrite seven fields made it long enough for assistants to cut short,
 * so rewriting is now its own round (chgGapFixPrompt.ts). A reply that includes corrections anyway still has
 * them applied.
 */
export const REVISED_FIELDS_HEADING = '=== REVISED FIELDS ===';

/** A pasted review split into what a person reads and what the app writes back into the change. */
export interface RiskCheckReplyParts {
  reviewText: string;
  revisedFieldsText: string;
}

// The corrections heading, tolerating the bold / heading markup an assistant likes to wrap it in. Not tied
// to a line start: when copying flattened the reply, the heading sits mid-line after the verdict.
const REVISED_FIELDS_HEADING_PATTERN = /[*#_>`-]*=== REVISED FIELDS ===[*#_`-]*/i;

/**
 * Splits a pasted risk-check reply at the corrections heading. With no heading, the whole reply is review
 * — an assistant that found no gaps, or ignored the instruction, still has its review shown.
 */
export function splitRiskCheckReply(replyText: string): RiskCheckReplyParts {
  const cleanedReply = stripCodeFences(replyText);
  const headingMatch = REVISED_FIELDS_HEADING_PATTERN.exec(cleanedReply);
  if (headingMatch === null) {
    return { reviewText: cleanedReply, revisedFieldsText: '' };
  }
  const correctionsText = cleanedReply.slice(headingMatch.index + headingMatch[0].length).trim();
  return {
    reviewText: cleanedReply.slice(0, headingMatch.index).trim(),
    // Each field marker back on its own line, in case copying flattened the corrections too.
    revisedFieldsText: restoreMarkerLineBreaks(correctionsText, CHG_FIELD_REPLY_MARKERS),
  };
}

/**
 * The whole pre-approval check as one prompt: the record facts and delivery path, all seven text fields, the Formula
 * Card checklist and the judging rules, then the fill-in table to answer in — one row per card field and quality-gate
 * question. An extra part (the change's tasks) adds its records after the change, and its rows to the table.
 */
export function buildChgRiskCheckPrompt(
  context: ChgPromptContext,
  fieldValues: ChgTextFieldValues,
  extraPart?: ExtraPromptPart,
): string {
  return [
    'You are a Release Manager reviewing a ServiceNow Change Request before it enters approval.',
    'Review it against the Change Request Formula Card below. Vague wording such as "implement change", "monitor", '
      + '"validate" or "revert the change" does not meet a minimum.',
    '',
    buildChgContextText(context),
    '',
    'The change as written:',
    renderChangeText(fieldValues),
    ...(extraPart ? ['', ...extraPart.contextLines] : []),
    '',
    'Change Request Formula Card:',
    renderFormulaCardChecklist(),
    '',
    ...REVIEW_INTRO_LINES,
    ...(extraPart ? extraPart.replyLines : []),
    CODE_BLOCK_REPLY_INSTRUCTION,
    '',
    ...buildRiskCheckTableLines(listFullCheckItems(extraPart?.tableItems)),
  ].join('\n');
}
