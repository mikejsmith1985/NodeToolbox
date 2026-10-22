// modifyTasks.ts — Editing the tasks of a change that already exists: which cards are its own tasks, which were edited, and saving them.
//
// A modify loads the change's tasks as ordinary cards (Toolbox's own load path copies them). Each is linked to the
// ServiceNow task it came from, with a fingerprint of how it looked, so saving rewrites only the cards the user
// edited and creates only the cards the user added — through Toolbox's own task writers, the same payload as create.

import { fetchChangeTaskDefaults, createChangeTasks, updateChangeTaskRecord, type CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import type { ChangeTaskDefaults } from '../../views/SnowHub/ctaskParentDefaults.ts';
import { fetchChangeForModify } from './modifyLoad.ts';
import { dateTaskCards } from './taskTimeline.ts';
import { buildTaskTemplateData } from './templateSave.ts';

/** One card that is a task the change already has. */
export interface ExistingTaskLink {
  /** The card's id in the draft. */
  taskId: string;
  sysId: string;
  number: string;
  /** How the card looked when loaded, to tell whether it was edited. */
  loadedFingerprint: string;
}

/** One existing task as ServiceNow lists it. */
export interface ExistingTaskRecord {
  sysId: string;
  number: string;
}

/** What saving the tasks will write: the edited existing tasks, and the new cards. */
export interface ModifyTaskWrites {
  updates: Array<{ link: ExistingTaskLink; task: CtaskTemplate }>;
  creates: CtaskTemplate[];
}

/** The writers a save goes through; replaceable in tests. */
export interface ModifyTaskWriters {
  resolveChangeSysId: (changeNumber: string) => Promise<string>;
  readChangeDefaults: (changeSysId: string) => Promise<ChangeTaskDefaults>;
  updateTask: (taskSysId: string, changeSysId: string, task: CtaskTemplate, changeDefaults: ChangeTaskDefaults) => Promise<void>;
  createTasks: (changeSysId: string, tasks: CtaskTemplate[], changeDefaults: ChangeTaskDefaults) => Promise<number>;
}

const DEFAULT_WRITERS: ModifyTaskWriters = {
  resolveChangeSysId: async (changeNumber) => (await fetchChangeForModify(changeNumber)).changeSysId,
  readChangeDefaults: fetchChangeTaskDefaults,
  updateTask: updateChangeTaskRecord,
  createTasks: createChangeTasks,
};

/** A card's values as one string; environments are left out because a modify edits one change. */
export function buildTaskFingerprint(task: CtaskTemplate): string {
  const { environmentKeys: _environmentKeys, ...taskValues } = buildTaskTemplateData(task);
  return JSON.stringify(taskValues);
}

/** Links each loaded card to the existing task it was copied from (the load names a copied card by its number). */
export function linkExistingTasks(draftTasks: readonly CtaskTemplate[], taskRecords: readonly ExistingTaskRecord[]): ExistingTaskLink[] {
  return draftTasks.flatMap((task) => {
    const taskRecord = taskRecords.find((record) => record.number !== '' && record.number === task.name);
    return taskRecord ? [{ taskId: task.id, sysId: taskRecord.sysId, number: taskRecord.number, loadedFingerprint: buildTaskFingerprint(task) }] : [];
  });
}

/** True when an existing task's card no longer matches how it was loaded. */
export function isExistingTaskEdited(task: CtaskTemplate, link: ExistingTaskLink): boolean {
  return buildTaskFingerprint(task) !== link.loadedFingerprint;
}

/** The writes a save needs: every edited existing task, then every new card, in the user's order. */
export function planModifyTaskWrites(draftTasks: readonly CtaskTemplate[], links: readonly ExistingTaskLink[], shouldWriteEveryTask = false): ModifyTaskWrites {
  const taskWrites: ModifyTaskWrites = { updates: [], creates: [] };
  for (const task of draftTasks) {
    const link = links.find((existingLink) => existingLink.taskId === task.id);
    if (!link) taskWrites.creates.push(task);
    else if (shouldWriteEveryTask || isExistingTaskEdited(task, link)) taskWrites.updates.push({ link, task });
  }
  return taskWrites;
}

/** "1 task updated and 2 tasks added on CHG0012345." */
function describeTaskWrites(taskWrites: ModifyTaskWrites, changeNumber: string): string {
  const countText = (count: number, verb: string) => `${count} task${count === 1 ? '' : 's'} ${verb}`;
  const parts = [
    taskWrites.updates.length > 0 ? countText(taskWrites.updates.length, 'updated') : '',
    taskWrites.creates.length > 0 ? countText(taskWrites.creates.length, 'added') : '',
  ].filter((part) => part !== '');
  return `${parts.join(' and ')} on ${changeNumber}.`;
}

/** What a save of the tasks needs to know. */
export interface SaveModifyTasksInput {
  changeNumber: string;
  /** Known since the change was loaded; looked up by number for a job saved before it was kept. */
  changeSysId?: string;
  draftTasks: readonly CtaskTemplate[];
  links: readonly ExistingTaskLink[];
  /** Rewrite every existing task, edited or not — a schedule save re-dates them all. */
  shouldWriteEveryTask?: boolean;
}

/**
 * Rewrites the edited existing tasks and creates the new ones, each carrying the change's configuration item.
 * Returns a plain summary, or null when there was nothing to write. A failed write throws with ServiceNow's reason.
 */
export async function saveModifyTasks(input: SaveModifyTasksInput, writers: ModifyTaskWriters = DEFAULT_WRITERS): Promise<string | null> {
  const taskWrites = planModifyTaskWrites(input.draftTasks, input.links, input.shouldWriteEveryTask);
  if (taskWrites.updates.length === 0 && taskWrites.creates.length === 0) return null;
  const changeSysId = input.changeSysId || await writers.resolveChangeSysId(input.changeNumber);
  const changeDefaults = await writers.readChangeDefaults(changeSysId);
  // Every written task carries its own slot on the change's timeline, worked out over all of the change's cards.
  const datedTasks = dateTaskCards(input.draftTasks, changeDefaults.plannedStartDate);
  const readDatedTask = (task: CtaskTemplate) => datedTasks[input.draftTasks.indexOf(task)] ?? task;
  for (const { link, task } of taskWrites.updates) await writers.updateTask(link.sysId, changeSysId, readDatedTask(task), changeDefaults);
  if (taskWrites.creates.length > 0) await writers.createTasks(changeSysId, taskWrites.creates.map(readDatedTask), changeDefaults);
  return describeTaskWrites(taskWrites, input.changeNumber);
}
