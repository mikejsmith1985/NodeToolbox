// snowApi.test.ts — Unit tests for the ServiceNow proxy client.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from './snowApi.ts';

const SNOW_PATH = '/api/now/table/change_request';
const SNOW_RESPONSE = { result: [] };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('snowApi', () => {
  it('builds the ServiceNow proxy URL and returns parsed JSON', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(SNOW_RESPONSE),
    } as unknown as Response);

    await expect(snowFetch<typeof SNOW_RESPONSE>(SNOW_PATH)).resolves.toEqual(SNOW_RESPONSE);
    expect(fetch).toHaveBeenCalledWith(`/snow-proxy${SNOW_PATH}`, {});
  });

  it('throws on an error response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 502 } as Response);

    await expect(snowFetch(SNOW_PATH)).rejects.toThrow(
      'SNow fetch /api/now/table/change_request failed: 502',
    );
  });
});
