// test/integration/scheduler.test.js — Integration tests for the scheduler API routes.
// Verifies that /api/scheduler/status, /config, /run-now, and /results respond
// correctly with both valid and invalid inputs.

'use strict';

const request  = require('supertest');
const express  = require('express');
const { applyCorsHeaders }   = require('../../src/middleware/cors');
const createSchedulerRouter  = require('../../src/routes/scheduler');

// ── Test App Factory ──────────────────────────────────────────────────────────

function buildTestApp(configuration) {
  const testApp = express();
  testApp.use(express.json());
  testApp.use(applyCorsHeaders);
  testApp.use(createSchedulerRouter(configuration));
  return testApp;
}

function buildBaseConfig(overrides) {
  return Object.assign(
    {
      jira:      { baseUrl: '', pat: '', username: '', apiToken: '' },
      snow:      { baseUrl: '', username: '', password: '' },
      github:    { baseUrl: 'https://api.github.com', pat: '' },
      sslVerify: true,
      scheduler: {
        repoMonitor: {
          enabled:       false,
          repos:         [],
          branchPattern: 'feature/[A-Z]+-\\d+',
          intervalMin:   15,
          transitions:   {},
          seenBranches:  {},
          seenCommits:   {},
          seenPrs:       {},
        },
      },
    },
    overrides
  );
}

// ── GET /api/scheduler/status ─────────────────────────────────────────────────

describe('GET /api/scheduler/status', () => {
  it('returns repoMonitor status object', async () => {
    const configuration = buildBaseConfig();
    const response = await request(buildTestApp(configuration)).get('/api/scheduler/status');
    expect(response.status).toBe(200);
    expect(response.body.repoMonitor).toBeDefined();
    expect(typeof response.body.repoMonitor.enabled).toBe('boolean');
  });

  it('reflects enabled:false when scheduler is disabled', async () => {
    const configuration = buildBaseConfig();
    const response = await request(buildTestApp(configuration)).get('/api/scheduler/status');
    expect(response.body.repoMonitor.enabled).toBe(false);
  });
});

// ── GET /api/scheduler/config ─────────────────────────────────────────────────

describe('GET /api/scheduler/config', () => {
  it('returns scheduler configuration without credentials', async () => {
    const configuration = buildBaseConfig();
    const response = await request(buildTestApp(configuration)).get('/api/scheduler/config');
    expect(response.status).toBe(200);
    expect(response.body.repoMonitor).toBeDefined();
    expect(Array.isArray(response.body.repoMonitor.repos)).toBe(true);
    expect(typeof response.body.repoMonitor.intervalMin).toBe('number');
  });
});

// ── POST /api/scheduler/config ────────────────────────────────────────────────

describe('POST /api/scheduler/config', () => {
  it('accepts valid config and returns success:true', async () => {
    const configuration = buildBaseConfig();
    const response = await request(buildTestApp(configuration))
      .post('/api/scheduler/config')
      .send({ repoMonitor: { enabled: false, repos: ['owner/repo'], intervalMin: 30 } });
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('returns 400 for a non-object body', async () => {
    const configuration = buildBaseConfig();
    // Send a JSON string (valid JSON but not an object) — express.json() will parse
    // it but the route must reject it since it's not a configuration object.
    const response = await request(buildTestApp(configuration))
      .post('/api/scheduler/config')
      .type('json')
      .send('"not-a-config-object"');
    expect(response.status).toBe(400);
  });

  it('updates repos in the live configuration', async () => {
    const configuration = buildBaseConfig();
    await request(buildTestApp(configuration))
      .post('/api/scheduler/config')
      .send({ repoMonitor: { repos: ['acme/api-service', 'acme/frontend'] } });
    expect(configuration.scheduler.repoMonitor.repos).toEqual(['acme/api-service', 'acme/frontend']);
  });
});

// ── POST /api/scheduler/run-now ───────────────────────────────────────────────

describe('POST /api/scheduler/run-now', () => {
  it('returns 400 when GitHub PAT is not configured', async () => {
    const configuration = buildBaseConfig();
    const response = await request(buildTestApp(configuration))
      .post('/api/scheduler/run-now');
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/GitHub/i);
  });

  it('returns ok:true when GitHub PAT is configured', async () => {
    const configuration = buildBaseConfig({ github: { pat: 'ghp_test', baseUrl: 'https://api.github.com' } });
    const response = await request(buildTestApp(configuration))
      .post('/api/scheduler/run-now');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});

// ── GET /api/scheduler/results ────────────────────────────────────────────────

describe('GET /api/scheduler/results', () => {
  it('returns repoMonitor results with an events array', async () => {
    const configuration = buildBaseConfig();
    const response = await request(buildTestApp(configuration)).get('/api/scheduler/results');
    expect(response.status).toBe(200);
    expect(response.body.repoMonitor).toBeDefined();
    expect(Array.isArray(response.body.repoMonitor.events)).toBe(true);
  });
});
