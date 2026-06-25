// Unit tests for the AI Assist exchange service (dispatch + result polling).

'use strict';

const { dispatchPrompt, fetchResult, stripStorageHtml, extractStaticResult, listCorrelationMarkers, PARKING_TITLE_PREFIX } = require('./aiAssistExchange');

function aiAssistConfig(overrides = {}) {
  return {
    sslVerify: true,
    aiAssistAutomation: { webhookUrl: 'https://team.atlassian.net/ai-assist-hook', webhookSecret: 's3cret', parkingSpaceKey: 'AIASSIST', ...overrides },
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
    const result = await dispatchPrompt(aiAssistConfig(), { correlationId: 'abc', prompt: 'do the thing' }, { triggerWebhook: fn });
    expect(result).toMatchObject({ ok: true, httpStatus: 200, code: 'dispatched' });
    expect(calls[0].payload).toEqual({ correlationId: 'abc', prompt: 'do the thing' });
    expect(calls[0].secret).toBe('s3cret');
  });

  it('does NOT redact the prompt content', async () => {
    const { fn, calls } = fakeWebhook(200);
    await dispatchPrompt(aiAssistConfig(), { correlationId: 'abc', prompt: 'password=keepThisIntact for context' }, { triggerWebhook: fn });
    expect(calls[0].payload.prompt).toContain('password=keepThisIntact');
  });

  it('rejects a missing correlationId (400) and a blank prompt (400)', async () => {
    expect(await dispatchPrompt(aiAssistConfig(), { prompt: 'x' }, { triggerWebhook: fakeWebhook(200).fn })).toMatchObject({ httpStatus: 400, code: 'bad-correlation' });
    expect(await dispatchPrompt(aiAssistConfig(), { correlationId: 'abc', prompt: '   ' }, { triggerWebhook: fakeWebhook(200).fn })).toMatchObject({ httpStatus: 400, code: 'empty-prompt' });
  });

  it('returns 409 when no AI Assist webhook is configured', async () => {
    const config = aiAssistConfig({ webhookUrl: '' });
    expect(await dispatchPrompt(config, { correlationId: 'abc', prompt: 'x' }, { triggerWebhook: fakeWebhook(200).fn })).toMatchObject({ httpStatus: 409, code: 'not-configured' });
  });

  it('blocks a non-Atlassian webhook host with 422 and sends nothing', async () => {
    const { fn, calls } = fakeWebhook(200);
    const config = aiAssistConfig({ webhookUrl: 'https://evil.example.com/hook' });
    const result = await dispatchPrompt(config, { correlationId: 'abc', prompt: 'x' }, { triggerWebhook: fn });
    expect(result).toMatchObject({ httpStatus: 422, code: 'host-not-allowed' });
    expect(calls).toHaveLength(0);
  });

  it('maps a non-2xx webhook response to 502', async () => {
    const result = await dispatchPrompt(aiAssistConfig(), { correlationId: 'abc', prompt: 'x' }, { triggerWebhook: fakeWebhook(401).fn });
    expect(result).toMatchObject({ httpStatus: 502, webhookStatus: 401, code: 'webhook-rejected' });
  });

  it('maps a thrown error to 502', async () => {
    const throwing = () => Promise.reject(new Error('ECONNREFUSED'));
    expect(await dispatchPrompt(aiAssistConfig(), { correlationId: 'abc', prompt: 'x' }, { triggerWebhook: throwing })).toMatchObject({ httpStatus: 502, code: 'dispatch-failed' });
  });
});

describe('fetchResult', () => {
  it('returns ready:false when the parking page does not exist yet', async () => {
    const confluence = () => Promise.resolve({ results: [] });
    const result = await fetchResult(aiAssistConfig(), 'abc', { makeConfluenceApiRequest: confluence });
    expect(result).toMatchObject({ ok: true, ready: false });
  });

  it('returns the plain-text response and deletes the page when ready', async () => {
    const calls = [];
    const confluence = (method, path) => {
      calls.push({ method, path });
      if (method === 'GET') {
        return Promise.resolve({ results: [{ id: '12345', title: 'rovo-result-abc', body: { storage: { value: '<p>SHORT_DESCRIPTION: Deploy v2</p>' } } }] });
      }
      return Promise.resolve({});
    };
    const result = await fetchResult(aiAssistConfig(), 'abc', { makeConfluenceApiRequest: confluence });
    expect(result).toMatchObject({ ok: true, ready: true });
    expect(result.response).toBe('SHORT_DESCRIPTION: Deploy v2');
    // GET searched by the correlationId title, and a DELETE was issued for the page id.
    expect(calls[0].path).toContain(PARKING_TITLE_PREFIX + 'abc');
    expect(calls.some((call) => call.method === 'DELETE' && call.path.includes('12345'))).toBe(true);
  });

  it('falls back to the space listing and matches the exact title when the global title search misses', async () => {
    const calls = [];
    const confluence = (method, path) => {
      calls.push({ method, path });
      if (method === 'GET' && path.includes('title=')) {
        // global-title strategy: returns nothing (e.g. personal-space quirk)
        return Promise.resolve({ results: [] });
      }
      if (method === 'GET' && path.includes('spaceKey=')) {
        // space-listing strategy: returns several pages; only one matches the title
        return Promise.resolve({ results: [
          { id: '111', title: 'Overview', body: { storage: { value: '<p>nope</p>' } } },
          { id: '222', title: 'rovo-result-abc', body: { storage: { value: '<p>DESCRIPTION: found via listing</p>' } } },
        ] });
      }
      return Promise.resolve({});
    };
    const result = await fetchResult(aiAssistConfig(), 'abc', { makeConfluenceApiRequest: confluence });
    expect(result).toMatchObject({ ok: true, ready: true });
    expect(result.response).toBe('DESCRIPTION: found via listing');
    expect(calls.some((call) => call.method === 'DELETE' && call.path.includes('222'))).toBe(true);
  });

  it('reads the REAL search envelope { status, body: { results } } (title path)', async () => {
    // Regression: search results are at response.body.results, not response.results.
    const confluence = (method, path) => {
      if (method === 'GET' && path.includes('title=')) {
        return Promise.resolve({ status: 200, body: { results: [
          { id: '999', title: 'rovo-result-abc', body: { storage: { value: '<p>SHORT_DESCRIPTION: via title</p>' } } },
        ] } });
      }
      return Promise.resolve({ status: 204, body: {} });
    };
    const result = await fetchResult(aiAssistConfig(), 'abc', { makeConfluenceApiRequest: confluence });
    expect(result).toMatchObject({ ok: true, ready: true });
    expect(result.response).toBe('SHORT_DESCRIPTION: via title');
  });

  it('returns 409 when the parking space is not configured', async () => {
    const config = aiAssistConfig({ parkingSpaceKey: '' });
    expect(await fetchResult(config, 'abc', { makeConfluenceApiRequest: () => Promise.resolve({}) })).toMatchObject({ httpStatus: 409, code: 'not-configured' });
  });

  it('rejects a missing correlationId with 400', async () => {
    expect(await fetchResult(aiAssistConfig(), '', { makeConfluenceApiRequest: () => Promise.resolve({}) })).toMatchObject({ httpStatus: 400, code: 'bad-correlation' });
  });

  it('maps a Confluence error to 502', async () => {
    const confluence = () => Promise.reject(new Error('timeout'));
    expect(await fetchResult(aiAssistConfig(), 'abc', { makeConfluenceApiRequest: confluence })).toMatchObject({ httpStatus: 502, code: 'fetch-failed' });
  });
});

describe('fetchResult — static parking page (by id)', () => {
  function pageConfig() {
    return {
      sslVerify: true,
      aiAssistAutomation: { webhookUrl: 'https://x.atlassian.net/h', parkingPageId: '781058099' },
      confluence: { baseUrl: 'https://x.atlassian.net/wiki', email: 'e', apiToken: 't' },
    };
  }

  it('reads by page id, returns ready when the body carries this correlationId, and strips the marker', async () => {
    const calls = [];
    const confluence = (method, path) => {
      calls.push({ method, path });
      return Promise.resolve({ body: { storage: { value: '<p>correlationId: abc</p><p>SHORT_DESCRIPTION: Deploy v2</p>' } } });
    };
    const result = await fetchResult(pageConfig(), 'abc', { makeConfluenceApiRequest: confluence });
    expect(result).toMatchObject({ ok: true, ready: true });
    expect(result.response).toBe('SHORT_DESCRIPTION: Deploy v2'); // correlationId marker line removed
    expect(calls[0].path).toContain('/content/781058099'); // direct by-id fetch, no search
  });

  it('returns not-ready when the page holds a different (stale) correlationId', async () => {
    const confluence = () => Promise.resolve({ body: { storage: { value: '<p>correlationId: OLD-ID</p><p>SHORT_DESCRIPTION: stale</p>' } } });
    expect(await fetchResult(pageConfig(), 'abc', { makeConfluenceApiRequest: confluence })).toMatchObject({ ok: true, ready: false });
  });

  it('maps a fetch-by-id error to 502', async () => {
    const confluence = () => Promise.reject(new Error('404 not found'));
    expect(await fetchResult(pageConfig(), 'abc', { makeConfluenceApiRequest: confluence })).toMatchObject({ ok: false, httpStatus: 502, code: 'fetch-failed' });
  });

  it('reads the REAL makeConfluenceApiRequest envelope { status, body: <json> } by id', async () => {
    // Regression: the shared HTTP helper wraps the response, so the page content is at
    // response.body.body.storage.value — one level deeper than a naive read. This mock
    // mirrors the real shape exactly (status + nested body) so the parsing can't regress.
    const confluence = () => Promise.resolve({
      status: 200,
      body: { id: '283772406', title: 'Release Testing', body: { storage: { value: '<p>correlationId: abc</p><p>SHORT_DESCRIPTION: Live result</p>' } } },
    });
    const result = await fetchResult(pageConfig(), 'abc', { makeConfluenceApiRequest: confluence });
    expect(result).toMatchObject({ ok: true, ready: true });
    expect(result.response).toBe('SHORT_DESCRIPTION: Live result');
  });

  it('falls back to the rendered view body when storage is empty (modern ADF editor)', async () => {
    // Confluence returns an empty body.storage for new-editor pages; the text is in body.view.
    const confluence = () => Promise.resolve({
      body: {
        storage: { value: '' },
        view: { value: '<p>correlationId:&nbsp;<code>abc</code></p><p>SHORT_DESCRIPTION: Restore prod data</p>' },
      },
    });
    const result = await fetchResult(pageConfig(), 'abc', { makeConfluenceApiRequest: confluence });
    expect(result).toMatchObject({ ok: true, ready: true });
    expect(result.response).toBe('SHORT_DESCRIPTION: Restore prod data');
  });
});

describe('extractStaticResult', () => {
  it('returns null when the correlationId is absent', () => {
    expect(extractStaticResult('SHORT_DESCRIPTION: x', 'abc')).toBeNull();
  });
  it('strips the correlationId marker line and returns the rest', () => {
    expect(extractStaticResult('correlationId: abc\nSHORT_DESCRIPTION: x\nDESCRIPTION: y', 'abc')).toBe('SHORT_DESCRIPTION: x\nDESCRIPTION: y');
  });
  it('returns ONLY this request\'s block when the page appends multiple runs', () => {
    // The "Append content" rule grows the page; an older run must not leak into the new result.
    const accumulated = [
      'correlationId: OLD-1', 'SHORT_DESCRIPTION: stale one',
      'correlationId: abc', 'SHORT_DESCRIPTION: the fresh one', 'DESCRIPTION: mine',
    ].join('\n');
    expect(extractStaticResult(accumulated, 'abc')).toBe('SHORT_DESCRIPTION: the fresh one\nDESCRIPTION: mine');
    expect(extractStaticResult(accumulated, 'OLD-1')).toBe('SHORT_DESCRIPTION: stale one');
  });
});

describe('listCorrelationMarkers', () => {
  it('returns an empty array when no marker is present (wrong-page diagnosis)', () => {
    expect(listCorrelationMarkers('SHORT_DESCRIPTION: x\nDESCRIPTION: y')).toEqual([]);
  });
  it('returns every marker id stamped on the page', () => {
    expect(listCorrelationMarkers('correlationId: id-1\nSHORT_DESCRIPTION: a\ncorrelationId: id-2\nSHORT_DESCRIPTION: b')).toEqual(['id-1', 'id-2']);
  });
});

describe('stripStorageHtml', () => {
  it('strips tags, converts breaks to newlines, and decodes entities', () => {
    expect(stripStorageHtml('<p>A: 1</p><p>B: x &amp; y</p>')).toBe('A: 1\nB: x & y');
  });
});
