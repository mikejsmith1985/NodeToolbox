// templateSave.ts — The rules for saving the change in hand as a template: name clashes, and which task templates to reuse (pure).
//
// A template remembers its tasks as linked task templates. A task staged from a task template and left untouched
// reuses that template, so saving again does not pile up copies; an edited or new task becomes a new task template.

import type { CrgTemplate, CtaskTemplate, CtaskTemplateData } from '../../views/SnowHub/hooks/useCrgState.ts';

/** What to do for one staged task: link the task template it came from, or save it as a new one. */
export type StagedTaskLink = { kind: 'reuse'; ctaskTemplateId: string } | { kind: 'create'; name: string; taskData: CtaskTemplateData };

const UNNAMED_TASK_PREFIX = 'Task';

/** The saved template already using this name (ignoring case and outer spaces), if any. */
export function findTemplateByName(templates: readonly CrgTemplate[], name: string): CrgTemplate | undefined {
  const wantedName = name.trim().toLowerCase();
  return templates.find((template) => template.name.trim().toLowerCase() === wantedName);
}

/** A task's reusable values, without its identity or the link to the template it was staged from. */
export function buildTaskTemplateData(task: CtaskTemplate): CtaskTemplateData {
  const { id: _id, name: _name, createdAt: _createdAt, sourceTemplateId: _sourceTemplateId, ...taskData } = task;
  return taskData;
}

/** Whether a staged task still matches the task template it came from, value for value. */
function isUnchangedFromSource(task: CtaskTemplate, sourceTemplate: CtaskTemplate): boolean {
  return JSON.stringify(buildTaskTemplateData(task)) === JSON.stringify(buildTaskTemplateData(sourceTemplate));
}

/** For each staged task, reuse its unchanged source task template or plan a new one named after what it does. */
export function planStagedTaskLinks(stagedTasks: readonly CtaskTemplate[], ctaskTemplates: readonly CtaskTemplate[]): StagedTaskLink[] {
  return stagedTasks.map((task, taskIndex) => {
    const sourceTemplate = ctaskTemplates.find((ctaskTemplate) => ctaskTemplate.id === task.sourceTemplateId);
    if (sourceTemplate && isUnchangedFromSource(task, sourceTemplate)) return { kind: 'reuse', ctaskTemplateId: sourceTemplate.id };
    const taskName = task.shortDescription.trim() || task.name.trim() || `${UNNAMED_TASK_PREFIX} ${taskIndex + 1}`;
    return { kind: 'create', name: taskName, taskData: buildTaskTemplateData(task) };
  });
}
