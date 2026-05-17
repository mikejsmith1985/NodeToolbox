// test/unit/repoMonitor.test.js — Unit tests for the repository monitor service.
// Tests the exported utility functions, scheduler state management, and the
// GitHub connectivity probe. HTTP is intercepted with nock for probe tests.

'use strict';

const nock        = require('nock');
const repoMonitor = require('../../src/services/repoMonitor');

// ── Shared test configuration ─────────────────────────────────────────────────

function buildTestConfig(overrides) {
  return Object.assign(
    {
      jira:   { baseUrl: 'https://jira.example.com', pat: 'jira-pat', username: '', apiToken: '' },
      snow:   { baseUrl: '', username: '', password: '' },
      github: { baseUrl: 'https://api.github.com', pat: 'gh-pat' },
      sslVerify: true,
      scheduler: {
        repoMonitor: {
          enabled:       false,
          repos:         [],
          branchPattern: 'feature/[A-Z]+-\\d+',
          intervalMin:   15,
          transitions:   {},
          seenBranches:  {},
          seenCommits:   {},
          seenPrs:       {},
        },
      },
    },
    overrides
  );
}

// ── getSchedulerStatus ────────────────────────────────────────────────────────

describe('getSchedulerStatus', () => {
  it('returns a status object with repoMonitor key', () => {
    const configuration = buildTestConfig();
    const status = repoMonitor.getSchedulerStatus(configuration);
    expect(status.repoMonitor).toBeDefined();
  });

  it('reflects enabled:false when the scheduler is disabled', () => {
    const configuration = buildTestConfig();
    const status = repoMonitor.getSchedulerStatus(configuration);
    expect(status.repoMonitor.enabled).toBe(false);
  });

  it('reflects enabled:true when the scheduler is enabled', () => {
    const configuration = buildTestConfig();
    configuration.scheduler.repoMonitor.enabled = true;
    const status = repoMonitor.getSchedulerStatus(configuration);
    expect(status.repoMonitor.enabled).toBe(true);
  });

  it('returns intervalMin from configuration', () => {
    const configuration = buildTestConfig();
    configuration.scheduler.repoMonitor.intervalMin = 30;
    const status = repoMonitor.getSchedulerStatus(configuration);
    expect(status.repoMonitor.intervalMin).toBe(30);
  });

  it('returns an empty repos array when no repos are configured', () => {
    const configuration = buildTestConfig();
    const status = repoMonitor.getSchedulerStatus(configuration);
    expect(status.repoMonitor.repos).toEqual([]);
  });
});

// ── getSchedulerResults ───────────────────────────────────────────────────────

describe('getSchedulerResults', () => {
  it('returns a results object with repoMonitor key', () => {
    const results = repoMonitor.getSchedulerResults();
    expect(results.repoMonitor).toBeDefined();
  });

  it('returns an events array', () => {
    const results = repoMonitor.getSchedulerResults();
    expect(Array.isArray(results.repoMonitor.events)).toBe(true);
  });
});

// ── applySchedulerConfig ──────────────────────────────────────────────────────

describe('applySchedulerConfig', () => {
  it('updates the repos list in the live config', () => {
    const configuration = buildTestConfig();
    repoMonitor.applySchedulerConfig(configuration, {
      repoMonitor: { repos: ['owner/repo-one', 'owner/repo-two'] },
    });
    expect(configuration.scheduler.repoMonitor.repos).toEqual(['owner/repo-one', 'owner/repo-two']);
  });

  it('updates intervalMin in the live config', () => {
    const configuration = buildTestConfig();
    repoMonitor.applySchedulerConfig(configuration, {
      repoMonitor: { intervalMin: 45 },
    });
    expect(configuration.scheduler.repoMonitor.intervalMin).toBe(45);
  });

  it('clamps intervalMin to a minimum of 1 minute', () => {
    const configuration = buildTestConfig();
    repoMonitor.applySchedulerConfig(configuration, {
      repoMonitor: { intervalMin: 0 },
    });
    expect(configuration.scheduler.repoMonitor.intervalMin).toBeGreaterThanOrEqual(1);
  });

  it('updates the branchPattern in the live config', () => {
    const configuration = buildTestConfig();
    repoMonitor.applySchedulerConfig(configuration, {
      repoMonitor: { branchPattern: 'release/\\d+' },
    });
    expect(configuration.scheduler.repoMonitor.branchPattern).toBe('release/\\d+');
  });

  it('does not mutate fields that are absent from the incoming config', () => {
    const configuration = buildTestConfig();
    configuration.scheduler.repoMonitor.intervalMin = 25;
    repoMonitor.applySchedulerConfig(configuration, {
      repoMonitor: { repos: ['owner/only-this'] },
    });
    // intervalMin was not in the incoming config — must remain unchanged
    expect(configuration.scheduler.repoMonitor.intervalMin).toBe(25);
  });
});

// ── runRepoMonitor ────────────────────────────────────────────────────────────

describe('runRepoMonitor', () => {
  it('resolves without throwing when no repos are configured', async () => {
    const configuration = buildTestConfig();
    await expect(repoMonitor.runRepoMonitor(configuration)).resolves.toBeUndefined();
  });

  it('resolves without throwing when GitHub PAT is missing', async () => {
    const configuration = buildTestConfig();
    configuration.github.pat = '';
    await expect(repoMonitor.runRepoMonitor(configuration)).resolves.toBeUndefined();
  });
});

// ── testGitHubConnectivity ────────────────────────────────────────────────────

describe('testGitHubConnectivity', () => {
  afterEach(() => nock.cleanAll());

  it('returns success=true with authenticatedAs when GitHub returns HTTP 200', async () => {
    nock('https://api.github.com')
      .get('/user')
      .reply(200, { login: 'mikejsmith1985', name: 'Mike Smith' });

    const configuration = buildTestConfig();
    const probeResult   = await repoMonitor.testGitHubConnectivity(configuration);

    expect(probeResult.success).toBe(true);
    expect(probeResult.statusCode).toBe(200);
    expect(probeResult.statusText).toBe('OK');
    expect(probeResult.method).toBe('GET');
    expect(probeResult.endpoint).toMatch(/\/user/);
    expect(probeResult.authenticatedAs).toBe('mikejsmith1985');
    expect(probeResult.errorMessage).toBeUndefined();
    expect(typeof probeResult.responseTime).toBe('number');
  });

  it('returns success=false with a human-readable errorMessage when GitHub returns HTTP 401', async () => {
    nock('https://api.github.com')
      .get('/user')
      .reply(401, { message: 'Bad credentials' });

    const configuration = buildTestConfig();
    const probeResult   = await repoMonitor.testGitHubConnectivity(configuration);

    expect(probeResult.success).toBe(false);
    expect(probeResult.statusCode).toBe(401);
    expect(probeResult.statusText).toBe('Unauthorized');
    expect(probeResult.errorMessage).toMatch(/401/);
    expect(probeResult.errorMessage).toMatch(/Unauthorized/);
    expect(probeResult.errorMessage).toMatch(/Bad credentials/);
    expect(probeResult.authenticatedAs).toBeNull();
  });

  it('returns success=false with errorMessage when GitHub returns HTTP 403', async () => {
    nock('https://api.github.com')
      .get('/user')
      .reply(403, { message: 'Forbidden' });

    const configuration = buildTestConfig();
    const probeResult   = await repoMonitor.testGitHubConnectivity(configuration);

    expect(probeResult.success).toBe(false);
    expect(probeResult.statusCode).toBe(403);
    expect(probeResult.statusText).toBe('Forbidden');
    expect(probeResult.errorMessage).toMatch(/403/);
    expect(probeResult.authenticatedAs).toBeNull();
  });
});

// ── validateRepoMonitorConnectivity — probeErrorMessage capture ──────────────

describe('validateRepoMonitorConnectivity — probeErrorMessage from GitHub API body', () => {
  afterEach(() => nock.cleanAll());

  it('sets probeErrorMessage to the GitHub API body message when branches returns 403', async () => {
    nock('https://api.github.com')
      .get('/repos/zilvertonz/test-repo/branches')
      .query(true)
      .reply(403, { message: 'Your IP address is not in the allowed list for this resource.' })
      .get('/repos/zilvertonz/test-repo/pulls')
      .query(true)
      .reply(403, { message: 'Your IP address is not in the allowed list for this resource.' });

    const configuration = buildTestConfig();
    configuration.scheduler.repoMonitor.repos = ['zilvertonz/test-repo'];
    const result = await repoMonitor.validateRepoMonitorConnectivity(configuration);

    const repoResult = result.repoMonitor.repos[0];
    expect(repoResult.isReachable).toBe(false);
    expect(repoResult.branchesHttpStatus).toBe(403);
    // The actual GitHub error message must be surfaced — not null — so the UI
    // can tell the operator whether it is an IP allow list block, SAML enforcement,
    // or a missing scope issue.
    expect(repoResult.probeErrorMessage).toMatch(/IP address/i);
  });

  it('sets probeErrorMessage to null when the probe succeeds', async () => {
    nock('https://api.github.com')
      .get('/repos/zilvertonz/test-repo/branches')
      .query(true)
      .reply(200, [{ name: 'main' }])
      .get('/repos/zilvertonz/test-repo/pulls')
      .query(true)
      .reply(200, []);

    const configuration = buildTestConfig();
    configuration.scheduler.repoMonitor.repos = ['zilvertonz/test-repo'];
    const result = await repoMonitor.validateRepoMonitorConnectivity(configuration);

    const repoResult = result.repoMonitor.repos[0];
    expect(repoResult.isReachable).toBe(true);
    expect(repoResult.probeErrorMessage).toBeNull();
  });
});
