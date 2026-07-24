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
  incidentNumber: 'INC0012345',
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

const MOCK_SERVICE_NOW_INCIDENT_RESPONSE = {
  result: [
    {
      number: 'INC0012345',
    },
  ],
};

describe('usePrbState', () => {
  afterEach(() => {
    vi.clearAllMocks();
    // The SL sub-task preferences persist to localStorage; clear them so tests stay isolated.
    localStorage.clear();
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
    vi.mocked(snowFetch)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_PROBLEM_RESPONSE)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_INCIDENT_RESPONSE);
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
      expect(result.current.state.primaryIssueSummaryTemplate).toBe(
        'INC0012345: PRB0001234: "Checkout flow fails under load"',
      );
      expect(result.current.state.slStorySummaryTemplate).toBe(
        '[SL] INC0012345: PRB0001234: "Checkout flow fails under load"',
      );
    });
  });

  it('sanitizes encoded ServiceNow description markup before storing PRB data', async () => {
    vi.mocked(snowFetch)
      .mockResolvedValueOnce({
        result: [
          {
            ...MOCK_SERVICE_NOW_PROBLEM_RESPONSE.result[0],
            description: '<p dir="auto" style="animation-duration:0.01ms;">Facets:</p><b>Deployment details</b>',
          },
        ],
      })
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_INCIDENT_RESPONSE);
    const { result } = renderHook(() => usePrbState());

    act(() => {
      result.current.actions.setPrbNumber('PRB0001234');
    });

    await act(async () => {
      await result.current.actions.fetchPrb();
    });

    await waitFor(() => {
      expect(result.current.state.prbData?.description).toBe('Facets: Deployment details');
    });
  });

  it('loads a PRB by number query and then fetches the linked incident by problem sys_id', async () => {
    vi.mocked(snowFetch)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_PROBLEM_RESPONSE)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_INCIDENT_RESPONSE);
    const { result } = renderHook(() => usePrbState());

    act(() => {
      result.current.actions.setPrbNumber('prb0001234');
    });

    await act(async () => {
      await result.current.actions.fetchPrb();
    });

    const problemLookupPath = vi.mocked(snowFetch).mock.calls[0][0] as string;
    const incidentLookupPath = vi.mocked(snowFetch).mock.calls[1][0] as string;

    expect(problemLookupPath).toContain('/api/now/table/problem?');
    expect(problemLookupPath).toContain('sysparm_query=number%3DPRB0001234');
    expect(problemLookupPath).not.toContain('/api/now/table/problem/PRB0001234');
    expect(incidentLookupPath).toContain('/api/now/table/incident?');
    expect(incidentLookupPath).toContain('sysparm_query=problem_id%3Dproblem-1');
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

  it('loads the PRB and stores a warning when the related incident lookup fails', async () => {
    vi.mocked(snowFetch)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_PROBLEM_RESPONSE)
      .mockRejectedValueOnce(new Error('Incident API unavailable'));
    const { result } = renderHook(() => usePrbState());

    act(() => {
      result.current.actions.setPrbNumber('PRB0001234');
    });

    await act(async () => {
      await result.current.actions.fetchPrb();
    });

    await waitFor(() => {
      expect(result.current.state.prbData).toEqual({
        ...MOCK_PROBLEM_RECORD,
        incidentNumber: '',
      });
      expect(result.current.state.fetchError).toBeNull();
      expect(result.current.state.fetchWarning).toBe(
        'PRB loaded, but the related incident number could not be read: Incident API unavailable',
      );
    });
  });

  it('creates a Defect plus an SL sub-task parented to it by default', async () => {
    vi.mocked(snowFetch)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_PROBLEM_RESPONSE)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_INCIDENT_RESPONSE);
    vi.mocked(jiraPost)
      .mockResolvedValueOnce({ key: 'ABC-101' })
      .mockResolvedValueOnce({ key: 'ABC-102' });
    const { result } = renderHook(() => usePrbState());

    act(() => {
      result.current.actions.setPrbNumber('PRB0001234');
      result.current.actions.setJiraProjectKey('abc');
    });

    await act(async () => {
      await result.current.actions.fetchPrb();
    });
    await waitFor(() => {
      expect(result.current.state.prbData).not.toBeNull();
    });
    await act(async () => {
      await result.current.actions.createJiraIssues();
    });

    // Primary Defect is created first so its key can parent the SL sub-task.
    expect(vi.mocked(jiraPost).mock.calls[0][1]).toMatchObject({
      fields: {
        summary: 'INC0012345: PRB0001234: "Checkout flow fails under load"',
        issuetype: { name: 'Defect' },
        priority: { name: 'High' },
      },
    });
    // The SL issue is a Sub-task whose parent is the primary issue just created.
    expect(vi.mocked(jiraPost).mock.calls[1][1]).toMatchObject({
      fields: {
        summary: '[SL] INC0012345: PRB0001234: "Checkout flow fails under load"',
        issuetype: { name: 'Sub-task' },
        parent: { key: 'ABC-101' },
        priority: { name: 'High' },
      },
    });
    expect(result.current.state.createdIssueKeys).toEqual(['ABC-101', 'ABC-102']);
  });

  it('creates a standalone SL Story (no parent) when the sub-task option is turned off', async () => {
    vi.mocked(snowFetch)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_PROBLEM_RESPONSE)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_INCIDENT_RESPONSE);
    vi.mocked(jiraPost)
      .mockResolvedValueOnce({ key: 'ABC-101' })
      .mockResolvedValueOnce({ key: 'ABC-102' });
    const { result } = renderHook(() => usePrbState());

    act(() => {
      result.current.actions.setPrbNumber('PRB0001234');
      result.current.actions.setJiraProjectKey('abc');
      result.current.actions.setCreateSlAsSubtask(false);
    });

    await act(async () => {
      await result.current.actions.fetchPrb();
    });
    await waitFor(() => expect(result.current.state.prbData).not.toBeNull());
    await act(async () => {
      await result.current.actions.createJiraIssues();
    });

    // The SL issue is a Story with no parent — the legacy behaviour.
    const slPayload = vi.mocked(jiraPost).mock.calls[1][1] as { fields: Record<string, unknown> };
    expect(slPayload.fields.issuetype).toEqual({ name: 'Story' });
    expect(slPayload.fields.parent).toBeUndefined();
  });

  it('honours a configured SL sub-task issue type name', async () => {
    vi.mocked(snowFetch)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_PROBLEM_RESPONSE)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_INCIDENT_RESPONSE);
    vi.mocked(jiraPost)
      .mockResolvedValueOnce({ key: 'ABC-101' })
      .mockResolvedValueOnce({ key: 'ABC-102' });
    const { result } = renderHook(() => usePrbState());

    act(() => {
      result.current.actions.setPrbNumber('PRB0001234');
      result.current.actions.setJiraProjectKey('abc');
      result.current.actions.setSlSubtaskIssueTypeName('SL Task');
    });

    await act(async () => {
      await result.current.actions.fetchPrb();
    });
    await waitFor(() => expect(result.current.state.prbData).not.toBeNull());
    await act(async () => {
      await result.current.actions.createJiraIssues();
    });

    expect(vi.mocked(jiraPost).mock.calls[1][1]).toMatchObject({
      fields: { issuetype: { name: 'SL Task' }, parent: { key: 'ABC-101' } },
    });
  });

  it('creates the primary issue as a Story when the defect checkbox is cleared', async () => {
    vi.mocked(snowFetch)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_PROBLEM_RESPONSE)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_INCIDENT_RESPONSE);
    vi.mocked(jiraPost)
      .mockResolvedValueOnce({ key: 'ABC-101' })
      .mockResolvedValueOnce({ key: 'ABC-102' });
    const { result } = renderHook(() => usePrbState());

    act(() => {
      result.current.actions.setPrbNumber('PRB0001234');
      result.current.actions.setJiraProjectKey('abc');
      result.current.actions.setIsPrimaryIssueDefect(false);
    });

    await act(async () => {
      await result.current.actions.fetchPrb();
    });
    await waitFor(() => {
      expect(result.current.state.prbData).not.toBeNull();
    });
    await act(async () => {
      await result.current.actions.createJiraIssues();
    });

    // Primary is a Story; the SL sub-task still parents to it.
    expect(vi.mocked(jiraPost).mock.calls[0][1]).toMatchObject({ fields: { issuetype: { name: 'Story' } } });
    expect(vi.mocked(jiraPost).mock.calls[1][1]).toMatchObject({
      fields: { issuetype: { name: 'Sub-task' }, parent: { key: 'ABC-101' } },
    });
  });

  it('preserves the created primary key and reports the failure when the SL sub-task fails', async () => {
    vi.mocked(snowFetch)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_PROBLEM_RESPONSE)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_INCIDENT_RESPONSE);
    // Primary succeeds, SL sub-task fails.
    vi.mocked(jiraPost)
      .mockResolvedValueOnce({ key: 'ABC-101' })
      .mockRejectedValueOnce(new Error('400 — Issue Type is required.'));
    const { result } = renderHook(() => usePrbState());

    act(() => {
      result.current.actions.setPrbNumber('PRB0001234');
      result.current.actions.setJiraProjectKey('ABC');
    });
    await act(async () => {
      await result.current.actions.fetchPrb();
    });
    await waitFor(() => expect(result.current.state.prbData).not.toBeNull());
    await act(async () => {
      await result.current.actions.createJiraIssues();
    });

    await waitFor(() => {
      // The successfully created primary issue key must be preserved.
      expect(result.current.state.createdIssueKeys).toEqual(['ABC-101']);
      // An error message for the failed SL sub-task must also be surfaced.
      expect(result.current.state.createError).toContain('SL sub-task');
      expect(result.current.state.createError).toContain('400 — Issue Type is required.');
      expect(result.current.state.isCreatingIssues).toBe(false);
    });
  });

  it('skips the SL sub-task and says so when the primary issue cannot be created', async () => {
    vi.mocked(snowFetch)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_PROBLEM_RESPONSE)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_INCIDENT_RESPONSE);
    vi.mocked(jiraPost).mockRejectedValueOnce(new Error('403 — no create permission'));
    const { result } = renderHook(() => usePrbState());

    act(() => {
      result.current.actions.setPrbNumber('PRB0001234');
      result.current.actions.setJiraProjectKey('ABC');
    });
    await act(async () => {
      await result.current.actions.fetchPrb();
    });
    await waitFor(() => expect(result.current.state.prbData).not.toBeNull());
    await act(async () => {
      await result.current.actions.createJiraIssues();
    });

    await waitFor(() => {
      // Only the primary was attempted — no orphan sub-task creation without a parent.
      expect(vi.mocked(jiraPost)).toHaveBeenCalledTimes(1);
      expect(result.current.state.createdIssueKeys).toEqual([]);
      expect(result.current.state.createError).toContain('Primary issue');
      expect(result.current.state.createError).toContain('skipped because the primary issue was not created');
    });
  });

  it('resets the PRB state back to its initial values', async () => {
    vi.mocked(snowFetch)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_PROBLEM_RESPONSE)
      .mockResolvedValueOnce(MOCK_SERVICE_NOW_INCIDENT_RESPONSE);
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
