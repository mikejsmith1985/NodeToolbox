// modifyTasks.test.ts — Proves a modify links loaded cards to their tasks, rewrites only edited ones, and adds only new cards.

import { describe, expect, it, vi } from 'vitest';

import type { CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import {
  isExistingTaskEdited, linkExistingTasks, planModifyTaskWrites, saveModifyTasks, type ModifyTaskWriters,
} from './modifyTasks.ts';

vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

const BLANK = { sysId: '', displayName: '' };
const DEFAULTS = { configItemSysId: 'ci-1', plannedStartDate: '', plannedEndDate: '' };

function buildTask(overrides: Partial<CtaskTemplate> = {}): CtaskTemplate {
  return {
    id: 'card-1', name: 'CTASK0001', createdAt: '', shortDescription: 'Deploy', description: '', assignmentGroup: BLANK, assignedTo: BLANK,
    plannedStartDate: '', plannedEndDate: '', closeNotes: '', changeTaskType: 'implementation', ...overrides,
  };
}

function buildWriters(): ModifyTaskWriters {
  return {
    resolveChangeSysId: vi.fn(async () => 'chg-sys-looked-up'),
    readChangeDefaults: vi.fn(async () => DEFAULTS),
    updateTask: vi.fn(async () => undefined),
    createTasks: vi.fn(async (_changeSysId: string, tasks: CtaskTemplate[]) => tasks.length),
  };
}

const LOADED_TASKS = [buildTask(), buildTask({ id: 'card-2', name: 'CTASK0002', shortDescription: 'Checkout' })];
const LINKS = linkExistingTasks(LOADED_TASKS, [{ sysId: 'sys-1', number: 'CTASK0001' }, { sysId: 'sys-2', number: 'CTASK0002' }]);

describe('linkExistingTasks / isExistingTaskEdited', () => {
  it('links each loaded card to its task by number, and spots an edit', () => {
    expect(LINKS.map((link) => [link.taskId, link.sysId])).toEqual([['card-1', 'sys-1'], ['card-2', 'sys-2']]);
    expect(isExistingTaskEdited(LOADED_TASKS[0], LINKS[0])).toBe(false);
    expect(isExistingTaskEdited({ ...LOADED_TASKS[0], assignedTo: { sysId: 'usr-1', displayName: 'Pat' } }, LINKS[0])).toBe(true);
  });

  it('leaves a card without a matching task unlinked', () => {
    expect(linkExistingTasks([buildTask({ name: 'Smoke test' })], [{ sysId: 'sys-1', number: 'CTASK0001' }])).toEqual([]);
  });
});

describe('planModifyTaskWrites', () => {
  it('rewrites only edited tasks and creates only new cards', () => {
    const draftTasks = [{ ...LOADED_TASKS[0], shortDescription: 'Deploy v2' }, LOADED_TASKS[1], buildTask({ id: 'card-3', name: '', shortDescription: 'Smoke' })];
    const taskWrites = planModifyTaskWrites(draftTasks, LINKS);
    expect(taskWrites.updates.map(({ link, task }) => [link.sysId, task.shortDescription])).toEqual([['sys-1', 'Deploy v2']]);
    expect(taskWrites.creates.map((task) => task.shortDescription)).toEqual(['Smoke']);
  });
});

describe('saveModifyTasks', () => {
  it('writes nothing when nothing changed', async () => {
    const writers = buildWriters();
    expect(await saveModifyTasks({ changeNumber: 'CHG1', changeSysId: 'chg-sys', draftTasks: LOADED_TASKS, links: LINKS }, writers)).toBeNull();
    expect(writers.updateTask).not.toHaveBeenCalled();
  });

  it('rewrites the edited task and adds the new one with the change’s defaults, then says what it did', async () => {
    const writers = buildWriters();
    const draftTasks = [{ ...LOADED_TASKS[0], changeTaskType: 'testing' }, LOADED_TASKS[1], buildTask({ id: 'card-3', name: '' })];
    const summary = await saveModifyTasks({ changeNumber: 'CHG1', draftTasks, links: LINKS }, writers);
    expect(writers.resolveChangeSysId).toHaveBeenCalledWith('CHG1');
    expect(writers.updateTask).toHaveBeenCalledWith('sys-1', 'chg-sys-looked-up', draftTasks[0], DEFAULTS);
    expect(writers.createTasks).toHaveBeenCalledWith('chg-sys-looked-up', [draftTasks[2]], DEFAULTS);
    expect(summary).toBe('1 task updated and 1 task added on CHG1.');
  });
});

describe('saveModifyTasks — the timeline', () => {
  it('writes each edited or new task with its own slot on the change\'s timeline', async () => {
    const writers = buildWriters();
    vi.mocked(writers.readChangeDefaults).mockResolvedValue({ configItemSysId: 'ci-1', plannedStartDate: '2026-10-24T22:00', plannedEndDate: '2026-10-25T01:00' });
    const timing = { implementationMinutes: '30', validationMinutes: '15', backoutMinutes: '20' };
    const draftTasks = [{ ...LOADED_TASKS[0], durationEstimates: timing }, LOADED_TASKS[1], buildTask({ id: 'card-3', name: '', shortDescription: 'Smoke test', changeTaskType: '', durationEstimates: timing })];
    await saveModifyTasks({ changeNumber: 'CHG1', changeSysId: 'chg-sys', draftTasks, links: LINKS }, writers);
    expect(vi.mocked(writers.updateTask).mock.calls[0][2]).toMatchObject({ plannedStartDate: '2026-10-24T22:00', plannedEndDate: '2026-10-24T22:45' });
    expect(vi.mocked(writers.createTasks).mock.calls[0][1][0]).toMatchObject({ plannedStartDate: '2026-10-24T22:45', plannedEndDate: '2026-10-24T23:30' });
  });
});
