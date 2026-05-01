// test/unit/cors.test.js — Unit tests for the CORS middleware.
// Verifies that every response includes the required access-control headers
// and that OPTIONS preflight requests receive a 204 with no body.

'use strict';

const express             = require('express');
const request             = require('supertest');
const { applyCorsHeaders } = require('../../src/middleware/cors');

// ── Test App Helper ───────────────────────────────────────────────────────────

function buildCorsTestApp() {
  const testApp = express();
  testApp.use(applyCorsHeaders);
  testApp.get('/test', (req, res) => res.json({ ok: true }));
  return testApp;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('applyCorsHeaders middleware', () => {
  it('sets Access-Control-Allow-Origin: * on every response', async () => {
    const response = await request(buildCorsTestApp()).get('/test');
    expect(response.headers['access-control-allow-origin']).toBe('*');
  });

  it('sets Access-Control-Allow-Methods on every response', async () => {
    const response = await request(buildCorsTestApp()).get('/test');
    expect(response.headers['access-control-allow-methods']).toBeDefined();
  });

  it('sets Access-Control-Allow-Headers on every response', async () => {
    const response = await request(buildCorsTestApp()).get('/test');
    expect(response.headers['access-control-allow-headers']).toBeDefined();
  });

  it('responds 204 No Content for OPTIONS preflight requests', async () => {
    const response = await request(buildCorsTestApp()).options('/test');
    expect(response.status).toBe(204);
  });

  it('does not set a body on OPTIONS preflight responses', async () => {
    const response = await request(buildCorsTestApp()).options('/test');
    expect(response.text).toBe('');
  });

  it('passes non-OPTIONS requests through to the next middleware', async () => {
    const response = await request(buildCorsTestApp()).get('/test');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});
