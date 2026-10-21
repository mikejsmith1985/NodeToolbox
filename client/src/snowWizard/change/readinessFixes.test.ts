// readinessFixes.test.ts — Proves the one-click fixes run on the change as ServiceNow holds it: the change's own item onto
// every task that differs, and a planned outage for the change's own item and window.

import { describe, expect, it, vi } from 'vitest';

import type { ReviewedCtask } from '../../views/SnowHub/chgFormula/ctaskReviewRecord.ts';
import { runReadinessFix, type ReadinessFixWriters } from './readinessFixes.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

const TARGET = { changeNumber: 'CHG9', changeSysId: 'sys-9' };

function buildTask(number: string, configItemSysId: string): ReviewedCtask {
  return { sysId: `sys-${number}`, number, configItem: { sysId: configItemSysId, displayName: '' } } as unknown as ReviewedCtask;
}

function buildWriters(configItemSysId = 'ci-prd'): ReadinessFixWriters & { setTaskConfigItem: ReturnType<typeof vi.fn>; createOutage: ReturnType<typeof vi.fn> } {
  return {
    readChange: vi.fn(async () => ({ configItemSysId, plannedStartUtc: '2026-10-24 02:00:00', plannedEndUtc: '2026-10-24 11:00:00', shortDescription: 'Payments' })),
    readTasks: vi.fn(async () => [buildTask('CTASK1', 'ci-prd'), buildTask('CTASK2', 'ci-rel')]),
    setTaskConfigItem: vi.fn(async () => undefined),
    createOutage: vi.fn(async () => 'OUT0001'),
  };
}

describe('runReadinessFix', () => {
  it('puts the change\'s own configuration item on every task that differs, and says which', async () => {
    const writers = buildWriters();
    expect(await runReadinessFix('setCtaskConfigItems', [TARGET], writers)).toBe('CHG9: set the configuration item on CTASK2.');
    expect(writers.setTaskConfigItem).toHaveBeenCalledTimes(1);
    expect(writers.setTaskConfigItem).toHaveBeenCalledWith(expect.objectContaining({ number: 'CTASK2' }), 'ci-prd');
  });

  it('refuses to copy a configuration item the change does not have', async () => {
    await expect(runReadinessFix('setCtaskConfigItems', [TARGET], buildWriters(''))).rejects.toThrow('CHG9 has no configuration item to copy');
  });

  it('creates the planned outage for the change\'s own item and window', async () => {
    const writers = buildWriters();
    expect(await runReadinessFix('createPlannedOutage', [TARGET], writers)).toBe('CHG9: created planned outage OUT0001.');
    expect(writers.createOutage).toHaveBeenCalledWith({ changeSysId: 'sys-9', configItemSysId: 'ci-prd', plannedStartUtc: '2026-10-24 02:00:00', plannedEndUtc: '2026-10-24 11:00:00', shortDescription: 'Payments' });
  });

  it('does nothing for problem records — ServiceNow links them itself', async () => {
    const writers = buildWriters();
    expect(await runReadinessFix('linkProblems', [TARGET], writers)).toContain('nothing to do');
    expect(writers.readChange).not.toHaveBeenCalled();
  });
});
