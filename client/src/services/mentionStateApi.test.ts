// mentionStateApi.test.ts — Unit tests for the addressed-mentions client wrapper.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchAddressedMentions, setMentionAddressed } from './mentionStateApi.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchAddressedMentions', () => {
  it('requests the per-user endpoint and returns the addressed map', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ addressed: { 'TBX-1#101': { addressedAt: 'x', issueKey: 'TBX-1' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAddressedMentions('jane smith');

    expect(fetchMock).toHaveBeenCalledWith('/api/mention-state?user=jane%20smith');
    expect(result).toHaveProperty('TBX-1#101');
  });

  it('throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchAddressedMentions('jsmith')).rejects.toThrow(/HTTP 500/);
  });
});

describe('setMentionAddressed', () => {
  it('posts the mention payload and returns the updated map', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ addressed: { 'TBX-1#101': { addressedAt: 'x', issueKey: 'TBX-1' } } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await setMentionAddressed({
      userKey: 'jsmith',
      mentionKey: 'TBX-1#101',
      issueKey: 'TBX-1',
      isAddressed: true,
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/mention-state', expect.objectContaining({ method: 'POST' }));
    expect(result).toHaveProperty('TBX-1#101');
  });
});
