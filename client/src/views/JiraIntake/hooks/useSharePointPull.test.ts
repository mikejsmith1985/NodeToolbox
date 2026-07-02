// useSharePointPull.test.ts — Covers a successful pull (maps rows + surfaces missing columns), the
// not-configured guard, the not-connected guard, and fail-safe on a read error.

import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchRelayStatus } from '../../../services/relayBridgeApi.ts';
import { fetchListItems, resolveListFieldMap } from '../../../services/sharepointIntakeApi.ts';
import { useSharePointPull, type SharePointPullResult } from './useSharePointPull.ts';
import type { IntakeConfig } from '../lib/intakeTypes.ts';

vi.mock('../../../services/relayBridgeApi.ts', () => ({ fetchRelayStatus: vi.fn() }));
vi.mock('../../../services/sharepointIntakeApi.ts', () => ({ resolveListFieldMap: vi.fn(), fetchListItems: vi.fn() }));

const statusMock = vi.mocked(fetchRelayStatus);
const fieldMapMock = vi.mocked(resolveListFieldMap);
const itemsMock = vi.mocked(fetchListItems);

const CONFIG: IntakeConfig = {
  projectKey: 'ENFCT', acceptanceCriteriaFieldId: 'customfield_10200', autoCreateOnImport: true,
  sharePointSiteRelativeUrl: '/sites/CUCIntake', sharePointListName: 'Jira-Intake',
  updatedAt: '', updatedBy: '',
};

// Capture object avoids TS narrowing a closure-assigned `let` to `null`.
function captured(): { value: SharePointPullResult | null } {
  return { value: null };
}

afterEach(() => { vi.clearAllMocks(); });

describe('useSharePointPull', () => {
  it('pulls, maps items to rows, and surfaces missing columns', async () => {
    statusMock.mockResolvedValue({ system: 'sharepoint', isConnected: true, lastPingAt: null, version: null });
    fieldMapMock.mockResolvedValue({
      byDisplayName: new Map([['id', '_x0069_d'], ['summary', 'summary']]),
      missingColumns: ['acceptanceCriteria'],
    });
    itemsMock.mockResolvedValue([{ _x0069_d: 'a', summary: 'abc' }]);

    const { result } = renderHook(() => useSharePointPull(CONFIG));
    const out = captured();
    await act(async () => { out.value = await result.current.pull(); });

    expect(out.value?.itemCount).toBe(1);
    expect(out.value?.rows[0].id).toBe('a');
    expect(out.value?.rows[0].summary).toBe('abc');
    expect(out.value?.missingColumns).toEqual(['acceptanceCriteria']);
    expect(result.current.errorMessage).toBeNull();
  });

  it('errors (no rows) when SharePoint site/list are not configured', async () => {
    const { result } = renderHook(() => useSharePointPull({ ...CONFIG, sharePointSiteRelativeUrl: undefined }));
    const out = captured();
    await act(async () => { out.value = await result.current.pull(); });
    expect(out.value).toBeNull();
    expect(result.current.errorMessage).toMatch(/settings first/i);
    expect(fieldMapMock).not.toHaveBeenCalled();
  });

  it('errors (no rows) when the relay is not connected', async () => {
    statusMock.mockResolvedValue({ system: 'sharepoint', isConnected: false, lastPingAt: null, version: null });
    const { result } = renderHook(() => useSharePointPull(CONFIG));
    const out = captured();
    await act(async () => { out.value = await result.current.pull(); });
    expect(out.value).toBeNull();
    expect(result.current.errorMessage).toMatch(/connect the sharepoint relay/i);
    expect(fieldMapMock).not.toHaveBeenCalled();
  });

  it('fails safe (no rows, clear message) when a read errors', async () => {
    statusMock.mockResolvedValue({ system: 'sharepoint', isConnected: true, lastPingAt: null, version: null });
    fieldMapMock.mockRejectedValue(new Error('Access denied'));
    const { result } = renderHook(() => useSharePointPull(CONFIG));
    const out = captured();
    await act(async () => { out.value = await result.current.pull(); });
    expect(out.value).toBeNull();
    expect(result.current.errorMessage).toMatch(/access denied/i);
  });
});
