// Tests for the standup briefing router (config CRUD + run endpoints).

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../config/loader', () => ({ saveConfigToDisk: jest.fn() }));
jest.mock('../services/standupBriefingScheduler', () => ({
  runTeamBriefingNow: jest.fn(),
  runArtRollupNow: jest.fn(),
  runAdhocBriefing: jest.fn(),
}));
jest.mock('../utils/httpClient', () => ({ triggerWebhook: jest.fn() }));

const { saveConfigToDisk } = require('../config/loader');
const { runTeamBriefingNow, runAdhocBriefing } = require('../services/standupBriefingScheduler');
const { triggerWebhook } = require('../utils/httpClient');
const createStandupBriefingRouter = require('./standupBriefing');

function buildApp(configuration) {
  const app = express();
  app.use(express.json());
  app.use(createStandupBriefingRouter(configuration));
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/standup/config', () => {
  it('returns empty teamReports and a default ART rollup', async () => {
    const response = await request(buildApp({})).get('/api/standup/config');
    expect(response.status).toBe(200);
    expect(response.body.teamReports).toEqual([]);
    expect(response.body.artRollup).toMatchObject({ isEnabled: false, scheduleTime: '09:00' });
  });
});

describe('POST /api/standup/config', () => {
  it('sanitises team reports (trims, filters project keys, defaults schedule) and persists', async () => {
    const configuration = {};
    const response = await request(buildApp(configuration)).post('/api/standup/config').send({
      teamReports: [{ teamName: '  Alpha ', projectKeys: ['DENP', '  ', 5], isEnabled: 'yes' }],
    });

    expect(response.status).toBe(200);
    const saved = configuration.scheduler.standupBriefing.teamReports[0];
    expect(saved.teamName).toBe('Alpha');
    expect(saved.projectKeys).toEqual(['DENP']); // blanks and non-strings filtered
    expect(saved.scheduleTime).toBe('08:45'); // default applied
    expect(saved.isEnabled).toBe(true);
    expect(saveConfigToDisk).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/standup/run-team', () => {
  it('rejects a non-integer teamIndex with 400', async () => {
    const response = await request(buildApp({})).post('/api/standup/run-team').send({ teamIndex: -1 });
    expect(response.status).toBe(400);
    expect(runTeamBriefingNow).not.toHaveBeenCalled();
  });

  it('returns the briefing result for a valid teamIndex', async () => {
    runTeamBriefingNow.mockResolvedValue({ briefingText: '## Briefing' });
    const response = await request(buildApp({})).post('/api/standup/run-team').send({ teamIndex: 0 });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, briefingText: '## Briefing' });
  });
});

describe('POST /api/standup/run-adhoc', () => {
  it('rejects a missing projectKeys array with 400', async () => {
    const response = await request(buildApp({})).post('/api/standup/run-adhoc').send({ teamName: 'Alpha' });
    expect(response.status).toBe(400);
    expect(runAdhocBriefing).not.toHaveBeenCalled();
  });

  it('rejects a projectKeys array with no valid strings with 400', async () => {
    const response = await request(buildApp({})).post('/api/standup/run-adhoc').send({ projectKeys: ['  ', 7] });
    expect(response.status).toBe(400);
  });

  it('generates a briefing with sanitised keys and default daysBack', async () => {
    runAdhocBriefing.mockResolvedValue({ briefingText: 'text', counts: {} });
    const response = await request(buildApp({})).post('/api/standup/run-adhoc').send({ projectKeys: [' DENP '], teamName: '  ' });
    expect(response.status).toBe(200);
    expect(runAdhocBriefing).toHaveBeenCalledWith(expect.anything(), ['DENP'], 'Team', 1);
  });
});

describe('POST /api/standup/test-webhook', () => {
  it('rejects an invalid URL with 400', async () => {
    const response = await request(buildApp({})).post('/api/standup/test-webhook').send({ triggerUrl: 'nope' });
    expect(response.status).toBe(400);
    expect(triggerWebhook).not.toHaveBeenCalled();
  });

  it('reports webhook success', async () => {
    triggerWebhook.mockResolvedValue({ status: 200, body: '' });
    const response = await request(buildApp({})).post('/api/standup/test-webhook').send({ triggerUrl: 'https://x.atlassian.net/hook' });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });
});
