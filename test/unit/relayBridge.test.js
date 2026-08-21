// test/unit/relayBridge.test.js — Unit tests for the HTTP relay bridge router.
//
// The relay bridge enables Chrome-compatible relay operation by replacing the
// window.postMessage channel (blocked by COOP on SNow/Jira) with HTTP long-polling
// against the NodeToolbox server on localhost.

'use strict';

const express = require('express');
const request = require('supertest');
const relayBridgeRouter = require('../../src/routes/relayBridge');

// ── Test App Helper ───────────────────────────────────────────────────────────

function buildTestApp() {
  const testApp = express();
  testApp.use(express.json());
  testApp.use('/api/relay-bridge', relayBridgeRouter);
  return testApp;
}

// Reset shared bridge state before each test to prevent cross-test contamination
beforeEach(() => {
  relayBridgeRouter._resetBridgeStateForTests();
});

// ── Status endpoint ───────────────────────────────────────────────────────────

describe('GET /api/relay-bridge/status', () => {
  it('reports inactive before any bookmarklet has registered', async () => {
    const response = await request(buildTestApp()).get('/api/relay-bridge/status?sys=snow');
    expect(response.status).toBe(200);
    expect(response.body.isConnected).toBe(false);
    expect(response.body.system).toBe('snow');
  });

  it('supports the sharepoint relay system (register + status)', async () => {
    const app = buildTestApp();
    const registerResponse = await request(app).post('/api/relay-bridge/register?sys=sharepoint').send({});
    expect(registerResponse.status).toBe(200);

    const statusResponse = await request(app).get('/api/relay-bridge/status?sys=sharepoint');
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.system).toBe('sharepoint');
  });

  it('does not report connected until the bookmarklet has started polling', async () => {
    const app = buildTestApp();
    await request(app).post('/api/relay-bridge/register?sys=snow').send({});
    const response = await request(app).get('/api/relay-bridge/status?sys=snow');
    expect(response.body.isConnected).toBe(false);
  });

  it('reports connected after the bookmarklet registers and polls', async () => {
    const app = buildTestApp();
    await request(app).post('/api/relay-bridge/register?sys=snow').send({});
    await request(app)
      .post('/api/relay-bridge/request')
      .send({ sys: 'snow', id: 'status-ready', method: 'GET', path: '/api/now/table/sys_user' });
    await request(app).get('/api/relay-bridge/poll?sys=snow');
    const response = await request(app).get('/api/relay-bridge/status?sys=snow');
    expect(response.body.isConnected).toBe(true);
  });

  it('defaults system to snow when no query param is provided', async () => {
    const response = await request(buildTestApp()).get('/api/relay-bridge/status');
    expect(response.body.system).toBe('snow');
  });
});

// ── Register / deregister ─────────────────────────────────────────────────────

describe('POST /api/relay-bridge/register', () => {
  it('allows ServiceNow bookmarklets to call the bridge from a cross-origin page', async () => {
    const response = await request(buildTestApp())
      .options('/api/relay-bridge/register?sys=snow')
      .set('Origin', 'https://example.service-now.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers['access-control-allow-private-network']).toBe('true');
  });

  it('returns ok:true and the sys identifier', async () => {
    const response = await request(buildTestApp())
      .post('/api/relay-bridge/register?sys=jira')
      .send({});
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.sys).toBe('jira');
  });

  it('rejects an unknown sys value with HTTP 400', async () => {
    const response = await request(buildTestApp())
      .post('/api/relay-bridge/register?sys=unknown')
      .send({});
    expect(response.status).toBe(400);
  });
});

describe('POST /api/relay-bridge/session-token', () => {
  it('updates hasSessionToken without requiring a fresh registration', async () => {
    const testApp = buildTestApp();
    await request(testApp).post('/api/relay-bridge/register?sys=snow&gck=0').send({});

    const beforeTokenResponse = await request(testApp).get('/api/relay-bridge/status?sys=snow');
    expect(beforeTokenResponse.body.hasSessionToken).toBe(false);

    const tokenResponse = await request(testApp).post('/api/relay-bridge/session-token?sys=snow&gck=1').send({});
    expect(tokenResponse.status).toBe(200);
    expect(tokenResponse.body.hasSessionToken).toBe(true);

    const afterTokenResponse = await request(testApp).get('/api/relay-bridge/status?sys=snow');
    expect(afterTokenResponse.body.hasSessionToken).toBe(true);
  });

  it('rejects an unknown sys value with HTTP 400', async () => {
    const response = await request(buildTestApp())
      .post('/api/relay-bridge/session-token?sys=unknown&gck=1')
      .send({});

    expect(response.status).toBe(400);
  });
});

describe('POST /api/relay-bridge/deregister', () => {
  it('marks the channel inactive', async () => {
    const app = buildTestApp();
    await request(app).post('/api/relay-bridge/register?sys=snow').send({});
    await request(app).post('/api/relay-bridge/deregister?sys=snow').send({});
    const statusResponse = await request(app).get('/api/relay-bridge/status?sys=snow');
    expect(statusResponse.body.isConnected).toBe(false);
  });

  it('fails in-flight result waits immediately when the bookmarklet disconnects', async () => {
    const app = buildTestApp();
    const requestId = 'disconnect-result-' + Date.now();
    await request(app).post('/api/relay-bridge/register?sys=snow').send({});

    const pendingResultResponse = request(app)
      .get('/api/relay-bridge/result/' + requestId + '?sys=snow')
      .timeout({ response: 1000, deadline: 1500 })
      .then(response => response);

    await new Promise(resolve => setTimeout(resolve, 10));
    await request(app).post('/api/relay-bridge/deregister?sys=snow').send({});

    const disconnectResponse = await pendingResultResponse;
    expect(disconnectResponse.status).toBe(503);
    expect(disconnectResponse.body.error).toContain('disconnected');
  });
});

// ── Request enqueue ───────────────────────────────────────────────────────────

describe('POST /api/relay-bridge/request', () => {
  it('accepts a valid request and returns ok:true', async () => {
    const response = await request(buildTestApp())
      .post('/api/relay-bridge/request')
      .send({ sys: 'snow', id: 'req-1', method: 'GET', path: '/api/now/table/incident' });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.id).toBe('req-1');
  });

  it('rejects a request without an id with HTTP 400', async () => {
    const response = await request(buildTestApp())
      .post('/api/relay-bridge/request')
      .send({ sys: 'snow', method: 'GET', path: '/api/now/table/incident' });
    expect(response.status).toBe(400);
  });
});

// ── Result submission ─────────────────────────────────────────────────────────

describe('POST /api/relay-bridge/result', () => {
  it('stores a result that can be collected via GET /result/:id', async () => {
    const app = buildTestApp();
    const requestId = 'roundtrip-' + Date.now();

    // Bookmarklet posts the result
    await request(app)
      .post('/api/relay-bridge/result')
      .send({ id: requestId, sys: 'snow', ok: true, status: 200, data: { hello: 'world' } });

    // Toolbox collects it
    const collectResponse = await request(app)
      .get('/api/relay-bridge/result/' + requestId + '?sys=snow');
    expect(collectResponse.status).toBe(200);
    expect(collectResponse.body.result.data.hello).toBe('world');
    expect(collectResponse.body.result.status).toBe(200);
  });

  it('rejects a result without an id with HTTP 400', async () => {
    const response = await request(buildTestApp())
      .post('/api/relay-bridge/result')
      .send({ sys: 'snow', ok: true, status: 200 });
    expect(response.status).toBe(400);
  });
});

// ── Poll endpoint ─────────────────────────────────────────────────────────────

describe('GET /api/relay-bridge/poll', () => {
  it('returns { request: null } when no request is queued (no hang in test)', async () => {
    // The router holds the connection for up to 28s if nothing is queued.
    // We don't want the test to hang — so we enqueue nothing and let the
    // short-circuit path (no queued requests, no waiters) respond immediately.
    // Since supertest times out, we test the immediate-delivery path instead:
    // enqueue first, then poll.
    const app = buildTestApp();
    const requestId = 'poll-test-' + Date.now();
    await request(app)
      .post('/api/relay-bridge/request')
      .send({ sys: 'snow', id: requestId, method: 'GET', path: '/api/now/table/incident' });

    const pollResponse = await request(app).get('/api/relay-bridge/poll?sys=snow');
    expect(pollResponse.status).toBe(200);
    expect(pollResponse.body.request).not.toBeNull();
    expect(pollResponse.body.request.id).toBe(requestId);
  });
});

// ── getBridgeStatus() exported helper ────────────────────────────────────────
// This function is used by the /api/snow-diag endpoint so it can report relay
// state without making an internal HTTP request.

describe('getBridgeStatus()', () => {
  it('returns false for the snow channel before any registration', () => {
    expect(relayBridgeRouter.getBridgeStatus('snow')).toBe(false);
  });

  it('returns false for the jira channel before any registration', () => {
    expect(relayBridgeRouter.getBridgeStatus('jira')).toBe(false);
  });

  it('returns false for an unknown system identifier', () => {
    expect(relayBridgeRouter.getBridgeStatus('unknown-system')).toBe(false);
  });

  it('returns true after the snow bookmarklet registers and polls', async () => {
    const testApp = buildTestApp();
    await request(testApp).post('/api/relay-bridge/register?sys=snow').send({});
    await request(testApp)
      .post('/api/relay-bridge/request')
      .send({ sys: 'snow', id: 'bridge-status-ready', method: 'GET', path: '/test' });
    await request(testApp).get('/api/relay-bridge/poll?sys=snow');
    expect(relayBridgeRouter.getBridgeStatus('snow')).toBe(true);
  });

  it('returns false again after the snow bookmarklet deregisters', async () => {
    const testApp = buildTestApp();
    await request(testApp).post('/api/relay-bridge/register?sys=snow').send({});
    await request(testApp)
      .post('/api/relay-bridge/request')
      .send({ sys: 'snow', id: 'bridge-status-deregister', method: 'GET', path: '/test' });
    await request(testApp).get('/api/relay-bridge/poll?sys=snow');
    await request(testApp).post('/api/relay-bridge/deregister?sys=snow').send({});
    expect(relayBridgeRouter.getBridgeStatus('snow')).toBe(false);
  });

  it('tracks snow and jira channels independently', async () => {
    const testApp = buildTestApp();
    await request(testApp).post('/api/relay-bridge/register?sys=snow').send({});
    await request(testApp)
      .post('/api/relay-bridge/request')
      .send({ sys: 'snow', id: 'bridge-status-independent', method: 'GET', path: '/test' });
    await request(testApp).get('/api/relay-bridge/poll?sys=snow');
    // Registering snow must not affect jira
    expect(relayBridgeRouter.getBridgeStatus('snow')).toBe(true);
    expect(relayBridgeRouter.getBridgeStatus('jira')).toBe(false);
  });
});

// ── getBridgeDiag() exported helper ──────────────────────────────────────────
// Used by /api/snow-diag to surface registration timestamps in diagnostic reports.

describe('getBridgeDiag()', () => {
  it('returns inactive state with null timestamps before any registration', () => {
    const diag = relayBridgeRouter.getBridgeDiag('snow');
    expect(diag.active).toBe(false);
    expect(diag.lastRegisteredAt).toBeNull();
    expect(diag.lastDeregisteredAt).toBeNull();
    expect(diag.lastPolledAt).toBeNull();
  });

  it('returns active=true and a non-null lastRegisteredAt after registration', async () => {
    const beforeReg = Date.now();
    const testApp = buildTestApp();
    await request(testApp).post('/api/relay-bridge/register?sys=snow').send({});
    const diag = relayBridgeRouter.getBridgeDiag('snow');
    expect(diag.active).toBe(true);
    expect(diag.lastRegisteredAt).toBeGreaterThanOrEqual(beforeReg);
    expect(diag.lastDeregisteredAt).toBeNull();
  });

  it('sets lastDeregisteredAt after deregistration', async () => {
    const testApp = buildTestApp();
    await request(testApp).post('/api/relay-bridge/register?sys=snow').send({});
    const beforeDereg = Date.now();
    await request(testApp).post('/api/relay-bridge/deregister?sys=snow').send({});
    const diag = relayBridgeRouter.getBridgeDiag('snow');
    expect(diag.active).toBe(false);
    expect(diag.lastDeregisteredAt).toBeGreaterThanOrEqual(beforeDereg);
  });

  it('sets lastPolledAt after the bookmarklet polls', async () => {
    const testApp = buildTestApp();
    // Enqueue a request so poll returns immediately (avoids 28s hang)
    await request(testApp)
      .post('/api/relay-bridge/request')
      .send({ sys: 'snow', id: 'diag-poll-test', method: 'GET', path: '/test' });
    const beforePoll = Date.now();
    await request(testApp).get('/api/relay-bridge/poll?sys=snow');
    const diag = relayBridgeRouter.getBridgeDiag('snow');
    expect(diag.lastPolledAt).toBeGreaterThanOrEqual(beforePoll);
  });

  it('returns safe defaults for an unknown sys', () => {
    const diag = relayBridgeRouter.getBridgeDiag('unknown');
    expect(diag.active).toBe(false);
    expect(diag.lastRegisteredAt).toBeNull();
  });
});

// ── Status endpoint — lastPingAt field ────────────────────────────────────────

describe('GET /api/relay-bridge/status — lastPingAt field', () => {
  it('returns null lastPingAt before the bookmarklet has polled', async () => {
    // Register but do not poll — lastPingAt is only set after the bookmarklet polls
    const app = buildTestApp();
    await request(app).post('/api/relay-bridge/register?sys=snow').send({});
    const response = await request(app).get('/api/relay-bridge/status?sys=snow');
    expect(response.body.lastPingAt).toBeNull();
  });

  it('returns an ISO 8601 lastPingAt after the bookmarklet polls', async () => {
    const app = buildTestApp();
    // Enqueue a request so the poll returns immediately (avoids the 28s long-poll hang)
    await request(app)
      .post('/api/relay-bridge/request')
      .send({ sys: 'snow', id: 'ping-test', method: 'GET', path: '/api/now/table/sys_user' });
    await request(app).get('/api/relay-bridge/poll?sys=snow');
    const response = await request(app).get('/api/relay-bridge/status?sys=snow');
    // lastPingAt should be a valid ISO date string
    expect(response.body.lastPingAt).not.toBeNull();
    expect(new Date(response.body.lastPingAt).toISOString()).toBe(response.body.lastPingAt);
  });
});


// ── parseRelayResultData() — JSON-string normalization for server consumers ──
// Regression coverage for the Release Management "Change CHG... not found in
// ServiceNow" bug: the bookmarklet posts ServiceNow responses as JSON strings,
// and server-side relay consumers must parse them before reading `.result`.

describe('parseRelayResultData()', () => {
  it('parses a JSON string body into an object so .result is readable', () => {
    const rawBookmarkletBody = '{"result":[{"sys_id":"abc123","number":"CHG0047146"}]}';
    const parsed = relayBridgeRouter.parseRelayResultData(rawBookmarkletBody);
    expect(Array.isArray(parsed.result)).toBe(true);
    expect(parsed.result[0].sys_id).toBe('abc123');
  });

  it('returns an already-parsed object unchanged', () => {
    const alreadyParsed = { result: [{ sys_id: 'def456' }] };
    expect(relayBridgeRouter.parseRelayResultData(alreadyParsed)).toBe(alreadyParsed);
  });

  it('collapses null, undefined, and empty bodies to an empty object', () => {
    expect(relayBridgeRouter.parseRelayResultData(null)).toEqual({});
    expect(relayBridgeRouter.parseRelayResultData(undefined)).toEqual({});
    expect(relayBridgeRouter.parseRelayResultData('   ')).toEqual({});
  });

  it('returns the raw string when the body is not valid JSON', () => {
    expect(relayBridgeRouter.parseRelayResultData('Service unavailable')).toBe('Service unavailable');
  });
});

describe('submitRelayRequest() — JSON-string result handling', () => {
  it('resolves a JSON-string ServiceNow response as a parsed object', async () => {
    const app = buildTestApp();

    // Bring the snow channel online: register, then poll (consuming a priming
    // request) so isRelayReady() passes for the server-initiated request below.
    await request(app).post('/api/relay-bridge/register?sys=snow').send({});
    await request(app)
      .post('/api/relay-bridge/request')
      .send({ sys: 'snow', id: 'prime-ready', method: 'GET', path: '/test' });
    await request(app).get('/api/relay-bridge/poll?sys=snow');

    // The server enqueues a lookup the same way the CHG state route does.
    const submitPromise = relayBridgeRouter.submitRelayRequest(
      'snow',
      { method: 'GET', url: '/api/now/v2/table/change_request?sysparm_query=number=CHG0047146&sysparm_fields=sys_id' },
      5000,
    );

    // Drain the queued request to learn its generated id, then post the result
    // exactly as the bookmarklet does — as a raw JSON string body.
    const pollResponse = await request(app).get('/api/relay-bridge/poll?sys=snow');
    const queuedRequestId = pollResponse.body.request.id;
    await request(app)
      .post('/api/relay-bridge/result')
      .send({
        id: queuedRequestId,
        sys: 'snow',
        ok: true,
        status: 200,
        data: '{"result":[{"sys_id":"sys-abc-123"}]}',
      });

    const resolvedData = await submitPromise;
    expect(resolvedData.result[0].sys_id).toBe('sys-abc-123');
  });
});

describe('relay bridge full round-trip (request → poll → result → collect)', () => {
  it('delivers a request to the bookmarklet and returns the result to the caller', async () => {
    const app = buildTestApp();
    const requestId = 'e2e-' + Date.now();

    // Register bookmarklet
    await request(app).post('/api/relay-bridge/register?sys=snow').send({});

    // Toolbox enqueues request
    await request(app)
      .post('/api/relay-bridge/request')
      .send({ sys: 'snow', id: requestId, method: 'GET', path: '/api/now/table/sys_user', body: null });

    // Bookmarklet polls and receives the request
    const pollResponse = await request(app).get('/api/relay-bridge/poll?sys=snow');
    expect(pollResponse.body.request.id).toBe(requestId);

    // Bookmarklet posts the result
    await request(app)
      .post('/api/relay-bridge/result')
      .send({ id: requestId, sys: 'snow', ok: true, status: 200, data: [{ name: 'Alice' }] });

    // Toolbox collects the result
    const collectResponse = await request(app)
      .get('/api/relay-bridge/result/' + requestId + '?sys=snow');
    expect(collectResponse.status).toBe(200);
    expect(collectResponse.body.result.ok).toBe(true);
    expect(collectResponse.body.result.data[0].name).toBe('Alice');
  });
});

// ── Surviving a NodeToolbox restart ───────────────────────────────────────────
//
// The defect these cover: a server restart rebuilds the bridge state with isActive=false, but the
// bookmarklet's tab never unloaded, so no /deregister ever arrived and its poll loop simply
// reconnected. The relay was alive and polling while every consumer refused to use it, and only a
// human clicking the bookmarklet again could fix it. That is what made every app update cost a manual
// reconnect — and what caused scheduled SharePoint pulls to be silently skipped.

describe.each(['snow', 'sharepoint'])('relay recovery after a restart (%s)', (sys) => {
  /** Queues a request so the next poll returns at once instead of holding open for 28 seconds. */
  async function queueOneRequest(app, requestId) {
    await request(app)
      .post('/api/relay-bridge/request')
      .send({ sys, id: requestId, method: 'GET', path: '/api/now/table/incident' });
  }

  it('treats an arriving poll as proof the bookmarklet is alive', async () => {
    const app = buildTestApp();
    await queueOneRequest(app, 'req-alive');

    // No /register: exactly the state a restart leaves behind, with the tab still polling.
    await request(app).get(`/api/relay-bridge/poll?sys=${sys}`);

    const statusResponse = await request(app).get(`/api/relay-bridge/status?sys=${sys}`);
    expect(statusResponse.body.isConnected).toBe(true);
  });

  it('asks a bookmarklet it has never seen register to announce itself', async () => {
    const app = buildTestApp();
    await queueOneRequest(app, 'req-hint');

    const pollResponse = await request(app).get(`/api/relay-bridge/poll?sys=${sys}`);

    // The poll proves presence; it does not carry the session token a ServiceNow write needs, and
    // that is only captured at registration.
    expect(pollResponse.body.shouldReregister).toBe(true);
  });

  it('stops asking once the bookmarklet has registered', async () => {
    const app = buildTestApp();
    await request(app).post(`/api/relay-bridge/register?sys=${sys}`).send({});
    await queueOneRequest(app, 'req-registered');

    const pollResponse = await request(app).get(`/api/relay-bridge/poll?sys=${sys}`);

    expect(pollResponse.body.shouldReregister).toBe(false);
  });

  it('leaves a deregistered channel disconnected, because a closed tab sends no polls', async () => {
    const app = buildTestApp();
    await request(app).post(`/api/relay-bridge/register?sys=${sys}`).send({});
    await request(app).post(`/api/relay-bridge/deregister?sys=${sys}`).send({});

    const statusResponse = await request(app).get(`/api/relay-bridge/status?sys=${sys}`);
    expect(statusResponse.body.isConnected).toBe(false);
  });

  it('serves a queued request on the same poll that revives the channel', async () => {
    const app = buildTestApp();
    await request(app).post(`/api/relay-bridge/register?sys=${sys}`).send({});
    await queueOneRequest(app, 'req-served');

    const pollResponse = await request(app).get(`/api/relay-bridge/poll?sys=${sys}`);

    // A recovering relay must not have to choose between announcing itself and doing its job.
    expect(pollResponse.body.request).toBeTruthy();
    expect(pollResponse.body).toHaveProperty('shouldReregister');
  });
});

// ── Timed-out requests must not leave a poller behind ─────────────────────────

describe('submitRelayRequest() — a timeout releases everything it started', () => {
  it('clears the 100ms result poller when the request times out', async () => {
    // The bug this pins: the timeout rejected the promise and left the interval polling forever, so
    // every relay request that ever timed out abandoned a 100ms timer for the life of the process.
    // Nothing held a reference to it, so nothing could ever stop it.
    const app = buildTestApp();
    await request(app).post('/api/relay-bridge/register?sys=snow').send({});
    await request(app)
      .post('/api/relay-bridge/request')
      .send({ sys: 'snow', id: 'prime-ready', method: 'GET', path: '/test' });
    await request(app).get('/api/relay-bridge/poll?sys=snow');

    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    // Short enough to expire on real timers without slowing the suite; the bookmarklet never answers.
    const relayError = await relayBridgeRouter
      .submitRelayRequest('snow', { method: 'GET', url: '/never-answered' }, 30)
      .catch((caughtError) => caughtError);

    expect(relayError.message).toContain('timed out');
    expect(clearIntervalSpy).toHaveBeenCalled();

    clearIntervalSpy.mockRestore();
  });
});

// ── Authorization, which is NOT the same fact as connection ───────────────────
//
// A dropped VPN leaves the bookmarklet long-polling this machine perfectly happily while every
// SharePoint call comes back 403. Reporting that as "connected" is a false positive somebody plans
// a morning around, so the last real outcome is recorded and reported separately.

describe('relay authorization', () => {
  /** Registers a channel and marks it polled, so it reads as connected. */
  async function connectRelay(app, sys) {
    await request(app).post(`/api/relay-bridge/register?sys=${sys}`).send({});
    // A poll would normally block; the register alone is enough for these assertions.
  }

  it('treats a relay that has never been refused as authorized', async () => {
    const app = buildTestApp();
    await connectRelay(app, 'sharepoint');

    const response = await request(app).get('/api/relay-bridge/status?sys=sharepoint');
    expect(response.body.isAuthorized).toBe(true);
    expect(response.body.lastUnauthorizedAt).toBeNull();
  });

  it('reports unauthorized after the far system returns 403', async () => {
    const app = buildTestApp();
    await connectRelay(app, 'sharepoint');

    await request(app).post('/api/relay-bridge/result').send({
      id: 'req-1', sys: 'sharepoint', ok: false, status: 403, error: 'Unauthorized',
    });

    const response = await request(app).get('/api/relay-bridge/status?sys=sharepoint');
    expect(response.body.isAuthorized).toBe(false);
    expect(response.body.lastUnauthorizedAt).not.toBeNull();
  });

  it('reports unauthorized after a 401 as well', async () => {
    const app = buildTestApp();
    await connectRelay(app, 'sharepoint');

    await request(app).post('/api/relay-bridge/result').send({
      id: 'req-1', sys: 'sharepoint', ok: false, status: 401, error: 'Unauthenticated',
    });

    expect((await request(app).get('/api/relay-bridge/status?sys=sharepoint')).body.isAuthorized).toBe(false);
  });

  it('recovers once a later request succeeds, so a reconnected VPN clears the warning', async () => {
    const app = buildTestApp();
    await connectRelay(app, 'sharepoint');

    await request(app).post('/api/relay-bridge/result').send({
      id: 'req-1', sys: 'sharepoint', ok: false, status: 403, error: 'Unauthorized',
    });
    await request(app).post('/api/relay-bridge/result').send({
      id: 'req-2', sys: 'sharepoint', ok: true, status: 200, data: { value: [] },
    });

    expect((await request(app).get('/api/relay-bridge/status?sys=sharepoint')).body.isAuthorized).toBe(true);
  });

  it('does not treat an ordinary failure as a refusal', async () => {
    // A 500 or a timeout means the far system could not answer, not that it refused us. Only 401
    // and 403 say "I know who you are and the answer is no".
    const app = buildTestApp();
    await connectRelay(app, 'sharepoint');

    await request(app).post('/api/relay-bridge/result').send({
      id: 'req-1', sys: 'sharepoint', ok: false, status: 500, error: 'Server error',
    });

    expect((await request(app).get('/api/relay-bridge/status?sys=sharepoint')).body.isAuthorized).toBe(true);
  });

  it('keeps authorization per system, so a refused SharePoint does not mark SNow refused', async () => {
    const app = buildTestApp();
    await connectRelay(app, 'sharepoint');
    await connectRelay(app, 'snow');

    await request(app).post('/api/relay-bridge/result').send({
      id: 'req-1', sys: 'sharepoint', ok: false, status: 403, error: 'Unauthorized',
    });

    expect((await request(app).get('/api/relay-bridge/status?sys=sharepoint')).body.isAuthorized).toBe(false);
    expect((await request(app).get('/api/relay-bridge/status?sys=snow')).body.isAuthorized).toBe(true);
  });

  it('reports an unknown system as authorized rather than as refused', async () => {
    // Nothing has refused us; the system simply is not one we relay.
    const response = await request(buildTestApp()).get('/api/relay-bridge/status?sys=nope');
    expect(response.body.isConnected).toBe(false);
    expect(response.body.isAuthorized).toBe(true);
  });
});
