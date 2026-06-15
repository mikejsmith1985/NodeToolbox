// Unit tests for the Rovo exchange service (dispatch + result polling).

'use strict';

const { dispatchPrompt, fetchResult, stripStorageHtml, PARKING_TITLE_PREFIX } = require('./rovoExchange');

function rovoConfig(overrides = {}) {
  return {
    sslVerify: true,
    rovoAutomation: { webhookUrl: 'https://team.atlassian.net/rovo-hook', webhookSecret: 's3cret', parkingSpaceKey: 'ROVO', ...overrides },
    confluence: { baseUrl: 'https://team.atlassian.net/wiki', email: 'x', apiToken: 'y' },
  };
}

describe('dispatchPrompt', () => {
  function fakeWebhook(status) {
    const calls = [];
    return { fn: (url, payload, tls, secret) => { calls.push({ url, payload, tls, secret }); return Promise.resolve({ status }); }, calls };
  }

  it('dispatches the prompt + correlationId with the secret as a header arg', async () => {
    const { fn, calls } = fakeWebhook(200);
    const result = await dispatchPrompt(rovoConfig(), { correlationId: 'abc', prompt: 'do the thing' }, { triggerWebhook: fn });
    expect(result).toMatchObject({ ok: true, httpStatus: 200, code: 'dispatched' });
    expect(calls[0].payload).toEqual({ correlationId: 'abc', prompt: 'do the thing' });
    expect(calls[0].secret).toBe('s3cret');
  });

  it('does NOT redact the prompt content', async () => {
    const { fn, calls } = fakeWebhook(200);
    await dispatchPrompt(rovoConfig(), { correlationId: 'abc', prompt: 'password=keepThisIntact for context' }, { triggerWebhook: fn });
    expect(calls[0].payload.prompt).toContain('password=keepThisIntact');
  });

  it('rejects a missing correlationId (400) and a blank prompt (400)', async () => {
    expect(await dispatchPrompt(rovoConfig(), { prompt: 'x' }, { triggerWebhook: fakeWebhook(200).fn })).toMatchObject({ httpStatus: 400, code: 'bad-correlation' });
    expect(await dispatchPrompt(rovoConfig(), { correlationId: 'abc', prompt: '   ' }, { triggerWebhook: fakeWebhook(200).fn })).toMatchObject({ httpStatus: 400, code: 'empty-prompt' });
  });

  it('returns 409 when no Rovo webhook is configured', async () => {
    const config = rovoConfig({ webhookUrl: '' });
    expect(await dispatchPrompt(config, { correlationId: 'abc', prompt: 'x' }, { triggerWebhook: fakeWebhook(200).fn })).toMatchObject({ httpStatus: 409, code: 'not-configured' });
  });

  it('blocks a non-Atlassian webhook host with 422 and sends nothing', async () => {
    const { fn, calls } = fakeWebhook(200);
    const config = rovoConfig({ webhookUrl: 'https://evil.example.com/hook' });
    const result = await dispatchPrompt(config, { correlationId: 'abc', prompt: 'x' }, { triggerWebhook: fn });
    expect(result).toMatchObject({ httpStatus: 422, code: 'host-not-allowed' });
    expect(calls).toHaveLength(0);
  });

  it('maps a non-2xx webhook response to 502', async () => {
    const result = await dispatchPrompt(rovoConfig(), { correlationId: 'abc', prompt: 'x' }, { triggerWebhook: fakeWebhook(401).fn });
    expect(result).toMatchObject({ httpStatus: 502, webhookStatus: 401, code: 'webhook-rejected' });
  });

  it('maps a thrown error to 502', async () => {
    const throwing = () => Promise.reject(new Error('ECONNREFUSED'));
    expect(await dispatchPrompt(rovoConfig(), { correlationId: 'abc', prompt: 'x' }, { triggerWebhook: throwing })).toMatchObject({ httpStatus: 502, code: 'dispatch-failed' });
  });
});

describe('fetchResult', () => {
  it('returns ready:false when the parking page does not exist yet', async () => {
    const confluence = () => Promise.resolve({ results: [] });
    const result = await fetchResult(rovoConfig(), 'abc', { makeConfluenceApiRequest: confluence });
    expect(result).toMatchObject({ ok: true, ready: false });
  });

  it('returns the plain-text response and deletes the page when ready', async () => {
    const calls = [];
    const confluence = (method, path) => {
      calls.push({ method, path });
      if (method === 'GET') {
        return Promise.resolve({ results: [{ id: '12345', body: { storage: { value: '<p>SHORT_DESCRIPTION: Deploy v2</p>' } } }] });
      }
      return Promise.resolve({});
    };
    const result = await fetchResult(rovoConfig(), 'abc', { makeConfluenceApiRequest: confluence });
    expect(result).toMatchObject({ ok: true, ready: true });
    expect(result.response).toBe('SHORT_DESCRIPTION: Deploy v2');
    // GET searched by the correlationId title, and a DELETE was issued for the page id.
    expect(calls[0].path).toContain(PARKING_TITLE_PREFIX + 'abc');
    expect(calls.some((call) => call.method === 'DELETE' && call.path.includes('12345'))).toBe(true);
  });

  it('returns 409 when the parking space is not configured', async () => {
    const config = rovoConfig({ parkingSpaceKey: '' });
    expect(await fetchResult(config, 'abc', { makeConfluenceApiRequest: () => Promise.resolve({}) })).toMatchObject({ httpStatus: 409, code: 'not-configured' });
  });

  it('rejects a missing correlationId with 400', async () => {
    expect(await fetchResult(rovoConfig(), '', { makeConfluenceApiRequest: () => Promise.resolve({}) })).toMatchObject({ httpStatus: 400, code: 'bad-correlation' });
  });

  it('maps a Confluence error to 502', async () => {
    const confluence = () => Promise.reject(new Error('timeout'));
    expect(await fetchResult(rovoConfig(), 'abc', { makeConfluenceApiRequest: confluence })).toMatchObject({ httpStatus: 502, code: 'fetch-failed' });
  });
});

describe('stripStorageHtml', () => {
  it('strips tags, converts breaks to newlines, and decodes entities', () => {
    expect(stripStorageHtml('<p>A: 1</p><p>B: x &amp; y</p>')).toBe('A: 1\nB: x & y');
  });
});
