// useModifyLoader.test.ts — Proves the loader refuses a closed change, reports a failed look-up, and records a loaded change.

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../services/snowApi.ts';
import { useCrgState } from '../../views/SnowHub/hooks/useCrgState.ts';
import { fetchChangeForModify } from './modifyLoad.ts';
import { useModifyLoader } from './useModifyLoader.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));
vi.mock('./modifyLoad.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./modifyLoad.ts')>()),
  fetchChangeForModify: vi.fn(),
  fetchExistingTasks: vi.fn(async () => [{ sysId: 'task-sys-1', number: 'CTASK0001', label: 'CTASK0001 — Deploy' }]),
}));

const LOADED_CHANGE = {
  changeSysId: 'sys-1', changeNumber: 'CHG0002', stateLabel: 'Assess', isEditable: true,
  snapshot: {}, plannedStartInput: '', plannedEndInput: '',
};

/** The loader over a real draft hook, with the number already typed. */
function renderLoader(onLoaded = vi.fn()) {
  const hookResult = renderHook(() => {
    const crg = useCrgState({ storageKey: 'snowWizard:change:loader-test' });
    return { crg, loader: useModifyLoader(crg, onLoaded) };
  });
  act(() => hookResult.result.current.crg.actions.setCloneChgNumber('CHG0002'));
  return { hookResult, onLoaded };
}

describe('useModifyLoader', () => {
  it('refuses a change that can no longer be edited', async () => {
    vi.mocked(fetchChangeForModify).mockResolvedValueOnce({ ...LOADED_CHANGE, stateLabel: 'Cancelled', isEditable: false });
    const { hookResult } = renderLoader();
    act(() => hookResult.result.current.loader.lookUp());
    await waitFor(() => expect(hookResult.result.current.loader.status).toEqual({ kind: 'refused', stateLabel: 'Cancelled' }));
  });

  it('reports a look-up that fails', async () => {
    vi.mocked(fetchChangeForModify).mockRejectedValueOnce(new Error('ServiceNow has no change CHG0002.'));
    const { hookResult } = renderLoader();
    act(() => hookResult.result.current.loader.lookUp());
    await waitFor(() => expect(hookResult.result.current.loader.status).toEqual({ kind: 'failed', message: 'ServiceNow has no change CHG0002.' }));
  });

  it('records the loaded change with its snapshot and step values', async () => {
    vi.mocked(fetchChangeForModify).mockResolvedValueOnce(LOADED_CHANGE);
    vi.mocked(snowFetch).mockImplementation(async (path: string) => (path.includes('/change_request?')
      ? { result: [{ sys_id: { value: 'sys-1' }, short_description: 'Loaded title' }] }
      : { result: [{ number: 'CTASK0001', short_description: 'Deploy' }] }) as never);
    const { hookResult, onLoaded } = renderLoader();
    act(() => hookResult.result.current.loader.lookUp());
    await waitFor(() => expect(onLoaded).toHaveBeenCalled());
    expect(onLoaded.mock.calls[0][0]).toMatchObject({ changeNumber: 'CHG0002', stateLabel: 'Assess', changeSysId: 'sys-1', existingTaskNames: ['CTASK0001 — Deploy'] });
    expect(onLoaded.mock.calls[0][0].loadedStepValues.details.Title).toBe('Loaded title');
    // The change's own task stays on the draft as a card, linked to the task it came from.
    expect(hookResult.result.current.crg.state.changeTasks.map((task) => task.shortDescription)).toEqual(['Deploy']);
    expect(onLoaded.mock.calls[0][0].existingTasks).toEqual([expect.objectContaining({ sysId: 'task-sys-1', number: 'CTASK0001' })]);
  });
});
