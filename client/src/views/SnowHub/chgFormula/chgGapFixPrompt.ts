// chgGapFixPrompt.ts — The "fix these gaps" round of the risk-check loop (GH #395).
//
// The loop is: check → fix → check again, until the verdict is READY. The check reports gaps; this prompt
// hands those gaps back with the change as it stands and asks for the affected fields rewritten, which the
// app applies from the pasted reply. Keeping the rewrite in its own round keeps each reply short enough that
// assistants do not cut it off.

import { CODE_BLOCK_REPLY_INSTRUCTION } from './assistantReplyText.ts';
import { buildChgContextText, type ChgPromptContext } from './chgPromptContext.ts';
import { renderChangeText, type ChgTextFieldValues } from './chgRiskCheckPrompt.ts';
import {
  CHG_TEXT_FIELD_LABELS,
  renderFormulaGuidanceForField,
  type ChgTextFieldKey,
} from './formulaCard.ts';
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

/** Every field's card rules, so a rewrite that closes one gap does not open another. */
function renderAllFieldRules(): string {
  return FIELD_MARKERS
    .map(({ marker, fieldKey }) => `${marker} (${CHG_TEXT_FIELD_LABELS[fieldKey]}) must satisfy:\n${renderFormulaGuidanceForField(fieldKey)}`)
    .join('\n\n');
}

/**
 * The rewrite round: the record facts, the change as written, the gaps the review found, the card rules,
 * and a reply format of whole rewritten fields in the same markers the drafting prompt uses.
 */
export function buildChgGapFixPrompt(
  context: ChgPromptContext,
  fieldValues: ChgTextFieldValues,
  gapFindings: readonly RiskCheckFinding[],
): string {
  return [
    'You are fixing a ServiceNow Change Request so it passes the Release Manager\'s Change Request Formula Card review.',
    'A review of the change found the gaps listed below. Rewrite the change\'s text fields to close every gap you '
      + 'can from the information here.',
    '',
    buildChgContextText(context),
    '',
    'The change as written:',
    renderChangeText(fieldValues),
    '',
    'Gaps to close:',
    ...gapFindings.map((finding) => renderGapLine(finding)),
    '',
    'Formula Card rules for each field:',
    renderAllFieldRules(),
    '',
    'Reply with the complete rewritten text of each field you changed, using these markers in this order, and '
      + 'leave out any field you did not change:',
    ...FIELD_MARKERS.map(({ marker }) => `${marker}:`),
    'Each is the whole field as it should now read, not just the added sentence. Keep every correct fact already '
      + 'in it. A gap in a record field (configuration item, category, assignment group, owner, dates) cannot be '
      + 'fixed in text — skip it. Where the fix needs a fact you do not have, write [CONFIRM: <what is needed>].',
    '',
    CODE_BLOCK_REPLY_INSTRUCTION,
  ].join('\n');
}
