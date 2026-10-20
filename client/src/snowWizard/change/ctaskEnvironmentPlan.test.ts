// ctaskEnvironmentPlan.test.ts — Proves the CTASK × environment rules: defaults, saved overlay, errors and per-change filtering.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  CTASK_ENV_DEFAULTS_STORAGE_KEY,
  filterStagedCtasksForEnvironment,
  listPlanErrors,
  loadSavedCtaskEnvironmentDefaults,
  normalizeCtaskLabel,
  saveCtaskEnvironmentDefault,
  seedCtaskEnvironmentPlan,
  toggleCtaskEnvironment,
  type CtaskEnvironmentPlan,
} from './ctaskEnvironmentPlan.ts';

const ALL_ENVIRONMENTS = ['REL', 'PRD', 'PFIX'] as const;

describe('seedCtaskEnvironmentPlan', () => {
  it('ticks Business Checkout for PRD and PFIX but not REL, and every environment for the others', () => {
    const plan = seedCtaskEnvironmentPlan(['Implementation', 'Technical Checkout', 'Business Checkout', 'Smoke test'], [...ALL_ENVIRONMENTS], {});
    expect(plan['Business Checkout']).toEqual({ REL: false, PRD: true, PFIX: true });
    expect(plan.Implementation).toEqual({ REL: true, PRD: true, PFIX: true });
    expect(plan['Technical Checkout']).toEqual({ REL: true, PRD: true, PFIX: true });
    expect(plan['Smoke test']).toEqual({ REL: true, PRD: true, PFIX: true });
  });

  it('never ticks an environment the change does not use', () => {
    const plan = seedCtaskEnvironmentPlan(['Business Checkout', 'Testing'], ['REL', 'PRD'], {});
    expect(plan['Business Checkout']).toEqual({ REL: false, PRD: true, PFIX: false });
    expect(plan.Testing).toEqual({ REL: true, PRD: true, PFIX: false });
  });

  it('lets a saved default win over the built-in rule', () => {
    const plan = seedCtaskEnvironmentPlan(['Business Checkout'], [...ALL_ENVIRONMENTS], {
      businesscheckout: { REL: true, PRD: true, PFIX: false },
    });
    expect(plan['Business Checkout']).toEqual({ REL: true, PRD: true, PFIX: false });
  });

  it('keeps the ticks the user already chose, dropping removed tasks', () => {
    const existingPlan: CtaskEnvironmentPlan = { Testing: { REL: false, PRD: true, PFIX: false }, Gone: { REL: true, PRD: true, PFIX: true } };
    const plan = seedCtaskEnvironmentPlan(['Testing'], ['REL', 'PRD'], {}, existingPlan);
    expect(plan).toEqual({ Testing: { REL: false, PRD: true, PFIX: false } });
  });

  it('re-seeds a kept row that lost every tick when its environments were switched off', () => {
    const existingPlan: CtaskEnvironmentPlan = { Testing: { REL: true, PRD: false, PFIX: false } };
    expect(seedCtaskEnvironmentPlan(['Testing'], ['PRD'], {}, existingPlan).Testing).toEqual({ REL: false, PRD: true, PFIX: false });
  });
});

describe('listPlanErrors', () => {
  it('names a task with no environment and a tick on an environment the change does not use', () => {
    const plan: CtaskEnvironmentPlan = {
      Testing: { REL: false, PRD: false, PFIX: false },
      'Business Checkout': { REL: false, PRD: true, PFIX: true },
    };
    expect(listPlanErrors(plan, ['REL', 'PRD'])).toEqual([
      'Testing is not ticked for any environment.',
      'Business Checkout is ticked for PFIX, which this change does not use.',
    ]);
  });

  it('is empty for a sound plan', () => {
    expect(listPlanErrors({ Testing: { REL: true, PRD: false, PFIX: false } }, ['REL'])).toEqual([]);
  });
});

describe('filterStagedCtasksForEnvironment', () => {
  const stagedTasks = [
    { id: 'one', shortDescription: 'Business Checkout' },
    { id: 'two', shortDescription: 'Testing' },
    { id: 'three', shortDescription: '', name: 'Unplanned task' },
  ];
  const plan: CtaskEnvironmentPlan = {
    'Business Checkout': { REL: false, PRD: true, PFIX: true },
    Testing: { REL: true, PRD: true, PFIX: false },
  };

  it('keeps only the tasks ticked for that environment, and keeps tasks the plan does not mention', () => {
    expect(filterStagedCtasksForEnvironment(stagedTasks, plan, 'REL').map((task) => task.id)).toEqual(['two', 'three']);
    expect(filterStagedCtasksForEnvironment(stagedTasks, plan, 'PRD').map((task) => task.id)).toEqual(['one', 'two', 'three']);
    expect(filterStagedCtasksForEnvironment(stagedTasks, plan, 'PFIX').map((task) => task.id)).toEqual(['one', 'three']);
  });

  it('returns the very same list when there is no plan', () => {
    expect(filterStagedCtasksForEnvironment(stagedTasks, undefined, 'REL')).toBe(stagedTasks);
  });
});

describe('toggleCtaskEnvironment', () => {
  it('flips one tick and leaves the rest', () => {
    const plan: CtaskEnvironmentPlan = { Testing: { REL: true, PRD: false, PFIX: false } };
    expect(toggleCtaskEnvironment(plan, 'Testing', 'PRD')).toEqual({ Testing: { REL: true, PRD: true, PFIX: false } });
    expect(plan.Testing.PRD).toBe(false);
  });
});

describe('saved defaults', () => {
  beforeEach(() => localStorage.clear());

  it('remembers a default under the Wizard key and reads it back by its plain label', () => {
    saveCtaskEnvironmentDefault('Business Checkout', { REL: true, PRD: true, PFIX: true });
    expect(localStorage.getItem(CTASK_ENV_DEFAULTS_STORAGE_KEY)).toContain('businesscheckout');
    expect(loadSavedCtaskEnvironmentDefaults()).toEqual({ businesscheckout: { REL: true, PRD: true, PFIX: true } });
  });

  it('reads nothing from a damaged entry', () => {
    localStorage.setItem(CTASK_ENV_DEFAULTS_STORAGE_KEY, '{not json');
    expect(loadSavedCtaskEnvironmentDefaults()).toEqual({});
  });

  it('normalises labels so spacing and case do not matter', () => {
    expect(normalizeCtaskLabel(' Business  Check-out ')).toBe('businesscheckout');
  });
});
