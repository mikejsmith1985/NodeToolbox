// Tests for the Rovo exchange router (status mapping; service mocked).

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../services/rovoExchange', () => ({ dispatchPrompt: jest.fn(), fetchResult: jest.fn() }));
const { dispatchPrompt, fetchResult } = require('../services/rovoExchange');
const createRovoExchangeRouter = require('./rovoExchange');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createRovoExchangeRouter({}));
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('POST /api/rovo/dispatch', () => {
  it('returns 200 on a successful dispatch and never echoes a prompt or secret', async () => {
    dispatchPrompt.mockResolvedValue({ ok: true, httpStatus: 200, webhookStatus: 200, code: 'dispatched', message: 'Dispatched to Rovo (HTTP 200).' });
    const response = await request(buildApp()).post('/api/rovo/dispatch').send({ correlationId: 'abc', prompt: 'secret prompt body' });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('secret prompt body');
  });

  it('passes through a 422 host-not-allowed result', async () => {
    dispatchPrompt.mockResolvedValue({ ok: false, httpStatus: 422, code: 'host-not-allowed', message: 'not allowed' });
    const response = await request(buildApp()).post('/api/rovo/dispatch').send({ correlationId: 'abc', prompt: 'x' });
    expect(response.status).toBe(422);
  });

  it('passes through a 409 not-configured result', async () => {
    dispatchPrompt.mockResolvedValue({ ok: false, httpStatus: 409, code: 'not-configured', message: 'configure it' });
    const response = await request(buildApp()).post('/api/rovo/dispatch').send({ correlationId: 'abc', prompt: 'x' });
    expect(response.status).toBe(409);
  });
});

describe('GET /api/rovo/result', () => {
  it('returns ready:false while the result is not yet parked', async () => {
    fetchResult.mockResolvedValue({ ok: true, httpStatus: 200, ready: false });
    const response = await request(buildApp()).get('/api/rovo/result?correlationId=abc');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, ready: false });
  });

  it('returns the response text once ready', async () => {
    fetchResult.mockResolvedValue({ ok: true, httpStatus: 200, ready: true, response: 'SHORT_DESCRIPTION: x' });
    const response = await request(buildApp()).get('/api/rovo/result?correlationId=abc');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, ready: true, response: 'SHORT_DESCRIPTION: x' });
  });

  it('passes the correlationId through to the service', async () => {
    fetchResult.mockResolvedValue({ ok: true, httpStatus: 200, ready: false });
    await request(buildApp()).get('/api/rovo/result?correlationId=xyz-1');
    expect(fetchResult).toHaveBeenCalledWith({}, 'xyz-1');
  });
});
