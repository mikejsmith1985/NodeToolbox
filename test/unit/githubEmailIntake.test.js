// test/unit/githubEmailIntakeRoute.test.js — The Admin Hub route: config sanitisation/persistence,
// run-now guards, preview, and status. The scheduler service and config saver are mocked so the route
// logic is tested in isolation.

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../src/config/loader', () => ({ saveConfigToDisk: jest.fn() }));
jest.mock('../../src/utils/httpClient', () => ({ makeJiraApiRequest: jest.fn() }));
jest.mock('../../src/services/githubEmailIntakeScheduler', () => ({
  runGithubEmailIntakeNow: jest.fn(),
  isGithubEmailIntakeRunInProgress: jest.fn(() => false),
  readLastRunResult: jest.fn(() => ({ hasRun: true, postedCount: 2 })),
}));

const { saveConfigToDisk } = require('../../src/config/loader');
const { makeJiraApiRequest } = require('../../src/utils/httpClient');
const scheduler = require('../../src/services/githubEmailIntakeScheduler');
const createRouter = require('../../src/routes/githubEmailIntake');

function buildApp(configuration) {
  const app = express();
  app.use(express.json());
  app.use(createRouter(configuration));
  return app;
}

function freshConfig() {
  return { scheduler: { githubEmailIntake: { dropFolder: 'C:\\gh', seenPrs: { 'r': { '1': 'merged' } } } } };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/github-email-intake/config', () => {
  it('returns merged config without exposing internal seenPrs state', async () => {
    const response = await request(buildApp(freshConfig())).get('/api/github-email-intake/config');
    expect(response.status).toBe(200);
    expect(response.body.dropFolder).toBe('C:\\gh');
    expect(response.body.seenPrs).toBeUndefined();
    expect(response.body.mode).toBe('dryRun');
  });
});

describe('POST /api/github-email-intake/config', () => {
  it('sanitises the block, preserves seenPrs, and persists', async () => {
    const configuration = freshConfig();
    const response = await request(buildApp(configuration))
      .post('/api/github-email-intake/config')
      .send({ isEnabled: true, mode: 'nonsense', scheduleTime: '99:99', jiraProjectKeys: ['denp', ''], dropFolder: 'C:\\gh' });

    expect(response.status).toBe(200);
    expect(saveConfigToDisk).toHaveBeenCalledTimes(1);
    const saved = configuration.scheduler.githubEmailIntake;
    expect(saved.mode).toBe('dryRun');           // invalid mode coerced
    expect(saved.scheduleTime).toBe('07:00');    // invalid time coerced
    expect(saved.jiraProjectKeys).toEqual(['DENP']); // uppercased, blanks dropped
    expect(saved.seenPrs).toEqual({ r: { '1': 'merged' } }); // dedup state preserved
  });

  it('returns 500 when the config save fails', async () => {
    saveConfigToDisk.mockImplementationOnce(() => { throw new Error('disk full'); });
    const response = await request(buildApp(freshConfig()))
      .post('/api/github-email-intake/config')
      .send({ dropFolder: 'C:\\gh' });
    expect(response.status).toBe(500);
    expect(response.body.message).toMatch(/disk full/);
  });
});

describe('POST /api/github-email-intake/run-now', () => {
  it('400s when no drop folder is configured', async () => {
    const response = await request(buildApp({ scheduler: { githubEmailIntake: { dropFolder: '' } } }))
      .post('/api/github-email-intake/run-now').send({});
    expect(response.status).toBe(400);
    expect(scheduler.runGithubEmailIntakeNow).not.toHaveBeenCalled();
  });

  it('409s when a run is already in progress', async () => {
    scheduler.isGithubEmailIntakeRunInProgress.mockReturnValueOnce(true);
    const response = await request(buildApp(freshConfig())).post('/api/github-email-intake/run-now').send({});
    expect(response.status).toBe(409);
  });

  it('returns the run result on success', async () => {
    scheduler.runGithubEmailIntakeNow.mockResolvedValueOnce({ ok: true, result: { postedCount: 3 } });
    const response = await request(buildApp(freshConfig())).post('/api/github-email-intake/run-now').send({});
    expect(response.status).toBe(200);
    expect(response.body.result.postedCount).toBe(3);
  });
});

describe('POST /api/github-email-intake/preview', () => {
  it('runs a dry-run preview that does not persist or archive', async () => {
    scheduler.runGithubEmailIntakeNow.mockResolvedValueOnce({ ok: true, result: { mode: 'dryRun', events: [] } });
    const response = await request(buildApp(freshConfig())).post('/api/github-email-intake/preview').send({});
    expect(response.status).toBe(200);
    // The preview forces dryRun mode and injects no-op move/ledger deps.
    const [, deps] = scheduler.runGithubEmailIntakeNow.mock.calls[0];
    expect(typeof deps.moveFile).toBe('function');
    expect(deps.writeLastRun).toBe(false);
  });
});

describe('GET /api/github-email-intake/status', () => {
  it('returns the persisted last run', async () => {
    const response = await request(buildApp(freshConfig())).get('/api/github-email-intake/status');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ hasRun: true, postedCount: 2 });
  });
});

describe('GET /api/github-email-intake/jira-statuses', () => {
  it('unions and de-dupes statuses across configured project keys', async () => {
    makeJiraApiRequest.mockResolvedValue({
      status: 200,
      body: [
        { name: 'Story', statuses: [{ name: 'To Do' }, { name: 'In Progress' }] },
        { name: 'Task', statuses: [{ name: 'In Progress' }, { name: 'Done' }] },
      ],
    });
    const configuration = { jira: { baseUrl: 'https://j' }, scheduler: { githubEmailIntake: { jiraProjectKeys: ['ENFCT'] } } };

    const response = await request(buildApp(configuration)).get('/api/github-email-intake/jira-statuses');

    expect(response.status).toBe(200);
    expect(response.body.statuses).toEqual(['Done', 'In Progress', 'To Do']);
    expect(makeJiraApiRequest).toHaveBeenCalledWith('GET', '/rest/api/2/project/ENFCT/statuses', null, { baseUrl: 'https://j' }, true);
  });

  it('falls back to the instance-wide status list when no project keys are configured', async () => {
    makeJiraApiRequest.mockResolvedValue({ status: 200, body: [{ name: 'Backlog' }, { name: 'Done' }] });
    const configuration = { jira: { baseUrl: 'https://j' }, scheduler: { githubEmailIntake: { jiraProjectKeys: [] } } };

    const response = await request(buildApp(configuration)).get('/api/github-email-intake/jira-statuses');

    expect(response.body.statuses).toEqual(['Backlog', 'Done']);
    expect(makeJiraApiRequest).toHaveBeenCalledWith('GET', '/rest/api/2/status', null, { baseUrl: 'https://j' }, true);
  });

  it('returns an empty list (never throws) when Jira is unreachable', async () => {
    makeJiraApiRequest.mockRejectedValue(new Error('ECONNREFUSED'));
    const response = await request(buildApp({ jira: {}, scheduler: { githubEmailIntake: {} } })).get('/api/github-email-intake/jira-statuses');
    expect(response.status).toBe(200);
    expect(response.body.statuses).toEqual([]);
  });
});

describe('customRules sanitisation', () => {
  it('keeps well-formed rules and drops malformed ones on save', async () => {
    const configuration = freshConfig();
    await request(buildApp(configuration))
      .post('/api/github-email-intake/config')
      .send({
        dropFolder: 'C:\\gh',
        customRules: [
          { id: 'good', eventType: 'pr_opened', bodyPattern: 'wants to merge', requiresPrNumber: true },
          { id: '', eventType: 'pr_merged', bodyPattern: 'x' }, // no id → dropped
          'not an object',                                       // dropped
        ],
      });

    const saved = configuration.scheduler.githubEmailIntake.customRules;
    expect(saved).toEqual([{ id: 'good', eventType: 'pr_opened', bodyPattern: 'wants to merge', requiresPrNumber: true }]);
  });
});
