// gapFocus.ts — Keeps each round of the risk-check loop to the gaps that are still open (GH #395).
//
// After the first full review, re-sending the whole change and the whole fifty-field card every round is
// slow and dilutes the assistant's attention. Each gap names a Formula Card field (or a quality-gate
// question), and each card field is answered in one known text field — so a round can carry only those
// fields, only those rules, and re-check only those gaps. The full review stays one click away for a final
// pass that would catch anything a rewrite newly broke.

import { CODE_BLOCK_REPLY_INSTRUCTION } from './assistantReplyText.ts';
import { buildChgContextText, type ChgPromptContext, type ExtraPromptPart } from './chgPromptContext.ts';
import {
  CHG_TEXT_FIELD_FORMULA_FIELDS,
  CHG_TEXT_FIELD_LABELS,
  FORMULA_CARD_FIELDS,
  FORMULA_CARD_QUALITY_GATE,
  type ChgTextFieldKey,
} from './formulaCard.ts';
import { parseRiskCheckReview, type RiskCheckFinding } from './riskCheckReview.ts';

/** The seven drafted text fields as the change currently holds them. */
type ChgTextFieldValues = Readonly<Record<ChgTextFieldKey, string>>;

// The order fields appear on the change form — every list of fields is shown in this order.
const FORM_FIELD_ORDER = Object.keys(CHG_TEXT_FIELD_LABELS) as ChgTextFieldKey[];

// Which text field answers each Front-Page Quality Gate question, in the card's question order.
const QUALITY_GATE_TEXT_FIELDS: readonly (readonly ChgTextFieldKey[])[] = [
  ['shortDescription', 'description'], // Can anyone understand exactly what is changing?
  ['justification'], // Is it clear why the change must occur now?
  ['testPlan'], // Can the team detect failure quickly?
  ['backoutPlan'], // Can the service be restored within the approved window?
  ['testPlan'], // Is success objective?
];

/** Lower-case letters and digits only, so "Backout Trigger(s)" and "backout trigger" compare equal. */
function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** True when a reviewer's name for a field is the card's name, allowing a light rewording either way. */
function isSameName(reviewerName: string, cardName: string): boolean {
  const reviewerKey = normaliseName(reviewerName);
  const cardKey = normaliseName(cardName);
  return reviewerKey !== '' && (reviewerKey === cardKey || reviewerKey.includes(cardKey) || cardKey.includes(reviewerKey));
}

/**
 * The card field names a reviewer's name refers to. An exact match wins outright, so "Impact" means the
 * Impact field, not Data Impact; only when nothing matches exactly is a light rewording accepted.
 */
function findMatchingCardNames(reviewerName: string): string[] {
  const allCardNames = FORMULA_CARD_FIELDS.map((entry) => entry.field);
  const exactMatches = allCardNames.filter((cardName) => normaliseName(cardName) === normaliseName(reviewerName));
  return exactMatches.length > 0 ? exactMatches : allCardNames.filter((cardName) => isSameName(reviewerName, cardName));
}

/** The text fields one gap is answered in: its card field's field, or the gate question's; none for record fields. */
function resolveFieldsForFinding(finding: RiskCheckFinding): readonly ChgTextFieldKey[] {
  const gateIndex = FORMULA_CARD_QUALITY_GATE.findIndex((gateItem) => isSameName(finding.field, gateItem.question));
  if (gateIndex >= 0) {
    return QUALITY_GATE_TEXT_FIELDS[gateIndex];
  }
  const matchingCardNames = findMatchingCardNames(finding.field);
  return FORM_FIELD_ORDER.filter((fieldKey) =>
    CHG_TEXT_FIELD_FORMULA_FIELDS[fieldKey].some((cardFieldName) => matchingCardNames.includes(cardFieldName)));
}

/**
 * The text fields the gaps live in, once each, in form order. Record-field gaps (configuration item, owner,
 * dates…) map to none — no rewrite of text can close them.
 */
export function resolveGapTextFields(gapFindings: readonly RiskCheckFinding[]): ChgTextFieldKey[] {
  const gapFieldKeys = new Set(gapFindings.flatMap((finding) => resolveFieldsForFinding(finding)));
  return FORM_FIELD_ORDER.filter((fieldKey) => gapFieldKeys.has(fieldKey));
}

/** Only the named fields, each under its form label — the rest of the change is not this round's business. */
export function renderSelectedChangeText(fieldValues: ChgTextFieldValues, fieldKeys: readonly ChgTextFieldKey[]): string {
  return fieldKeys.map((fieldKey) => {
    const fieldText = fieldValues[fieldKey].trim();
    return `${CHG_TEXT_FIELD_LABELS[fieldKey]}:\n${fieldText === '' ? '(not set)' : fieldText}`;
  }).join('\n\n');
}

/** One open gap with the rule it is judged against: the card field's formula, or the gate's pass standard. */
function renderGapWithRule(finding: RiskCheckFinding): string {
  const gapLine = `- ${[finding.field, finding.detail, finding.fix ? `Earlier suggested fix: ${finding.fix}` : '']
    .filter((part) => part !== '').join(' — ')}`;
  const [matchingCardName] = findMatchingCardNames(finding.field);
  const cardField = FORMULA_CARD_FIELDS.find((entry) => entry.field === matchingCardName);
  if (cardField) {
    return [gapLine, `  Formula: ${cardField.formula}`, `  Minimum acceptable: ${cardField.minimumAcceptable}`,
      `  Reviewer test: ${cardField.reviewerTest}`].join('\n');
  }
  const gateItem = FORMULA_CARD_QUALITY_GATE.find((item) => isSameName(finding.field, item.question));
  return gateItem ? `${gapLine}\n  Pass standard: ${gateItem.passStandard}` : gapLine;
}

/**
 * The targeted re-check: only the gaps the last review left open, only the fields they live in, each judged
 * against its own card rule — a short prompt and a short reply.
 */
export function buildGapRecheckPrompt(
  context: ChgPromptContext,
  fieldValues: ChgTextFieldValues,
  gapFindings: readonly RiskCheckFinding[],
  extraPart?: ExtraPromptPart,
): string {
  const gapFieldKeys = resolveGapTextFields(gapFindings);
  return [
    'You are a Release Manager re-checking specific gaps in a ServiceNow Change Request against the Change '
      + 'Request Formula Card. Judge ONLY the gaps listed below; nothing else is in question.',
    '',
    buildChgContextText(context),
    '',
    gapFieldKeys.length > 0 ? 'The fields these gaps live in, as they now read:' : '',
    gapFieldKeys.length > 0 ? renderSelectedChangeText(fieldValues, gapFieldKeys) : '',
    ...(extraPart ? ['', ...extraPart.contextLines] : []),
    '',
    'Gaps to re-check:',
    ...gapFindings.map((finding) => renderGapWithRule(finding)),
    ...(extraPart?.gapLines ?? []),
    '',
    'Reply with exactly one line per gap above, using its exact name, each starting with one of:',
    'PASS | <name> — <why it now meets the minimum acceptable>',
    'GAP | <name> — <what is still missing> — Fix: <the specific text to add, and which change field it belongs in>',
    'N/A | <name> — <why it does not apply to this change>',
    'For a quality-gate question, answer YES | <question> or NO | <question> — <why>.',
    'Then exactly one line: VERDICT: READY FOR APPROVAL, or VERDICT: NOT READY — <number> gap(s).',
    'Treat any [CONFIRM: ...] placeholder as a GAP until it is filled in.',
    '',
    CODE_BLOCK_REPLY_INSTRUCTION,
  ].join('\n');
}

/** One finding as a review line, in the same format the review prompt asks for. */
function renderFindingLine(finding: RiskCheckFinding): string {
  return [`${finding.status} | ${finding.field}`, finding.detail, finding.fix ? `Fix: ${finding.fix}` : '']
    .filter((part) => part !== '').join(' — ');
}

/** True for a finding that still needs work: an open gap or a failed quality-gate question. */
export function isOpenFinding(finding: RiskCheckFinding): boolean {
  return finding.status === 'GAP' || finding.status === 'NO';
}

/**
 * A set of findings as review text, with the verdict counted from what is still open — the one place a
 * verdict is recalculated, so every way of combining reviews agrees on it.
 */
export function renderReviewText(findings: readonly RiskCheckFinding[]): string {
  const openCount = findings.filter((finding) => isOpenFinding(finding)).length;
  const verdictLine = openCount === 0 ? 'VERDICT: READY FOR APPROVAL' : `VERDICT: NOT READY — ${openCount} gap(s).`;
  return [...findings.map((finding) => renderFindingLine(finding)), verdictLine].join('\n');
}

/** How a re-check went: how many of the gaps it judged are now closed, and how many are still open. */
export function countRecheckOutcome(recheckReplyText: string): { closedCount: number; stillOpenCount: number } {
  const recheckFindings = parseRiskCheckReview(recheckReplyText).findings;
  const stillOpenCount = recheckFindings.filter((finding) => isOpenFinding(finding)).length;
  return { closedCount: recheckFindings.length - stillOpenCount, stillOpenCount };
}

/**
 * Folds a targeted re-check into the earlier full review: each re-checked finding replaces its earlier
 * line, every other line is kept, and the verdict is recalculated from what is now open — the re-check's
 * own verdict only ever saw the gaps it was given.
 */
export function mergeRecheckIntoReview(previousReviewText: string, recheckReplyText: string): string {
  const previousReview = parseRiskCheckReview(previousReviewText);
  const recheckFindings = parseRiskCheckReview(recheckReplyText).findings;
  const mergedFindings = previousReview.findings.map((previousFinding) =>
    recheckFindings.find((recheckFinding) => normaliseName(recheckFinding.field) === normaliseName(previousFinding.field))
      ?? previousFinding);
  return renderReviewText(mergedFindings);
}
