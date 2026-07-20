// useIssueByKey.test.ts — Unit tests for the single-issue lookup hook's honest outcome states.

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchIssueByKey } from '../services/issueLookup.ts';
import { useIssueByKey } from './useIssueByKey.ts';

// Mock only the fetch; keep the real extractHttpStatus so status mapping is exercised end-to-end.
vi.mock('../services/issueLookup.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/issueLookup.ts')>();
  return { ...actual, fetchIssueByKey: vi.fn() };
});

const LOADED_ISSUE = { id: '1', key: 'ENCUC-1234', fields: { summary: 'An issue' } };

describe('useIssueByKey', () => {
  afterEach(() => vi.clearAllMocks());

  it('stays idle when no key is provided', () => {
    const { result } = renderHook(() => useIssueByKey(null));
    expect(result.current.status).toBe('idle');
    expect(result.current.issue).toBeNull();
  });

  it('reports loading then loaded on success', async () => {
    vi.mocked(fetchIssueByKey).mockResolvedValue(LOADED_ISSUE as never);
    const { result } = renderHook(() => useIssueByKey('ENCUC-1234'));

    expect(result.current.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.status).toBe('loaded');
      expect(result.current.issue).toEqual(LOADED_ISSUE);
    });
  });

  it('maps a 404 to not-found', async () => {
    vi.mocked(fetchIssueByKey).mockRejectedValue(new Error('Jira GET /x failed: 404'));
    const { result } = renderHook(() => useIssueByKey('ENCUC-9999999'));
    await waitFor(() => expect(result.current.status).toBe('not-found'));
    expect(result.current.issue).toBeNull();
  });

  it('maps a 403 to no-permission', async () => {
    vi.mocked(fetchIssueByKey).mockRejectedValue(new Error('Jira GET /x failed: 403 — Forbidden'));
    const { result } = renderHook(() => useIssueByKey('ENCUC-1'));
    await waitFor(() => expect(result.current.status).toBe('no-permission'));
  });

  it('maps any other failure to a generic error', async () => {
    vi.mocked(fetchIssueByKey).mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useIssueByKey('ENCUC-1'));
    await waitFor(() => {
      expect(result.current.status).toBe('error');
      expect(result.current.errorMessage).toBe('network down');
    });
  });

  it('keeps the last issue visible during a refetch (no spinner flicker), then updates', async () => {
    const firstIssue = { key: 'ENCUC-1234', fields: { summary: 'v1' } };
    const secondIssue = { key: 'ENCUC-1234', fields: { summary: 'v2' } };
    let resolveRefetch: (issue: unknown) => void = () => {};
    vi.mocked(fetchIssueByKey)
      .mockResolvedValueOnce(firstIssue as never)
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveRefetch = resolve as unknown as (issue: unknown) => void; }),
      );

    const { result } = renderHook(() => useIssueByKey('ENCUC-1234'));
    await waitFor(() => expect(result.current.status).toBe('loaded'));

    act(() => result.current.refetch());
    // While the refetch is in flight the previous issue stays on screen — never back to 'loading'.
    expect(result.current.status).toBe('loaded');
    expect(result.current.issue).toEqual(firstIssue);

    await act(async () => { resolveRefetch(secondIssue); });
    await waitFor(() => expect(result.current.issue).toEqual(secondIssue));
  });
});
