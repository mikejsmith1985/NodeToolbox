// createdCtaskTimeline.test.ts — Planning a new change's CTASK timeline before it exists, and dating the tasks it got.

import { describe, expect, it } from 'vitest';

import type { ReviewedCtask } from './ctaskReviewRecord.ts';
import {
  buildPlannedTasks,
  readTimelinePlanFromReply,
  scheduleCreatedCtasks,
  toFormUtcFromApi,
} from './createdCtaskTimeline.ts';

/** A change task as ServiceNow holds it once the change is created. */
function buildCreatedTask(overrides: Partial<ReviewedCtask>): ReviewedCtask {
  return {
    sysId: 'task', number: 'CTASK0000000', shortDescription: '', description: '', typeLabel: '', isImplementation: false,
    configItem: { sysId: '', displayName: '' }, assignedTo: { sysId: '', displayName: '' },
    assignmentGroup: { sysId: '', displayName: '' }, backoutPlan: '', backoutFieldName: null,
    ...overrides,
  };
}

const STAGED = [
  { label: 'Review Business Checkout', description: 'PO confirms enrolment screens.' },
  { label: 'Deploy usmg-enrollment-ingestion', description: 'PR 98.\nImplementation: 30 minutes' },
];

describe('buildPlannedTasks', () => {
  it('lists the staged tasks, plus the Implementation and Technical Checkout ServiceNow will create itself', () => {
    const plannedTasks = buildPlannedTasks(STAGED, true);

    expect(plannedTasks.map((plannedTask) => plannedTask.shortDescription)).toEqual([
      'Implementation (created by ServiceNow)',
      'Technical Checkout (created by ServiceNow)',
      'Review Business Checkout',
      'Deploy usmg-enrollment-ingestion',
    ]);
    expect(plannedTasks[0].isImplementation).toBe(true);
    expect(plannedTasks[3].isImplementation).toBe(true);
  });
});

describe('readTimelinePlanFromReply', () => {
  it('turns the reply into an ordered plan by task name', () => {
    const plannedTasks = buildPlannedTasks(STAGED, false);
    const reply = `TIMELINE:\n${plannedTasks[1].number} | 40\n${plannedTasks[0].number} | 20`;

    expect(readTimelinePlanFromReply(reply, plannedTasks)).toEqual([
      { taskLabel: 'Deploy usmg-enrollment-ingestion', minutes: 40 },
      { taskLabel: 'Review Business Checkout', minutes: 20 },
    ]);
  });
});

describe('scheduleCreatedCtasks', () => {
  const createdTasks = [
    buildCreatedTask({ sysId: 't1', number: 'CTASK0000101', shortDescription: 'Enrollment - AWS - PRD', isImplementation: true }),
    buildCreatedTask({ sysId: 't2', number: 'CTASK0000102', shortDescription: 'Technical Checkout' }),
    buildCreatedTask({ sysId: 't3', number: 'CTASK0000103', shortDescription: 'Review Business Checkout' }),
  ];

  it('dates the created tasks from the plan — by name, else by stage — back to back in stage order', () => {
    const plan = [
      { taskLabel: 'Implementation (created by ServiceNow)', minutes: 45 },
      { taskLabel: 'Technical Checkout (created by ServiceNow)', minutes: 15 },
      { taskLabel: 'Review Business Checkout', minutes: 30 },
    ];

    const schedule = scheduleCreatedCtasks(createdTasks, plan, '2026-10-10T05:00');

    expect(schedule.map((entry) => [entry.ctask.number, entry.startUtc, entry.endUtc])).toEqual([
      ['CTASK0000101', '2026-10-10T05:00', '2026-10-10T05:45'],
      ['CTASK0000102', '2026-10-10T05:45', '2026-10-10T06:00'],
      ['CTASK0000103', '2026-10-10T06:00', '2026-10-10T06:30'],
    ]);
  });

  it('falls back to each task\'s own estimates when there is no plan, and leaves out a task with none', () => {
    const estimatedTasks = [
      { ...createdTasks[0], description: 'Implementation: 30 minutes\nPost-deployment validation/monitoring: 10 minutes' },
      createdTasks[1],
    ];

    const schedule = scheduleCreatedCtasks(estimatedTasks, [], '2026-10-10T05:00');

    expect(schedule.map((entry) => [entry.ctask.number, entry.minutes])).toEqual([['CTASK0000101', 40]]);
  });
});

describe('toFormUtcFromApi', () => {
  it('reads the change builder\'s API date-time as the form\'s UTC date-time', () => {
    expect(toFormUtcFromApi('2026-10-10 05:00:00')).toBe('2026-10-10T05:00');
    expect(toFormUtcFromApi('')).toBe('');
  });
});
