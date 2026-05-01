// test/integration/server.test.js — Smoke tests for the Express server entry point.
// Verifies that the full Express application assembles correctly and that key
// endpoints are reachable. Uses supertest with the app object directly —
// no TCP port is bound so tests run fast and never conflict with a running server.

'use strict';

const request = require('supertest');

// Import the app without starting a TCP listener — require.main guard in server.js
// ensures app.listen() is skipped when the module is required (not executed directly).
const { app } = require('../../server');

// ── Sanity Tests ──────────────────────────────────────────────────────────────

describe('Server integration smoke tests', () => {
  it('responds to GET /api/proxy-status with proxy:true', async () => {
    const response = await request(app).get('/api/proxy-status');
    expect(response.status).toBe(200);
    expect(response.body.proxy).toBe(true);
  });

  it('responds to GET /api/proxy-config', async () => {
    const response = await request(app).get('/api/proxy-config');
    expect(response.status).toBe(200);
    expect(response.body).toBeDefined();
  });

  it('responds to GET /api/snow-session', async () => {
    const response = await request(app).get('/api/snow-session');
    expect(response.status).toBe(200);
    expect(typeof response.body.hasSession).toBe('boolean');
  });

  it('responds to GET /api/scheduler/status', async () => {
    const response = await request(app).get('/api/scheduler/status');
    expect(response.status).toBe(200);
    expect(response.body.repoMonitor).toBeDefined();
  });

  it('sets CORS headers on every response', async () => {
    const response = await request(app).get('/api/proxy-status');
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });

  it('returns 204 for OPTIONS preflight', async () => {
    const response = await request(app).options('/api/proxy-status');
    expect(response.status).toBe(204);
  });

  it('serves toolbox.html or redirects to setup for GET /', async () => {
    // In test environments the config file is absent, so the first-run redirect
    // (302 → /setup) fires. On a configured server it serves toolbox.html (200)
    // or a 404 page if the HTML file is missing. All three are valid outcomes.
    const response = await request(app).get('/');
    expect([200, 302, 404]).toContain(response.status);

    if (response.status === 302) {
      expect(response.headers['location']).toBe('/setup');
    } else {
      expect(response.headers['content-type']).toMatch(/text\/html/);
    }
  });
});
