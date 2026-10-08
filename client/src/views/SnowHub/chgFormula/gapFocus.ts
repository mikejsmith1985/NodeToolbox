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
import { renderChangeText, REVIEW_STATUS_RULES } from './chgRiskCheckPrompt.ts';
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
export function isSameName(reviewerName: string, cardName: string): boolean {
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
  const gapLine = finding.status === 'INFO'
    ? renderEarlierQuestionLine(finding)
    : `- ${[finding.field, finding.detail, finding.fix ? `Earlier suggested fix: ${finding.fix}` : '']
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
  // A question's answer can be in any field (a duration in the implementation plan, a validator in the test plan),
  // so a re-check that holds one is shown the whole change; text-only gaps keep the short, focused prompt.
  const isWholeChangeShown = hasQuestionOrRecordFinding(gapFindings);
  const gapFieldKeys = isWholeChangeShown ? [] : resolveGapTextFields(gapFindings);
  return [
    'You are a Release Manager re-checking specific gaps in a ServiceNow Change Request against the Change '
      + 'Request Formula Card. Judge ONLY the gaps listed below; nothing else is in question.',
    '',
    buildChgContextText(context),
    '',
    isWholeChangeShown ? 'The change as it now reads:' : '',
    isWholeChangeShown ? renderChangeText(fieldValues) : '',
    gapFieldKeys.length > 0 ? 'The fields these gaps live in, as they now read:' : '',
    gapFieldKeys.length > 0 ? renderSelectedChangeText(fieldValues, gapFieldKeys) : '',
    ...(extraPart ? ['', ...extraPart.contextLines] : []),
    '',
    'Gaps to re-check:',
    ...gapFindings.map((finding) => renderGapWithRule(finding)),
    ...(extraPart?.gapLines ?? []),
    '',
    'Reply with exactly one line per item above, using its exact name, judged by these rules:',
    ...REVIEW_STATUS_RULES,
    'For a quality-gate question, answer YES | <question> or NO | <question> — <why>.',
    'Then exactly one line: VERDICT: READY FOR APPROVAL, or VERDICT: NOT READY — <number> gap(s), counting only GAP '
      + 'and NO lines.',
    '',
    CODE_BLOCK_REPLY_INSTRUCTION,
  ].join('\n');
}

/**
 * An earlier question, framed as something to close rather than a premise to repeat. Shown bare, the assistant
 * asked the very same question again — even with the answer in the change in front of it (GH #415).
 */
function renderEarlierQuestionLine(finding: RiskCheckFinding): string {
  return `- ${finding.field} — Earlier question: ${finding.detail} — PASS it if anything given here meets the minimum.`;
}

/** True when a re-check holds a question or a record field, whose answer can sit in any part of the change. */
function hasQuestionOrRecordFinding(findings: readonly RiskCheckFinding[]): boolean {
  return findings.some((finding) => finding.status === 'INFO' || finding.status === 'RECORD');
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
 * True for anything not yet settled: a gap or failed gate, a fact still needed from the owner (INFO), or a
 * record field still to set (RECORD). Check again re-judges all of these, so an answered question can close.
 */
export function isUnsettledFinding(finding: RiskCheckFinding): boolean {
  return isOpenFinding(finding) || finding.status === 'INFO' || finding.status === 'RECORD';
}

/**
 * The questions the owner has answered, as gaps for the fix round: each carries the owner's answer as the fix,
 * so the rewrite puts that fact into the field the question belongs to. This is how the loop becomes a
 * conversation — the check asks, the owner answers in the app, the fix round writes the answers in.
 */
export function buildAnsweredFindings(
  questionFindings: readonly RiskCheckFinding[],
  answersByField: Readonly<Record<string, string>>,
): RiskCheckFinding[] {
  return questionFindings
    .filter((finding) => finding.status === 'INFO' && (answersByField[finding.field] ?? '').trim() !== '')
    .map((finding) => ({
      status: 'GAP',
      field: finding.field,
      detail: finding.detail,
      fix: `Write in the owner's answer: ${answersByField[finding.field].trim()}`,
    }));
}

/** "1 fact", "2 facts" — the verdict reads as a sentence. */
function countWithNoun(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** The verdict from what is still unsettled: ready only when nothing is, otherwise each kind counted apart. */
function buildVerdictLine(findings: readonly RiskCheckFinding[]): string {
  const gapCount = findings.filter((finding) => isOpenFinding(finding)).length;
  const infoCount = findings.filter((finding) => finding.status === 'INFO').length;
  const recordCount = findings.filter((finding) => finding.status === 'RECORD').length;
  if (gapCount + infoCount + recordCount === 0) {
    return 'VERDICT: READY FOR APPROVAL';
  }
  const verdictParts = [
    gapCount > 0 ? `${gapCount} gap(s)` : 'no text gaps',
    ...(infoCount > 0 ? [`${countWithNoun(infoCount, 'fact', 'facts')} needed from you`] : []),
    ...(recordCount > 0 ? [`${countWithNoun(recordCount, 'record field', 'record fields')} to set`] : []),
  ];
  return `VERDICT: NOT READY — ${verdictParts.join('; ')}.`;
}

/**
 * A set of findings as review text, with the verdict counted from what is still open — the one place a
 * verdict is recalculated, so every way of combining reviews agrees on it.
 */
export function renderReviewText(findings: readonly RiskCheckFinding[]): string {
  return [...findings.map((finding) => renderFindingLine(finding)), buildVerdictLine(findings)].join('\n');
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
