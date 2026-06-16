// hygieneMonitor.test.js — Route tests for the hygiene monitor API.
// All downstream services (scheduler, config loader) are mocked; these tests
// verify HTTP status codes, response shapes, and that secrets are never echoed.

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../services/hygieneMonitorScheduler', () => ({
  runHygieneScan: jest.fn(),
  getLastScanStatus: jest.fn(),
}));
jest.mock('../config/loader', () => ({ saveConfigToDisk: jest.fn() }));

const { runHygieneScan, getLastScanStatus } = require('../services/hygieneMonitorScheduler');
const { saveConfigToDisk } = require('../config/loader');
const createHygieneMonitorRouter = require('./hygieneMonitor');

function buildApp(configuration = {}) {
  const app = express();
  app.use(express.json());
  app.use(createHygieneMonitorRouter(configuration));
  return app;
}

beforeEach(() => jest.clearAllMocks());

// ── GET /api/hygiene-monitor/config ──────────────────────────────────────────

describe('GET /api/hygiene-monitor/config', () => {
  it('returns 200 with an empty team list when no config is set', async () => {
    const response = await request(buildApp({})).get('/api/hygiene-monitor/config');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('teams');
    expect(Array.isArray(response.body.teams)).toBe(true);
  });

  it('returns the current teams config without echoing the Teams webhook secret', async () => {
    const configuration = {
      hygieneMonitor: {
        teams: [
          {
            teamName: 'Platform',
            projectKeys: ['PLAT'],
            scheduleTime: '06:00',
            weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
            digestTriggerUrl: 'https://contoso.atlassian.net/automation/webhooks/secret-url',
            digestTriggerSecret: 'my-secret',
            digestEmailTo: 'platform-dl@example.com',
            enabledCheckIds: ['no-assignee'],
          },
        ],
      },
    };
    const response = await request(buildApp(configuration)).get('/api/hygiene-monitor/config');
    expect(response.status).toBe(200);
    // The secret must never be returned in any response.
    expect(JSON.stringify(response.body)).not.toContain('my-secret');
    expect(response.body.teams[0].teamName).toBe('Platform');
  });
});

// ── POST /api/hygiene-monitor/config ─────────────────────────────────────────

describe('POST /api/hygiene-monitor/config', () => {
  it('saves a valid config and persists it to disk', async () => {
    const configuration = {};
    const payload = {
      teams: [
        {
          teamName: 'Checkout',
          projectKeys: ['CHK'],
          scheduleTime: '07:00',
          weekdays: ['Mon', 'Wed', 'Fri'],
          digestTriggerUrl: 'https://contoso.atlassian.net/automation/webhooks/checkout',
          digestTriggerSecret: 'checkout-secret',
          digestEmailTo: 'checkout-dl@example.com',
          enabledCheckIds: ['no-assignee', 'stale-issue'],
        },
      ],
    };

    const response = await request(buildApp(configuration)).post('/api/hygiene-monitor/config').send(payload);
    expect(response.status).toBe(200);
    expect(saveConfigToDisk).toHaveBeenCalledTimes(1);
    // Config is reflected on the live object.
    expect(configuration.hygieneMonitor.teams[0].teamName).toBe('Checkout');
    // The secret must never be returned in the save response.
    expect(JSON.stringify(response.body)).not.toContain('checkout-secret');
  });

  it('returns 400 when the teams array is missing', async () => {
    const response = await request(buildApp({})).post('/api/hygiene-monitor/config').send({});
    expect(response.status).toBe(400);
  });
});

// ── POST /api/hygiene-monitor/scan ────────────────────────────────────────────

describe('POST /api/hygiene-monitor/scan', () => {
  it('triggers a scan and returns 200 with scan metadata', async () => {
    runHygieneScan.mockResolvedValue({
      teamName: 'Platform',
      issuesScanned: 5,
      violationsFound: 2,
      fixesApplied: 1,
      actionsRequired: 1,
      unassignedCount: 0,
      failures: [],
    });

    const configuration = {
      hygieneMonitor: {
        teams: [{ teamName: 'Platform', projectKeys: ['PLAT'] }],
      },
    };

    const response = await request(buildApp(configuration)).post('/api/hygiene-monitor/scan').send({ teamName: 'Platform' });
    expect(response.status).toBe(200);
    expect(response.body.issuesScanned).toBe(5);
    expect(runHygieneScan).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when the requested team is not configured', async () => {
    const response = await request(buildApp({ hygieneMonitor: { teams: [] } }))
      .post('/api/hygiene-monitor/scan')
      .send({ teamName: 'Unknown Team' });
    expect(response.status).toBe(404);
  });

  it('returns 503 when the scan service throws', async () => {
    runHygieneScan.mockRejectedValue(new Error('Jira proxy unavailable'));
    const configuration = {
      hygieneMonitor: {
        teams: [{ teamName: 'Platform', projectKeys: ['PLAT'] }],
      },
    };
    const response = await request(buildApp(configuration)).post('/api/hygiene-monitor/scan').send({ teamName: 'Platform' });
    expect(response.status).toBe(503);
  });
});

// ── GET /api/hygiene-monitor/status ──────────────────────────────────────────

describe('GET /api/hygiene-monitor/status', () => {
  it('returns the last scan status summary', async () => {
    getLastScanStatus.mockReturnValue({
      lastScanAt: '2026-06-16T06:00:00.000Z',
      nextScanAt: '2026-06-17T06:00:00.000Z',
      teamStatuses: [{ teamName: 'Platform', violationsFound: 3 }],
    });

    const response = await request(buildApp({})).get('/api/hygiene-monitor/status');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('lastScanAt');
    expect(response.body.teamStatuses[0].teamName).toBe('Platform');
  });

  it('returns 200 with null lastScanAt when no scan has run yet', async () => {
    getLastScanStatus.mockReturnValue({ lastScanAt: null, nextScanAt: null, teamStatuses: [] });
    const response = await request(buildApp({})).get('/api/hygiene-monitor/status');
    expect(response.status).toBe(200);
    expect(response.body.lastScanAt).toBeNull();
  });
});
