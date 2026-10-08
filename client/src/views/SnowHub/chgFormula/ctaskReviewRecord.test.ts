// ctaskReviewRecord.test.ts — Reading a change task for the risk check: its type, CI and backout plan (GH #395).

import { describe, expect, it } from 'vitest';

import {
  findBackoutFieldName,
  readBackoutSectionFromDescription,
  readReviewedCtask,
  upsertBackoutSection,
} from './ctaskReviewRecord.ts';

/** A change_task as the Table API returns it with sysparm_display_value=all. */
function buildRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sys_id: { value: 'task-1', display_value: 'task-1' },
    number: { value: 'CTASK0012345', display_value: 'CTASK0012345' },
    short_description: { value: 'Deploy recon service', display_value: 'Deploy recon service' },
    description: { value: 'Run the pipeline.', display_value: 'Run the pipeline.' },
    change_task_type: { value: 'implementation', display_value: 'Implementation' },
    cmdb_ci: { value: 'ci-recon', display_value: 'Recon Service' },
    assigned_to: { value: 'usr-1', display_value: 'Jane Smith' },
    assignment_group: { value: 'grp-1', display_value: 'Platform Team' },
    ...overrides,
  };
}

describe('findBackoutFieldName', () => {
  it('finds the instance\'s own backout plan field by name, ignoring backout timings', () => {
    expect(findBackoutFieldName({ u_backout_duration: '', u_backout_plan: '', number: '' })).toBe('u_backout_plan');
    expect(findBackoutFieldName({ u_backout_steps: '' })).toBe('u_backout_steps');
  });

  it('reports none when the instance has no backout field on a change task', () => {
    expect(findBackoutFieldName({ u_backout_time: '', description: '' })).toBeNull();
  });
});

describe('readReviewedCtask', () => {
  it('reads the number, type, CI and the backout plan field', () => {
    const ctask = readReviewedCtask(buildRecord({ u_backout_plan: { value: 'Redeploy v1.4.', display_value: 'Redeploy v1.4.' } }));

    expect(ctask).toEqual(expect.objectContaining({
      sysId: 'task-1',
      number: 'CTASK0012345',
      typeLabel: 'Implementation',
      isImplementation: true,
      configItem: { sysId: 'ci-recon', displayName: 'Recon Service' },
      assignedTo: { sysId: 'usr-1', displayName: 'Jane Smith' },
      assignmentGroup: { sysId: 'grp-1', displayName: 'Platform Team' },
      backoutPlan: 'Redeploy v1.4.',
      backoutFieldName: 'u_backout_plan',
    }));
  });

  it('reads the backout plan from the description when there is no backout field', () => {
    const descriptionText = 'Run the pipeline.\n\n--- Backout plan ---\nRedeploy v1.4.\n--- End backout plan ---';
    const ctask = readReviewedCtask(buildRecord({ description: { value: descriptionText, display_value: descriptionText } }));

    expect(ctask.backoutFieldName).toBeNull();
    expect(ctask.backoutPlan).toBe('Redeploy v1.4.');
  });

  it('treats a task with no type field as implementation when its name says it deploys or implements', () => {
    const { change_task_type: _ignoredType, ...recordWithoutType } = buildRecord();
    const reviewTask = readReviewedCtask({ ...recordWithoutType, short_description: { value: 'Peer review', display_value: 'Peer review' } });

    expect(readReviewedCtask(recordWithoutType).isImplementation).toBe(true);
    expect(reviewTask.isImplementation).toBe(false);
    expect(reviewTask.typeLabel).toBe('');
  });

  it('does not treat a review or testing task as implementation', () => {
    expect(readReviewedCtask(buildRecord({ change_task_type: { value: 'testing', display_value: 'Testing' } })).isImplementation).toBe(false);
  });
});

describe('the description backout section', () => {
  it('adds a backout section after the existing text', () => {
    expect(upsertBackoutSection('Run the pipeline.', 'Redeploy v1.4.'))
      .toBe('Run the pipeline.\n\n--- Backout plan ---\nRedeploy v1.4.\n--- End backout plan ---');
  });

  it('replaces an earlier backout section instead of stacking a second one', () => {
    const once = upsertBackoutSection('Run the pipeline.', 'Old plan.');
    const twice = upsertBackoutSection(once, 'New plan.');

    expect(twice).toBe('Run the pipeline.\n\n--- Backout plan ---\nNew plan.\n--- End backout plan ---');
    expect(readBackoutSectionFromDescription(twice)).toBe('New plan.');
  });

  it('reads no section from a description without one', () => {
    expect(readBackoutSectionFromDescription('Run the pipeline.')).toBe('');
  });
});
