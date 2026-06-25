// Tests for the AI Assist exchange router (status mapping; service mocked).

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../services/aiAssistExchange', () => ({ dispatchPrompt: jest.fn(), fetchResult: jest.fn() }));
jest.mock('../config/loader', () => ({ saveConfigToDisk: jest.fn() }));
const { dispatchPrompt, fetchResult } = require('../services/aiAssistExchange');
const { saveConfigToDisk } = require('../config/loader');
const createAiAssistExchangeRouter = require('./aiAssistExchange');

function buildApp(configuration = {}) {
  const app = express();
  app.use(express.json());
  app.use(createAiAssistExchangeRouter(configuration));
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('AI Assist config endpoints', () => {
  it('GET returns the current config (empty defaults)', async () => {
    const response = await request(buildApp({})).get('/api/ai-assist/config');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ webhookUrl: '', webhookSecret: '', parkingSpaceKey: '', parkingPageId: '', isEnabled: false });
  });

  it('POST sanitises, saves to disk, and persists into configuration', async () => {
    const configuration = {};
    const response = await request(buildApp(configuration)).post('/api/ai-assist/config').send({
      webhookUrl: '  https://x.atlassian.net/hook  ', webhookSecret: ' s ', parkingSpaceKey: ' AIASSIST ', parkingPageId: ' 781058099 ', isEnabled: 1,
    });
    expect(response.status).toBe(200);
    expect(configuration.aiAssistAutomation).toEqual({ webhookUrl: 'https://x.atlassian.net/hook', webhookSecret: 's', parkingSpaceKey: 'AIASSIST', parkingPageId: '781058099', isEnabled: true });
    expect(saveConfigToDisk).toHaveBeenCalledTimes(1);
  });

  it('GET reflects a previously saved config', async () => {
    const configuration = { aiAssistAutomation: { webhookUrl: 'https://x.atlassian.net/h', webhookSecret: 'k', parkingSpaceKey: 'AIASSIST', isEnabled: true } };
    const response = await request(buildApp(configuration)).get('/api/ai-assist/config');
    expect(response.body).toMatchObject({ webhookUrl: 'https://x.atlassian.net/h', parkingSpaceKey: 'AIASSIST', isEnabled: true });
  });
});

describe('POST /api/ai-assist/dispatch', () => {
  it('returns 200 on a successful dispatch and never echoes a prompt or secret', async () => {
    dispatchPrompt.mockResolvedValue({ ok: true, httpStatus: 200, webhookStatus: 200, code: 'dispatched', message: 'Dispatched to AI Assist (HTTP 200).' });
    const response = await request(buildApp()).post('/api/ai-assist/dispatch').send({ correlationId: 'abc', prompt: 'secret prompt body' });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain('secret prompt body');
  });

  it('passes through a 422 host-not-allowed result', async () => {
    dispatchPrompt.mockResolvedValue({ ok: false, httpStatus: 422, code: 'host-not-allowed', message: 'not allowed' });
    const response = await request(buildApp()).post('/api/ai-assist/dispatch').send({ correlationId: 'abc', prompt: 'x' });
    expect(response.status).toBe(422);
  });

  it('passes through a 409 not-configured result', async () => {
    dispatchPrompt.mockResolvedValue({ ok: false, httpStatus: 409, code: 'not-configured', message: 'configure it' });
    const response = await request(buildApp()).post('/api/ai-assist/dispatch').send({ correlationId: 'abc', prompt: 'x' });
    expect(response.status).toBe(409);
  });
});

describe('GET /api/ai-assist/result', () => {
  it('returns ready:false while the result is not yet parked', async () => {
    fetchResult.mockResolvedValue({ ok: true, httpStatus: 200, ready: false });
    const response = await request(buildApp()).get('/api/ai-assist/result?correlationId=abc');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, ready: false });
  });

  it('returns the response text once ready', async () => {
    fetchResult.mockResolvedValue({ ok: true, httpStatus: 200, ready: true, response: 'SHORT_DESCRIPTION: x' });
    const response = await request(buildApp()).get('/api/ai-assist/result?correlationId=abc');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, ready: true, response: 'SHORT_DESCRIPTION: x' });
  });

  it('passes the correlationId through to the service', async () => {
    fetchResult.mockResolvedValue({ ok: true, httpStatus: 200, ready: false });
    await request(buildApp()).get('/api/ai-assist/result?correlationId=xyz-1');
    expect(fetchResult).toHaveBeenCalledWith({}, 'xyz-1');
  });
});
