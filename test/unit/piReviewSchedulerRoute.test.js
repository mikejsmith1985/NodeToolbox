// test/unit/piReviewSchedulerRoute.test.js — Endpoints for the PI Review scheduler (feature 015).
// The scheduler service and config save are mocked, so this runs in Jest without linkedom or disk I/O.

'use strict';

jest.mock('../../src/config/loader', () => ({ saveConfigToDisk: jest.fn() }));
jest.mock('../../src/services/piReviewScheduler', () => ({
  runPiReviewTeamNow: jest.fn(),
  readLastRunResults: jest.fn(),
}));

const express = require('express');
const request = require('supertest');
const { saveConfigToDisk } = require('../../src/config/loader');
const { runPiReviewTeamNow, readLastRunResults } = require('../../src/services/piReviewScheduler');
const createPiReviewSchedulerRouter = require('../../src/routes/piReviewScheduler');

function makeApp(configuration) {
  const app = express();
  app.use(express.json());
  app.use(createPiReviewSchedulerRouter(configuration));
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/pi-review-scheduler/config', () => {
  it('returns the configured teams', async () => {
    const configuration = { scheduler: { piReview: { teams: [{ teamName: 'Transformers', isEnabled: true }] } } };
    const response = await request(makeApp(configuration)).get('/api/pi-review-scheduler/config');
    expect(response.status).toBe(200);
    expect(response.body.teams).toHaveLength(1);
    expect(response.body.teams[0].teamName).toBe('Transformers');
  });

  it('returns an empty list when nothing is configured', async () => {
    const response = await request(makeApp({})).get('/api/pi-review-scheduler/config');
    expect(response.body.teams).toEqual([]);
  });
});

describe('POST /api/pi-review-scheduler/config', () => {
  it('sanitises, persists, and never echoes unexpected/credential fields', async () => {
    const configuration = {};
    const response = await request(makeApp(configuration))
      .post('/api/pi-review-scheduler/config')
      .send({
        teams: [{
          teamName: '  Transformers  ',
          isEnabled: true,
          scheduleTime: '06:30',
          productOwnerAssignee: 'C73130',
          piFieldId: 'customfield_10301',
          pages: [{ pageUrlOrId: '12345', piName: 'PI 26.4', extra: 'DROP ME' }],
          apiToken: 'should-be-dropped',
        }],
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    const savedTeam = response.body.teams[0];
    expect(savedTeam.teamName).toBe('Transformers'); // trimmed
    expect(savedTeam).not.toHaveProperty('apiToken'); // credential/unexpected field dropped
    expect(savedTeam.pages[0]).toEqual({ pageUrlOrId: '12345', piName: 'PI 26.4' }); // extra dropped
    expect(saveConfigToDisk).toHaveBeenCalledTimes(1);
    expect(configuration.scheduler.piReview.teams[0].teamName).toBe('Transformers');
  });

  it('defaults an invalid schedule time to 06:00 and drops pages without a URL', async () => {
    const response = await request(makeApp({}))
      .post('/api/pi-review-scheduler/config')
      .send({ teams: [{ teamName: 'T', scheduleTime: '99:99', pages: [{ piName: 'no url' }] }] });
    expect(response.body.teams[0].scheduleTime).toBe('06:00');
    expect(response.body.teams[0].pages).toEqual([]);
  });
});

describe('POST /api/pi-review-scheduler/run-now', () => {
  it('runs the team and returns per-page results', async () => {
    runPiReviewTeamNow.mockResolvedValue({ ok: true, teamName: 'T', results: [{ status: 'success', pageUrlOrId: '12345' }] });
    const configuration = { scheduler: { piReview: { teams: [{ teamName: 'T' }] } } };
    const response = await request(makeApp(configuration)).post('/api/pi-review-scheduler/run-now').send({ teamIndex: 0 });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.results).toHaveLength(1);
    expect(runPiReviewTeamNow).toHaveBeenCalledWith(configuration, 0);
  });

  it('rejects a non-integer teamIndex with 400', async () => {
    const response = await request(makeApp({})).post('/api/pi-review-scheduler/run-now').send({ teamIndex: 'nope' });
    expect(response.status).toBe(400);
    expect(runPiReviewTeamNow).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown team', async () => {
    runPiReviewTeamNow.mockResolvedValue({ ok: false, teamName: '9', results: [] });
    const response = await request(makeApp({})).post('/api/pi-review-scheduler/run-now').send({ teamIndex: 9 });
    expect(response.status).toBe(404);
  });
});

describe('GET /api/pi-review-scheduler/status', () => {
  it('returns the persisted last-run results per team', async () => {
    readLastRunResults.mockReturnValue({ Transformers: [{ pageUrlOrId: '12345', status: 'success', ranAtIso: 'x', message: '' }] });
    const response = await request(makeApp({})).get('/api/pi-review-scheduler/status');
    expect(response.status).toBe(200);
    expect(response.body.teams.Transformers[0].status).toBe('success');
  });
});
