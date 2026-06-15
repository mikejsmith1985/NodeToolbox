// Tests for the client report-delivery API caller.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { deliverReport } from './reportDelivery.ts';

function stubFetchJson(jsonBody: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ json: async () => jsonBody });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('deliverReport', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts surface/teamId/report to the delivery endpoint and maps success', async () => {
    const fetchMock = stubFetchJson({ ok: true, status: 200, redactionApplied: false, redactionCount: 0, message: 'Delivered to Automation webhook (HTTP 200).' });

    const result = await deliverReport({ surface: 'standup-briefing', teamId: 'ALPHA', report: '## Briefing' });

    expect(fetchMock).toHaveBeenCalledWith('/api/reports/deliver', expect.objectContaining({ method: 'POST' }));
    const sentBody = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(sentBody).toEqual({ surface: 'standup-briefing', teamId: 'ALPHA', report: '## Briefing' });
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/Delivered/);
  });

  it('maps a redaction result', async () => {
    stubFetchJson({ ok: true, status: 200, redactionApplied: true, redactionCount: 3, message: 'Delivered. 3 value(s) redacted before sending.' });
    const result = await deliverReport({ surface: 'scope-change', teamId: 'ALPHA', report: {} });
    expect(result.redactionApplied).toBe(true);
    expect(result.redactionCount).toBe(3);
  });

  it('returns a non-ok result on network error (never throws)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('connection refused'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await deliverReport({ surface: 'feature-change', teamId: 'ALPHA', report: {} });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/connection refused/);
  });
});
