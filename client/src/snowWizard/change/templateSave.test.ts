// templateSave.test.ts — Proves saving a draft as a template finds name clashes and reuses unchanged task templates.

import { describe, expect, it } from 'vitest';

import type { CrgTemplate, CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import { buildTaskTemplateData, findTemplateByName, planStagedTaskLinks } from './templateSave.ts';

const GROUP = { sysId: 'grp-1', displayName: 'Payments' };
const BLANK = { sysId: '', displayName: '' };

function buildTask(overrides: Partial<CtaskTemplate> = {}): CtaskTemplate {
  return {
    id: 'staged-1', name: 'CTASK0010001', createdAt: '', shortDescription: 'Business Checkout', description: 'Check it',
    assignmentGroup: GROUP, assignedTo: BLANK, plannedStartDate: '', plannedEndDate: '', closeNotes: '', ...overrides,
  };
}

describe('findTemplateByName', () => {
  it('matches ignoring case and outer spaces', () => {
    const templates = [{ id: 'a', name: 'Monthly Release' }] as CrgTemplate[];
    expect(findTemplateByName(templates, '  monthly release ')?.id).toBe('a');
    expect(findTemplateByName(templates, 'Other')).toBeUndefined();
  });
});

describe('buildTaskTemplateData', () => {
  it('keeps the task values and drops its identity and source link', () => {
    const taskData = buildTaskTemplateData(buildTask({ sourceTemplateId: 'tpl-x', changeTaskType: 'review' }));
    expect(taskData).not.toHaveProperty('id');
    expect(taskData).not.toHaveProperty('sourceTemplateId');
    expect(taskData.changeTaskType).toBe('review');
  });
});

describe('planStagedTaskLinks', () => {
  it('reuses a task template the task came from when nothing was changed', () => {
    const savedTemplate = { ...buildTask({ id: 'tpl-1', name: 'Business Checkout' }) };
    const plan = planStagedTaskLinks([buildTask({ sourceTemplateId: 'tpl-1' })], [savedTemplate]);
    expect(plan).toEqual([{ kind: 'reuse', ctaskTemplateId: 'tpl-1' }]);
  });

  it('makes a new task template for an edited or brand-new task, named after what it does', () => {
    const savedTemplate = { ...buildTask({ id: 'tpl-1' }) };
    const plan = planStagedTaskLinks([buildTask({ sourceTemplateId: 'tpl-1', description: 'Edited' }), buildTask({ shortDescription: '' })], [savedTemplate]);
    expect(plan[0]).toMatchObject({ kind: 'create', name: 'Business Checkout' });
    expect(plan[1]).toMatchObject({ kind: 'create', name: 'CTASK0010001' });
  });
});
