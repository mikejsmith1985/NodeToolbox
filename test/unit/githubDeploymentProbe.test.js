// githubDeploymentProbe.test.js — A read-only check of whether GitHub's Deployments API is reachable.
//
// The whole email pipeline exists because GitHub API access has failed here before. So this probe
// exists to answer that question with facts rather than an assumption, and its most important job is
// what it does when the call FAILS: report the status, the body, the URL and the auth method, so a
// 404 on a bad base URL cannot be mistaken for "no deployments".

'use strict';

jest.mock('../../src/services/githubAppAuth', () => ({
  resolveEffectiveGitHubToken: jest.fn(),
  hasAnyGitHubAuth: jest.fn(() => true),
}));

const { resolveEffectiveGitHubToken, hasAnyGitHubAuth } = require('../../src/services/githubAppAuth');
const { probeGithubDeployments } = require('../../src/services/githubDeploymentProbe');

const CONFIGURATION = { github: { baseUrl: 'https://github.zilverton.com/api/v3' } };

function stubFetch(response) {
  global.fetch = jest.fn(async () => response);
}

beforeEach(() => {
  jest.clearAllMocks();
  hasAnyGitHubAuth.mockReturnValue(true);
  resolveEffectiveGitHubToken.mockResolvedValue({ token: 'tok', authType: 'github-app' });
});

describe('probeGithubDeployments', () => {
  it('reports the deployments it can read, with environment and ref', async () => {
    stubFetch({
      ok: true,
      status: 200,
      json: async () => ([
        { id: 1, environment: 'int', ref: 'ENFCT-1690-develop', description: '[ENFCT-1690]: Trigger LEP', created_at: '2026-08-19T12:00:00Z' },
      ]),
    });

    const outcome = await probeGithubDeployments(CONFIGURATION, 'zilvertonz', 'usmg-elements-integrations');

    expect(outcome.ok).toBe(true);
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.deployments).toEqual([
      { id: 1, environment: 'int', ref: 'ENFCT-1690-develop', description: '[ENFCT-1690]: Trigger LEP', createdAt: '2026-08-19T12:00:00Z' },
    ]);
  });

  it('names the URL and auth method it used, so a wrong base URL is obvious', async () => {
    stubFetch({ ok: true, status: 200, json: async () => ([]) });

    const outcome = await probeGithubDeployments(CONFIGURATION, 'zilvertonz', 'repo');

    expect(outcome.requestUrl).toBe('https://github.zilverton.com/api/v3/repos/zilvertonz/repo/deployments?per_page=5');
    expect(outcome.authType).toBe('github-app');
  });

  it('carries the failure body through instead of reporting an empty list', async () => {
    // The failure this guards: a 404 from a wrong base URL returning [] would read as "this repo has
    // no deployments", which is the same mistake — an error presented as an absence.
    stubFetch({ ok: false, status: 404, text: async () => '{"message":"Not Found"}' });

    const outcome = await probeGithubDeployments(CONFIGURATION, 'zilvertonz', 'repo');

    expect(outcome.ok).toBe(false);
    expect(outcome.httpStatus).toBe(404);
    expect(outcome.errorBody).toContain('Not Found');
    expect(outcome.deployments).toEqual([]);
  });

  it('reports a thrown network error as a failure with its message', async () => {
    global.fetch = jest.fn(async () => { throw new Error('self signed certificate'); });

    const outcome = await probeGithubDeployments(CONFIGURATION, 'zilvertonz', 'repo');

    expect(outcome.ok).toBe(false);
    expect(outcome.errorBody).toContain('self signed certificate');
  });

  it('refuses before calling out when GitHub is not configured at all', async () => {
    hasAnyGitHubAuth.mockReturnValue(false);
    global.fetch = jest.fn();

    const outcome = await probeGithubDeployments(CONFIGURATION, 'zilvertonz', 'repo');

    expect(outcome.ok).toBe(false);
    expect(outcome.errorBody).toMatch(/not configured/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('requires an owner and a repo rather than building a nonsense URL', async () => {
    global.fetch = jest.fn();

    const outcome = await probeGithubDeployments(CONFIGURATION, '', 'repo');

    expect(outcome.ok).toBe(false);
    expect(outcome.errorBody).toMatch(/owner and a repository/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
