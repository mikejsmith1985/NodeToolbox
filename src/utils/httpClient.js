// src/utils/httpClient.js — Outbound HTTP/HTTPS proxy helper and authentication utilities.
//
// Provides the core proxy function that forwards browser requests to Jira, GitHub,
// and ServiceNow with server-side credential injection. Also exports auth header
// builders used by both the proxy routes and the background scheduler.

'use strict';

const http  = require('http');
const https = require('https');

// ── Constants ────────────────────────────────────────────────────────────────

/** User-Agent string sent on all outbound proxy requests */
const PROXY_USER_AGENT = 'NodeToolbox/1.0.0';

// ── Authentication Helpers ────────────────────────────────────────────────────

/**
 * Builds a Basic Auth header value from a username and password/token pair.
 * Returns null if either credential is empty so callers can detect unconfigured services.
 *
 * @param {string} username
 * @param {string} password
 * @returns {string|null} "Basic <base64>" or null
 */
function buildBasicAuthHeader(username, password) {
  if (!username || !password) return null;
  const encodedCredentials = Buffer.from(username + ':' + password).toString('base64');
  return 'Basic ' + encodedCredentials;
}

/**
 * Builds the correct Authorization header for a service configuration.
 * PAT (Bearer token) takes priority over Basic Auth because SSO/Okta environments
 * block username+password authentication but allow personal access tokens.
 *
 * @param {{ pat?: string, username?: string, apiToken?: string, password?: string }} serviceConfig
 * @returns {string|null} Authorization header value, or null if no credentials are configured
 */
function buildAuthHeader(serviceConfig) {
  if (!serviceConfig) return null;

  if (serviceConfig.pat) {
    return 'Bearer ' + serviceConfig.pat;
  }

  // apiToken takes priority over password — Jira uses apiToken, SNow uses password
  const credentialSecret = serviceConfig.apiToken || serviceConfig.password || '';
  return buildBasicAuthHeader(serviceConfig.username || '', credentialSecret);
}

// ── Proxy Request ─────────────────────────────────────────────────────────────

/**
 * Proxies an incoming Express request to a target service and pipes the response
 * back to the browser. Injects the appropriate Authorization header server-side
 * so credentials are never exposed to the browser.
 *
 * @param {import('express').Request}  clientReq      - The original browser request
 * @param {import('express').Response} clientRes      - The response to write back to browser
 * @param {object}  serviceConfig                     - Service credentials ({ baseUrl, pat?, username?, apiToken?, password? })
 * @param {string}  targetPathWithQuery               - Path + query string after stripping proxy prefix
 * @param {object}  [sessionOverrides]                - Optional headers to inject instead of credentials (e.g. SNow g_ck token)
 * @param {boolean} [shouldVerifyTls=true]            - Whether to reject self-signed/corp-intercepted TLS certs
 */
function proxyRequest(clientReq, clientRes, serviceConfig, targetPathWithQuery, sessionOverrides, shouldVerifyTls) {
  const isVerifyingTls = shouldVerifyTls !== false;

  if (!serviceConfig.baseUrl) {
    return clientRes.status(502).json({
      error:   'Service not configured',
      message: 'Set the base URL in toolbox-proxy.json or via the /setup wizard.',
    });
  }

  let targetUrl;
  try {
    targetUrl = new URL(serviceConfig.baseUrl + targetPathWithQuery);
  } catch (urlParseError) {
    return clientRes.status(502).json({
      error:   'Invalid target URL',
      message: urlParseError.message,
    });
  }

  const isHttps    = targetUrl.protocol === 'https:';
  const transport  = isHttps ? https : http;

  const outboundHeaders = buildOutboundHeaders(clientReq, serviceConfig, sessionOverrides);

  const requestOptions = {
    hostname:           targetUrl.hostname,
    port:               targetUrl.port || (isHttps ? 443 : 80),
    path:               targetUrl.pathname + targetUrl.search,
    method:             clientReq.method,
    headers:            outboundHeaders,
    // Allow disabling cert verification for corporate SSL inspection (e.g. Zscaler)
    // that replaces server certs with their own CA. Only disabled when explicitly configured.
    rejectUnauthorized: isVerifyingTls,
  };

  const outboundRequest = transport.request(requestOptions, (upstreamResponse) => {
    // Forward the upstream content-type so the browser parses the body correctly
    if (upstreamResponse.headers['content-type']) {
      clientRes.setHeader('Content-Type', upstreamResponse.headers['content-type']);
    }
    clientRes.status(upstreamResponse.statusCode);
    upstreamResponse.pipe(clientRes);
  });

  outboundRequest.on('error', (networkError) => {
    // Prefer the human-readable message; fall back to the error code so the
    // response never arrives with an empty "message" field.
    const errorDescription = networkError.message || networkError.code || 'Unknown network error';
    console.error('  ⚠ Proxy error → ' + serviceConfig.baseUrl + targetPathWithQuery + ': ' + errorDescription);
    // Only send an error response if headers haven't been sent already
    if (!clientRes.headersSent) {
      clientRes.status(502).json({ error: 'Proxy error', message: errorDescription });
    }
  });

  // GET and HEAD have no request body — end the outbound request immediately
  if (clientReq.method === 'GET' || clientReq.method === 'HEAD') {
    outboundRequest.end();
  } else {
    // Express body-parser middleware (express.json) runs before the proxy router
    // and eagerly consumes the raw request stream, storing the parsed result in
    // clientReq.body.  Piping clientReq at this point would send an empty body
    // to the upstream service, causing some servers (e.g. ServiceNow) to close
    // the connection with a TCP RST — which Node reports as a network error with
    // an empty message string (the source of the "Proxy error / message: ''" 502).
    //
    // When body-parser has already parsed the body we re-serialize it so the
    // exact original payload is forwarded with a correct Content-Length header.
    if (clientReq.body !== undefined) {
      const serializedBody = Buffer.from(JSON.stringify(clientReq.body), 'utf8');
      // Set Content-Length now — before .end() sends the request headers
      outboundRequest.setHeader('Content-Length', serializedBody.length);
      outboundRequest.end(serializedBody);
    } else {
      // Body has not been pre-parsed (e.g. non-JSON content type) — pipe as-is
      clientReq.pipe(outboundRequest);
    }
  }
}

/**
 * Makes an outbound GET request to the GitHub API using the server-side PAT.
 * Used by the background scheduler — not for browser proxy requests.
 *
 * @param {string} apiPath         - Path after api.github.com (e.g. /repos/org/repo/branches)
 * @param {string} githubPat       - GitHub Personal Access Token
 * @param {string} githubBaseUrl   - GitHub API base URL (defaults to https://api.github.com)
 * @param {boolean} shouldVerifyTls - Whether to verify TLS certificates
 * @returns {Promise<{status: number, body: any}>}
 */
function makeGithubApiRequest(apiPath, githubPat, githubBaseUrl, shouldVerifyTls) {
  return new Promise((resolve, reject) => {
    if (!githubPat) {
      reject(new Error('GitHub PAT not configured'));
      return;
    }

    const baseUrl    = (githubBaseUrl || 'https://api.github.com').replace(/\/$/, '');
    const requestUrl = new URL(baseUrl + apiPath);
    const isHttps    = requestUrl.protocol === 'https:';
    const transport  = isHttps ? https : http;

    const requestOptions = {
      hostname:           requestUrl.hostname,
      port:               requestUrl.port || (isHttps ? 443 : 80),
      path:               requestUrl.pathname + requestUrl.search,
      method:             'GET',
      rejectUnauthorized: shouldVerifyTls !== false,
      headers: {
        'Accept':        'application/vnd.github+json',
        'Authorization': 'Bearer ' + githubPat,
        'User-Agent':    PROXY_USER_AGENT,
      },
    };

    const request = transport.request(requestOptions, (response) => {
      const responseChunks = [];
      response.on('data', (chunk) => responseChunks.push(chunk));
      response.on('end', () => {
        const rawBody = Buffer.concat(responseChunks).toString('utf8');
        try {
          resolve({ status: response.statusCode, body: JSON.parse(rawBody) });
        } catch (_jsonParseError) {
          resolve({ status: response.statusCode, body: {} });
        }
      });
    });

    request.on('error', reject);
    request.end();
  });
}

/**
 * Makes an outbound request to the Jira API using server-side credentials.
 * Used by the background scheduler — not for browser proxy requests.
 *
 * @param {string}      httpMethod  - HTTP method (GET, POST, etc.)
 * @param {string}      apiPath     - Path after the Jira base URL
 * @param {object|null} requestBody - JSON payload for POST/PUT, or null
 * @param {object}      jiraConfig  - Jira credentials { baseUrl, pat?, username?, apiToken? }
 * @param {boolean}     shouldVerifyTls
 * @returns {Promise<{status: number, body: any}>}
 */
function makeJiraApiRequest(httpMethod, apiPath, requestBody, jiraConfig, shouldVerifyTls) {
  return new Promise((resolve, reject) => {
    const jiraBaseUrl = (jiraConfig && jiraConfig.baseUrl || '').replace(/\/$/, '');
    if (!jiraBaseUrl) {
      reject(new Error('Jira URL not configured'));
      return;
    }

    const authorizationHeader = buildAuthHeader(jiraConfig);
    if (!authorizationHeader) {
      reject(new Error('Jira credentials not configured'));
      return;
    }

    const requestUrl    = new URL(jiraBaseUrl + apiPath);
    const isHttps       = requestUrl.protocol === 'https:';
    const transport     = isHttps ? https : http;
    const encodedBody   = requestBody ? Buffer.from(JSON.stringify(requestBody), 'utf8') : null;

    const requestOptions = {
      hostname:           requestUrl.hostname,
      port:               requestUrl.port || (isHttps ? 443 : 80),
      path:               requestUrl.pathname + requestUrl.search,
      method:             httpMethod,
      rejectUnauthorized: shouldVerifyTls !== false,
      headers: {
        'Accept':        'application/json',
        'Content-Type':  'application/json',
        'Authorization': authorizationHeader,
        'User-Agent':    PROXY_USER_AGENT,
      },
    };

    if (encodedBody) {
      requestOptions.headers['Content-Length'] = encodedBody.length;
    }

    const request = transport.request(requestOptions, (response) => {
      const responseChunks = [];
      response.on('data', (chunk) => responseChunks.push(chunk));
      response.on('end', () => {
        const rawBody = Buffer.concat(responseChunks).toString('utf8');
        try {
          resolve({ status: response.statusCode, body: JSON.parse(rawBody) });
        } catch (_jsonParseError) {
          resolve({ status: response.statusCode, body: {} });
        }
      });
    });

    request.on('error', reject);
    if (encodedBody) request.write(encodedBody);
    request.end();
  });
}

// ── Private Helpers ───────────────────────────────────────────────────────────

/**
 * Builds the outbound headers for a proxied request.
 * Injects credentials or SNow session token depending on what is available.
 *
 * @param {import('express').Request} clientReq
 * @param {object} serviceConfig
 * @param {object} [sessionOverrides] - Extra headers to inject (e.g. SNow X-UserToken)
 * @returns {object} Headers object for the outbound request
 */
function buildOutboundHeaders(clientReq, serviceConfig, sessionOverrides) {
  const outboundHeaders = {
    'Content-Type': clientReq.headers['content-type'] || 'application/json',
    'Accept':       clientReq.headers['accept']       || 'application/json',
    'User-Agent':   PROXY_USER_AGENT,
  };

  if (sessionOverrides && Object.keys(sessionOverrides).length > 0) {
    // Session mode: inject SNow g_ck token instead of credentials
    Object.assign(outboundHeaders, sessionOverrides);
  } else {
    const authorizationHeader = buildAuthHeader(serviceConfig);
    if (authorizationHeader) {
      outboundHeaders['Authorization'] = authorizationHeader;
    }
  }

  return outboundHeaders;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  proxyRequest,
  buildAuthHeader,
  buildBasicAuthHeader,
  makeGithubApiRequest,
  makeJiraApiRequest,
};
