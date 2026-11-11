// riskCheckTable.ts — The fill-in table every risk-check round ends with, and its follow-up for rows left out (GH #499).
//
// Google's AI Mode, the team's only assistant, ignores a line format such as "GAP | <name> — <why>" and writes its own
// document instead. A table that already lists every item — each Formula Card field, each quality-gate question, each
// task's backout plan — is followed far more reliably: the assistant only fills in the blanks, so it cannot rename,
// invent or drop an item. Any row still left blank gets a short follow-up for the SAME chat asking for just those rows;
// nothing is ever guessed for it.

import { buildFillInTable, FILL_IN_BLANK } from '../../../utils/aiReplyTable.ts';
import { FORMULA_CARD_FIELDS, FORMULA_CARD_QUALITY_GATE } from './formulaCard.ts';
import {
  normaliseFindingName,
  parseRiskCheckReview,
  RISK_CHECK_TABLE_HEADER,
  RISK_CHECK_TABLE_MARKER,
  type RiskCheckFinding,
} from './riskCheckReview.ts';

// ── The table ──

/**
 * Every item a full check answers, in card order: each Formula Card field, each quality-gate question, then any extra
 * items (the change's implementation tasks' backout plans).
 */
export function listFullCheckItems(extraItems: readonly string[] = []): string[] {
  return [
    ...FORMULA_CARD_FIELDS.map((cardField) => cardField.field),
    ...FORMULA_CARD_QUALITY_GATE.map((gateItem) => gateItem.question),
    ...extraItems,
  ];
}

/** The rule lines before the table: what each column takes, worded for an assistant that answers in its own shape. */
export function describeRiskCheckTableRules(): string[] {
  return [
    `Answer ONLY by copying the table below, starting with the line ${RISK_CHECK_TABLE_MARKER}, and replacing every `
      + `${FILL_IN_BLANK} with your answer. Keep every row, in this order, with its Item exactly as written. Do not add, `
      + 'remove or rename rows or columns, and do not answer in bullet points, headings or paragraphs.',
    'Answer: PASS, GAP, N/A, INFO or RECORD for a card field or a task; YES or NO for a quality-gate question.',
    'Finding: why it passes, what falls short, why it does not apply, the one question for the owner, or what to set in '
      + 'the change form.',
    `Fix: only for a GAP or NO — the specific text to add and which change field it belongs in. Otherwise leave ${FILL_IN_BLANK}.`,
    'Keep each cell on one line and never put a "|" inside a cell. Write nothing before or after the table.',
  ];
}

/** The rules, the marker line and the table itself: one row per item, its name filled in and a blank for each answer. */
export function buildRiskCheckTableLines(items: readonly string[]): string[] {
  return [
    ...describeRiskCheckTableRules(),
    '',
    RISK_CHECK_TABLE_MARKER,
    ...buildFillInTable(RISK_CHECK_TABLE_HEADER, items.map((itemName) => [itemName])),
  ];
}

// ── Rows left out ──

/**
 * Every reply pasted in one round, oldest first. A follow-up's reply answers only the rows left blank, so it is read
 * together with the first reply; a row answered twice takes its later answer.
 */
export function appendRoundReply(roundReplies: string, replyText: string): string {
  return roundReplies === '' ? replyText : `${roundReplies}\n${replyText}`;
}

/**
 * The asked items a reply's findings do not answer. An exact name match wins; only then is a light rewording accepted,
 * one finding per item, so "Impact" is never counted as answered by "Data Impact".
 */
export function listUnansweredItems(findings: readonly RiskCheckFinding[], askedItems: readonly string[]): string[] {
  const remainingNames = findings.map((finding) => normaliseFindingName(finding.field));
  const claimName = (nameIndex: number) => { remainingNames.splice(nameIndex, 1); };
  const looselyUnmatched = askedItems.filter((itemName) => {
    const exactIndex = remainingNames.indexOf(normaliseFindingName(itemName));
    if (exactIndex === -1) return true;
    claimName(exactIndex);
    return false;
  });
  return looselyUnmatched.filter((itemName) => {
    const itemKey = normaliseFindingName(itemName);
    const looseIndex = remainingNames.findIndex((findingName) => findingName !== '' && (findingName.includes(itemKey) || itemKey.includes(findingName)));
    if (looseIndex === -1) return true;
    claimName(looseIndex);
    return false;
  });
}

/**
 * The follow-up for the same AI chat when a review reply could not be read or left rows blank, or '' when every asked
 * item was answered. It asks for the table again with only the rows still open, so the answers already given are kept.
 */
export function buildRiskCheckFollowUp(replyText: string, askedItems: readonly string[]): string {
  const findings = parseRiskCheckReview(replyText).findings;
  const unansweredItems = listUnansweredItems(findings, askedItems);
  if (unansweredItems.length === 0) {
    return '';
  }
  const openingLine = findings.length === 0
    ? 'Your last reply was not in the form I need, so it could not be read. Keep the judgements you made, but put them in this table.'
    : `Your last reply left ${unansweredItems.length} ${unansweredItems.length === 1 ? 'row' : 'rows'} unanswered. Answer only these rows now.`;
  return [openingLine, ...buildRiskCheckTableLines(unansweredItems)].join('\n');
}
