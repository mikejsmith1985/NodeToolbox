// test/integration/proxyJiraRelay.test.js — Jira calls ride the browser relay when a Jira tab is relaying.
//
// After a Jira re-instance migration the server's stored Jira token belongs to the OLD instance, so every
// /jira-proxy call came back 401. With the relay bookmark clicked in a signed-in Jira tab, the proxy now sends
// each call through that tab instead, using the person's own Jira session — no token to create or paste.

'use strict';

const request  = require('supertest');
const nock     = require('nock');
const express  = require('express');
const createProxyRouter = require('../../src/routes/proxy');
const relayBridgeRouter = require('../../src/routes/relayBridge');

const CONFIGURATION = {
  jira:   { baseUrl: 'https://jira.example.com', pat: 'stale-old-instance-pat', username: '', apiToken: '' },
  snow:   { baseUrl: '' },
  github: { baseUrl: 'https://api.github.com', pat: '' },
  confluence: { baseUrl: '' },
  sslVerify: true,
};

function buildTestApp() {
  const testApp = express();
  testApp.use(express.json());
  testApp.use(createProxyRouter(CONFIGURATION));
  testApp.use('/api/relay-bridge', relayBridgeRouter);
  return testApp;
}

async function bringJiraRelayOnline(app) {
  await request(app).post('/api/relay-bridge/register?sys=jira').send({});
  await request(app).post('/api/relay-bridge/request').send({ sys: 'jira', id: 'prime-ready', method: 'GET', path: '/x' });
  await request(app).get('/api/relay-bridge/poll?sys=jira');
}

/** Plays the Jira tab: takes the next queued request and answers it with the given result. */
async function answerNextRelayRequest(app, relayResult) {
  const pollResponse = await request(app).get('/api/relay-bridge/poll?sys=jira');
  const relayedRequest = pollResponse.body.request;
  await request(app).post('/api/relay-bridge/result').send({ id: relayedRequest.id, sys: 'jira', ...relayResult });
  return relayedRequest;
}

beforeEach(() => relayBridgeRouter._resetBridgeStateForTests());
afterEach(() => nock.cleanAll());

describe('/jira-proxy/* through the Jira relay', () => {
  it('sends a read through the relaying Jira tab and returns its JSON', async () => {
    const app = buildTestApp();
    await bringJiraRelayOnline(app);

    const proxyPromise = request(app).get('/jira-proxy/rest/api/2/field?expand=x').then((proxyResponse) => proxyResponse); // .then() sends it now
    const relayedRequest = await answerNextRelayRequest(app, { ok: true, status: 200, data: '[{"id":"summary"}]' });
    const response = await proxyPromise;

    expect(relayedRequest).toMatchObject({ method: 'GET', path: '/rest/api/2/field?expand=x', body: null });
    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 'summary' }]);
  });

  it('passes Jira\'s own error status and body through unchanged', async () => {
    const app = buildTestApp();
    await bringJiraRelayOnline(app);

    const proxyPromise = request(app).get('/jira-proxy/rest/api/2/search?jql=bad').then((proxyResponse) => proxyResponse); // .then() sends it now
    await answerNextRelayRequest(app, { ok: false, status: 400, data: '{"errorMessages":["bad jql"]}' });
    const response = await proxyPromise;

    expect(response.status).toBe(400);
    expect(response.body.errorMessages).toEqual(['bad jql']);
  });

  it('forwards a JSON write body to the Jira tab', async () => {
    const app = buildTestApp();
    await bringJiraRelayOnline(app);

    const proxyPromise = request(app).post('/jira-proxy/rest/api/2/filter').send({ name: 'Enrollment Kit — All Work' }).then((proxyResponse) => proxyResponse); // .then() sends it now
    const relayedRequest = await answerNextRelayRequest(app, { ok: true, status: 200, data: '{"id":"10001"}' });
    const response = await proxyPromise;

    expect(relayedRequest).toMatchObject({ method: 'POST', body: { name: 'Enrollment Kit — All Work' } });
    expect(response.body.id).toBe('10001');
  });

  it('reports a 502 that names the relay when the Jira tab could not reach Jira', async () => {
    const app = buildTestApp();
    await bringJiraRelayOnline(app);

    const proxyPromise = request(app).get('/jira-proxy/rest/api/2/myself').then((proxyResponse) => proxyResponse); // .then() sends it now
    await answerNextRelayRequest(app, { ok: false, status: 0, data: null, error: 'Failed to fetch' });
    const response = await proxyPromise;

    expect(response.status).toBe(502);
    expect(response.body.message).toMatch(/Jira relay.*Failed to fetch/);
  });

  it('uses the stored token, exactly as before, when no Jira tab is relaying', async () => {
    nock('https://jira.example.com', { reqheaders: { authorization: 'Bearer stale-old-instance-pat' } })
      .get('/rest/api/2/myself')
      .reply(200, { name: 'direct' });

    const response = await request(buildTestApp()).get('/jira-proxy/rest/api/2/myself');

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('direct');
  });

  it('refuses to fall back to a DIFFERENT Jira than the one the relay was last on', async () => {
    // After a migration the stored URL and token point at the OLD instance. Quietly answering from there when
    // the relay drops would show old data as if it were current — and send writes to the wrong Jira.
    const app = buildTestApp();
    await request(app).post('/api/relay-bridge/register?sys=jira&origin=' + encodeURIComponent('https://jira.new.example.com')).send({});
    await request(app).post('/api/relay-bridge/deregister?sys=jira').send({});
    const oldInstance = nock('https://jira.example.com').get('/rest/api/2/myself').reply(200, { name: 'old' });

    const response = await request(app).get('/jira-proxy/rest/api/2/myself');

    expect(response.status).toBe(503);
    expect(response.body.message).toMatch(/jira\.new\.example\.com/);
    expect(response.body.message).toMatch(/jira\.example\.com/);
    expect(oldInstance.isDone()).toBe(false);
  });

  it('still falls back to the stored token when the relay was on the same Jira', async () => {
    const app = buildTestApp();
    await request(app).post('/api/relay-bridge/register?sys=jira&origin=' + encodeURIComponent('https://jira.example.com')).send({});
    await request(app).post('/api/relay-bridge/deregister?sys=jira').send({});
    nock('https://jira.example.com').get('/rest/api/2/myself').reply(200, { name: 'direct' });

    const response = await request(app).get('/jira-proxy/rest/api/2/myself');

    expect(response.status).toBe(200);
  });
});
