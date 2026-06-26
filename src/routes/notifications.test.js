// Tests for the notifications router (config CRUD + run/test endpoints).

'use strict';

const express = require('express');
const request = require('supertest');

// Mock collaborators so the router is tested in isolation.
jest.mock('../config/loader', () => ({ saveConfigToDisk: jest.fn() }));
jest.mock('../services/scopeChangeScheduler', () => ({ runTeamReportNow: jest.fn(), runArtRollupNow: jest.fn() }));
jest.mock('../services/featureChangeScheduler', () => ({ runFeatureReportNow: jest.fn(), runFeatureArtRollupNow: jest.fn() }));
jest.mock('../utils/httpClient', () => ({ triggerWebhook: jest.fn() }));
jest.mock('../services/reportDeliveryStatus', () => ({ loadDeliveryStatuses: jest.fn(() => ({})) }));

const { saveConfigToDisk } = require('../config/loader');
const { runTeamReportNow } = require('../services/scopeChangeScheduler');
const { triggerWebhook } = require('../utils/httpClient');
const { loadDeliveryStatuses } = require('../services/reportDeliveryStatus');
const createNotificationsRouter = require('./notifications');

function buildApp(configuration) {
  const app = express();
  app.use(express.json());
  app.use(createNotificationsRouter(configuration));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/notifications/config', () => {
  it('returns empty teamReports and a default artRollup when nothing is configured', async () => {
    const response = await request(buildApp({})).get('/api/notifications/config');
    expect(response.status).toBe(200);
    expect(response.body.teamReports).toEqual([]);
    expect(response.body.artRollup).toMatchObject({ isEnabled: false, scheduleTime: '09:00' });
  });
});

describe('POST /api/notifications/config', () => {
  it('sanitises team reports (trims, defaults, coerces) and persists to disk', async () => {
    const configuration = {};
    const response = await request(buildApp(configuration)).post('/api/notifications/config').send({
      teamReports: [{ teamName: '  Alpha  ', projectKey: 'alpha', isEnabled: 1 }],
    });

    expect(response.status).toBe(200);
    const saved = configuration.scheduler.scopeChange.teamReports[0];
    expect(saved.teamName).toBe('Alpha');
    expect(saved.scheduleTime).toBe('11:00'); // default applied
    expect(saved.isEnabled).toBe(true); // coerced from 1
    expect(saveConfigToDisk).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/notifications/delivery-status', () => {
  it('returns the persisted delivery status object for the Admin Hub to display', async () => {
    loadDeliveryStatuses.mockReturnValueOnce({
      scopeChange: {
        'team-0-ENFCT': { status: 'skipped', message: 'No fix version changes since Jun 25.', label: 'Transformers', ranAt: '2026-06-26T13:00:00.000Z' },
      },
    });

    const response = await request(buildApp({})).get('/api/notifications/delivery-status');

    expect(response.status).toBe(200);
    expect(response.body.scopeChange['team-0-ENFCT']).toMatchObject({ status: 'skipped', label: 'Transformers' });
  });
});

describe('POST /api/notifications/run-team', () => {
  it('rejects a non-integer teamIndex with 400', async () => {
    const response = await request(buildApp({})).post('/api/notifications/run-team').send({ teamIndex: 'x' });
    expect(response.status).toBe(400);
    expect(runTeamReportNow).not.toHaveBeenCalled();
  });

  it('delivers and returns the result for a valid teamIndex', async () => {
    runTeamReportNow.mockResolvedValue({ postUrl: 'https://x.atlassian.net/p/1' });
    const response = await request(buildApp({})).post('/api/notifications/run-team').send({ teamIndex: 0 });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, postUrl: 'https://x.atlassian.net/p/1' });
  });

  it('maps a delivery error to 502', async () => {
    runTeamReportNow.mockRejectedValue(new Error('boom'));
    const response = await request(buildApp({})).post('/api/notifications/run-team').send({ teamIndex: 0 });
    expect(response.status).toBe(502);
    expect(response.body.message).toMatch(/boom/);
  });
});

describe('POST /api/notifications/test-webhook', () => {
  it('rejects a missing/invalid URL with 400', async () => {
    const response = await request(buildApp({})).post('/api/notifications/test-webhook').send({ triggerUrl: 'not-a-url' });
    expect(response.status).toBe(400);
    expect(triggerWebhook).not.toHaveBeenCalled();
  });

  it('reports the webhook HTTP status on success', async () => {
    triggerWebhook.mockResolvedValue({ status: 200, body: 'ok' });
    const response = await request(buildApp({})).post('/api/notifications/test-webhook').send({ triggerUrl: 'https://x.atlassian.net/hook' });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, httpStatus: 200 });
  });
});

describe('POST /api/notifications/feature-change-config', () => {
  it('sanitises feature reports and persists', async () => {
    const configuration = {};
    const response = await request(buildApp(configuration)).post('/api/notifications/feature-change-config').send({
      reports: [{ teamName: 'Beta', jiraLabel: '  beta-label  ' }],
    });
    expect(response.status).toBe(200);
    expect(configuration.scheduler.featureChange.reports[0].jiraLabel).toBe('beta-label');
    expect(saveConfigToDisk).toHaveBeenCalled();
  });
});
