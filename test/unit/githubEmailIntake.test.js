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
  runGithubEmailSourcesNow: jest.fn(),
  filterNewSharePointFileNames: jest.fn((names) => names),
  collectRuleSamples: jest.fn(),
  isGithubEmailIntakeRunInProgress: jest.fn(() => false),
  readLastRunResult: jest.fn(() => ({ hasRun: true, postedCount: 2 })),
  readRunLog: jest.fn(() => [
    { ranAtIso: '2026-08-03T07:00:00.000Z', trigger: 'scheduled', mode: 'full', postedCount: 1, skippedCount: 2, errorCount: 0, events: [] },
  ]),
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

  it('keeps a rule\'s parent-story action fields and the Sub-status field id through sanitisation', async () => {
    const configuration = freshConfig();
    await request(buildApp(configuration))
      .post('/api/github-email-intake/config')
      .send({
        dropFolder: 'C:\\gh',
        subStatusFieldId: ' customfield_10201 ',
        customRules: [{
          id: 'org-branch-merged', eventType: 'pr_merged', bodyPattern: 'merged .* into (main|develop)',
          transitionStatus: 'Done',
          parentTransitionStatus: '  Ready for Testing  ',
          parentSubStatusValue: 'Dev Complete',
          parentRequiresAllDevDone: false,
        }],
      });

    const saved = configuration.scheduler.githubEmailIntake;
    expect(saved.subStatusFieldId).toBe('customfield_10201');
    expect(saved.customRules[0].parentTransitionStatus).toBe('Ready for Testing');
    expect(saved.customRules[0].parentSubStatusValue).toBe('Dev Complete');
    expect(saved.customRules[0].parentRequiresAllDevDone).toBe(false);
  });

  it('stores the guard only when explicitly turned OFF and defaults the Sub-status field id', async () => {
    const configuration = freshConfig();
    await request(buildApp(configuration))
      .post('/api/github-email-intake/config')
      .send({
        dropFolder: 'C:\\gh',
        customRules: [{
          id: 'org-branch-merged', eventType: 'pr_merged', bodyPattern: 'merged',
          parentTransitionStatus: 'Ready for Testing',
          parentRequiresAllDevDone: true,
        }],
      });

    const saved = configuration.scheduler.githubEmailIntake;
    expect(saved.subStatusFieldId).toBe('customfield_10201');
    expect(saved.customRules[0].parentRequiresAllDevDone).toBeUndefined(); // default (on) stays clean
  });
});

describe('GET /api/github-email-intake/sub-status-options', () => {
  it('unions the Sub-status dropdown options across the configured projects via createmeta', async () => {
    makeJiraApiRequest.mockResolvedValue({
      status: 200,
      body: {
        projects: [{
          issuetypes: [
            { fields: { customfield_10201: { allowedValues: [{ value: 'Dev Complete' }, { value: 'In QA' }] } } },
            { fields: { customfield_10201: { allowedValues: [{ value: 'Dev Complete' }, { value: 'Blocked' }] } } },
          ],
        }],
      },
    });
    const configuration = { scheduler: { githubEmailIntake: { dropFolder: 'C:\\gh', jiraProjectKeys: ['DENP'], subStatusFieldId: 'customfield_10201' } } };

    const response = await request(buildApp(configuration)).get('/api/github-email-intake/sub-status-options');

    expect(response.status).toBe(200);
    expect(response.body.options).toEqual(['Blocked', 'Dev Complete', 'In QA']);
  });

  it('returns an empty list (never throws) when Jira is unreachable', async () => {
    makeJiraApiRequest.mockRejectedValue(new Error('down'));
    const configuration = { scheduler: { githubEmailIntake: { dropFolder: 'C:\\gh', jiraProjectKeys: ['DENP'] } } };

    const response = await request(buildApp(configuration)).get('/api/github-email-intake/sub-status-options');

    expect(response.status).toBe(200);
    expect(response.body.options).toEqual([]);
  });

  it('falls back to the per-project createmeta endpoints when the legacy one is gone (Jira DC 9)', async () => {
    makeJiraApiRequest.mockImplementation(async (_method, path) => {
      const decodedPath = decodeURIComponent(path);
      // Jira DC 9 removed the legacy full createmeta.
      if (decodedPath.includes('/issue/createmeta?')) {
        return { status: 410, body: {} };
      }
      if (/\/issue\/createmeta\/DENP\/issuetypes\?/.test(decodedPath)) {
        return { status: 200, body: { values: [{ id: '10001', name: 'Story' }, { id: '10004', name: 'Defect' }] } };
      }
      if (/\/issue\/createmeta\/DENP\/issuetypes\/10001/.test(decodedPath)) {
        return { status: 200, body: { values: [
          { fieldId: 'summary' },
          { fieldId: 'customfield_10201', allowedValues: [{ value: 'Dev Complete' }, { value: 'In QA' }] },
        ] } };
      }
      if (/\/issue\/createmeta\/DENP\/issuetypes\/10004/.test(decodedPath)) {
        return { status: 200, body: { values: [{ fieldId: 'customfield_10201', allowedValues: [{ value: 'Blocked' }] }] } };
      }
      return { status: 404, body: {} };
    });
    const configuration = { scheduler: { githubEmailIntake: { dropFolder: 'C:\\gh', jiraProjectKeys: ['DENP'], subStatusFieldId: 'customfield_10201' } } };

    const response = await request(buildApp(configuration)).get('/api/github-email-intake/sub-status-options');

    expect(response.status).toBe(200);
    expect(response.body.options).toEqual(['Blocked', 'Dev Complete', 'In QA']);
  });

  it('resolves options via the JQL suggestions endpoint when no project keys are configured', async () => {
    makeJiraApiRequest.mockImplementation(async (_method, path) => {
      const decodedPath = decodeURIComponent(path);
      if (decodedPath.endsWith('/rest/api/2/field')) {
        return { status: 200, body: [
          { id: 'customfield_10999', name: 'Something Else' },
          { id: 'customfield_10201', name: 'Sub-status' },
        ] };
      }
      if (decodedPath.includes('/jql/autocompletedata/suggestions') && decodedPath.includes('fieldName=Sub-status')) {
        return { status: 200, body: { results: [
          { value: '"Dev Complete"', displayName: 'Dev Complete' },
          { value: '"In QA"', displayName: 'In QA' },
        ] } };
      }
      return { status: 404, body: {} };
    });
    const configuration = { scheduler: { githubEmailIntake: { dropFolder: 'C:\\gh', jiraProjectKeys: [], subStatusFieldId: 'customfield_10201' } } };

    const response = await request(buildApp(configuration)).get('/api/github-email-intake/sub-status-options');

    expect(response.status).toBe(200);
    expect(response.body.options).toEqual(['Dev Complete', 'In QA']);
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

describe('POST /api/github-email-intake/rule-samples', () => {
  it('forwards includeAll and returns the collected samples', async () => {
    scheduler.collectRuleSamples.mockReturnValueOnce({
      ok: true, samples: [{ fileName: 'a.eml', eventType: 'unknown', rawSource: 'raw' }], totalCount: 3, unknownCount: 1, truncated: false,
    });
    const response = await request(buildApp(freshConfig()))
      .post('/api/github-email-intake/rule-samples')
      .send({ includeAll: true });

    expect(response.status).toBe(200);
    expect(response.body.samples).toHaveLength(1);
    const [, deps] = scheduler.collectRuleSamples.mock.calls[0];
    expect(deps.includeAll).toBe(true);
  });

  it('returns 400 when the collector reports no drop folder', async () => {
    scheduler.collectRuleSamples.mockReturnValueOnce({ ok: false, message: 'No drop folder configured — set it and save first.', samples: [] });
    const response = await request(buildApp(freshConfig()))
      .post('/api/github-email-intake/rule-samples')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
  });
});

describe('GET /api/github-email-intake/status', () => {
  it('returns the persisted last run', async () => {
    const response = await request(buildApp(freshConfig())).get('/api/github-email-intake/status');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ hasRun: true, postedCount: 2 });
  });
});

describe('GET /api/github-email-intake/run-log', () => {
  it('returns the persisted run history so operators can verify scheduled activity', async () => {
    const response = await request(buildApp(freshConfig())).get('/api/github-email-intake/run-log');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.runs).toHaveLength(1);
    expect(response.body.runs[0]).toMatchObject({ trigger: 'scheduled', postedCount: 1 });
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

describe('SharePoint source routes', () => {
  it('saves the SharePoint folder URL with the config and returns it on GET', async () => {
    const configuration = freshConfig();
    await request(buildApp(configuration))
      .post('/api/github-email-intake/config')
      .send({ dropFolder: 'C:\\gh', sharePointFolderUrl: '  /sites/Team/Shared Documents/GitHubEmails  ' });
    expect(configuration.scheduler.githubEmailIntake.sharePointFolderUrl).toBe('/sites/Team/Shared Documents/GitHubEmails');

    const response = await request(buildApp(configuration)).get('/api/github-email-intake/config');
    expect(response.body.sharePointFolderUrl).toBe('/sites/Team/Shared Documents/GitHubEmails');
  });

  it('moves a URL pasted into the LOCAL drop folder to the SharePoint folder field on save', async () => {
    const configuration = freshConfig();
    const response = await request(buildApp(configuration))
      .post('/api/github-email-intake/config')
      .send({ dropFolder: 'https://myfyi.sharepoint.com/:f:/r/sites/Team/Shared%20Documents/gh_emails?web=1' });

    expect(response.status).toBe(200);
    // Self-healing, not just a warning: the saved config is immediately usable.
    const saved = configuration.scheduler.githubEmailIntake;
    expect(saved.dropFolder).toBe('');
    expect(saved.sharePointFolderUrl).toBe('/sites/Team/Shared Documents/gh_emails');
    expect(response.body.folderWarning).toMatch(/local path/i);
    expect(response.body.folderWarning).toMatch(/SharePoint/);
  });

  it('run-now without a drop folder points at the SharePoint pull when that source is configured', async () => {
    const configuration = { scheduler: { githubEmailIntake: { dropFolder: '', sharePointFolderUrl: '/sites/Team/GitHubEmails' } } };
    const response = await request(buildApp(configuration)).post('/api/github-email-intake/run-now');

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/Pull from SharePoint/i);
  });

  it('POST /sharepoint/filter-new returns only the names the seen-ledger has not recorded', async () => {
    scheduler.filterNewSharePointFileNames.mockReturnValueOnce(['fresh.eml']);
    const response = await request(buildApp(freshConfig()))
      .post('/api/github-email-intake/sharepoint/filter-new')
      .send({ fileNames: ['seen.eml', 'fresh.eml'] });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, newFileNames: ['fresh.eml'] });
    expect(scheduler.filterNewSharePointFileNames).toHaveBeenCalledWith(['seen.eml', 'fresh.eml']);
  });

  it('POST /sharepoint/filter-new rejects a body without a fileNames array', async () => {
    const response = await request(buildApp(freshConfig()))
      .post('/api/github-email-intake/sharepoint/filter-new')
      .send({});
    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
  });

  it('POST /sharepoint/run ingests the posted sources with the configured folder as the label', async () => {
    scheduler.runGithubEmailSourcesNow.mockResolvedValueOnce({ ok: true, result: { postedCount: 1, events: [] } });
    const configuration = freshConfig();
    configuration.scheduler.githubEmailIntake.sharePointFolderUrl = '/sites/Team/GitHubEmails';

    const response = await request(buildApp(configuration))
      .post('/api/github-email-intake/sharepoint/run')
      .send({ sources: [{ fileName: 'a.eml', content: 'raw' }] });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.result.postedCount).toBe(1);
    expect(scheduler.runGithubEmailSourcesNow).toHaveBeenCalledWith(
      configuration,
      { folderLabel: '/sites/Team/GitHubEmails', sources: [{ fileName: 'a.eml', content: 'raw' }], listedCount: 0, pullId: '' },
    );
  });

  it('POST /sharepoint/run forwards the client pullId so batches merge into one log entry', async () => {
    scheduler.runGithubEmailSourcesNow.mockResolvedValueOnce({ ok: true, result: { postedCount: 0, events: [] } });
    await request(buildApp(freshConfig()))
      .post('/api/github-email-intake/sharepoint/run')
      .send({ sources: [{ fileName: 'a.eml', content: 'raw' }], pullId: 'pull-abc' });

    expect(scheduler.runGithubEmailSourcesNow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ pullId: 'pull-abc' }),
    );
  });

  it('POST /sharepoint/run accepts EMPTY sources so an all-caught-up pull still logs a sweep', async () => {
    scheduler.runGithubEmailSourcesNow.mockResolvedValueOnce({ ok: true, result: { postedCount: 0, events: [] } });
    const response = await request(buildApp(freshConfig()))
      .post('/api/github-email-intake/sharepoint/run')
      .send({ sources: [], listedCount: 7 });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(scheduler.runGithubEmailSourcesNow).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sources: [], listedCount: 7 }),
    );
  });

  it('POST /sharepoint/run rejects a non-array sources value and an over-cap batch', async () => {
    const missingResponse = await request(buildApp(freshConfig()))
      .post('/api/github-email-intake/sharepoint/run')
      .send({});
    expect(missingResponse.status).toBe(400);

    const overCap = Array.from({ length: 101 }, (_unused, index) => ({ fileName: `f${index}.eml`, content: 'x' }));
    const overCapResponse = await request(buildApp(freshConfig()))
      .post('/api/github-email-intake/sharepoint/run')
      .send({ sources: overCap });
    expect(overCapResponse.status).toBe(400);
    expect(overCapResponse.body.message).toMatch(/batch/i);
    expect(scheduler.runGithubEmailSourcesNow).not.toHaveBeenCalled();
  });

  it('POST /sharepoint/preview dry-runs the sources without ledgering, seen-recording, or run logging', async () => {
    scheduler.runGithubEmailSourcesNow.mockResolvedValueOnce({ ok: true, result: { mode: 'dryRun', events: [] } });
    const configuration = freshConfig();
    configuration.scheduler.githubEmailIntake.mode = 'full';
    configuration.scheduler.githubEmailIntake.sharePointFolderUrl = '/sites/Team/GitHubEmails';

    const response = await request(buildApp(configuration))
      .post('/api/github-email-intake/sharepoint/preview')
      .send({ sources: [{ fileName: 'a.eml', content: 'raw' }] });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    const [previewConfiguration, pullInput, previewDeps] = scheduler.runGithubEmailSourcesNow.mock.calls[0];
    // Mode is FORCED to dryRun regardless of the configured rollout mode…
    expect(previewConfiguration.scheduler.githubEmailIntake.mode).toBe('dryRun');
    expect(pullInput).toEqual({ folderLabel: '/sites/Team/GitHubEmails', sources: [{ fileName: 'a.eml', content: 'raw' }] });
    // …and nothing persists: no ledger write, no seen-file recording, no last-run/Activity-Log entry.
    expect(previewDeps.writeLastRun).toBe(false);
    expect(typeof previewDeps.writeLedger).toBe('function');
    expect(typeof previewDeps.recordSeenNames).toBe('function');
  });

  it('POST /sharepoint/run returns 409 while another intake run is in progress', async () => {
    scheduler.isGithubEmailIntakeRunInProgress.mockReturnValueOnce(true);
    const response = await request(buildApp(freshConfig()))
      .post('/api/github-email-intake/sharepoint/run')
      .send({ sources: [{ fileName: 'a.eml', content: 'raw' }] });
    expect(response.status).toBe(409);
  });
});
