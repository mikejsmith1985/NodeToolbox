// src/services/githubApiProbe.js — A multi-check GitHub REST API reachability probe.
//
// Answers one question deterministically for a locked-down org (e.g. Enterprise Managed Users): with the
// GitHub credentials NodeToolbox already holds, can we actually READ the pull-request, commit, and event
// data the flow-analysis and hygiene automation needs — or is the API blocked, so the email-intake path is
// the only option? Every check is a real read-only GET. The result lists each check's HTTP status
// separately, so a PARTIAL block (auth succeeds but repo access is denied) is visible rather than hidden
// behind one pass/fail flag. Nothing is written to GitHub or Jira — this is purely diagnostic.

'use strict';

const { makeGithubApiRequest } = require('../utils/httpClient');
const { resolveEffectiveGitHubToken, hasAnyGitHubAuth } = require('./githubAppAuth');

/** GitHub's public API host, used when no enterprise base URL is configured. */
const DEFAULT_GITHUB_BASE_URL = 'https://api.github.com';

// How many items to request for the list endpoints. Small — the probe only needs to prove access and show
// the newest entry, not page through history.
const PROBE_LIST_PAGE_SIZE = 3;
const USER_EVENTS_PAGE_SIZE = 5;

// Minimal reason-phrase map so the panel can show "HTTP 403 Forbidden" without an extra dependency.
const HTTP_STATUS_TEXT = {
  200: 'OK', 201: 'Created', 204: 'No Content', 301: 'Moved Permanently', 302: 'Found',
  304: 'Not Modified', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
  409: 'Conflict', 422: 'Unprocessable Entity', 429: 'Too Many Requests', 500: 'Internal Server Error',
  502: 'Bad Gateway', 503: 'Service Unavailable',
};

/** Returns the human-readable reason phrase for an HTTP status code, or '' when unknown. */
function resolveHttpStatusText(statusCode) {
  return HTTP_STATUS_TEXT[statusCode] || '';
}

/** True for any 2xx status — the probe treats every 2xx as a passing read. */
function isSuccessStatus(statusCode) {
  return statusCode >= 200 && statusCode < 300;
}

/**
 * Runs one read-only GET and shapes it into a check row. Never throws on an HTTP error status —
 * makeGithubApiRequest resolves with the status — so a 403 becomes a FAILED check, not an aborted probe;
 * only a genuine network error rejects, which is turned into a status-0 error check. The parsed body is
 * kept on the returned object for the caller's own use (login, verdict) and stripped before the wire.
 */
async function runProbeCheck(checkName, apiPath, token, baseUrl, isTlsVerified, describeBody) {
  const startedAtMs = Date.now();
  try {
    const response = await makeGithubApiRequest(apiPath, token, baseUrl, isTlsVerified);
    const didSucceed = isSuccessStatus(response.status);
    const githubMessage = response.body && response.body.message ? response.body.message : null;
    return {
      name: checkName,
      endpoint: apiPath,
      method: 'GET',
      statusCode: response.status,
      statusText: resolveHttpStatusText(response.status),
      responseTime: Date.now() - startedAtMs,
      success: didSucceed,
      detail: didSucceed ? describeBody(response.body) : null,
      errorMessage: didSucceed
        ? undefined
        : 'HTTP ' + response.status + ' ' + resolveHttpStatusText(response.status) +
          (githubMessage ? ' — ' + githubMessage : ''),
      body: response.body,
    };
  } catch (networkError) {
    return {
      name: checkName,
      endpoint: apiPath,
      method: 'GET',
      statusCode: 0,
      statusText: '',
      responseTime: Date.now() - startedAtMs,
      success: false,
      detail: null,
      errorMessage: 'Network error — ' + networkError.message,
      body: null,
    };
  }
}

// ── Body describers (turn a raw response body into a one-line human detail) ──────────────────────────

/** Describes the newest entry of an array endpoint, or reports an empty (but readable) list. */
function describeNewestListEntry(body, singularNoun, formatNewest) {
  if (!Array.isArray(body)) {
    return 'Unexpected response shape';
  }
  if (body.length === 0) {
    return 'Readable — 0 ' + singularNoun + 's (none to show)';
  }
  return body.length + ' ' + singularNoun + (body.length === 1 ? '' : 's') + ' · ' + formatNewest(body[0]);
}

function describeAuthenticatedUser(body) {
  return 'Authenticated as ' + (body && body.login ? body.login : '(unknown login)');
}

function describeRepository(body) {
  const fullName = body && body.full_name ? body.full_name : '(unknown repo)';
  const visibility = body && body.private ? 'private' : 'public';
  return fullName + ' · ' + visibility;
}

function describePullRequests(body) {
  return describeNewestListEntry(body, 'PR', (newest) =>
    'newest #' + newest.number + ' by ' + ((newest.user && newest.user.login) || '?') + ' updated ' + newest.updated_at);
}

function describeCommits(body) {
  return describeNewestListEntry(body, 'commit', (newest) =>
    'newest ' + String(newest.sha || '').slice(0, 7) + ' by ' + ((newest.author && newest.author.login) || '?'));
}

function describeEvents(body) {
  return describeNewestListEntry(body, 'event', (newest) =>
    'newest ' + newest.type + ' by ' + ((newest.actor && newest.actor.login) || '?'));
}

// ── Verdict ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * Turns the run's checks into one plain-English conclusion the operator can act on: reachable (build a
 * poller), blocked (use the email path), or auth-only (needs a repo to test). The first failing REQUIRED
 * check names where access broke, so a partial block is diagnosed, not just reported.
 */
function summarizeVerdict(userCheck, repoChecks, wasRepoProvided) {
  const authenticatedAs = userCheck.success && userCheck.body ? userCheck.body.login : null;

  if (!userCheck.success) {
    return 'Blocked at authentication (' + (userCheck.errorMessage || 'no response') +
      '). The API is not reachable with these credentials — the email-intake path is required.';
  }

  if (!wasRepoProvided) {
    return 'Authenticated as ' + authenticatedAs +
      '. Enter a repository (owner/repo) and re-run to test pull-request, commit, and event access.';
  }

  const firstFailedRepoCheck = repoChecks.find((repoCheck) => !repoCheck.success);
  if (firstFailedRepoCheck) {
    return 'Authenticated as ' + authenticatedAs + ', but blocked reading "' + firstFailedRepoCheck.name +
      '" (' + (firstFailedRepoCheck.errorMessage || 'failed') + '). A poller cannot get the data it needs — ' +
      'the email-intake path is required.';
  }

  return 'Reachable. Authenticated as ' + authenticatedAs +
    ' and read the repository, pull requests, commits, and events. A GitHub API poller is viable — the ' +
    'email-intake path can be retired.';
}

/**
 * Runs the probe: authenticate, then (when a repo is given) read the repository, its pull requests,
 * commits, and events; optionally read one roster member's user events. Returns a diagnostic object whose
 * `checks` array carries a row per attempted call. Never throws — auth/config problems become a
 * not-configured result, and per-call failures become failed check rows.
 *
 * @param {import('../config/loader').ProxyConfig} configuration
 * @param {{ repoFullPath?: string, githubUserId?: string }} [options]
 * @returns {Promise<object>}
 */
async function runGitHubApiProbe(configuration, options = {}) {
  const repoFullPath = String(options.repoFullPath || '').trim();
  const githubUserId = String(options.githubUserId || '').trim();
  const githubBaseUrl = (configuration.github && configuration.github.baseUrl) || DEFAULT_GITHUB_BASE_URL;
  const isTlsVerified = configuration.sslVerify !== false;

  if (!hasAnyGitHubAuth(configuration)) {
    return buildUnconfiguredResult(repoFullPath, 'No GitHub credentials configured. Set a PAT or GitHub App in Admin Hub, then re-run.');
  }

  let token;
  let authType;
  try {
    ({ token, authType } = await resolveEffectiveGitHubToken(configuration));
  } catch (tokenError) {
    return buildUnconfiguredResult(repoFullPath, 'Could not resolve a GitHub token — ' + tokenError.message);
  }

  const userCheck = await runProbeCheck(
    'Authenticate (/user)', '/user', token, githubBaseUrl, isTlsVerified, describeAuthenticatedUser);

  const repoChecks = repoFullPath === ''
    ? []
    : await runRepositoryChecks(repoFullPath, token, githubBaseUrl, isTlsVerified);

  const userEventsChecks = githubUserId === ''
    ? []
    : [await runProbeCheck(
        'User events (/users/' + githubUserId + '/events)',
        '/users/' + encodeURIComponent(githubUserId) + '/events?per_page=' + USER_EVENTS_PAGE_SIZE,
        token, githubBaseUrl, isTlsVerified, describeEvents)];

  const allChecks = [userCheck, ...repoChecks, ...userEventsChecks];
  // Required checks are auth plus every repo check when a repo was given; user-events is informational.
  const requiredChecks = [userCheck, ...repoChecks];

  return {
    isConfigured: true,
    authType,
    authenticatedAs: userCheck.success && userCheck.body ? userCheck.body.login : null,
    repoFullPath,
    overallSuccess: requiredChecks.every((check) => check.success),
    verdict: summarizeVerdict(userCheck, repoChecks, repoFullPath !== ''),
    checks: allChecks.map(stripBodyFromCheck),
  };
}

/** Runs the four repository-scoped reads (repo, pulls, commits, events) in order. */
async function runRepositoryChecks(repoFullPath, token, baseUrl, isTlsVerified) {
  const encodedRepo = repoFullPath.split('/').map(encodeURIComponent).join('/');
  return [
    await runProbeCheck('Repository (/repos/' + repoFullPath + ')',
      '/repos/' + encodedRepo, token, baseUrl, isTlsVerified, describeRepository),
    await runProbeCheck('Pull requests',
      '/repos/' + encodedRepo + '/pulls?state=all&per_page=' + PROBE_LIST_PAGE_SIZE + '&sort=updated&direction=desc',
      token, baseUrl, isTlsVerified, describePullRequests),
    await runProbeCheck('Commits',
      '/repos/' + encodedRepo + '/commits?per_page=' + PROBE_LIST_PAGE_SIZE,
      token, baseUrl, isTlsVerified, describeCommits),
    await runProbeCheck('Events',
      '/repos/' + encodedRepo + '/events?per_page=' + PROBE_LIST_PAGE_SIZE,
      token, baseUrl, isTlsVerified, describeEvents),
  ];
}

/** Removes the internal raw body before a check is returned to the client. */
function stripBodyFromCheck(check) {
  const { body: _unusedBody, ...wireCheck } = check;
  return wireCheck;
}

/** Builds the early-return shape used when no usable GitHub auth exists. */
function buildUnconfiguredResult(repoFullPath, verdict) {
  return {
    isConfigured: false,
    authType: 'none',
    authenticatedAs: null,
    repoFullPath,
    overallSuccess: false,
    verdict,
    checks: [],
  };
}

module.exports = {
  runGitHubApiProbe,
};
