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
  it('GET returns the current config, reporting the secret as absent rather than echoing it', async () => {
    const response = await request(buildApp({})).get('/api/ai-assist/config');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ webhookUrl: '', hasWebhookSecret: false, parkingSpaceKey: '', parkingPageId: '', isEnabled: false });
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

// The rest of this router already refuses to echo a prompt or a secret on dispatch. The config read was
// the one place that did — /api/proxy-config reports `hasCredentials` and states that raw credentials are
// NEVER returned, and this endpoint now matches that.
describe('AI Assist config — the webhook secret never leaves the server', () => {
  const SAVED_CONFIG = {
    aiAssistAutomation: {
      webhookUrl: 'https://x.atlassian.net/h', webhookSecret: 'super-secret-token',
      parkingSpaceKey: 'AIASSIST', parkingPageId: '781058099', isEnabled: true,
    },
  };

  it('GET never returns the secret, however it is spelled', async () => {
    const response = await request(buildApp({ ...SAVED_CONFIG })).get('/api/ai-assist/config');

    expect(JSON.stringify(response.body)).not.toContain('super-secret-token');
    expect(response.body.webhookSecret).toBeUndefined();
  });

  it('GET says WHETHER a secret is set, which is all the form needs to render', async () => {
    const withSecret = await request(buildApp({ ...SAVED_CONFIG })).get('/api/ai-assist/config');
    const withoutSecret = await request(buildApp({ aiAssistAutomation: { webhookUrl: 'https://x/h' } })).get('/api/ai-assist/config');

    expect(withSecret.body.hasWebhookSecret).toBe(true);
    expect(withoutSecret.body.hasWebhookSecret).toBe(false);
  });

  it('POST KEEPS an existing secret when the form does not send one', async () => {
    // The pairing that makes withholding the secret safe: the form is never given the secret, so it
    // cannot send it back, and a blind overwrite would wipe it whenever anyone saved another field.
    const configuration = { ...SAVED_CONFIG };

    await request(buildApp(configuration)).post('/api/ai-assist/config').send({
      webhookUrl: 'https://x.atlassian.net/h', parkingSpaceKey: 'AIASSIST', isEnabled: true,
    });

    expect(configuration.aiAssistAutomation.webhookSecret).toBe('super-secret-token');
  });

  it('POST keeps an existing secret when the form sends a blank one', async () => {
    const configuration = { ...SAVED_CONFIG };

    await request(buildApp(configuration)).post('/api/ai-assist/config').send({
      webhookUrl: 'https://x.atlassian.net/h', webhookSecret: '   ', isEnabled: true,
    });

    expect(configuration.aiAssistAutomation.webhookSecret).toBe('super-secret-token');
  });

  it('POST replaces the secret when the form sends a new one', async () => {
    const configuration = { ...SAVED_CONFIG };

    await request(buildApp(configuration)).post('/api/ai-assist/config').send({
      webhookUrl: 'https://x.atlassian.net/h', webhookSecret: 'rotated-token', isEnabled: true,
    });

    expect(configuration.aiAssistAutomation.webhookSecret).toBe('rotated-token');
  });

  it('POST clears the secret only when explicitly asked to', async () => {
    const configuration = { ...SAVED_CONFIG };

    await request(buildApp(configuration)).post('/api/ai-assist/config').send({
      webhookUrl: 'https://x.atlassian.net/h', clearWebhookSecret: true, isEnabled: true,
    });

    expect(configuration.aiAssistAutomation.webhookSecret).toBe('');
  });

  it('POST does not echo the secret back either', async () => {
    const response = await request(buildApp({ ...SAVED_CONFIG })).post('/api/ai-assist/config').send({
      webhookUrl: 'https://x.atlassian.net/h', webhookSecret: 'rotated-token', isEnabled: true,
    });

    expect(JSON.stringify(response.body)).not.toContain('rotated-token');
    expect(response.body.config.hasWebhookSecret).toBe(true);
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
