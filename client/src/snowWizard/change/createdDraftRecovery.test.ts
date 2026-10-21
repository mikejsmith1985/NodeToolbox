// createdDraftRecovery.test.ts — Proves a wiped create-first job is recognised, and restoring copies the first change's
// values back and gives each environment its own change's window and configuration item.

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../services/snowApi.ts';
import { useCrgState } from '../../views/SnowHub/hooks/useCrgState.ts';
import type { CrgDraftState, CrgHook } from './changeDraft.ts';
import { createChangeWizardSession, type ChangeWizardSession } from './changeWizardSession.ts';
import { needsDraftRecovery, readCreatedEnvironmentValues, useCreatedDraftRecovery, useCreatedTaskNumbers } from './createdDraftRecovery.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

const WIPED_SESSION: ChangeWizardSession = {
  ...createChangeWizardSession('create'),
  createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG1' }, { environmentLabel: 'PRD', changeNumber: 'CHG2' }],
};

function readBlankDraft(): CrgDraftState {
  return renderHook(() => useCrgState({ storageKey: 'snowWizard:change:recovery-blank' })).result.current.state;
}

/** One change's environment fields as ServiceNow sends them with display values. */
function buildEnvironmentReply(configItemSysId: string, startUtc: string, changeSysId = 'chg-sys') {
  return { result: [{ sys_id: { value: changeSysId, display_value: changeSysId }, cmdb_ci: { value: configItemSysId, display_value: `Item ${configItemSysId}` }, start_date: { value: startUtc, display_value: '' }, end_date: { value: '', display_value: '' }, u_environment: { value: 'prod', display_value: 'Production' } }] };
}

describe('needsDraftRecovery', () => {
  it('is needed only for a create job with changes made but no picks left, and never after saving', () => {
    const blankDraft = readBlankDraft();
    expect(needsDraftRecovery(WIPED_SESSION, blankDraft)).toBe(true);
    expect(needsDraftRecovery({ ...WIPED_SESSION, hasSavedChanges: true }, blankDraft)).toBe(false);
    expect(needsDraftRecovery(createChangeWizardSession('create'), blankDraft)).toBe(false);
    // A title generated after the wipe must not hide the offer.
    expect(needsDraftRecovery(WIPED_SESSION, { ...blankDraft, generatedShortDescription: 'Payments 1.2' })).toBe(true);
  });
});

describe('readCreatedEnvironmentValues', () => {
  it('reads a change\'s configuration item, window and environment value', async () => {
    vi.mocked(snowFetch).mockResolvedValueOnce(buildEnvironmentReply('ci-prd', '2026-10-23 21:00:00') as never);
    const values = await readCreatedEnvironmentValues('CHG2');
    expect(values.configItem).toEqual({ sysId: 'ci-prd', displayName: 'Item ci-prd' });
    expect(values.plannedStartDate).not.toBe('');
    expect(values.plannedEndDate).toBe('');
    expect(values.snowEnvironmentValue).toBe('prod');
  });

  it('says so plainly when the change cannot be found', async () => {
    vi.mocked(snowFetch).mockResolvedValueOnce({ result: [] } as never);
    await expect(readCreatedEnvironmentValues('CHG9')).rejects.toThrow('ServiceNow has no change CHG9.');
  });
});

describe('useCreatedDraftRecovery', () => {
  it('copies the first change back, then each environment\'s own values, and reports it restored', async () => {
    // Each change has its own tasks: REL's deploy, PRD's deploy and Business Checkout.
    const tasksBySysId: Record<string, Array<Record<string, unknown>>> = {
      'sys-rel': [{ number: { value: 'CTASK1', display_value: 'CTASK1' }, short_description: { value: 'Enrollment - AWS - REL', display_value: 'Enrollment - AWS - REL' } }],
      'sys-prd': [
        { number: { value: 'CTASK2', display_value: 'CTASK2' }, short_description: { value: 'Enrollment - AWS - PRD', display_value: 'Enrollment - AWS - PRD' } },
        { number: { value: 'CTASK3', display_value: 'CTASK3' }, short_description: { value: 'Business Checkout', display_value: 'Business Checkout' } },
      ],
    };
    vi.mocked(snowFetch).mockImplementation(async (path: string) => {
      if (path.includes('change_task')) return { result: tasksBySysId[Object.keys(tasksBySysId).find((sysId) => decodeURIComponent(path).includes(sysId)) ?? ''] ?? [] } as never;
      if (path.includes('u_environment')) {
        const isPrd = path.includes('CHG2');
        return buildEnvironmentReply(isPrd ? 'ci-prd' : 'ci-rel', '2026-10-23 21:00:00', isPrd ? 'sys-prd' : 'sys-rel') as never;
      }
      return { result: [{ sys_id: { value: 'chg-1', display_value: 'chg-1' }, short_description: { value: 'Payments 1.2', display_value: 'Payments 1.2' }, category: { value: 'software', display_value: 'Software' } }] } as never;
    });
    const onRestored = vi.fn();
    const { result } = renderHook(() => {
      const crg = useCrgState({ storageKey: 'snowWizard:change:recovery-run' }) as CrgHook;
      return { crg, recovery: useCreatedDraftRecovery(crg, WIPED_SESSION, onRestored) };
    });
    expect(result.current.recovery.isNeeded).toBe(true);

    act(() => result.current.recovery.restore());

    await waitFor(() => expect(result.current.recovery.phase).toBe('done'));
    expect(onRestored).toHaveBeenCalled();
    expect(result.current.crg.state.generatedShortDescription).toBe('Payments 1.2');
    expect(result.current.crg.state.relEnvironment.configItem.sysId).toBe('ci-rel');
    expect(result.current.crg.state.prdEnvironment.configItem.sysId).toBe('ci-prd');
    expect(result.current.crg.state.prdEnvironment.isEnabled).toBe(true);
    // Every real task, on its own environment, named by its CTASK number.
    expect(result.current.crg.state.changeTasks.map((card) => `${card.name}:${card.shortDescription}:${card.environmentKeys?.join('+')}`)).toEqual([
      'CTASK1:Enrollment - AWS - REL:REL', 'CTASK2:Enrollment - AWS - PRD:PRD', 'CTASK3:Business Checkout:PRD',
    ]);
    expect(result.current.recovery.isNeeded).toBe(false);
  });

describe('useCreatedTaskNumbers', () => {
  it('reads the task numbers of a change picked up by number, once, and leaves known ones alone', async () => {
    vi.mocked(snowFetch).mockReset().mockResolvedValue({ result: [{ sys_id: 't9', number: 'CTASK9', short_description: 'Deploy' }] } as never);
    const updateSession = vi.fn();
    const session = { ...WIPED_SESSION, createdTasks: { CHG1: [] } };
    renderHook(() => useCreatedTaskNumbers(session, updateSession));
    await waitFor(() => expect(updateSession).toHaveBeenCalledWith({ createdTasks: { CHG1: [], CHG2: [{ sysId: 't9', number: 'CTASK9', shortDescription: 'Deploy' }] } }));
    expect(snowFetch).toHaveBeenCalledTimes(1);
  });
});
});
