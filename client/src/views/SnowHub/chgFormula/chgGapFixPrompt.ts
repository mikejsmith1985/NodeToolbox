// chgGapFixPrompt.ts — The "fix these gaps" round of the risk-check loop (GH #395).
//
// The loop is: check → fix → check again, until the verdict is READY. The check reports gaps; this prompt
// hands those gaps back with ONLY the fields they live in and only those fields' card rules, and asks for
// just those fields rewritten, which the app applies from the pasted reply. A small prompt gets a short,
// direct reply that assistants do not cut off.

import { CODE_BLOCK_REPLY_INSTRUCTION } from './assistantReplyText.ts';
import { buildChgContextText, type ChgPromptContext, type ExtraPromptPart } from './chgPromptContext.ts';
import type { ChgTextFieldValues } from './chgRiskCheckPrompt.ts';
import {
  CHG_TEXT_FIELD_LABELS,
  renderFormulaGuidanceForField,
  type ChgTextFieldKey,
} from './formulaCard.ts';
import { renderSelectedChangeText, resolveGapTextFields } from './gapFocus.ts';
import type { RiskCheckFinding } from './riskCheckReview.ts';

// Each drafted field's reply marker, in the order the drafting prompt uses them.
const FIELD_MARKERS: ReadonlyArray<{ marker: string; fieldKey: ChgTextFieldKey }> = [
  { marker: 'SHORT_DESCRIPTION', fieldKey: 'shortDescription' },
  { marker: 'DESCRIPTION', fieldKey: 'description' },
  { marker: 'JUSTIFICATION', fieldKey: 'justification' },
  { marker: 'RISK_AND_IMPACT', fieldKey: 'riskImpact' },
  { marker: 'IMPLEMENTATION_PLAN', fieldKey: 'implementationPlan' },
  { marker: 'TEST_PLAN', fieldKey: 'testPlan' },
  { marker: 'BACKOUT_PLAN', fieldKey: 'backoutPlan' },
];

/** One gap as the rewrite prompt lists it: the field, what is wrong, and the reviewer's suggested fix. */
function renderGapLine(finding: RiskCheckFinding): string {
  return `- ${[finding.field, finding.detail, finding.fix ? `Fix: ${finding.fix}` : ''].filter((part) => part !== '').join(' — ')}`;
}

/**
 * The fields this round may rewrite: those the gaps live in. When none can be placed (a reviewer named a
 * field the card does not know), all seven are offered rather than none.
 */
export function resolveFixableFields(gapFindings: readonly RiskCheckFinding[]): ChgTextFieldKey[] {
  const gapFieldKeys = resolveGapTextFields(gapFindings);
  return gapFieldKeys.length > 0 ? gapFieldKeys : FIELD_MARKERS.map(({ fieldKey }) => fieldKey);
}

/** The card rules of the fields being rewritten, so a rewrite that closes one gap does not open another. */
function renderFieldRules(fieldKeys: readonly ChgTextFieldKey[]): string {
  return FIELD_MARKERS
    .filter(({ fieldKey }) => fieldKeys.includes(fieldKey))
    .map(({ marker, fieldKey }) => `${marker} (${CHG_TEXT_FIELD_LABELS[fieldKey]}) must satisfy:\n${renderFormulaGuidanceForField(fieldKey)}`)
    .join('\n\n');
}

/**
 * The rewrite round: the record facts, only the fields the gaps live in, the gaps, those fields' card rules,
 * and a reply format of whole rewritten fields in the same markers the drafting prompt uses. An extra part
 * (the change's tasks) adds its records, gaps and markers; with no change gaps beside it, no change field is
 * offered at all — a task-only round must not invite a rewrite of the change.
 */
export function buildChgGapFixPrompt(
  context: ChgPromptContext,
  fieldValues: ChgTextFieldValues,
  gapFindings: readonly RiskCheckFinding[],
  extraPart?: ExtraPromptPart,
): string {
  const fixableFieldKeys = gapFindings.length === 0 && extraPart ? [] : resolveFixableFields(gapFindings);
  const hasChangeFields = fixableFieldKeys.length > 0;
  return [
    'You are fixing a ServiceNow Change Request so it passes the Release Manager\'s Change Request Formula Card review.',
    'A review of the change found the gaps listed below. Rewrite the change\'s text fields to close every gap you '
      + 'can from the information here.',
    '',
    buildChgContextText(context),
    ...(hasChangeFields ? ['', 'The fields to fix, as they now read:', renderSelectedChangeText(fieldValues, fixableFieldKeys)] : []),
    ...(extraPart ? ['', ...extraPart.contextLines] : []),
    '',
    'Gaps to close:',
    ...gapFindings.map((finding) => renderGapLine(finding)),
    ...(extraPart?.gapLines ?? []),
    ...(hasChangeFields ? ['', 'Formula Card rules for these fields:', renderFieldRules(fixableFieldKeys)] : []),
    '',
    'Reply with the complete rewritten text of each field you changed, using these markers in this order, and '
      + 'leave out any field you did not change:',
    ...FIELD_MARKERS.filter(({ fieldKey }) => fixableFieldKeys.includes(fieldKey)).map(({ marker }) => `${marker}:`),
    ...(extraPart?.replyLines ?? []),
    'Each is the whole field as it should now read, not just the added sentence. Keep every correct fact already '
      + 'in it. A gap in a record field (configuration item, category, assignment group, owner, dates) cannot be '
      + 'fixed in text — skip it. Where the fix needs a fact you do not have, write [CONFIRM: <what is needed>].',
    '',
    CODE_BLOCK_REPLY_INSTRUCTION,
  ].join('\n');
}
