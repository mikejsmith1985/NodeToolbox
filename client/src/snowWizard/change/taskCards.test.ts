// taskCards.test.ts — Proves a blank card, a card from a saved task, and the plain-words problems that hold the tasks step.

import { describe, expect, it } from 'vitest';

import type { CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import type { CrgDraftState } from './changeDraft.ts';
import { buildBlankChangeTask, buildTaskFromTemplate, describeTaskCard, listTaskProblems } from './taskCards.ts';

const GROUP = { sysId: 'grp-1', displayName: 'Payments' };
const OWNER = { sysId: 'usr-1', displayName: 'Pat' };
const DRAFT = { chgBasicInfo: { assignmentGroup: GROUP, assignedTo: OWNER } } as unknown as CrgDraftState;

function buildTask(overrides: Partial<CtaskTemplate> = {}): CtaskTemplate {
  return { ...buildBlankChangeTask(DRAFT), id: 'task-1', shortDescription: 'Smoke test', ...overrides };
}

describe('buildBlankChangeTask', () => {
  it('starts empty, with the change’s group and owner, and no environments of its own', () => {
    const blankTask = buildBlankChangeTask(DRAFT);
    expect(blankTask).toMatchObject({ shortDescription: '', description: '', changeTaskType: '', assignmentGroup: GROUP, assignedTo: OWNER });
    expect(blankTask.environmentKeys).toBeUndefined();
  });
});

describe('buildTaskFromTemplate', () => {
  it('copies the saved task, its environments included, and remembers where it came from', () => {
    const fromTemplate = buildTaskFromTemplate(buildTask({ id: 'tpl-9', name: 'Checkout', environmentKeys: ['PRD'] }));
    expect(fromTemplate).toMatchObject({ sourceTemplateId: 'tpl-9', name: 'Checkout', environmentKeys: ['PRD'] });
  });
});

describe('describeTaskCard', () => {
  it('names a card by its short description, or by its place', () => {
    expect(describeTaskCard(buildTask(), 0)).toBe('Smoke test');
    expect(describeTaskCard(buildTask({ shortDescription: ' ' }), 2)).toBe('Task 3');
  });
});

describe('listTaskProblems', () => {
  it('needs a short description and, for a new change, at least one environment', () => {
    const tasks = [buildTask({ shortDescription: '' }), buildTask({ environmentKeys: ['PFIX'] })];
    expect(listTaskProblems(tasks, ['REL', 'PRD'], 'create')).toEqual([
      'Task 1 needs a short description.',
      'Smoke test is not on any change. Tick at least one environment.',
    ]);
  });

  it('does not ask about environments when editing one change', () => {
    expect(listTaskProblems([buildTask({ environmentKeys: [] })], ['PRD'], 'modify')).toEqual([]);
  });

  it('is empty when every card is complete, and when there are no cards', () => {
    expect(listTaskProblems([buildTask()], ['REL'], 'create')).toEqual([]);
    expect(listTaskProblems([], ['REL'], 'create')).toEqual([]);
  });
});
