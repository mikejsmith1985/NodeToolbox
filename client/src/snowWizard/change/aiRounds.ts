// aiRounds.ts — The record facts every Wizard AI prompt states, built from the change draft (pure).
//
// Toolbox builds this context inside its 3,000-line builder component, which the Wizard cannot carry, so it is built
// here from the draft — for AI Assist (aiDraft.ts) and for Toolbox's Risk Check (RiskCheckSection). Nothing is ever
// sent automatically and nothing is written until the user applies it (propose-only, FR-008).

import { describeTaskPeople, type ChgPromptContext } from '../../views/SnowHub/chgFormula/chgPromptContext.ts';
import { formatMinutes, readPlannedWindowMinutes, rollUpEstimates, sumEstimateMinutes } from '../../views/SnowHub/ctaskDurations.ts';
import { DRAFT_ENVIRONMENTS, readSelectedIssues, type CrgDraftState } from './changeDraft.ts';
import { buildIssueDetailTextWithin } from './promptBudget.ts';
import { describeTaskCard } from './taskCards.ts';
import { buildEnvironmentTimelines, describeEnvironmentTimeline, describeTaskTiming } from './taskTimeline.ts';

/** The assessment answers as "label: value" lines, skipping blanks. */
function readAssessmentLines(draft: CrgDraftState): string[] {
  return Object.entries(draft.chgPlanningAssessment)
    .filter(([, answer]) => answer.trim() !== '')
    .map(([assessmentName, answer]) => `${assessmentName}: ${answer}`);
}

const CI_PER_CHANGE_LABEL = 'one per change — see Environments';
// The Jira work's share of a Risk Check prompt, which also carries the change's seven texts, every CTASK and the rules,
// so the whole stays inside an AI chat box's 128,000 characters (GH #475).
const JIRA_SOURCE_CHARACTER_BUDGET = 50_000;

/** The environments switched on, each with the configuration item its own change will carry. */
function readEnabledChanges(draft: CrgDraftState) {
  return DRAFT_ENVIRONMENTS.filter(({ stateKey }) => draft[stateKey].isEnabled).map(({ stateKey, label }) => ({
    label,
    environment: draft[stateKey],
    configItemName: draft[stateKey].configItem.displayName || draft.chgBasicInfo.configItem.displayName,
  }));
}

/** One environment's change as a fact line: its window and how long it is, and its own configuration item when it has one. */
function describeEnvironmentChange({ label, environment, configItemName }: ReturnType<typeof readEnabledChanges>[number]): string {
  const windowMinutes = readPlannedWindowMinutes(environment.plannedStartDate, environment.plannedEndDate);
  const lengthText = windowMinutes === null ? '' : ` (window: ${formatMinutes(windowMinutes)})`;
  const windowText = `${environment.plannedStartDate || 'no start'} → ${environment.plannedEndDate || 'no end'}${lengthText}`;
  return environment.configItem.displayName ? `${label}: ${windowText} (configuration item: ${configItemName})` : `${label}: ${windowText}`;
}

/**
 * The tasks as the AI must write them into the plans: each change's tasks in the order they run, with planned times and
 * estimates (the timeline), then who does each task. A task not timed yet is named with its people only.
 */
function describeChangeTasks(draft: CrgDraftState): string[] {
  const timelineLines = buildEnvironmentTimelines(draft)
    .filter((timeline) => timeline.schedule.length > 0)
    .flatMap((timeline) => [`Timeline of the ${timeline.label} change, in the order the tasks run:`, ...describeEnvironmentTimeline(timeline)]);
  const peopleLines = draft.changeTasks.map((card, cardIndex) => {
    const timingText = describeTaskTiming(card) || 'no timing yet';
    return `${describeTaskCard(card, cardIndex)} (${timingText}) — ${describeTaskPeople(card.assignedTo.displayName, card.assignmentGroup.displayName)}`;
  });
  return [...timelineLines, ...peopleLines];
}

/** The change's three durations, added up from its tasks' estimates — undefined while no task is timed. */
function readChangeDurations(draft: CrgDraftState): ChgPromptContext['durationEstimates'] {
  const rolledUp = rollUpEstimates(draft.changeTasks.map((card) => card.durationEstimates));
  return sumEstimateMinutes(rolledUp) > 0 ? rolledUp : undefined;
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
    changeTaskLines: describeChangeTasks(draft),
    changeTaskInstructionLines: draft.changeTasks.map((card, cardIndex) => (card.description.trim() === '' ? '' : `${describeTaskCard(card, cardIndex)}: ${card.description.trim()}`)),
    durationEstimates: readChangeDurations(draft),
    jiraSourceText: readSelectedIssues(draft).length > 0 ? buildIssueDetailTextWithin(readSelectedIssues(draft), JIRA_SOURCE_CHARACTER_BUDGET).text : undefined,
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
