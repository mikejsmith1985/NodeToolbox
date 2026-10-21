// useMyOpenChanges.test.ts — Proves the open changes are read only when asked, and a failed read says why.

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { fetchMyOpenChanges } from '../../views/SnowHub/myOpenChanges.ts';
import { useMyOpenChanges } from './useMyOpenChanges.ts';

vi.mock('../../views/SnowHub/myOpenChanges.ts', () => ({ fetchMyOpenChanges: vi.fn() }));

describe('useMyOpenChanges', () => {
  it('reads nothing until asked, then holds the list', async () => {
    vi.mocked(fetchMyOpenChanges).mockResolvedValueOnce([{ changeNumber: 'CHG1', shortDescription: 'Payments' }]);
    const { result } = renderHook(() => useMyOpenChanges());
    expect(result.current.loadState).toEqual({ kind: 'idle' });
    expect(fetchMyOpenChanges).not.toHaveBeenCalled();
    await act(async () => { await result.current.load(); });
    expect(result.current.loadState).toEqual({ kind: 'loaded', changes: [{ changeNumber: 'CHG1', shortDescription: 'Payments' }] });
  });

  it('says why a read failed', async () => {
    vi.mocked(fetchMyOpenChanges).mockRejectedValueOnce(new Error('HTTP 401'));
    const { result } = renderHook(() => useMyOpenChanges());
    await act(async () => { await result.current.load(); });
    expect(result.current.loadState).toEqual({ kind: 'failed', message: 'HTTP 401' });
  });
});
