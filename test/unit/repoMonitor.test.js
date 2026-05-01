// test/unit/repoMonitor.test.js — Unit tests for the repository monitor service.
// Tests the exported utility functions and scheduler state management.
// Outbound HTTP calls to GitHub and Jira are not tested here — those are
// covered by the integration tests via nock-intercepted HTTP.

'use strict';

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
