// test/unit/githubApiProbe.test.js — Unit tests for the multi-check GitHub API reachability probe.
// HTTP is intercepted with nock so the checks run against canned GitHub responses. The probe must never
// throw for an HTTP error status; a partial block (auth ok, repo denied) must surface per-check.

'use strict';

const nock = require('nock');
const { runGitHubApiProbe } = require('../../src/services/githubApiProbe');

const GITHUB_API = 'https://api.github.com';

function buildConfig(overrides) {
  return Object.assign(
    { github: { baseUrl: GITHUB_API, pat: 'gh-pat' }, sslVerify: true },
    overrides,
  );
}

afterEach(() => {
  nock.cleanAll();
});

describe('runGitHubApiProbe', () => {
  it('reports not-configured (without any HTTP call) when no GitHub auth is set', async () => {
    const result = await runGitHubApiProbe({ github: {}, sslVerify: true }, { repoFullPath: 'zilvertonz/x' });
    expect(result.isConfigured).toBe(false);
    expect(result.overallSuccess).toBe(false);
    expect(result.checks).toEqual([]);
    expect(result.verdict).toMatch(/No GitHub credentials/);
  });

  it('authenticates only, and asks for a repo, when none is provided', async () => {
    nock(GITHUB_API).get('/user').reply(200, { login: 'C8Q6T3_Zilver' });

    const result = await runGitHubApiProbe(buildConfig(), {});

    expect(result.isConfigured).toBe(true);
    expect(result.authenticatedAs).toBe('C8Q6T3_Zilver');
    expect(result.checks).toHaveLength(1);
    expect(result.overallSuccess).toBe(true);
    expect(result.verdict).toMatch(/Enter a repository/);
  });

  it('passes every check and declares a poller viable when repo data is readable', async () => {
    nock(GITHUB_API)
      .get('/user').reply(200, { login: 'C8Q6T3_Zilver' })
      .get('/repos/zilvertonz/usmg-facets-enroll').reply(200, { full_name: 'zilvertonz/usmg-facets-enroll', private: true })
      .get('/repos/zilvertonz/usmg-facets-enroll/pulls')
      .query(true)
      .reply(200, [{ number: 577, user: { login: 'C13471_Zilver' }, updated_at: '2026-07-23T15:40:00Z' }])
      .get('/repos/zilvertonz/usmg-facets-enroll/commits')
      .query(true)
      .reply(200, [{ sha: 'abcdef1234567', author: { login: 'C13471_Zilver' } }])
      .get('/repos/zilvertonz/usmg-facets-enroll/events')
      .query(true)
      .reply(200, [{ type: 'PullRequestEvent', actor: { login: 'C13471_Zilver' } }]);

    const result = await runGitHubApiProbe(buildConfig(), { repoFullPath: 'zilvertonz/usmg-facets-enroll' });

    expect(result.overallSuccess).toBe(true);
    expect(result.checks).toHaveLength(5);
    expect(result.checks.every((check) => check.success)).toBe(true);
    // The raw body must be stripped from the wire shape.
    expect(result.checks[0]).not.toHaveProperty('body');
    expect(result.checks.find((check) => check.name === 'Pull requests').detail).toMatch(/#577/);
    expect(result.verdict).toMatch(/poller is viable/);
  });

  it('surfaces a partial block: auth succeeds but the repo read is forbidden', async () => {
    nock(GITHUB_API)
      .get('/user').reply(200, { login: 'C8Q6T3_Zilver' })
      .get('/repos/zilvertonz/usmg-facets-enroll').reply(403, { message: 'Resource protected by organization SAML enforcement' })
      .get('/repos/zilvertonz/usmg-facets-enroll/pulls').query(true).reply(403, { message: 'forbidden' })
      .get('/repos/zilvertonz/usmg-facets-enroll/commits').query(true).reply(403, { message: 'forbidden' })
      .get('/repos/zilvertonz/usmg-facets-enroll/events').query(true).reply(403, { message: 'forbidden' });

    const result = await runGitHubApiProbe(buildConfig(), { repoFullPath: 'zilvertonz/usmg-facets-enroll' });

    expect(result.isConfigured).toBe(true);
    expect(result.authenticatedAs).toBe('C8Q6T3_Zilver');
    expect(result.overallSuccess).toBe(false);
    const repoCheck = result.checks.find((check) => check.name.startsWith('Repository'));
    expect(repoCheck.success).toBe(false);
    expect(repoCheck.statusCode).toBe(403);
    expect(result.verdict).toMatch(/email-intake path is required/);
  });

  it('declares blocked at authentication when /user is unauthorized', async () => {
    nock(GITHUB_API).get('/user').reply(401, { message: 'Bad credentials' });

    const result = await runGitHubApiProbe(buildConfig(), { repoFullPath: 'zilvertonz/usmg-facets-enroll' });

    expect(result.overallSuccess).toBe(false);
    expect(result.authenticatedAs).toBeNull();
    expect(result.verdict).toMatch(/Blocked at authentication/);
    // Repo checks are still attempted, but the verdict leads with the auth failure.
    expect(result.checks[0].statusCode).toBe(401);
  });

  it('includes a user-events check when a GitHub user id is provided', async () => {
    nock(GITHUB_API)
      .get('/user').reply(200, { login: 'C8Q6T3_Zilver' })
      .get('/users/C13471_Zilver/events').query(true).reply(200, [{ type: 'PushEvent', actor: { login: 'C13471_Zilver' } }]);

    const result = await runGitHubApiProbe(buildConfig(), { githubUserId: 'C13471_Zilver' });

    const userEventsCheck = result.checks.find((check) => check.name.startsWith('User events'));
    expect(userEventsCheck).toBeDefined();
    expect(userEventsCheck.success).toBe(true);
    expect(userEventsCheck.detail).toMatch(/PushEvent/);
  });
});
