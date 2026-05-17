// schedulerApi.test.ts — Unit tests for scheduler repo-monitor API helpers.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchSchedulerConfig,
  fetchSchedulerResults,
  fetchSchedulerStatus,
  fetchSchedulerValidation,
  runSchedulerNow,
  updateSchedulerConfig,
} from './schedulerApi.ts';

const MOCK_CONFIG_RESPONSE = {
  repoMonitor: {
    enabled: true,
    repos: ['org/repo-one'],
    branchPattern: 'feature\\/[A-Z]+-\\d+',
    intervalMin: 15,
    transitions: {
      branchCreated: 'In Progress',
      commitPushed: '',
      prOpened: 'Code Review',
      prMerged: 'Done',
    },
  },
};

const MOCK_STATUS_RESPONSE = {
  repoMonitor: {
    enabled: true,
    repos: ['org/repo-one'],
    intervalMin: 15,
    lastRunAt: '2026-01-01T00:00:00.000Z',
    nextRunAt: '2026-01-01T00:15:00.000Z',
    eventCount: 8,
  },
};

const MOCK_RESULTS_RESPONSE = {
  repoMonitor: {
    lastRunAt: '2026-01-01T00:00:00.000Z',
    nextRunAt: '2026-01-01T00:15:00.000Z',
    eventCount: 8,
    events: [
      {
        repo: 'org/repo-one',
        eventType: 'branch_created',
        jiraKey: 'TBX-100',
        message: 'branch created — comment posted (repo-one)',
        isSuccess: true,
        timestamp: '2026-01-01T00:00:00.000Z',
        source: 'server',
      },
    ],
  },
};

const MOCK_VALIDATION_RESPONSE = {
  repoMonitor: {
    checkedAt: '2026-01-01T00:00:00.000Z',
    isGitHubConfigured: true,
    isGitHubReachable: true,
    configuredRepoCount: 1,
    reachableRepoCount: 1,
    unreachableRepoCount: 0,
    probeErrorMessage: null,
    validationMode: 'read-only-github-probe',
    repos: [
      {
        repo: 'org/repo-one',
        isReachable: true,
        branchesHttpStatus: 200,
        pullsHttpStatus: 200,
        branchProbeCount: 1,
        pullRequestProbeCount: 1,
        probeErrorMessage: null,
      },
    ],
  },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('schedulerApi', () => {
  it('fetchSchedulerConfig requests scheduler config endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(MOCK_CONFIG_RESPONSE),
    } as unknown as Response);

    await expect(fetchSchedulerConfig()).resolves.toEqual(MOCK_CONFIG_RESPONSE);
    expect(fetch).toHaveBeenCalledWith('/api/scheduler/config');
  });

  it('fetchSchedulerStatus requests scheduler status endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(MOCK_STATUS_RESPONSE),
    } as unknown as Response);

    await expect(fetchSchedulerStatus()).resolves.toEqual(MOCK_STATUS_RESPONSE);
    expect(fetch).toHaveBeenCalledWith('/api/scheduler/status');
  });

  it('fetchSchedulerResults requests scheduler results endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(MOCK_RESULTS_RESPONSE),
    } as unknown as Response);

    await expect(fetchSchedulerResults()).resolves.toEqual(MOCK_RESULTS_RESPONSE);
    expect(fetch).toHaveBeenCalledWith('/api/scheduler/results');
  });

  it('updateSchedulerConfig posts scheduler config payload', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response);

    await expect(updateSchedulerConfig(MOCK_CONFIG_RESPONSE)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith('/api/scheduler/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(MOCK_CONFIG_RESPONSE),
    });
  });

  it('fetchSchedulerValidation requests scheduler validation endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(MOCK_VALIDATION_RESPONSE),
    } as unknown as Response);

    await expect(fetchSchedulerValidation()).resolves.toEqual(MOCK_VALIDATION_RESPONSE);
    expect(fetch).toHaveBeenCalledWith('/api/scheduler/validate');
  });

  it('runSchedulerNow posts to run-now endpoint', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200 } as Response);

    await expect(runSchedulerNow()).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith('/api/scheduler/run-now', { method: 'POST' });
  });

  it('throws descriptive errors for non-ok responses', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);

    await expect(fetchSchedulerConfig()).rejects.toThrow('scheduler-config fetch failed: 500');
    await expect(fetchSchedulerStatus()).rejects.toThrow('scheduler-status fetch failed: 500');
    await expect(fetchSchedulerResults()).rejects.toThrow('scheduler-results fetch failed: 500');
    await expect(fetchSchedulerValidation()).rejects.toThrow('scheduler validation fetch failed: 500');
    await expect(runSchedulerNow()).rejects.toThrow('scheduler run-now failed: 500');
  });
});

