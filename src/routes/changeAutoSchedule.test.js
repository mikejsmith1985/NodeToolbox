// src/routes/changeAutoSchedule.test.js — Admin Hub endpoints for the change auto-schedule sweeper.

jest.mock('../config/loader', () => ({ saveConfigToDisk: jest.fn() }));
jest.mock('../services/changeAutoScheduleScheduler', () => ({
  runChangeAutoScheduleSweep: jest.fn(),
  readRunHistory: jest.fn(() => []),
  DEFAULT_SWEEP_INTERVAL_MINUTES: 5,
}));

const express = require('express');
const request = require('supertest');

const { saveConfigToDisk } = require('../config/loader');
const { runChangeAutoScheduleSweep, readRunHistory } = require('../services/changeAutoScheduleScheduler');
const createChangeAutoScheduleRouter = require('./changeAutoSchedule');

/** Builds an app around a live config object the router mutates in place. */
function buildApp(configuration) {
  const app = express();
  app.use(express.json());
  app.use(createChangeAutoScheduleRouter(configuration));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  readRunHistory.mockReturnValue([]);
});

describe('GET /api/change-auto-schedule/config', () => {
  it('answers with defaults when the sweeper was never configured', async () => {
    const response = await request(buildApp({})).get('/api/change-auto-schedule/config');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ isEnabled: false, isDryRun: false, intervalMin: 5, leadTimeMinutes: 0 });
  });

  it('answers with what was stored', async () => {
    const configuration = { scheduler: { changeAutoSchedule: { isEnabled: true, intervalMin: 15, leadTimeMinutes: 30, isDryRun: false } } };

    const response = await request(buildApp(configuration)).get('/api/change-auto-schedule/config');

    expect(response.body.isEnabled).toBe(true);
    expect(response.body.intervalMin).toBe(15);
  });
});

describe('POST /api/change-auto-schedule/config', () => {
  it('persists a sanitised block', async () => {
    const configuration = {};

    const response = await request(buildApp(configuration))
      .post('/api/change-auto-schedule/config')
      .send({ isEnabled: true, intervalMin: 10, leadTimeMinutes: 15 });

    expect(response.status).toBe(200);
    expect(configuration.scheduler.changeAutoSchedule)
      .toEqual({ isEnabled: true, isDryRun: false, intervalMin: 10, leadTimeMinutes: 15 });
    expect(saveConfigToDisk).toHaveBeenCalledTimes(1);
  });

  it('clamps an interval that would sweep every second or once a week', async () => {
    const configuration = {};

    await request(buildApp(configuration))
      .post('/api/change-auto-schedule/config')
      .send({ isEnabled: true, intervalMin: 0 });
    expect(configuration.scheduler.changeAutoSchedule.intervalMin).toBe(1);

    await request(buildApp(configuration))
      .post('/api/change-auto-schedule/config')
      .send({ isEnabled: true, intervalMin: 99999 });
    expect(configuration.scheduler.changeAutoSchedule.intervalMin).toBe(240);
  });

  it('falls back rather than storing an unreadable interval', async () => {
    const configuration = {};

    await request(buildApp(configuration))
      .post('/api/change-auto-schedule/config')
      .send({ isEnabled: true, intervalMin: 'soon' });

    expect(configuration.scheduler.changeAutoSchedule.intervalMin).toBe(5);
  });

  it('reports a failed save rather than claiming success', async () => {
    saveConfigToDisk.mockImplementation(() => { throw new Error('disk full'); });

    const response = await request(buildApp({}))
      .post('/api/change-auto-schedule/config')
      .send({ isEnabled: true });

    expect(response.status).toBe(500);
    expect(response.body.message).toMatch(/disk full/);
  });
});

describe('POST /api/change-auto-schedule/run-now', () => {
  it('returns the sweep summary', async () => {
    runChangeAutoScheduleSweep.mockResolvedValue({ scheduledChangeNumbers: ['CHG1'], failures: [], skipReason: '' });

    const response = await request(buildApp({})).post('/api/change-auto-schedule/run-now').send({});

    expect(response.status).toBe(200);
    expect(response.body.run.scheduledChangeNumbers).toEqual(['CHG1']);
  });

  it('answers 200 with the reason when the sweep could not act', async () => {
    // "The relay is not registered" is an outcome the operator needs to read, not a server error.
    runChangeAutoScheduleSweep.mockResolvedValue({
      scheduledChangeNumbers: [], failures: [], skipReason: 'The ServiceNow relay bookmarklet is not registered, so no change could be updated.',
    });

    const response = await request(buildApp({})).post('/api/change-auto-schedule/run-now').send({});

    expect(response.status).toBe(200);
    expect(response.body.run.skipReason).toMatch(/not registered/);
  });
});

describe('GET /api/change-auto-schedule/runs', () => {
  it('returns the recorded sweeps', async () => {
    readRunHistory.mockReturnValue([{ ranAtIso: '2026-08-31T09:00:00.000Z', scheduledChangeNumbers: ['CHG1'] }]);

    const response = await request(buildApp({})).get('/api/change-auto-schedule/runs');

    expect(response.body.runs).toHaveLength(1);
  });
});
