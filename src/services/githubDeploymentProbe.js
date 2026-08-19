// githubDeploymentProbe.js — A read-only check of whether GitHub's Deployments API is reachable.
//
// This exists because the whole email intake pipeline exists: direct GitHub API access has failed in
// this environment before, and nobody could say why. Presence of an auth module is not proof of
// access — the connection check only ever calls GET /user, which says nothing about whether a repo's
// deployments can be read.
//
// So this asks the actual question, and its most important job is what it does when the answer is
// no: report the status, the response body, the exact URL and the auth method used. A 404 caused by
// a wrong Enterprise base URL must never be presentable as "this repo has no deployments" — an error
// dressed as an absence is the failure this codebase keeps having to correct.
//
// Read-only by construction: one GET, no writes, five records.

'use strict';

const { hasAnyGitHubAuth, resolveEffectiveGitHubToken } = require('./githubAppAuth');

/** How many deployments to ask for. Enough to recognise the shape, small enough to stay a probe. */
const PROBE_PAGE_SIZE = 5;

/** Response bodies are echoed for diagnosis, not stored — capped so a stack trace cannot flood the UI. */
const MAX_ERROR_BODY_LENGTH = 600;

/** Reduces one GitHub deployment to the fields that decide whether this is a usable signal. */
function summariseDeployment(rawDeployment) {
  return {
    id: rawDeployment.id,
    environment: rawDeployment.environment ?? '',
    ref: rawDeployment.ref ?? '',
    description: rawDeployment.description ?? '',
    createdAt: rawDeployment.created_at ?? '',
  };
}

/** Builds a failed outcome that still says everything needed to diagnose it. */
function buildFailure(requestUrl, authType, httpStatus, errorBody) {
  return {
    ok: false,
    httpStatus,
    requestUrl,
    authType,
    errorBody: String(errorBody).slice(0, MAX_ERROR_BODY_LENGTH),
    deployments: [],
  };
}

/**
 * Asks GitHub for a repository's most recent deployments.
 *
 * @param {object} configuration - live server config (reads configuration.github)
 * @param {string} ownerName - the org or user that owns the repo
 * @param {string} repositoryName
 * @returns {Promise<{ ok: boolean, httpStatus: number, requestUrl: string, authType: string, errorBody: string, deployments: object[] }>}
 */
async function probeGithubDeployments(configuration, ownerName, repositoryName) {
  const githubConfig = (configuration && configuration.github) || {};
  const githubBaseUrl = (githubConfig.baseUrl || 'https://api.github.com').replace(/\/$/, '');
  const trimmedOwner = String(ownerName || '').trim();
  const trimmedRepository = String(repositoryName || '').trim();
  const requestUrl =
    `${githubBaseUrl}/repos/${trimmedOwner}/${trimmedRepository}/deployments?per_page=${PROBE_PAGE_SIZE}`;

  if (trimmedOwner === '' || trimmedRepository === '') {
    return buildFailure(requestUrl, 'none', 0, 'Enter both an owner and a repository name.');
  }
  if (!hasAnyGitHubAuth(configuration)) {
    return buildFailure(requestUrl, 'none', 0, 'GitHub is not configured — add a PAT or GitHub App credentials first.');
  }

  let authType = 'none';
  try {
    const resolvedAuth = await resolveEffectiveGitHubToken(configuration);
    authType = resolvedAuth.authType;

    const probeResponse = await fetch(requestUrl, {
      method: 'GET',
      headers: {
        Authorization: 'token ' + resolvedAuth.token,
        'User-Agent': 'NodeToolbox',
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!probeResponse.ok) {
      const failureBody = await probeResponse.text();
      return buildFailure(requestUrl, authType, probeResponse.status, failureBody);
    }

    const rawDeployments = await probeResponse.json();
    return {
      ok: true,
      httpStatus: probeResponse.status,
      requestUrl,
      authType,
      errorBody: '',
      deployments: (Array.isArray(rawDeployments) ? rawDeployments : []).map(summariseDeployment),
    };
  } catch (probeError) {
    // A thrown error is as informative as a status — a TLS or DNS failure names itself here rather
    // than surfacing as an unexplained empty result.
    return buildFailure(requestUrl, authType, 0, probeError instanceof Error ? probeError.message : String(probeError));
  }
}

module.exports = { probeGithubDeployments };
