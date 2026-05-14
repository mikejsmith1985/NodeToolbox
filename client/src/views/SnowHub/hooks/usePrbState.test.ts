// usePrbState.test.ts — Unit tests for the PRB generator state hook.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { jiraPost } from '../../../services/jiraApi.ts';
import { snowFetch } from '../../../services/snowApi.ts';
import { usePrbState } from './usePrbState.ts';

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraPost: vi.fn(),
}));

vi.mock('../../../services/snowApi.ts', () => ({
  snowFetch: vi.fn(),
}));

const MOCK_PROBLEM_RECORD = {
  sysId: 'problem-1',
  number: 'PRB0001234',
  shortDescription: 'Checkout flow fails under load',
  description: 'Users are unable to complete checkout during peak traffic.',
  state: 'Open',
  severity: '2 - High',
  assignedTo: null,
};

const MOCK_SERVICE_NOW_PROBLEM_RESPONSE = {
  result: [
    {
      sys_id:            'problem-1',
      number:            'PRB0001234',
      short_description: 'Checkout flow fails under load',
      description:       'Users are unable to complete checkout during peak traffic.',
      state:             'Open',
      severity:          '2 - High',
      assigned_to:       '',
    },
  ],
};

describe('usePrbState', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts with an empty PRB number and no loaded PRB data', () => {
    const { result } = renderHook(() => usePrbState());

    expect(result.current.state.prbNumber).toBe('');
    expect(result.current.state.prbData).toBeNull();
  });

  it('updates the PRB number when setPrbNumber is called', () => {
    const { result } = renderHook(() => usePrbState());

    act(() => {
      result.current.actions.setPrbNumber('PRB0001234');
    });

    expect(result.current.state.prbNumber).toBe('PRB0001234');
  });

  it('stores PRB details and clears the error after a successful fetch', async () => {
    vi.mocked(snowFetch).mockResolvedValue(MOCK_SERVICE_NOW_PROBLEM_RESPONSE);
    const { result } = renderHook(() => usePrbState());

    act(() => {
      result.current.actions.setPrbNumber('PRB0001234');
    });

    await act(async () => {
      await result.current.actions.fetchPrb();
    });

    await waitFor(() => {
      expect(result.current.state.prbData).toEqual(MOCK_PROBLEM_RECORD);
      expect(result.current.state.fetchError).toBeNull();
      expect(result.current.state.defectSummaryTemplate).toContain('PRB0001234');
    });
  });

  it('loads a PRB by number query instead of using the PRB number as a sys_id path segment', async () => {
    vi.mocked(snowFetch).mockResolvedValue(MOCK_SERVICE_NOW_PROBLEM_RESPONSE);
    const { result } = renderHook(() => usePrbState());

    act(() => {
      result.current.actions.setPrbNumber('prb0001234');
    });

    await act(async () => {
      await result.current.actions.fetchPrb();
    });

    const calledPath = vi.mocked(snowFetch).mock.calls[0][0] as string;
    expect(calledPath).toContain('/api/now/table/problem?');
    expect(calledPath).toContain('sysparm_query=number%3DPRB0001234');
    expect(calledPath).not.toContain('/api/now/table/problem/PRB0001234');
  });

  it('stores a fetch error when the ServiceNow request fails', async () => {
    vi.mocked(snowFetch).mockRejectedValue(new Error('SNow unavailable'));
    const { result } = renderHook(() => usePrbState());

    act(() => {
      result.current.actions.setPrbNumber('PRB0001234');
    });

    await act(async () => {
      await result.current.actions.fetchPrb();
    });

    await waitFor(() => {
      expect(result.current.state.fetchError).toBe('SNow unavailable');
    });
  });

  it('resets the PRB state back to its initial values', async () => {
    vi.mocked(snowFetch).mockResolvedValue(MOCK_SERVICE_NOW_PROBLEM_RESPONSE);
    vi.mocked(jiraPost).mockResolvedValue({ key: 'ABC-123' });
    const { result } = renderHook(() => usePrbState());

    act(() => {
      result.current.actions.setPrbNumber('PRB0001234');
      result.current.actions.setJiraProjectKey('abc');
    });

    await act(async () => {
      await result.current.actions.fetchPrb();
    });

    act(() => {
      result.current.actions.reset();
    });

    expect(result.current.state.prbNumber).toBe('');
    expect(result.current.state.prbData).toBeNull();
    expect(result.current.state.createdIssueKeys).toEqual([]);
  });
});
