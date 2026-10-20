// ctaskEnvironmentPlan.test.ts — Proves each task goes on the environments the user ticked (all in use by default), and per-change filtering.

import { describe, expect, it } from 'vitest';

import {
  buildCtaskEnvironmentPlan,
  filterStagedCtasksForEnvironment,
  listTaskLabelsByEnvironment,
  readTaskEnvironmentTicks,
  toggleTaskEnvironment,
  type CtaskEnvironmentPlan,
} from './ctaskEnvironmentPlan.ts';

describe('readTaskEnvironmentTicks', () => {
  it('ticks every environment in use when the task has made no choice', () => {
    expect(readTaskEnvironmentTicks({ shortDescription: 'Business Checkout' }, ['REL', 'PRD'])).toEqual({ REL: true, PRD: true, PFIX: false });
  });

  it('keeps the user\'s own choice, never ticking an environment the change does not use', () => {
    expect(readTaskEnvironmentTicks({ environmentKeys: ['PRD', 'PFIX'] }, ['REL', 'PRD'])).toEqual({ REL: false, PRD: true, PFIX: false });
  });
});

describe('toggleTaskEnvironment', () => {
  it('switches one environment off from the default of all, and back on', () => {
    const task = { environmentKeys: undefined };
    const switchedOff = toggleTaskEnvironment(task, 'REL', ['REL', 'PRD']);
    expect(switchedOff).toEqual(['PRD']);
    expect(toggleTaskEnvironment({ environmentKeys: switchedOff }, 'REL', ['REL', 'PRD'])).toEqual(['REL', 'PRD']);
  });
});

describe('buildCtaskEnvironmentPlan / listTaskLabelsByEnvironment', () => {
  const tasks = [
    { id: 'one', shortDescription: 'Deploy', environmentKeys: undefined },
    { id: 'two', shortDescription: 'Business Checkout', environmentKeys: ['PRD' as const] },
    { id: 'three', shortDescription: '' },
  ];

  it('keys each task\'s ticks by its id', () => {
    expect(buildCtaskEnvironmentPlan(tasks, ['REL', 'PRD'])).toEqual({
      one: { REL: true, PRD: true, PFIX: false },
      two: { REL: false, PRD: true, PFIX: false },
      three: { REL: true, PRD: true, PFIX: false },
    });
  });

  it('lists each change\'s tasks in the user\'s order, naming an untitled one by its place', () => {
    expect(listTaskLabelsByEnvironment(tasks, ['REL', 'PRD'])).toEqual({ REL: ['Deploy', 'Task 3'], PRD: ['Deploy', 'Business Checkout', 'Task 3'] });
  });
});

describe('filterStagedCtasksForEnvironment', () => {
  const stagedTasks = [
    { id: 'one', shortDescription: 'Business Checkout' },
    { id: 'two', shortDescription: 'Testing' },
    { id: 'three', shortDescription: '', name: 'Unplanned task' },
  ];

  it('finds a task by its id first', () => {
    const plan: CtaskEnvironmentPlan = { one: { REL: false, PRD: true, PFIX: false }, two: { REL: true, PRD: false, PFIX: false } };
    expect(filterStagedCtasksForEnvironment(stagedTasks, plan, 'REL').map((task) => task.id)).toEqual(['two', 'three']);
    expect(filterStagedCtasksForEnvironment(stagedTasks, plan, 'PRD').map((task) => task.id)).toEqual(['one', 'three']);
  });

  it('still reads a plan keyed by label, keeping tasks the plan does not mention', () => {
    const plan: CtaskEnvironmentPlan = {
      'Business Checkout': { REL: false, PRD: true, PFIX: true },
      Testing: { REL: true, PRD: true, PFIX: false },
    };
    expect(filterStagedCtasksForEnvironment(stagedTasks, plan, 'REL').map((task) => task.id)).toEqual(['two', 'three']);
    expect(filterStagedCtasksForEnvironment(stagedTasks, plan, 'PFIX').map((task) => task.id)).toEqual(['one', 'three']);
  });

  it('returns the very same list when there is no plan', () => {
    expect(filterStagedCtasksForEnvironment(stagedTasks, undefined, 'REL')).toBe(stagedTasks);
  });
});
