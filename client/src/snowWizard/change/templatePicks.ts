// templatePicks.ts — What a template keeps: the picks only, never the writing (pure).
//
// Owner's decision: every change's scope is its own, so the AI-written text must never be templatized — only the
// dropdowns, people, configuration items, planning answers and the tasks' shape. So a template is saved from the
// change with its writing and dates taken out, and opening a template (even an older one that still holds text)
// fills in the picks and leaves whatever writing the change already has.

import type { CrgTemplate, CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import { DRAFT_ENVIRONMENTS, type CrgDraftState } from './changeDraft.ts';
import type { TemplateDraft } from './useTemplateLibrary.ts';

/** The words saying what a template keeps, shown wherever one is saved. */
export const TEMPLATE_KEEPS_TEXT = 'A template keeps your picks — category, type, groups, people, configuration items, planning answers, environments and tasks. It never keeps the writing or dates: those are unique to each change.';

const NO_PLANS = { implementationPlan: '', backoutPlan: '', testPlan: '' };

/** One task's shape without what is unique to a change: its description, dates and close notes. */
export function keepTaskPicks<TaskTemplate extends CtaskTemplate>(task: TaskTemplate): TaskTemplate {
  return { ...task, description: '', plannedStartDate: '', plannedEndDate: '', closeNotes: '' };
}

/** The change as a template should hold it: the picks, with the writing, plans, dates and task descriptions taken out. */
export function buildPicksOnlyDraft(draft: CrgDraftState): TemplateDraft {
  const picksOnlyDraft: CrgDraftState = {
    ...draft,
    generatedShortDescription: '', generatedDescription: '', generatedJustification: '', generatedRiskImpact: '',
    chgPlanningContent: { ...draft.chgPlanningContent, ...NO_PLANS },
    changeTasks: draft.changeTasks.map(keepTaskPicks),
  };
  for (const { stateKey } of DRAFT_ENVIRONMENTS) {
    picksOnlyDraft[stateKey] = { ...draft[stateKey], plannedStartDate: '', plannedEndDate: '' };
  }
  return picksOnlyDraft;
}

/**
 * A template as it should be opened onto this change: its picks, with the change's own writing and dates kept. An
 * older template may still hold plans or dates; those never overwrite the change.
 */
export function buildPicksOnlyTemplate(template: CrgTemplate, draft: CrgDraftState): CrgTemplate {
  const keepDates = (environmentConfig: CrgTemplate['relEnvironment'], stateKey: 'relEnvironment' | 'prdEnvironment' | 'pfixEnvironment') => (
    environmentConfig ? { ...environmentConfig, plannedStartDate: draft[stateKey].plannedStartDate, plannedEndDate: draft[stateKey].plannedEndDate } : environmentConfig
  );
  return {
    ...template,
    chgPlanningContent: { ...template.chgPlanningContent, ...draft.chgPlanningContent },
    relEnvironment: keepDates(template.relEnvironment, 'relEnvironment'),
    prdEnvironment: keepDates(template.prdEnvironment, 'prdEnvironment'),
    pfixEnvironment: keepDates(template.pfixEnvironment, 'pfixEnvironment'),
  };
}
