// useImplementationBackout.test.ts — Proves the hook writes the change's backout plan into an Implementation task once.

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { readBackoutSectionFromDescription } from '../../views/SnowHub/chgFormula/ctaskReviewRecord.ts';
import type { CrgHook } from './changeDraft.ts';
import { useImplementationBackout } from './useImplementationBackout.ts';

function buildCrg(backoutPlan: string, updateChangeTask = vi.fn()): CrgHook {
  return {
    state: {
      chgPlanningContent: { implementationPlan: '', testPlan: '', backoutPlan },
      changeTasks: [{ id: 'impl', name: 'Deploy', changeTaskType: 'Implementation', description: '', createdAt: '' }],
    },
    actions: { updateChangeTask },
  } as unknown as CrgHook;
}

describe('useImplementationBackout', () => {
  it('copies the change\'s backout plan into the Implementation task', () => {
    const updateChangeTask = vi.fn();
    renderHook(() => useImplementationBackout(buildCrg('1. Redeploy v1', updateChangeTask)));
    expect(updateChangeTask).toHaveBeenCalledTimes(1);
    const [taskId, taskData] = updateChangeTask.mock.calls[0];
    expect(taskId).toBe('impl');
    expect(readBackoutSectionFromDescription(taskData.description)).toBe('1. Redeploy v1');
  });

  it('writes nothing while the change has no backout plan', () => {
    const updateChangeTask = vi.fn();
    renderHook(() => useImplementationBackout(buildCrg('', updateChangeTask)));
    expect(updateChangeTask).not.toHaveBeenCalled();
  });
});
