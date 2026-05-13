// useRovoAssist.test.ts — Unit tests for the Rovo AI assist hook.

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JiraIssue } from '../../../types/jira.ts';
import { useRovoAssist } from './useRovoAssist.ts';

function createMockJiraIssue(issueKey: string, summary: string): JiraIssue {
  return {
    id:     issueKey,
    key:    issueKey,
    fields: {
      summary,
      status:    { name: 'Done', statusCategory: { key: 'done' } },
      priority:  { name: 'High', iconUrl: '' },
      assignee:  null,
      reporter:  null,
      issuetype: { name: 'Story', iconUrl: '' },
      created:   '2025-01-01T00:00:00.000Z',
      updated:   '2025-01-01T00:00:00.000Z',
      description: null,
    },
  };
}

const EMPTY_CURRENT_FIELDS = {
  shortDescription: '',
  description:      '',
  justification:    '',
  riskImpact:       '',
};

describe('useRovoAssist', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts in a locked, idle state with no error', () => {
    const { result } = renderHook(() => useRovoAssist());

    expect(result.current.isUnlocked).toBe(false);
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.generationError).toBeNull();
  });

  it('unlocks and returns true when the correct passphrase is provided', async () => {
    const { result } = renderHook(() => useRovoAssist());

    let isValid = false;
    await act(async () => {
      isValid = await result.current.verifyPassphrase('rovonow');
    });

    expect(isValid).toBe(true);
    expect(result.current.isUnlocked).toBe(true);
  });

  it('stays locked and returns false when an incorrect passphrase is provided', async () => {
    const { result } = renderHook(() => useRovoAssist());

    let isValid = true;
    await act(async () => {
      isValid = await result.current.verifyPassphrase('wrongpassword');
    });

    expect(isValid).toBe(false);
    expect(result.current.isUnlocked).toBe(false);
  });

  it('stays locked when an empty string is provided as a passphrase', async () => {
    const { result } = renderHook(() => useRovoAssist());

    let isValid = true;
    await act(async () => {
      isValid = await result.current.verifyPassphrase('');
    });

    expect(isValid).toBe(false);
    expect(result.current.isUnlocked).toBe(false);
  });

  it('calls POST /api/rovo/generate with issue data and returns generated fields', async () => {
    const mockGeneratedFields = {
      shortDescription: 'AI: Deploy TOOL 1.0.0',
      description:      'AI: Issues included in this release',
      justification:    'AI: Planned release required by business',
      riskImpact:       'AI: Standard deployment risk',
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve(mockGeneratedFields),
    }));

    const { result } = renderHook(() => useRovoAssist());
    const selectedIssues = [createMockJiraIssue('TOOL-1', 'Fix critical bug')];

    let generatedFields: typeof mockGeneratedFields | null = null;
    await act(async () => {
      generatedFields = await result.current.generateChgFields(selectedIssues, EMPTY_CURRENT_FIELDS);
    });

    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/rovo/generate',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(generatedFields).toEqual(mockGeneratedFields);
    expect(result.current.isGenerating).toBe(false);
  });

  it('includes the issue key and summary in the request body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve(EMPTY_CURRENT_FIELDS),
    }));

    const { result } = renderHook(() => useRovoAssist());
    const selectedIssues = [createMockJiraIssue('TOOL-42', 'Fix the release blocker')];

    await act(async () => {
      await result.current.generateChgFields(selectedIssues, EMPTY_CURRENT_FIELDS);
    });

    const [, requestInit] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(requestInit.body as string) as { issueList: string };
    expect(requestBody.issueList).toContain('TOOL-42');
    expect(requestBody.issueList).toContain('Fix the release blocker');
  });

  it('falls back to "(no issues selected)" in the request body when no issues are passed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:   true,
      json: () => Promise.resolve(EMPTY_CURRENT_FIELDS),
    }));

    const { result } = renderHook(() => useRovoAssist());

    await act(async () => {
      await result.current.generateChgFields([], EMPTY_CURRENT_FIELDS);
    });

    const [, requestInit] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(requestInit.body as string) as { issueList: string };
    expect(requestBody.issueList).toBe('(no issues selected)');
  });

  it('sets generationError and returns null when the server responds with an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:     false,
      status: 502,
      json:   () => Promise.resolve({ message: 'Atlassian credentials not configured' }),
    }));

    const { result } = renderHook(() => useRovoAssist());

    let generatedFields: unknown = 'not-null';
    await act(async () => {
      generatedFields = await result.current.generateChgFields([], EMPTY_CURRENT_FIELDS);
    });

    expect(generatedFields).toBeNull();
    expect(result.current.generationError).toBe('Atlassian credentials not configured');
    expect(result.current.isGenerating).toBe(false);
  });

  it('sets generationError and returns null when fetch throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network unavailable')));

    const { result } = renderHook(() => useRovoAssist());

    await act(async () => {
      await result.current.generateChgFields([], EMPTY_CURRENT_FIELDS);
    });

    expect(result.current.generationError).toBe('Network unavailable');
    expect(result.current.isGenerating).toBe(false);
  });
});
