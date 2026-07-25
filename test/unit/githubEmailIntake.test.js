// test/unit/githubEmailIntakeRoute.test.js — The Admin Hub route: config sanitisation/persistence,
// run-now guards, preview, and status. The scheduler service and config saver are mocked so the route
// logic is tested in isolation.

'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../src/config/loader', () => ({ saveConfigToDisk: jest.fn() }));
jest.mock('../../src/services/githubEmailIntakeScheduler', () => ({
  runGithubEmailIntakeNow: jest.fn(),
  isGithubEmailIntakeRunInProgress: jest.fn(() => false),
  readLastRunResult: jest.fn(() => ({ hasRun: true, postedCount: 2 })),
}));
// Mock the Outlook exporter so the export-test endpoint never spawns PowerShell/Outlook on the test host.
jest.mock('../../src/services/outlookEmailExport', () => ({
  runOutlookExport: jest.fn(() => Promise.resolve({ ok: true, exportedCount: 3, total: 4 })),
}));

const { saveConfigToDisk } = require('../../src/config/loader');
const scheduler = require('../../src/services/githubEmailIntakeScheduler');
const { runOutlookExport } = require('../../src/services/outlookEmailExport');
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

describe('POST /api/github-email-intake/export-test', () => {
  it('runs the Outlook export with the configured folders and returns the result', async () => {
    const configuration = {
      scheduler: { githubEmailIntake: {
        dropFolder: 'C:\\gh',
        outlookExport: { sourceFolder: 'Inbox\\GH In', processedFolder: 'Inbox\\GH Done' },
      } },
    };
    const response = await request(buildApp(configuration)).post('/api/github-email-intake/export-test').send({});

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, result: { ok: true, exportedCount: 3, total: 4 } });
    expect(runOutlookExport).toHaveBeenCalledWith({
      sourceFolder: 'Inbox\\GH In', processedFolder: 'Inbox\\GH Done', dropFolder: 'C:\\gh',
    });
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

describe('outlookExport config round-trip', () => {
  it('sanitises and persists the outlookExport block, defaulting blank folders', async () => {
    const configuration = freshConfig();
    await request(buildApp(configuration))
      .post('/api/github-email-intake/config')
      .send({ dropFolder: 'C:\\gh', outlookExport: { isEnabled: true, sourceFolder: '  ', processedFolder: 'Inbox\\Done' } });

    const saved = configuration.scheduler.githubEmailIntake.outlookExport;
    expect(saved.isEnabled).toBe(true);
    expect(saved.sourceFolder).toBe('Inbox\\GitHub Intake'); // blank → default
    expect(saved.processedFolder).toBe('Inbox\\Done');
  });
});
