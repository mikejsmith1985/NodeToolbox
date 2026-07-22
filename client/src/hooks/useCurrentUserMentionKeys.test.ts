// useCurrentUserMentionKeys.test.ts — Unit tests for resolving the reader's own mention identifiers.
//
// The behaviour that matters most is the failure path: knowing who you are only decorates mentions
// of you, so it must never be able to stop a comment thread from rendering.

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetMyself = vi.fn();

vi.mock('../services/jiraApi.ts', () => ({
  getMyself: () => mockGetMyself(),
}));

const { buildUserDirectoryKeys, resetCurrentUserMentionKeysCache, useCurrentUserMentionKeys } =
  await import('./useCurrentUserMentionKeys.ts');

beforeEach(() => {
  mockGetMyself.mockReset();
  resetCurrentUserMentionKeysCache();
});

describe('buildUserDirectoryKeys', () => {
  it('builds the Cloud account key', () => {
    expect(buildUserDirectoryKeys({ accountId: '557058:ab-12', displayName: 'Jane' }))
      .toEqual(['accountId:557058:ab-12']);
  });

  it('builds both keys when Jira supplies an account id and a username', () => {
    expect(buildUserDirectoryKeys({ accountId: 'acc-1', name: 'jsmith', displayName: 'Jane' }))
      .toEqual(['accountId:acc-1', 'name:jsmith']);
  });

  it('builds the username key alone on a Data Center instance', () => {
    expect(buildUserDirectoryKeys({ name: 'jsmith', displayName: 'Jane' })).toEqual(['name:jsmith']);
  });

  it('returns nothing for a missing or identifier-less user', () => {
    expect(buildUserDirectoryKeys(null)).toEqual([]);
    expect(buildUserDirectoryKeys({ displayName: 'Nameless' })).toEqual([]);
    expect(buildUserDirectoryKeys({ accountId: '   ', displayName: 'Blank' })).toEqual([]);
  });
});

describe('useCurrentUserMentionKeys', () => {
  it('returns the reader keys once the identity resolves', async () => {
    mockGetMyself.mockResolvedValue({ accountId: 'acc-1', displayName: 'Reader' });

    const { result } = renderHook(() => useCurrentUserMentionKeys());

    await waitFor(() => expect(result.current).toEqual(['accountId:acc-1']));
  });

  it('starts empty so a thread renders before the identity is known', () => {
    mockGetMyself.mockReturnValue(new Promise(() => { /* never settles */ }));

    const { result } = renderHook(() => useCurrentUserMentionKeys());

    expect(result.current).toEqual([]);
  });

  it('asks Jira once no matter how many threads are on screen at the same time', async () => {
    mockGetMyself.mockResolvedValue({ accountId: 'acc-1', displayName: 'Reader' });

    const { result: firstThread } = renderHook(() => useCurrentUserMentionKeys());
    renderHook(() => useCurrentUserMentionKeys());
    renderHook(() => useCurrentUserMentionKeys());

    await waitFor(() => expect(firstThread.current).toEqual(['accountId:acc-1']));
    expect(mockGetMyself).toHaveBeenCalledTimes(1);
  });

  it('degrades quietly when the identity request is rejected', async () => {
    mockGetMyself.mockRejectedValue(new Error('Jira unreachable'));

    const { result } = renderHook(() => useCurrentUserMentionKeys());

    await waitFor(() => expect(mockGetMyself).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });

  it('degrades quietly when the Jira transport is not even callable', async () => {
    // A partially-stubbed transport throws synchronously rather than rejecting. Highlighting
    // mentions of yourself is a nicety; it must never take a comment thread down with it.
    mockGetMyself.mockImplementation(() => {
      throw new TypeError('getMyself is not a function');
    });

    const { result } = renderHook(() => useCurrentUserMentionKeys());

    await waitFor(() => expect(mockGetMyself).toHaveBeenCalled());
    expect(result.current).toEqual([]);
  });
});
