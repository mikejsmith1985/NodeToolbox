// test/integration/api.test.js — Integration tests for the API routes.
// Tests /api/proxy-status, /api/proxy-config, and /api/snow-session endpoints.

'use strict';

const request = require('supertest');
const express = require('express');
const { applyCorsHeaders }  = require('../../src/middleware/cors');
const createApiRouter        = require('../../src/routes/api');
const snowSession            = require('../../src/services/snowSession');

// ── Test App Factory ──────────────────────────────────────────────────────────

/**
 * Builds a minimal Express app with the API router mounted.
 * Uses express.json() so POST bodies are parsed automatically.
 *
 * @param {object} configuration - Proxy configuration to inject
 * @returns {import('express').Application}
 */
function buildTestApp(configuration) {
  const testApp = express();
  testApp.use(express.json());
  testApp.use(applyCorsHeaders);
  testApp.use(createApiRouter(configuration));
  return testApp;
}

// ── /api/proxy-status ─────────────────────────────────────────────────────────

describe('GET /api/proxy-status', () => {
  it('returns proxy:true with service status', async () => {
    const configuration = {
      jira:      { baseUrl: 'https://acme.atlassian.net', pat: 'jira-pat' },
      snow:      { baseUrl: '', username: '', password: '' },
      github:    { baseUrl: 'https://api.github.com', pat: 'gh-pat' },
      sslVerify: true,
    };

    const response = await request(buildTestApp(configuration))
      .get('/api/proxy-status');

    expect(response.status).toBe(200);
    expect(response.body.proxy).toBe(true);
    expect(response.body.jira.ready).toBe(true);
    expect(response.body.github.ready).toBe(true);
  });

  it('reports jira.ready=false when Jira has no credentials', async () => {
    const configuration = {
      jira:      { baseUrl: 'https://acme.atlassian.net', pat: '', username: '', apiToken: '' },
      snow:      { baseUrl: '', username: '', password: '' },
      github:    { baseUrl: 'https://api.github.com', pat: '' },
      sslVerify: true,
    };

    const response = await request(buildTestApp(configuration))
      .get('/api/proxy-status');

    expect(response.status).toBe(200);
    expect(response.body.jira.configured).toBe(true);
    expect(response.body.jira.ready).toBe(false);
  });
});

// ── /api/proxy-config ─────────────────────────────────────────────────────────

describe('GET /api/proxy-config', () => {
  it('returns config without exposing secrets', async () => {
    const configuration = {
      port:      5555,
      jira:      { baseUrl: 'https://acme.atlassian.net', pat: 'secret-pat', username: 'user', apiToken: 'token' },
      snow:      { baseUrl: 'https://acme.service-now.com', username: 'snow-user', password: 'snow-pass' },
      github:    { baseUrl: 'https://api.github.com', pat: 'gh-secret' },
      sslVerify: true,
    };

    const response = await request(buildTestApp(configuration))
      .get('/api/proxy-config');

    expect(response.status).toBe(200);
    // Base URLs are returned (not sensitive)
    expect(response.body.jira.baseUrl).toBe('https://acme.atlassian.net');
    // Actual secrets are not returned — only a boolean indicator
    expect(response.body.jira.hasCredentials).toBe(true);
    expect(response.body.jira.pat).toBeUndefined();
    expect(response.body.jira.apiToken).toBeUndefined();
  });
});

// ── /api/snow-session ─────────────────────────────────────────────────────────

describe('/api/snow-session', () => {
  // Clear session state between tests to avoid bleed-over
  afterEach(() => snowSession.clearSession());

  it('POST stores the session and returns ok:true', async () => {
    const configuration = {
      jira: { baseUrl: '', pat: '' }, snow: { baseUrl: '' },
      github: { baseUrl: 'https://api.github.com', pat: '' }, sslVerify: true,
    };

    const response = await request(buildTestApp(configuration))
      .post('/api/snow-session')
      .send({ gck: 'test-gck-token', baseUrl: 'https://snow.example.com', expiresIn: 3600 });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.expiresAt).toBeDefined();
  });

  it('POST returns 400 when gck is missing', async () => {
    const configuration = {
      jira: { baseUrl: '', pat: '' }, snow: { baseUrl: '' },
      github: { baseUrl: 'https://api.github.com', pat: '' }, sslVerify: true,
    };

    const response = await request(buildTestApp(configuration))
      .post('/api/snow-session')
      .send({ baseUrl: 'https://snow.example.com' });

    expect(response.status).toBe(400);
  });

  it('GET returns session status without exposing the token', async () => {
    snowSession.storeSession('my-secret-gck', 'https://snow.example.com', 7200);

    const configuration = {
      jira: { baseUrl: '', pat: '' }, snow: { baseUrl: '' },
      github: { baseUrl: 'https://api.github.com', pat: '' }, sslVerify: true,
    };

    const response = await request(buildTestApp(configuration))
      .get('/api/snow-session');

    expect(response.status).toBe(200);
    expect(response.body.hasSession).toBe(true);
    expect(response.body.isActive).toBe(true);
    // The raw token must never appear in the response
    expect(JSON.stringify(response.body)).not.toContain('my-secret-gck');
  });

  it('DELETE clears the session', async () => {
    snowSession.storeSession('to-be-deleted', 'https://snow.example.com', 7200);

    const configuration = {
      jira: { baseUrl: '', pat: '' }, snow: { baseUrl: '' },
      github: { baseUrl: 'https://api.github.com', pat: '' }, sslVerify: true,
    };

    const deleteResponse = await request(buildTestApp(configuration))
      .delete('/api/snow-session');

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.ok).toBe(true);

    const getResponse = await request(buildTestApp(configuration))
      .get('/api/snow-session');
    expect(getResponse.body.hasSession).toBe(false);
  });
});
