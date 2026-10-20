// useStartingPoint.test.ts — Proves a new change can begin as a copy of an old change or from a template, exactly once.

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../services/snowApi.ts';
import type { CrgTemplate, CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import { useCrgState } from '../../views/SnowHub/hooks/useCrgState.ts';
import { useStartingPoint, type ChangeStartingPoint } from './useStartingPoint.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

const OLD_CHANGE = { result: [{ sys_id: { value: 'chg-sys', display_value: 'chg-sys' }, short_description: { value: 'Payments 1.1', display_value: 'Payments 1.1' } }] };
const BLANK = { sysId: '', displayName: '' };

/** The draft and the starting point together, as the change job runs them. */
function renderStartingPoint(startingPoint: ChangeStartingPoint | null) {
  return renderHook(() => {
    const crg = useCrgState({ storageKey: 'snowWizard:change:starting-point-test' });
    return { crg, startingPoint: useStartingPoint(crg, startingPoint) };
  });
}

describe('useStartingPoint', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(snowFetch).mockReset();
  });

  it('copies an existing change into the new draft, once', async () => {
    vi.mocked(snowFetch).mockImplementation(async (path: string) => (path.includes('table/change_request') ? OLD_CHANGE : { result: [] }) as never);
    const { result } = renderStartingPoint({ kind: 'existingChange', changeNumber: 'CHG0001234' });
    await waitFor(() => expect(result.current.startingPoint.status).toEqual({ kind: 'copied', changeNumber: 'CHG0001234' }));
    expect(result.current.crg.state.generatedShortDescription).toBe('Payments 1.1');
    expect(vi.mocked(snowFetch).mock.calls.filter(([path]) => String(path).includes('table/change_request'))).toHaveLength(1);
  });

  it('reports a failed copy in plain words and can try again', async () => {
    vi.mocked(snowFetch).mockResolvedValue({ result: [] } as never);
    const { result } = renderStartingPoint({ kind: 'existingChange', changeNumber: 'CHG0000404' });
    await waitFor(() => expect(result.current.startingPoint.status.kind).toBe('failed'));
    vi.mocked(snowFetch).mockImplementation(async (path: string) => (path.includes('table/change_request') ? OLD_CHANGE : { result: [] }) as never);
    act(() => result.current.startingPoint.retry());
    await waitFor(() => expect(result.current.startingPoint.status.kind).toBe('copied'));
  });

  it('fills the draft from a template with its linked tasks, and can be put away', () => {
    const task = { id: 'ctask-1', name: 'Checkout', createdAt: '', shortDescription: 'Checkout', description: '', assignmentGroup: BLANK, assignedTo: BLANK, plannedStartDate: '', plannedEndDate: '', closeNotes: '' } as CtaskTemplate;
    const template = { id: 'tpl-1', name: 'Monthly', createdAt: '', chgBasicInfo: { category: 'software' }, chgPlanningAssessment: {}, chgPlanningContent: { implementationPlan: '1. Deploy' }, ctaskTemplateIds: ['ctask-1'] } as unknown as CrgTemplate;
    const { result } = renderStartingPoint({ kind: 'template', template, ctaskTemplates: [task] });
    expect(result.current.startingPoint.status).toEqual({ kind: 'applied', templateName: 'Monthly' });
    expect(result.current.crg.state.chgBasicInfo.category).toBe('software');
    expect(result.current.crg.state.changeTasks.map((stagedTask) => stagedTask.shortDescription)).toEqual(['Checkout']);
    act(() => result.current.startingPoint.dismiss());
    expect(result.current.startingPoint.status).toEqual({ kind: 'none' });
  });

  it('does nothing for a blank new change', () => {
    const { result } = renderStartingPoint(null);
    expect(result.current.startingPoint.status).toEqual({ kind: 'none' });
    expect(snowFetch).not.toHaveBeenCalled();
  });
});
