// aiRounds.ts — The wizard's copy-prompt AI fix round over a change draft: the prompt aimed at the flagged writing (pure).
//
// Framework-first: the prompt is Toolbox's own gap-fix round (chgGapFixPrompt), aimed at exactly the writing the
// readiness checks flag, and replies are read with Toolbox's own parsers. Only the prompt CONTEXT is built here,
// because Toolbox builds it inside its 3,000-line builder component, which the Wizard cannot carry. Replies are read by
// aiDraft.ts; nothing is ever sent automatically and nothing is written until the user applies it (propose-only, FR-008).

import { buildChgGapFixPrompt } from '../../views/SnowHub/chgFormula/chgGapFixPrompt.ts';
import type { ChgPromptContext } from '../../views/SnowHub/chgFormula/chgPromptContext.ts';
import { CHG_TEXT_FIELD_LABELS } from '../../views/SnowHub/chgFormula/formulaCard.ts';
import type { RiskCheckFinding } from '../../views/SnowHub/chgFormula/riskCheckReview.ts';
import type { ReadinessItem } from '../../views/SnowHub/guided/changeReadiness.ts';
import { buildIssueDetailText } from '../../views/SnowHub/hooks/useAiAssist.ts';
import { DRAFT_ENVIRONMENTS, readChangeTextFields, readSelectedIssues, type CrgDraftState } from './changeDraft.ts';

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
