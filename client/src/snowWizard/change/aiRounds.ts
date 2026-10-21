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

const CI_PER_CHANGE_LABEL = 'one per change — see Environments';

/** The environments switched on, each with the configuration item its own change will carry. */
function readEnabledChanges(draft: CrgDraftState) {
  return DRAFT_ENVIRONMENTS.filter(({ stateKey }) => draft[stateKey].isEnabled).map(({ stateKey, label }) => ({
    label,
    environment: draft[stateKey],
    configItemName: draft[stateKey].configItem.displayName || draft.chgBasicInfo.configItem.displayName,
  }));
}

/** One environment's change as a fact line: its window, and its own configuration item when it has one. */
function describeEnvironmentChange({ label, environment, configItemName }: ReturnType<typeof readEnabledChanges>[number]): string {
  const windowText = `${environment.plannedStartDate || 'no start'} → ${environment.plannedEndDate || 'no end'}`;
  return environment.configItem.displayName ? `${label}: ${windowText} (configuration item: ${configItemName})` : `${label}: ${windowText}`;
}

/** The record facts the prompts need, from the draft. */
export function buildWizardPromptContext(draft: CrgDraftState): ChgPromptContext {
  const basicInfo = draft.chgBasicInfo;
  const enabledChanges = readEnabledChanges(draft);
  // Each environment is its own change with its own configuration item; naming just one made the AI ask which change
  // it was writing for (GH #468), so with several the item is stated per environment.
  const hasConfigItemPerChange = new Set(enabledChanges.map((enabledChange) => enabledChange.configItemName)).size > 1;
  return {
    categoryLabel: basicInfo.category,
    changeTypeLabel: basicInfo.changeType,
    isExpedited: basicInfo.isExpedited,
    configItemLabel: hasConfigItemPerChange ? CI_PER_CHANGE_LABEL : basicInfo.configItem.displayName,
    assignmentGroupLabel: basicInfo.assignmentGroup.displayName,
    changeOwnerLabel: basicInfo.assignedTo.displayName,
    environmentLines: enabledChanges.map(describeEnvironmentChange),
    assessmentLines: readAssessmentLines(draft),
    changeTaskLines: draft.changeTasks.map((task) => task.shortDescription || task.name),
    jiraSourceText: readSelectedIssues(draft).length > 0 ? buildIssueDetailText(readSelectedIssues(draft)) : undefined,
  };
}

/**
 * The Wizard raises one change per environment from ONE set of texts (REL and PRD together). Without saying so, the AI
 * asks "is this the REL change or the Production change?" (GH #468). With several environments, this tells it to write
 * text true for every one of them, and to state each difference per environment. Empty for a single change.
 */
export function buildMultiChangeNote(draft: CrgDraftState): string[] {
  const environmentLabels = readEnabledChanges(draft).map((enabledChange) => enabledChange.label);
  if (environmentLabels.length < 2) return [];
  return [
    '',
    `IMPORTANT: these texts go on ${environmentLabels.length} separate change records created together — one per environment `
      + `(${environmentLabels.join(' and ')}) — each with the same Short Description, Description, Justification, Risk and `
      + 'plans. Do not ask which change this is. Write every field so it is true for all of them, and where a fact differs '
      + `(configuration item, window, the testing done in that environment), state it per environment, for example `
      + `"${environmentLabels.map((label) => `${label}: …`).join(' / ')}".`,
  ];
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
  return [buildChgGapFixPrompt(buildWizardPromptContext(draft), readChangeTextFields(draft), gapFindings), ...buildMultiChangeNote(draft)].join('\n');
}
