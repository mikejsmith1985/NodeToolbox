// src/routes/monthlyDelivery.test.js — Admin Hub endpoints for the Monthly Delivery Report
// scheduler (feature 018). Config save and the run/report services are mocked, so this runs in Jest
// without disk I/O or Jira.

'use strict';

jest.mock('../config/loader', () => ({ saveConfigToDisk: jest.fn() }));
jest.mock('../services/monthlyDeliveryScheduler', () => ({
  runMonthlyDeliveryNow: jest.fn(),
  isMonthlyDeliveryRunInProgress: jest.fn(() => false),
  readLastRunResult: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const { saveConfigToDisk } = require('../config/loader');
const {
  runMonthlyDeliveryNow,
  isMonthlyDeliveryRunInProgress,
  readLastRunResult,
} = require('../services/monthlyDeliveryScheduler');
const createMonthlyDeliveryRouter = require('./monthlyDelivery');

function makeApp(configuration) {
  const app = express();
  app.use(express.json());
  app.use(createMonthlyDeliveryRouter(configuration));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/monthly-delivery/config', () => {
  it('returns the configured block', async () => {
    const configuration = {
      scheduler: {
        monthlyDelivery: {
          isEnabled: true,
          scheduleTime: '09:15',
          featureLinkFieldId: 'customfield_10999',
          teams: [{ teamName: 'Transformers', projectKey: 'TRFM', boardId: '42' }],
        },
      },
    };
    const response = await request(makeApp(configuration)).get('/api/monthly-delivery/config');
    expect(response.status).toBe(200);
    expect(response.body.isEnabled).toBe(true);
    expect(response.body.scheduleTime).toBe('09:15');
    expect(response.body.featureLinkFieldId).toBe('customfield_10999');
    expect(response.body.teams).toHaveLength(1);
  });

  it('returns safe defaults when nothing is configured', async () => {
    const response = await request(makeApp({})).get('/api/monthly-delivery/config');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      isEnabled: false,
      scheduleTime: '08:00',
      featureLinkFieldId: 'customfield_10108',
      teams: [],
      triggerUrl: '',
      triggerSecret: '',
    });
  });
});

describe('POST /api/monthly-delivery/config', () => {
  it('persists the delivery webhook url and secret with the rest of the config', async () => {
    const configuration = {};
    const app = makeApp(configuration);

    await request(app).post('/api/monthly-delivery/config').send({
      isEnabled: true,
      scheduleTime: '09:30',
      teams: [{ teamName: 'T', projectKey: 'TT', boardId: '1' }],
      triggerUrl: '  https://api-private.atlassian.com/automation/webhooks/x  ',
      triggerSecret: ' s3cr3t ',
    });

    expect(configuration.scheduler.monthlyDelivery.triggerUrl).toBe('https://api-private.atlassian.com/automation/webhooks/x');
    expect(configuration.scheduler.monthlyDelivery.triggerSecret).toBe('s3cr3t');

    const echoed = await request(app).get('/api/monthly-delivery/config');
    expect(echoed.body.triggerUrl).toBe('https://api-private.atlassian.com/automation/webhooks/x');
  });
  it('sanitises, persists in place, and drops unexpected fields', async () => {
    const configuration = {};
    const response = await request(makeApp(configuration))
      .post('/api/monthly-delivery/config')
      .send({
        isEnabled: true,
        scheduleTime: '07:45',
        featureLinkFieldId: '  customfield_10108  ',
        teams: [
          { teamName: '  Transformers  ', projectKey: ' TRFM ', boardId: '42', apiToken: 'DROP ME' },
        ],
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.teams).toBe(1);
    expect(saveConfigToDisk).toHaveBeenCalledTimes(1);
    const savedBlock = configuration.scheduler.monthlyDelivery;
    expect(savedBlock.teams[0]).toEqual({ teamName: 'Transformers', projectKey: 'TRFM', boardId: '42' });
    expect(savedBlock.scheduleTime).toBe('07:45');
  });

  it('falls back to 08:00 for an invalid schedule time and drops teams without a project key', async () => {
    const configuration = {};
    await request(makeApp(configuration))
      .post('/api/monthly-delivery/config')
      .send({
        scheduleTime: '99:99',
        teams: [
          { teamName: 'No Project', projectKey: '   ', boardId: '1' },
          { teamName: 'Keeper', projectKey: 'KEEP', boardId: '2' },
        ],
      });

    const savedBlock = configuration.scheduler.monthlyDelivery;
    expect(savedBlock.scheduleTime).toBe('08:00');
    expect(savedBlock.teams).toHaveLength(1);
    expect(savedBlock.teams[0].teamName).toBe('Keeper');
  });

  it('defaults an empty featureLinkFieldId to customfield_10108', async () => {
    const configuration = {};
    await request(makeApp(configuration))
      .post('/api/monthly-delivery/config')
      .send({ featureLinkFieldId: '  ', teams: [] });
    expect(configuration.scheduler.monthlyDelivery.featureLinkFieldId).toBe('customfield_10108');
  });
});

describe('POST /api/monthly-delivery/run-now', () => {
  const CONFIGURED = {
    scheduler: { monthlyDelivery: { isEnabled: true, scheduleTime: '08:00', featureLinkFieldId: 'customfield_10108', teams: [{ teamName: 'T', projectKey: 'T', boardId: '1' }] } },
  };

  it('runs immediately and returns the RunResult (per-team errors stay inside a 200)', async () => {
    const runResult = {
      hasRun: true, ranAtIso: 'now', coveredMonth: '2026-06', trigger: 'manual', promptText: 'PROMPT',
      teams: [{ teamName: 'T', status: 'error', productionCount: 0, externalTestCount: 0, message: 'Jira search failed: 401' }],
    };
    runMonthlyDeliveryNow.mockResolvedValue({ ok: true, result: runResult });

    const response = await request(makeApp(CONFIGURED)).post('/api/monthly-delivery/run-now');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.result.teams[0].status).toBe('error');
    expect(runMonthlyDeliveryNow).toHaveBeenCalledWith(CONFIGURED, { trigger: 'manual' });
  });

  it('returns 400 when no teams are configured', async () => {
    const response = await request(makeApp({})).post('/api/monthly-delivery/run-now');
    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/no teams configured/i);
    expect(runMonthlyDeliveryNow).not.toHaveBeenCalled();
  });

  it('returns 409 while a run is already in progress', async () => {
    isMonthlyDeliveryRunInProgress.mockReturnValueOnce(true);
    const response = await request(makeApp(CONFIGURED)).post('/api/monthly-delivery/run-now');
    expect(response.status).toBe(409);
    expect(runMonthlyDeliveryNow).not.toHaveBeenCalled();
  });

  it('returns 500 only for an infrastructure failure of the run itself', async () => {
    runMonthlyDeliveryNow.mockRejectedValue(new Error('results disk full'));
    const response = await request(makeApp(CONFIGURED)).post('/api/monthly-delivery/run-now');
    expect(response.status).toBe(500);
    expect(response.body.ok).toBe(false);
  });
});

describe('GET /api/monthly-delivery/status', () => {
  it('returns the persisted last RunResult verbatim, including the prompt', async () => {
    readLastRunResult.mockReturnValue({
      hasRun: true, ranAtIso: 'x', coveredMonth: '2026-06', trigger: 'scheduled', promptText: 'PROMPT',
      teams: [{ teamName: 'T', status: 'ok', productionCount: 2, externalTestCount: 1, message: '' }],
    });
    const response = await request(makeApp({})).get('/api/monthly-delivery/status');
    expect(response.status).toBe(200);
    expect(response.body.promptText).toBe('PROMPT');
    expect(response.body.teams[0].productionCount).toBe(2);
  });

  it('reports hasRun false before any run has completed', async () => {
    readLastRunResult.mockReturnValue({ hasRun: false });
    const response = await request(makeApp({})).get('/api/monthly-delivery/status');
    expect(response.body).toEqual({ hasRun: false });
  });
});
