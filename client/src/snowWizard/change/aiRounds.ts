// aiRounds.ts — The wizard's copy-prompt / paste-reply AI rounds over a change draft: prompts out, suggestions back (pure).
//
// Framework-first: the prompt is Toolbox's own gap-fix round (chgGapFixPrompt), aimed at exactly the writing the
// readiness checks flag, and replies are read with Toolbox's own parsers. Only the prompt CONTEXT is built here,
// because Toolbox builds it inside its 3,000-line builder component, which the Wizard cannot carry. Nothing is ever
// sent automatically and nothing is written until the user accepts a suggestion (propose-only, FR-008).

import { buildChgGapFixPrompt } from '../../views/SnowHub/chgFormula/chgGapFixPrompt.ts';
import type { ChgPromptContext } from '../../views/SnowHub/chgFormula/chgPromptContext.ts';
import { CHG_TEXT_FIELD_LABELS, type ChgTextFieldKey } from '../../views/SnowHub/chgFormula/formulaCard.ts';
import type { RiskCheckFinding } from '../../views/SnowHub/chgFormula/riskCheckReview.ts';
import type { ReadinessItem } from '../../views/SnowHub/guided/changeReadiness.ts';
import { buildIssueDetailText, parseAiAssistChgResponse } from '../../views/SnowHub/hooks/useAiAssist.ts';
import { DRAFT_ENVIRONMENTS, readChangeTextFields, readSelectedIssues, type CrgDraftState } from './changeDraft.ts';

/** One proposed rewrite of one field, shown beside the current text for Accept / Decline. */
export interface FieldSuggestion {
  fieldKey: ChgTextFieldKey;
  fieldLabel: string;
  currentText: string;
  suggestedText: string;
}

/** What the user chose for one suggestion. */
export type SuggestionDecision = 'accepted' | 'declined';

/** The assessment answers as "label: value" lines, skipping blanks. */
function readAssessmentLines(draft: CrgDraftState): string[] {
  return Object.entries(draft.chgPlanningAssessment)
    .filter(([, answer]) => answer.trim() !== '')
    .map(([assessmentName, answer]) => `${assessmentName}: ${answer}`);
}

/** The record facts the prompts need, from the draft. */
export function buildWizardPromptContext(draft: CrgDraftState): ChgPromptContext {
  const basicInfo = draft.chgBasicInfo;
  return {
    categoryLabel: basicInfo.category,
    changeTypeLabel: basicInfo.changeType,
    isExpedited: basicInfo.isExpedited,
    configItemLabel: basicInfo.configItem.displayName,
    assignmentGroupLabel: basicInfo.assignmentGroup.displayName,
    changeOwnerLabel: basicInfo.assignedTo.displayName,
    environmentLines: DRAFT_ENVIRONMENTS
      .filter(({ stateKey }) => draft[stateKey].isEnabled)
      .map(({ stateKey, label }) => `${label}: ${draft[stateKey].plannedStartDate || 'no start'} → ${draft[stateKey].plannedEndDate || 'no end'}`),
    assessmentLines: readAssessmentLines(draft),
    changeTaskLines: draft.changeTasks.map((task) => task.shortDescription || task.name),
    jiraSourceText: readSelectedIssues(draft).length > 0 ? buildIssueDetailText(readSelectedIssues(draft)) : undefined,
  };
}

/** Each parsed field that differs from the draft, as a suggestion. */
function buildSuggestions(parsedFields: Partial<Record<ChgTextFieldKey, string>>, draft: CrgDraftState): FieldSuggestion[] {
  const currentFields = readChangeTextFields(draft);
  return (Object.entries(parsedFields) as Array<[ChgTextFieldKey, string]>)
    .filter(([fieldKey, suggestedText]) => suggestedText.trim() !== currentFields[fieldKey].trim())
    .map(([fieldKey, suggestedText]) => ({ fieldKey, fieldLabel: CHG_TEXT_FIELD_LABELS[fieldKey], currentText: currentFields[fieldKey], suggestedText }));
}

/** The failing checks that a rewrite of the change's writing can close, as review findings. */
function readTextGapFindings(items: readonly ReadinessItem[]): RiskCheckFinding[] {
  return items.flatMap((item) => {
    if (item.state !== 'needsAction' || item.action?.kind !== 'openStep' || !item.action.focusField) return [];
    return [{ status: 'GAP' as const, field: CHG_TEXT_FIELD_LABELS[item.action.focusField], detail: item.reason, fix: '' }];
  });
}

/** The fix-the-writing round for the failing checks, or null when no failing check is about the writing. */
export function buildChecksFixPrompt(draft: CrgDraftState, items: readonly ReadinessItem[]): string | null {
  const gapFindings = readTextGapFindings(items);
  if (gapFindings.length === 0) return null;
  return buildChgGapFixPrompt(buildWizardPromptContext(draft), readChangeTextFields(draft), gapFindings);
}

/** A pasted fix-round reply as suggestions. */
export function readFixReply(replyText: string, draft: CrgDraftState): FieldSuggestion[] {
  return buildSuggestions(parseAiAssistChgResponse(replyText), draft);
}
