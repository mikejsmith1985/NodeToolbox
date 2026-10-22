// quickSchedule.test.ts — Proves the schedule short cut re-dates every task and writes the duration block on the plan.

import { describe, expect, it, vi } from 'vitest';

import type { CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import { saveQuickSchedule, type QuickScheduleWriters } from './quickSchedule.ts';

vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

const BLANK = { sysId: '', displayName: '' };
const TASK: CtaskTemplate = {
  id: 'card-1', name: 'CTASK1', createdAt: '', shortDescription: 'Deploy', description: '', assignmentGroup: BLANK, assignedTo: BLANK,
  plannedStartDate: '', plannedEndDate: '', closeNotes: '', changeTaskType: 'implementation',
  durationEstimates: { implementationMinutes: '30', validationMinutes: '15', backoutMinutes: '20' },
};

function buildWriters(): QuickScheduleWriters {
  return {
    saveTasks: vi.fn(async () => '1 task updated on CHG1.'),
    readChangeDefaults: vi.fn(async () => ({ configItemSysId: '', plannedStartDate: '2026-10-24T22:00', plannedEndDate: '2026-10-25T01:00' })),
    patchImplementationPlan: vi.fn(async () => undefined),
  };
}

describe('saveQuickSchedule', () => {
  it('rewrites every task, edited or not, and puts the estimated durations on the implementation plan', async () => {
    const writers = buildWriters();
    const links = [{ taskId: 'card-1', sysId: 'sys-1', number: 'CTASK1', loadedFingerprint: '' }];
    const summary = await saveQuickSchedule({ changeNumber: 'CHG1', changeSysId: 'chg-sys', tasks: [TASK], links, implementationPlan: '1. Deploy modules' }, writers);
    expect(writers.saveTasks).toHaveBeenCalledWith(expect.objectContaining({ shouldWriteEveryTask: true, changeSysId: 'chg-sys' }), undefined);
    const writtenPlan = vi.mocked(writers.patchImplementationPlan).mock.calls[0][1];
    expect(writtenPlan).toContain('1. Deploy modules');
    expect(writtenPlan).toContain('• Implementation: 30 minutes');
    expect(writtenPlan).not.toContain('not estimated');
    expect(summary).toBe('1 task updated on CHG1. The implementation plan now states the estimated durations.');
  });
});
