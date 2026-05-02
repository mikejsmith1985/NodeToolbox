// test/integration/proxy.test.js — Integration tests for the proxy routes.
// Tests that /jira-proxy/*, /snow-proxy/*, and /github-proxy/* correctly forward
// requests and inject authorization headers. Uses nock to intercept outbound HTTP.

'use strict';

const request  = require('supertest');
const nock     = require('nock');
const express  = require('express');
const { applyCorsHeaders } = require('../../src/middleware/cors');
const createProxyRouter    = require('../../src/routes/proxy');

// ── Test App Factory ──────────────────────────────────────────────────────────

/**
 * Builds a minimal Express app with the proxy router mounted.
 * @param {object} configuration - Proxy configuration to inject
 * @returns {import('express').Application}
 */
function buildTestApp(configuration) {
  const testApp = express();
  testApp.use(applyCorsHeaders);
  testApp.use(createProxyRouter(configuration));
  return testApp;
}

// ── Jira Proxy Tests ──────────────────────────────────────────────────────────

describe('GET /jira-proxy/*', () => {
  afterEach(() => nock.cleanAll());

  it('proxies the request to the configured Jira base URL', async () => {
    const configuration = {
      jira:   { baseUrl: 'https://jira.example.com', pat: 'test-pat' },
      snow:   { baseUrl: '' },
      github: { baseUrl: 'https://api.github.com', pat: '' },
      sslVerify: true,
    };

    nock('https://jira.example.com')
      .get('/rest/api/2/myself')
      .reply(200, { displayName: 'Test User' });

    const response = await request(buildTestApp(configuration))
      .get('/jira-proxy/rest/api/2/myself');

    expect(response.status).toBe(200);
    expect(response.body.displayName).toBe('Test User');
  });

  it('injects Bearer auth header when a Jira PAT is configured', async () => {
    const configuration = {
      jira:   { baseUrl: 'https://jira.example.com', pat: 'my-jira-pat', username: '', apiToken: '' },
      snow:   { baseUrl: '' },
      github: { baseUrl: 'https://api.github.com', pat: '' },
      sslVerify: true,
    };

    nock('https://jira.example.com', {
      reqheaders: { authorization: 'Bearer my-jira-pat' },
    })
      .get('/rest/api/2/myself')
      .reply(200, { ok: true });

    const response = await request(buildTestApp(configuration))
      .get('/jira-proxy/rest/api/2/myself');

    expect(response.status).toBe(200);
  });

  it('returns 502 when Jira base URL is not configured', async () => {
    const configuration = {
      jira:   { baseUrl: '', pat: '' },
      snow:   { baseUrl: '' },
      github: { baseUrl: 'https://api.github.com', pat: '' },
      sslVerify: true,
    };

    const response = await request(buildTestApp(configuration))
      .get('/jira-proxy/rest/api/2/myself');

    expect(response.status).toBe(502);
  });

  it('includes CORS headers on the response', async () => {
    const configuration = {
      jira:   { baseUrl: 'https://jira.example.com', pat: 'pat' },
      snow:   { baseUrl: '' },
      github: { baseUrl: 'https://api.github.com', pat: '' },
      sslVerify: true,
    };

    nock('https://jira.example.com').get('/rest/api/2/myself').reply(200, {});

    const response = await request(buildTestApp(configuration))
      .get('/jira-proxy/rest/api/2/myself');

    expect(response.headers['access-control-allow-origin']).toBe('*');
  });
});

// ── GitHub Proxy Tests ────────────────────────────────────────────────────────

describe('GET /github-proxy/*', () => {
  afterEach(() => nock.cleanAll());

  it('proxies the request to the GitHub API with Bearer token', async () => {
    const configuration = {
      jira:   { baseUrl: '', pat: '' },
      snow:   { baseUrl: '' },
      github: { baseUrl: 'https://api.github.com', pat: 'ghp_test_token' },
      sslVerify: true,
    };

    nock('https://api.github.com', {
      reqheaders: { authorization: 'Bearer ghp_test_token' },
    })
      .get('/user')
      .reply(200, { login: 'testuser' });

    const response = await request(buildTestApp(configuration))
      .get('/github-proxy/user');

    expect(response.status).toBe(200);
    expect(response.body.login).toBe('testuser');
  });

  it('returns 502 with helpful message when GitHub PAT is not configured', async () => {
    const configuration = {
      jira:   { baseUrl: '', pat: '' },
      snow:   { baseUrl: '' },
      github: { baseUrl: 'https://api.github.com', pat: '' },
      sslVerify: true,
    };

    const response = await request(buildTestApp(configuration))
      .get('/github-proxy/user');

    expect(response.status).toBe(502);
    expect(response.body.error).toMatch(/PAT/i);
  });
});

// ── Query String Forwarding Tests ────────────────────────────────────────────

describe('Query string forwarding', () => {
  afterEach(() => nock.cleanAll());

  it('forwards query string parameters to the Jira API', async () => {
    const configuration = {
      jira:   { baseUrl: 'https://jira.example.com', pat: 'test-pat' },
      snow:   { baseUrl: '' },
      github: { baseUrl: 'https://api.github.com', pat: '' },
      sslVerify: true,
    };

    nock('https://jira.example.com')
      .get('/rest/agile/1.0/board')
      .query({ name: 'My Board', maxResults: '50' })
      .reply(200, { values: [{ id: 1, name: 'My Board' }] });

    const response = await request(buildTestApp(configuration))
      .get('/jira-proxy/rest/agile/1.0/board?name=My%20Board&maxResults=50');

    expect(response.status).toBe(200);
    expect(response.body.values[0].name).toBe('My Board');
  });

  it('forwards query string parameters to the ServiceNow API', async () => {
    const configuration = {
      jira:   { baseUrl: '', pat: '' },
      snow:   { baseUrl: 'https://snow.example.com', username: 'user', password: 'pass' },
      github: { baseUrl: 'https://api.github.com', pat: '' },
      sslVerify: true,
    };

    nock('https://snow.example.com')
      .get('/api/now/table/incident')
      .query({ sysparm_limit: '10', sysparm_query: 'state=1' })
      .reply(200, { result: [] });

    const response = await request(buildTestApp(configuration))
      .get('/snow-proxy/api/now/table/incident?sysparm_limit=10&sysparm_query=state%3D1');

    expect(response.status).toBe(200);
  });

  it('forwards query string parameters to the GitHub API', async () => {
    const configuration = {
      jira:   { baseUrl: '', pat: '' },
      snow:   { baseUrl: '' },
      github: { baseUrl: 'https://api.github.com', pat: 'ghp_test' },
      sslVerify: true,
    };

    nock('https://api.github.com')
      .get('/repos/myorg/myrepo/commits')
      .query({ sha: 'main', per_page: '20' })
      .reply(200, [{ sha: 'abc123' }]);

    const response = await request(buildTestApp(configuration))
      .get('/github-proxy/repos/myorg/myrepo/commits?sha=main&per_page=20');

    expect(response.status).toBe(200);
    expect(response.body[0].sha).toBe('abc123');
  });
});

// ── CORS Preflight Tests ──────────────────────────────────────────────────────

describe('OPTIONS preflight', () => {
  it('responds 204 with CORS headers for preflight requests', async () => {
    const configuration = {
      jira:   { baseUrl: '', pat: '' },
      snow:   { baseUrl: '' },
      github: { baseUrl: 'https://api.github.com', pat: '' },
      sslVerify: true,
    };

    const response = await request(buildTestApp(configuration))
      .options('/jira-proxy/rest/api/2/myself');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers['access-control-allow-methods']).toBeDefined();
  });
});
