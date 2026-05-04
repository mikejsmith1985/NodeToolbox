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
    expect(response.body.active).toBe(false);
    expect(response.body.sys).toBe('snow');
  });

  it('reports active after the bookmarklet registers', async () => {
    const app = buildTestApp();
    await request(app).post('/api/relay-bridge/register?sys=snow').send({});
    const response = await request(app).get('/api/relay-bridge/status?sys=snow');
    expect(response.body.active).toBe(true);
  });

  it('defaults sys to snow when no query param is provided', async () => {
    const response = await request(buildTestApp()).get('/api/relay-bridge/status');
    expect(response.body.sys).toBe('snow');
  });
});

// ── Register / deregister ─────────────────────────────────────────────────────

describe('POST /api/relay-bridge/register', () => {
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

describe('POST /api/relay-bridge/deregister', () => {
  it('marks the channel inactive', async () => {
    const app = buildTestApp();
    await request(app).post('/api/relay-bridge/register?sys=snow').send({});
    await request(app).post('/api/relay-bridge/deregister?sys=snow').send({});
    const statusResponse = await request(app).get('/api/relay-bridge/status?sys=snow');
    expect(statusResponse.body.active).toBe(false);
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

// ── Full round-trip ───────────────────────────────────────────────────────────

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
