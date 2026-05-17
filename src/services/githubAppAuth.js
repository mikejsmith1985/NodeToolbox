// src/services/githubAppAuth.js — GitHub App authentication service.
// Handles JWT generation (RS256) and installation access token lifecycle for GitHub Apps.
//
// GitHub Apps authenticate in two steps:
//   1. Generate a short-lived JWT signed with the app's RSA private key.
//   2. Exchange the JWT for an installation access token (valid 1 hour).
//
// Installation tokens are cached in memory and refreshed automatically before expiry
// so callers can call getValidInstallationToken() on every request without hammering
// the GitHub token endpoint.

'use strict';

const crypto = require('crypto');
const https  = require('https');
const http   = require('http');

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * JWT lifetime in seconds. GitHub allows a maximum of 10 minutes (600s).
 * We use 9 minutes (540s) to leave margin for network round-trips.
 */
const JWT_EXPIRY_SECONDS = 540;

/**
 * How many seconds before a cached token expires before we treat it as stale
 * and fetch a new one. 5 minutes gives plenty of headroom for long-running API calls.
 */
const TOKEN_REFRESH_BUFFER_SECONDS = 300;

/** User-Agent header sent on all GitHub App API requests. */
const GITHUB_APP_USER_AGENT = 'NodeToolbox-GitHubApp/1.0';

// ── In-memory token cache ─────────────────────────────────────────────────────

/**
 * Single-slot cache for the most recently fetched installation access token.
 * Installation tokens are valid for 1 hour — caching avoids generating a new JWT
 * and making an extra HTTP round-trip on every API call.
 */
const tokenCache = {
  token:       null,
  expiresAtMs: 0,
};

// ── JWT helpers ───────────────────────────────────────────────────────────────

/**
 * Serializes an object to JSON and encodes it as a base64url string.
 * base64url is the JWT-safe variant of base64: uses '-' and '_' instead of '+' and '/'.
 *
 * @param {object} obj - Any JSON-serializable object
 * @returns {string} base64url-encoded string
 */
function encodeBase64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

/**
 * Generates a signed RS256 JWT for authenticating as the GitHub App itself.
 *
 * GitHub requires:
 *   - alg: RS256
 *   - iss: the App ID (as a string)
 *   - iat: back-dated 60s to tolerate server clock skew
 *   - exp: iat + JWT_EXPIRY_SECONDS (max 10 minutes from now)
 *
 * The private key must be the RSA PEM downloaded from the GitHub App settings page.
 *
 * @param {string|number} appId        - The GitHub App ID shown in app settings
 * @param {string}        privateKeyPem - RSA private key in PKCS#8 or PKCS#1 PEM format
 * @returns {string} Signed JWT — use as `Authorization: Bearer <jwt>`
 */
function generateGitHubAppJwt(appId, privateKeyPem) {
  const nowSeconds    = Math.floor(Date.now() / 1000);
  // Back-date iat by 60 seconds to handle minor clock differences between
  // the NodeToolbox server and GitHub's API servers.
  const issuedAtTime  = nowSeconds - 60;

  const jwtHeader  = encodeBase64url({ alg: 'RS256', typ: 'JWT' });
  const jwtPayload = encodeBase64url({
    iat: issuedAtTime,
    exp: issuedAtTime + JWT_EXPIRY_SECONDS,
    iss: String(appId),
  });

  const signingInput  = jwtHeader + '.' + jwtPayload;
  const signer        = crypto.createSign('RSA-SHA256');
  signer.update(signingInput);
  const signatureB64u = signer.sign(privateKeyPem).toString('base64url');

  return signingInput + '.' + signatureB64u;
}

// ── Installation token fetching ───────────────────────────────────────────────

/**
 * Fetches a fresh GitHub App installation access token by calling:
 *   POST /app/installations/{installationId}/access_tokens
 *
 * This authenticates as the app (using the JWT) and returns a short-lived token
 * scoped to the specific installation (org or user account that installed the app).
 * The token is a plain string used just like a PAT: `Authorization: token <token>`.
 *
 * @param {string|number} appId          - GitHub App ID
 * @param {string|number} installationId - Installation ID (find in your org → Settings → GitHub Apps → Configure → URL)
 * @param {string}        privateKeyPem  - RSA private key PEM from GitHub App settings
 * @param {string}        baseUrl        - GitHub API base URL (e.g. https://api.github.com)
 * @param {boolean}       isTlsVerified  - Whether to verify TLS certificates (false for Zscaler-intercepted traffic)
 * @returns {Promise<{ token: string, expiresAt: string }>}
 */
function fetchInstallationToken(appId, installationId, privateKeyPem, baseUrl, isTlsVerified) {
  const appJwt       = generateGitHubAppJwt(appId, privateKeyPem);
  const cleanBaseUrl = (baseUrl || 'https://api.github.com').replace(/\/$/, '');
  const apiPath      = '/app/installations/' + installationId + '/access_tokens';

  return new Promise((resolve, reject) => {
    let targetUrl;
    try {
      targetUrl = new URL(cleanBaseUrl + apiPath);
    } catch (urlParseError) {
      return reject(new Error('Invalid GitHub API base URL: ' + urlParseError.message));
    }

    const isHttps   = targetUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const requestOptions = {
      hostname:           targetUrl.hostname,
      port:               targetUrl.port || (isHttps ? 443 : 80),
      path:               targetUrl.pathname + targetUrl.search,
      method:             'POST',
      rejectUnauthorized: isTlsVerified !== false,
      headers: {
        'Accept':         'application/vnd.github+json',
        'Authorization':  'Bearer ' + appJwt,
        'User-Agent':     GITHUB_APP_USER_AGENT,
        'Content-Length': '0',
      },
    };

    console.log('  [GitHub App] → POST ' + targetUrl.hostname + apiPath);

    const request = transport.request(requestOptions, (response) => {
      const responseChunks = [];
      response.on('data', (chunk) => responseChunks.push(chunk));
      response.on('end', () => {
        const rawBody = Buffer.concat(responseChunks).toString('utf8');
        let parsedBody;
        try {
          parsedBody = JSON.parse(rawBody);
        } catch (_jsonParseError) {
          return reject(new Error('Non-JSON response from GitHub App token endpoint (HTTP ' + response.statusCode + ')'));
        }

        console.log('  [GitHub App] ← HTTP ' + response.statusCode + ' (' + (parsedBody.message || 'ok') + ')');

        if (response.statusCode !== 201) {
          return reject(new Error(
            'GitHub App token request failed: HTTP ' + response.statusCode +
            (parsedBody.message ? ' — ' + parsedBody.message : '')
          ));
        }

        resolve({ token: parsedBody.token, expiresAt: parsedBody.expires_at });
      });
    });

    request.on('error', (networkError) => {
      console.error('  [GitHub App] ✗ Network error: ' + networkError.message);
      reject(networkError);
    });

    request.end();
  });
}

// ── Token cache management ────────────────────────────────────────────────────

/**
 * Returns a valid installation access token, reusing the cached one when it
 * has more than TOKEN_REFRESH_BUFFER_SECONDS remaining on its lifetime.
 *
 * Callers do not need to manage token expiry — this function handles refresh
 * transparently. Call it before every GitHub API request.
 *
 * @param {import('../config/loader').ProxyConfig} configuration
 * @returns {Promise<string>} The installation access token
 * @throws {Error} When GitHub App credentials are missing or token fetch fails
 */
async function getValidInstallationToken(configuration) {
  const githubConfig   = configuration.github || {};
  const { appId, installationId, appPrivateKey } = githubConfig;

  if (!appId || !installationId || !appPrivateKey) {
    throw new Error(
      'GitHub App credentials incomplete: appId, installationId, and appPrivateKey are all required. ' +
      'Configure them in Admin Hub → GitHub → GitHub App section.'
    );
  }

  // Refresh when less than TOKEN_REFRESH_BUFFER_SECONDS remain to avoid
  // mid-request expiry on slow network connections.
  const refreshThresholdMs = TOKEN_REFRESH_BUFFER_SECONDS * 1000;
  const isCacheValid       = tokenCache.token && (Date.now() + refreshThresholdMs) < tokenCache.expiresAtMs;

  if (isCacheValid) {
    return tokenCache.token;
  }

  const githubBaseUrl    = githubConfig.baseUrl || 'https://api.github.com';
  const isTlsVerified    = configuration.sslVerify !== false;
  const { token, expiresAt } = await fetchInstallationToken(
    appId, installationId, appPrivateKey, githubBaseUrl, isTlsVerified
  );

  // Store in module-level cache so subsequent calls within the hour reuse it
  tokenCache.token       = token;
  tokenCache.expiresAtMs = new Date(expiresAt).getTime();

  console.log('  [GitHub App] ✓ Installation token cached until ' + expiresAt);

  return token;
}

/**
 * Clears the cached installation token.
 * Call this after updating GitHub App credentials so the next API call
 * generates fresh tokens rather than reusing the stale cached one.
 */
function clearInstallationTokenCache() {
  tokenCache.token       = null;
  tokenCache.expiresAtMs = 0;
}

/**
 * Returns true when all three GitHub App credentials are present in the configuration.
 * Does NOT test whether the credentials are valid — use getValidInstallationToken() for that.
 *
 * @param {import('../config/loader').ProxyConfig} configuration
 * @returns {boolean}
 */
function hasGitHubAppCredentials(configuration) {
  const githubConfig = configuration.github || {};
  return !!(githubConfig.appId && githubConfig.installationId && githubConfig.appPrivateKey);
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  generateGitHubAppJwt,
  fetchInstallationToken,
  getValidInstallationToken,
  clearInstallationTokenCache,
  hasGitHubAppCredentials,
};
