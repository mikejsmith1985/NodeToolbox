// test/integration/api.test.js — Integration tests for the API routes.
// Tests /api/proxy-status, /api/proxy-config, /api/snow-session, and /api/diagnostic endpoints.

'use strict';

const request = require('supertest');
const express = require('express');
const nock = require('nock');
const { applyCorsHeaders }  = require('../../src/middleware/cors');
const createApiRouter        = require('../../src/routes/api');
const snowSession            = require('../../src/services/snowSession');

// ── Test App Factory ──────────────────────────────────────────────────────────

/**
 * Builds a minimal Express app with the API router mounted.
 * Uses express.json() so POST bodies are parsed automatically.
 *
 * @param {object} configuration - Proxy configuration to inject
 * @returns {import('express').Application}
 */
function buildTestApp(configuration) {
  const testApp = express();
  testApp.use(express.json());
  testApp.use(applyCorsHeaders);
  testApp.use(createApiRouter(configuration));
  return testApp;
}

// ── /api/proxy-status ─────────────────────────────────────────────────────────

describe('GET /api/proxy-status', () => {
  it('returns proxy:true with service status', async () => {
    const configuration = {
      jira:      { baseUrl: 'https://acme.atlassian.net', pat: 'jira-pat' },
      snow:      { baseUrl: '', username: '', password: '' },
      github:    { baseUrl: 'https://api.github.com', pat: 'gh-pat' },
      sslVerify: true,
    };

    const response = await request(buildTestApp(configuration))
      .get('/api/proxy-status');

    expect(response.status).toBe(200);
    expect(response.body.proxy).toBe(true);
    expect(response.body.jira.ready).toBe(true);
    // github.ready now reflects a live probe result (false until first Test Connection
    // succeeds). Use github.configured to assert credentials are present.
    expect(response.body.github.configured).toBe(true);
  });

  it('reports jira.ready=false when Jira has no credentials', async () => {
    const configuration = {
      jira:      { baseUrl: 'https://acme.atlassian.net', pat: '', username: '', apiToken: '' },
      snow:      { baseUrl: '', username: '', password: '' },
      github:    { baseUrl: 'https://api.github.com', pat: '' },
      sslVerify: true,
    };

    const response = await request(buildTestApp(configuration))
      .get('/api/proxy-status');

    expect(response.status).toBe(200);
    expect(response.body.jira.configured).toBe(true);
    expect(response.body.jira.ready).toBe(false);
  });

  it('returns blank first-install connection status for demo-mode requests', async () => {
    const configuration = {
      jira:       { baseUrl: 'https://acme.atlassian.net', pat: 'jira-pat', username: '', apiToken: '' },
      snow:       { baseUrl: 'https://acme.service-now.com', username: 'snow-user', password: 'snow-password' },
      github:     { baseUrl: 'https://api.github.com', pat: 'gh-pat' },
      confluence: { baseUrl: 'https://acme.atlassian.net', username: 'person@example.com', apiToken: 'cloud-token' },
      sslVerify:  true,
    };

    const response = await request(buildTestApp(configuration))
      .get('/api/proxy-status')
      .set('X-NodeToolbox-Demo-Mode', '1');

    expect(response.status).toBe(200);
    expect(response.body.jira.ready).toBe(false);
    expect(response.body.jira.configured).toBe(false);
    expect(response.body.github.configured).toBe(false);
    expect(response.body.confluence.configured).toBe(false);
    expect(response.body.confluence.baseUrl).toBeNull();
  });
});

// ── /api/proxy-config ─────────────────────────────────────────────────────────

describe('GET /api/proxy-config', () => {
  it('returns config without exposing secrets', async () => {
    const configuration = {
      port:      5555,
      jira:      { baseUrl: 'https://acme.atlassian.net', pat: 'secret-pat', username: 'user', apiToken: 'token' },
      snow:      { baseUrl: 'https://acme.service-now.com', username: 'snow-user', password: 'snow-pass' },
      github:    { baseUrl: 'https://api.github.com', pat: 'gh-secret' },
      sslVerify: true,
    };

    const response = await request(buildTestApp(configuration))
      .get('/api/proxy-config');

    expect(response.status).toBe(200);
    // Base URLs are returned (not sensitive)
    expect(response.body.jira.baseUrl).toBe('https://acme.atlassian.net');
    // Actual secrets are not returned — only a boolean indicator
    expect(response.body.jira.hasCredentials).toBe(true);
    expect(response.body.jira.pat).toBeUndefined();
    expect(response.body.jira.apiToken).toBeUndefined();
  });

  it('returns blank first-install config for demo-mode requests', async () => {
    const configuration = {
      port:       5555,
      jira:       { baseUrl: 'https://acme.atlassian.net', pat: 'secret-pat', username: 'user', apiToken: 'token' },
      snow:       { baseUrl: 'https://acme.service-now.com', username: 'snow-user', password: 'snow-pass' },
      github:     { baseUrl: 'https://api.github.com', pat: 'gh-secret' },
      confluence: { baseUrl: 'https://acme.atlassian.net', username: 'person@example.com', apiToken: 'cloud-token' },
      sslVerify:  true,
    };

    const response = await request(buildTestApp(configuration))
      .get('/api/proxy-config')
      .set('X-NodeToolbox-Demo-Mode', '1');

    expect(response.status).toBe(200);
    expect(response.body.jira.baseUrl).toBe('');
    expect(response.body.jira.hasCredentials).toBe(false);
    expect(response.body.github.hasCredentials).toBe(false);
    expect(response.body.confluence.baseUrl).toBe('');
    expect(response.body.confluence.hasCredentials).toBe(false);
  });
});

// ── /api/config/connectivity ───────────────────────────────────────────────────

describe('GET /api/config/connectivity', () => {
  it('reports GitHub App lookup readiness before Installation ID is known', async () => {
    const configuration = {
      jira:       { baseUrl: '', pat: '' },
      snow:       { baseUrl: '', username: '', password: '' },
      github:     {
        baseUrl: 'https://api.github.com',
        pat: '',
        appId: '123456',
        installationId: '',
        appPrivateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
      },
      confluence: { baseUrl: '', username: '', apiToken: '' },
      sslVerify:  true,
    };

    const response = await request(buildTestApp(configuration))
      .get('/api/config/connectivity');

    expect(response.status).toBe(200);
    expect(response.body.github.hasAppAuth).toBe(false);
    expect(response.body.github.hasAppId).toBe(true);
    expect(response.body.github.hasAppPrivateKey).toBe(true);
    expect(response.body.github.hasInstallationId).toBe(false);
    expect(response.body.github.hasAppLookupReady).toBe(true);
  });
});

// ── /api/snow-session ─────────────────────────────────────────────────────────

describe('/api/snow-session', () => {
  // Clear session state between tests to avoid bleed-over
  afterEach(() => snowSession.clearSession());

  it('POST stores the session and returns ok:true', async () => {
    const configuration = {
      jira: { baseUrl: '', pat: '' }, snow: { baseUrl: '' },
      github: { baseUrl: 'https://api.github.com', pat: '' }, sslVerify: true,
    };

    const response = await request(buildTestApp(configuration))
      .post('/api/snow-session')
      .send({ gck: 'test-gck-token', baseUrl: 'https://snow.example.com', expiresIn: 3600 });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.expiresAt).toBeDefined();
  });

  it('POST returns 400 when gck is missing', async () => {
    const configuration = {
      jira: { baseUrl: '', pat: '' }, snow: { baseUrl: '' },
      github: { baseUrl: 'https://api.github.com', pat: '' }, sslVerify: true,
    };

    const response = await request(buildTestApp(configuration))
      .post('/api/snow-session')
      .send({ baseUrl: 'https://snow.example.com' });

    expect(response.status).toBe(400);
  });

  it('GET returns session status without exposing the token', async () => {
    snowSession.storeSession('my-secret-gck', 'https://snow.example.com', 7200);

    const configuration = {
      jira: { baseUrl: '', pat: '' }, snow: { baseUrl: '' },
      github: { baseUrl: 'https://api.github.com', pat: '' }, sslVerify: true,
    };

    const response = await request(buildTestApp(configuration))
      .get('/api/snow-session');

    expect(response.status).toBe(200);
    expect(response.body.hasSession).toBe(true);
    expect(response.body.isActive).toBe(true);
    // The raw token must never appear in the response
    expect(JSON.stringify(response.body)).not.toContain('my-secret-gck');
  });

  it('DELETE clears the session', async () => {
    snowSession.storeSession('to-be-deleted', 'https://snow.example.com', 7200);

    const configuration = {
      jira: { baseUrl: '', pat: '' }, snow: { baseUrl: '' },
      github: { baseUrl: 'https://api.github.com', pat: '' }, sslVerify: true,
    };

    const deleteResponse = await request(buildTestApp(configuration))
      .delete('/api/snow-session');

    expect(deleteResponse.status).toBe(200);
    expect(deleteResponse.body.ok).toBe(true);

    const getResponse = await request(buildTestApp(configuration))
      .get('/api/snow-session');
    expect(getResponse.body.hasSession).toBe(false);
  });
});

// ── /api/proxy-status version field ─────────────────────────────────────────

describe('GET /api/proxy-status — version accuracy', () => {
  it('returns the actual package.json version, not a hardcoded placeholder', async () => {
    // If the server hardcodes "1.0.0" the port-conflict recovery will never detect
    // a version mismatch and will keep reusing old broken NodeToolbox instances.
    const { version: expectedVersion } = require('../../package.json');

    const configuration = {
      jira:   { baseUrl: '', pat: '' },
      snow:   { baseUrl: '', username: '', password: '' },
      github: { pat: '' },
      sslVerify: true,
    };

    const response = await request(buildTestApp(configuration))
      .get('/api/proxy-status');

    expect(response.status).toBe(200);
    expect(response.body.version).toBe(expectedVersion);
  });
});

// ── /api/version-check ────────────────────────────────────────────────────────

describe('GET /api/version-check', () => {
  const minimalConfiguration = {
    jira: { baseUrl: '', pat: '' },
    snow: { baseUrl: '', username: '', password: '' },
    github: { pat: '' },
    sslVerify: true,
  };

  afterEach(() => nock.cleanAll());

  it('returns the latest version and release notes from the GitHub API when the API responds', async () => {
    nock('https://api.github.com')
      .get('/repos/mikejsmith1985/NodeToolbox/releases/latest')
      .reply(200, {
        tag_name: 'v9.9.9',
        body: 'Release notes from the API.',
      });

    nock('https://github.com')
      .head('/mikejsmith1985/NodeToolbox/releases/latest')
      .reply(302, undefined, {
        Location: 'https://github.com/mikejsmith1985/NodeToolbox/releases/tag/v9.9.9',
      });

    const response = await request(buildTestApp(minimalConfiguration))
      .get('/api/version-check');

    expect(response.status).toBe(200);
    expect(response.body.latestVersion).toBe('9.9.9');
    expect(response.body.hasUpdate).toBe(true);
    expect(response.body.releaseNotes).toBe('Release notes from the API.');
  });

  it('falls back to the public GitHub release redirect when the API request fails', async () => {
    nock('https://api.github.com')
      .get('/repos/mikejsmith1985/NodeToolbox/releases/latest')
      .replyWithError('socket hang up');

    nock('https://github.com')
      .head('/mikejsmith1985/NodeToolbox/releases/latest')
      .reply(302, undefined, {
        Location: 'https://github.com/mikejsmith1985/NodeToolbox/releases/tag/v9.9.9',
      });

    const response = await request(buildTestApp(minimalConfiguration))
      .get('/api/version-check');

    expect(response.status).toBe(200);
    expect(response.body.latestVersion).toBe('9.9.9');
    expect(response.body.hasUpdate).toBe(true);
    expect(response.body.releaseNotes).toContain('Version detected from the public GitHub release page');
  });

  it('returns a clear fallback message when both GitHub version-check paths fail', async () => {
    const { version: expectedVersion } = require('../../package.json');

    nock('https://api.github.com')
      .get('/repos/mikejsmith1985/NodeToolbox/releases/latest')
      .replyWithError('api unavailable');

    nock('https://github.com')
      .head('/mikejsmith1985/NodeToolbox/releases/latest')
      .replyWithError('redirect unavailable');

    const response = await request(buildTestApp(minimalConfiguration))
      .get('/api/version-check');

    expect(response.status).toBe(200);
    expect(response.body.latestVersion).toBe(expectedVersion);
    expect(response.body.hasUpdate).toBe(false);
    expect(response.body.releaseNotes).toContain('Could not reach GitHub to check for updates.');
    expect(response.body.releaseNotes).toContain('API:');
    expect(response.body.releaseNotes).toContain('Fallback:');
  });
});

// ── /api/diagnostic ───────────────────────────────────────────────────────────

describe('GET /api/diagnostic', () => {
  let configuration;

  beforeEach(() => {
    configuration = {
      jira:   { baseUrl: '', pat: '' },
      snow:   { baseUrl: '', username: '', password: '' },
      github: { pat: '' },
      sslVerify: true,
    };
  });

  it('returns HTTP 200', async () => {
    const response = await request(buildTestApp(configuration))
      .get('/api/diagnostic');
    expect(response.status).toBe(200);
  });

  it('reports whether running inside a pkg snapshot (pkgSnapshot)', async () => {
    const response = await request(buildTestApp(configuration))
      .get('/api/diagnostic');
    // Must be a boolean — false in test environment (not packaged)
    expect(typeof response.body.pkgSnapshot).toBe('boolean');
  });

  it('includes Node.js runtime info (nodeVersion, platform)', async () => {
    const response = await request(buildTestApp(configuration))
      .get('/api/diagnostic');
    expect(typeof response.body.nodeVersion).toBe('string');
    expect(typeof response.body.platform).toBe('string');
  });
});

// ── /api/snow-diag ────────────────────────────────────────────────────────────
// Provides all server-side ServiceNow state in one call for the diagnostic report.
// Must never expose raw credentials — username is masked, password is never returned.

describe('GET /api/snow-diag', () => {
  // Reset relay bridge and snow session state before each test
  beforeEach(() => {
    snowSession.clearSession();
    require('../../src/routes/relayBridge')._resetBridgeStateForTests();
  });

  it('returns HTTP 200', async () => {
    const configuration = {
      jira: { baseUrl: '', pat: '' },
      snow: { baseUrl: '', username: '', password: '' },
      github: { pat: '' }, sslVerify: true,
    };
    const response = await request(buildTestApp(configuration)).get('/api/snow-diag');
    expect(response.status).toBe(200);
  });

  it('reports snow.hasCredentials: false when no username/password set', async () => {
    const configuration = {
      jira: { baseUrl: '', pat: '' },
      snow: { baseUrl: 'https://acme.service-now.com', username: '', password: '' },
      github: { pat: '' }, sslVerify: true,
    };
    const response = await request(buildTestApp(configuration)).get('/api/snow-diag');
    expect(response.body.snow.hasCredentials).toBe(false);
  });

  it('reports snow.hasCredentials: true when both username and password are set', async () => {
    const configuration = {
      jira: { baseUrl: '', pat: '' },
      snow: { baseUrl: 'https://acme.service-now.com', username: 'svc_toolbox', password: 'secret' },
      github: { pat: '' }, sslVerify: true,
    };
    const response = await request(buildTestApp(configuration)).get('/api/snow-diag');
    expect(response.body.snow.hasCredentials).toBe(true);
  });

  it('returns a masked username, never the raw password', async () => {
    const configuration = {
      jira: { baseUrl: '', pat: '' },
      snow: { baseUrl: 'https://acme.service-now.com', username: 'svc_toolbox', password: 'super-secret' },
      github: { pat: '' }, sslVerify: true,
    };
    const response = await request(buildTestApp(configuration)).get('/api/snow-diag');
    const responseText = JSON.stringify(response.body);

    // Raw password must never appear
    expect(responseText).not.toContain('super-secret');
    // Username is masked: visible prefix + asterisks + visible suffix
    expect(response.body.snow.usernameMasked).toBeDefined();
    expect(response.body.snow.usernameMasked).not.toBe('svc_toolbox');
    expect(response.body.snow.usernameMasked).toContain('*');
  });

  it('returns usernameMasked as null when no username is configured', async () => {
    const configuration = {
      jira: { baseUrl: '', pat: '' },
      snow: { baseUrl: '', username: '', password: '' },
      github: { pat: '' }, sslVerify: true,
    };
    const response = await request(buildTestApp(configuration)).get('/api/snow-diag');
    expect(response.body.snow.usernameMasked).toBeNull();
  });

  it('reports the SNow base URL', async () => {
    const configuration = {
      jira: { baseUrl: '', pat: '' },
      snow: { baseUrl: 'https://acme.service-now.com', username: '', password: '' },
      github: { pat: '' }, sslVerify: true,
    };
    const response = await request(buildTestApp(configuration)).get('/api/snow-diag');
    expect(response.body.snow.baseUrl).toBe('https://acme.service-now.com');
  });

  it('reports snow.sessionActive: false when no g_ck session is stored', async () => {
    const configuration = {
      jira: { baseUrl: '', pat: '' },
      snow: { baseUrl: '', username: '', password: '' },
      github: { pat: '' }, sslVerify: true,
    };
    const response = await request(buildTestApp(configuration)).get('/api/snow-diag');
    expect(response.body.snow.sessionActive).toBe(false);
    expect(response.body.snow.sessionExpiresAt).toBeNull();
  });

  it('reports snow.sessionActive: true when an active g_ck session is present', async () => {
    snowSession.storeSession('live-gck-token', 'https://acme.service-now.com', 7200);

    const configuration = {
      jira: { baseUrl: '', pat: '' },
      snow: { baseUrl: '', username: '', password: '' },
      github: { pat: '' }, sslVerify: true,
    };
    const response = await request(buildTestApp(configuration)).get('/api/snow-diag');
    expect(response.body.snow.sessionActive).toBe(true);
    expect(response.body.snow.sessionExpiresAt).toBeDefined();
    // The raw g_ck token must never appear in the response
    expect(JSON.stringify(response.body)).not.toContain('live-gck-token');
  });

  it('reports relay.snowActive: false when the SNow relay bookmarklet is not registered', async () => {
    const configuration = {
      jira: { baseUrl: '', pat: '' },
      snow: { baseUrl: '', username: '', password: '' },
      github: { pat: '' }, sslVerify: true,
    };
    const response = await request(buildTestApp(configuration)).get('/api/snow-diag');
    expect(response.body.relay.snowActive).toBe(false);
  });

  it('reports relay.jiraActive: false when the Jira relay bookmarklet is not registered', async () => {
    const configuration = {
      jira: { baseUrl: '', pat: '' },
      snow: { baseUrl: '', username: '', password: '' },
      github: { pat: '' }, sslVerify: true,
    };
    const response = await request(buildTestApp(configuration)).get('/api/snow-diag');
    expect(response.body.relay.jiraActive).toBe(false);
  });

  it('reports relay.snowActive: true after the SNow bookmarklet registers', async () => {
    // Register the SNow relay via HTTP so the bridge state is set
    const relayBridgeRouter = require('../../src/routes/relayBridge');
    const tempApp = require('express')();
    tempApp.use(require('express').json());
    tempApp.use('/api/relay-bridge', relayBridgeRouter);
    await request(tempApp).post('/api/relay-bridge/register?sys=snow').send({});

    const configuration = {
      jira: { baseUrl: '', pat: '' },
      snow: { baseUrl: '', username: '', password: '' },
      github: { pat: '' }, sslVerify: true,
    };
    const response = await request(buildTestApp(configuration)).get('/api/snow-diag');
    expect(response.body.relay.snowActive).toBe(true);
  });
});



describe('POST /api/shutdown', () => {
  let exitSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    // Prevent process.exit() from actually terminating the Jest process
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    exitSpy.mockRestore();
  });

  it('responds with ok:true and a message', async () => {
    const configuration = {
      jira: { baseUrl: '', pat: '' }, snow: { baseUrl: '' },
      github: { pat: '' }, sslVerify: true,
    };

    const response = await request(buildTestApp(configuration))
      .post('/api/shutdown');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(typeof response.body.message).toBe('string');
  });

  it('calls process.exit(0) after the response delay', async () => {
    const configuration = {
      jira: { baseUrl: '', pat: '' }, snow: { baseUrl: '' },
      github: { pat: '' }, sslVerify: true,
    };

    await request(buildTestApp(configuration)).post('/api/shutdown');

    expect(exitSpy).not.toHaveBeenCalled(); // not called before timeout fires
    jest.runAllTimers();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});

// ── /api/restart ──────────────────────────────────────────────────────────────

describe('POST /api/restart', () => {
  let exitSpy;
  let spawnSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    exitSpy  = jest.spyOn(process, 'exit').mockImplementation(() => {});
    // Prevent a real child process from being spawned during the test
    spawnSpy = jest.spyOn(require('child_process'), 'spawn')
      .mockReturnValue({ unref: () => {} });
  });

  afterEach(() => {
    jest.useRealTimers();
    exitSpy.mockRestore();
    spawnSpy.mockRestore();
  });

  it('responds with ok:true and a message', async () => {
    const configuration = {
      jira: { baseUrl: '', pat: '' }, snow: { baseUrl: '' },
      github: { pat: '' }, sslVerify: true,
    };

    const response = await request(buildTestApp(configuration))
      .post('/api/restart');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(typeof response.body.message).toBe('string');
  });

  it('spawns a detached child process then calls process.exit(0)', async () => {
    const configuration = {
      jira: { baseUrl: '', pat: '' }, snow: { baseUrl: '' },
      github: { pat: '' }, sslVerify: true,
    };

    // Clear any prior spawn calls made by Jest's own worker pool setup
    spawnSpy.mockClear();

    await request(buildTestApp(configuration)).post('/api/restart');

    jest.runAllTimers();

    // Verify the key properties of the spawn call without deep-comparing process.env
    expect(spawnSpy).toHaveBeenCalled();
    const spawnCallArgs = spawnSpy.mock.calls[0];
    expect(spawnCallArgs[0]).toBe(process.execPath);          // same node/exe binary
    expect(Array.isArray(spawnCallArgs[1])).toBe(true);       // argv args forwarded
    expect(spawnCallArgs[1]).toContain('--restart-handoff');  // restart launches fail fast on port handoff errors
    expect(spawnCallArgs[2].detached).toBe(true);             // fully detached
    expect(spawnCallArgs[2].stdio).toBe('ignore');            // no I/O attached
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});

// ── /api/download/launcher-vbs ────────────────────────────────────────────────
// The Admin Hub exposes download buttons for the VBS and BAT launcher files.
// These routes serve the actual files from the distribution root so users can
// re-download launchers without extracting a new release zip.

describe('GET /api/download/launcher-vbs', () => {
  const minimalConfig = {
    jira:      { baseUrl: '', username: '', apiToken: '', pat: '' },
    snow:      { baseUrl: '', username: '', password: '' },
    github:    { pat: '' },
    sslVerify: true,
  };

  it('returns 200 with Content-Disposition attachment for the VBS file', async () => {
    const response = await request(buildTestApp(minimalConfig))
      .get('/api/download/launcher-vbs');

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toMatch(/attachment/i);
    expect(response.headers['content-disposition']).toMatch(/Launch Toolbox Silent\.vbs/i);
  });

  it('returns the VBS file as text/plain or application/octet-stream content', async () => {
    const response = await request(buildTestApp(minimalConfig))
      .get('/api/download/launcher-vbs');

    // The file content should start with the VBScript comment header
    expect(response.text || response.body).toBeTruthy();
  });
});

// ── /api/download/launcher-bat ────────────────────────────────────────────────

describe('GET /api/download/launcher-bat', () => {
  const minimalConfig = {
    jira:      { baseUrl: '', username: '', apiToken: '', pat: '' },
    snow:      { baseUrl: '', username: '', password: '' },
    github:    { pat: '' },
    sslVerify: true,
  };

  it('returns 200 with Content-Disposition attachment for the BAT file', async () => {
    const response = await request(buildTestApp(minimalConfig))
      .get('/api/download/launcher-bat');

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toMatch(/attachment/i);
    expect(response.headers['content-disposition']).toMatch(/Launch Toolbox\.bat/i);
  });

  it('returns the BAT file content', async () => {
    const response = await request(buildTestApp(minimalConfig))
      .get('/api/download/launcher-bat');

    // Bat file should launch the payload selected by current.txt.
    expect(response.text).toContain('current.txt');
    expect(response.text).toContain('nodetoolbox.exe');
    expect(response.text).toContain('--open');
  });
});

// ── GET /api/config/github-app/installations ─────────────────────────────────

describe('GET /api/config/github-app/installations', () => {
  afterEach(() => nock.cleanAll());

  it('returns 400 when App credentials are not configured', async () => {
    const configuration = { github: {}, jira: {}, snow: {}, confluence: {} };
    const response = await request(buildTestApp(configuration))
      .get('/api/config/github-app/installations');

    expect(response.status).toBe(400);
    expect(response.body.ok).toBe(false);
  });

  it('returns 200 with installation list when GitHub App responds successfully', async () => {
    // Generate a real RSA key so JWT signing works inside the route handler
    const crypto = require('crypto');
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const testPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

    const configuration = {
      github: {
        appId: '12345',
        appPrivateKey: testPem,
        baseUrl: 'https://api.github.com',
        installationId: '0',
      },
      jira: {}, snow: {}, confluence: {},
    };

    const mockInstallations = [
      { id: 777, account: { login: 'test-org', type: 'Organization' }, app_slug: 'ntbx' },
    ];
    nock('https://api.github.com')
      .get('/app/installations')
      .reply(200, mockInstallations);

    const response = await request(buildTestApp(configuration))
      .get('/api/config/github-app/installations');

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.installations).toHaveLength(1);
    expect(response.body.installations[0].id).toBe(777);
    expect(response.body.installations[0].account).toBe('test-org');
  });
});

// ── GET /api/snow-relay/my-changes ────────────────────────────────────────
// Fetches all open ServiceNow Changes assigned to the current user.

describe('GET /api/snow-relay/my-changes', () => {
  const minimalConfig = {
    jira: { baseUrl: '', pat: '' },
    snow: { baseUrl: 'https://acme.service-now.com', username: 'svc_toolbox', password: 'secret' },
    github: { pat: '' },
    sslVerify: true,
  };

  afterEach(() => {
    // Clean up mocks and nock interceptors
    jest.clearAllMocks();
    nock.cleanAll();
  });

  it('TestFetchMyChanges_ReturnsUserAssignedChanges', async () => {
    // Mock the relay bridge for user lookup
    const relayBridge = require('../../src/routes/relayBridge');
    jest.spyOn(relayBridge, 'submitRelayRequest').mockImplementation((system, request, timeout) => {
      if (request.url.includes('sys_user')) {
        return Promise.resolve({
          result: [
            { sys_id: 'user-123', user_name: 'john.doe', name: 'John Doe' },
          ],
        });
      }
      // Mock changes query
      if (request.url.includes('change_request')) {
        return Promise.resolve({
          result: [
            {
              sys_id: 'chg-001',
              number: 'CHG0046897',
              short_description: 'Update network infrastructure',
              state: '2',
              priority: '2',
              assigned_to: { value: 'user-123', display_value: 'John Doe' },
            },
            {
              sys_id: 'chg-002',
              number: 'CHG0046898',
              short_description: 'Database migration',
              state: '1',
              priority: '3',
              assigned_to: { value: 'user-123', display_value: 'John Doe' },
            },
          ],
        });
      }
      return Promise.reject(new Error('Unexpected request'));
    });

    const response = await request(buildTestApp(minimalConfig))
      .get('/api/snow-relay/my-changes');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(2);

    // Verify first change structure and mapping
    const firstChange = response.body[0];
    expect(firstChange.key).toBe('CHG0046897');
    expect(firstChange.summary).toBe('Update network infrastructure');
    expect(firstChange.state).toBe('2');
    expect(firstChange.priority).toBe('2');
    expect(firstChange.assignedTo.displayName).toBe('John Doe');
  });

  it('TestFetchMyChanges_ReturnsEmptyResultsWhenUserHasNoOpenChanges', async () => {
    const relayBridge = require('../../src/routes/relayBridge');
    jest.spyOn(relayBridge, 'submitRelayRequest').mockImplementation((system, request, timeout) => {
      if (request.url.includes('sys_user')) {
        return Promise.resolve({
          result: [
            { sys_id: 'user-123', user_name: 'john.doe', name: 'John Doe' },
          ],
        });
      }
      // Mock empty changes query result
      if (request.url.includes('change_request')) {
        return Promise.resolve({ result: [] });
      }
      return Promise.reject(new Error('Unexpected request'));
    });

    const response = await request(buildTestApp(minimalConfig))
      .get('/api/snow-relay/my-changes');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('TestFetchMyChanges_ReturnsErrorWhenRelayBridgeIsInactive', async () => {
    const relayBridge = require('../../src/routes/relayBridge');
    jest.spyOn(relayBridge, 'submitRelayRequest').mockRejectedValue(
      new Error('Relay bridge is not active. Ensure the ServiceNow bookmarklet is open and registered.')
    );

    const response = await request(buildTestApp(minimalConfig))
      .get('/api/snow-relay/my-changes');

    expect(response.status).toBe(502);
    expect(response.body.error).toBe('Relay error');
    expect(response.body.message).toContain('relay bookmarklet is active');
    expect(response.body.details).toContain('Relay bridge is not active');
  });

  it('TestFetchMyChanges_SetsDefaultStateFilterWhenNotProvided', async () => {
    const relayBridge = require('../../src/routes/relayBridge');
    let capturedRequest;

    jest.spyOn(relayBridge, 'submitRelayRequest').mockImplementation((system, request, timeout) => {
      if (request.url.includes('sys_user')) {
        return Promise.resolve({
          result: [{ sys_id: 'user-123', user_name: 'john.doe', name: 'John Doe' }],
        });
      }
      if (request.url.includes('change_request')) {
        capturedRequest = request;
        return Promise.resolve({ result: [] });
      }
      return Promise.reject(new Error('Unexpected request'));
    });

    await request(buildTestApp(minimalConfig))
      .get('/api/snow-relay/my-changes');

    // Verify default state filter (1,2,3) is in the query
    expect(capturedRequest.url).toContain('state=1%2C2%2C3');
  });

  it('TestFetchMyChanges_UsesCustomStateFilterWhenProvided', async () => {
    const relayBridge = require('../../src/routes/relayBridge');
    let capturedRequest;

    jest.spyOn(relayBridge, 'submitRelayRequest').mockImplementation((system, request, timeout) => {
      if (request.url.includes('sys_user')) {
        return Promise.resolve({
          result: [{ sys_id: 'user-123', user_name: 'john.doe', name: 'John Doe' }],
        });
      }
      if (request.url.includes('change_request')) {
        capturedRequest = request;
        return Promise.resolve({ result: [] });
      }
      return Promise.reject(new Error('Unexpected request'));
    });

    await request(buildTestApp(minimalConfig))
      .get('/api/snow-relay/my-changes?state=1,2');

    // Verify custom state filter is used
    expect(capturedRequest.url).toContain('state=1%2C2');
  });

  it('TestFetchMyChanges_HandlesMissingUserFieldsGracefully', async () => {
    const relayBridge = require('../../src/routes/relayBridge');
    jest.spyOn(relayBridge, 'submitRelayRequest').mockImplementation((system, request, timeout) => {
      if (request.url.includes('sys_user')) {
        return Promise.resolve({
          result: [{ sys_id: 'user-123', user_name: 'john.doe', name: 'John Doe' }],
        });
      }
      if (request.url.includes('change_request')) {
        return Promise.resolve({
          result: [
            {
              sys_id: 'chg-001',
              number: 'CHG0046897',
              short_description: 'Partial data change',
              // Intentionally omit optional fields
            },
          ],
        });
      }
      return Promise.reject(new Error('Unexpected request'));
    });

    const response = await request(buildTestApp(minimalConfig))
      .get('/api/snow-relay/my-changes');

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    const change = response.body[0];
    expect(change.key).toBe('CHG0046897');
    expect(change.summary).toBe('Partial data change');
    expect(change.state).toBe('');
    expect(change.assignedTo.sysId).toBe('');
  });

  it('TestFetchMyChanges_SkipsUserLookupWhenUserQueryFails', async () => {
    const relayBridge = require('../../src/routes/relayBridge');
    let changeRequestAttempted = false;

    jest.spyOn(relayBridge, 'submitRelayRequest').mockImplementation((system, request, timeout) => {
      if (request.url.includes('sys_user')) {
        // Simulate user lookup failure
        return Promise.reject(new Error('User lookup failed'));
      }
      if (request.url.includes('change_request')) {
        changeRequestAttempted = true;
        return Promise.resolve({ result: [] });
      }
      return Promise.reject(new Error('Unexpected request'));
    });

    const response = await request(buildTestApp(minimalConfig))
      .get('/api/snow-relay/my-changes');

    expect(response.status).toBe(200);
    expect(changeRequestAttempted).toBe(true);
  });

  it('TestFetchMyChanges_ReturnsEmptyArrayWhenServiceNowReturnsNull', async () => {
    const relayBridge = require('../../src/routes/relayBridge');
    jest.spyOn(relayBridge, 'submitRelayRequest').mockImplementation((system, request, timeout) => {
      if (request.url.includes('sys_user')) {
        return Promise.resolve({
          result: [{ sys_id: 'user-123', user_name: 'john.doe', name: 'John Doe' }],
        });
      }
      if (request.url.includes('change_request')) {
        // Simulate ServiceNow returning null result
        return Promise.resolve({ result: null });
      }
      return Promise.reject(new Error('Unexpected request'));
    });

    const response = await request(buildTestApp(minimalConfig))
      .get('/api/snow-relay/my-changes');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('TestFetchMyChanges_IncludesAllChangeFieldsInResponse', async () => {
    const relayBridge = require('../../src/routes/relayBridge');
    jest.spyOn(relayBridge, 'submitRelayRequest').mockImplementation((system, request, timeout) => {
      if (request.url.includes('sys_user')) {
        return Promise.resolve({
          result: [{ sys_id: 'user-123', user_name: 'john.doe', name: 'John Doe' }],
        });
      }
      if (request.url.includes('change_request')) {
        return Promise.resolve({
          result: [
            {
              sys_id: 'chg-full',
              number: 'CHG0000001',
              short_description: 'Full field test',
              state: '1',
              priority: '1',
              assigned_to: { value: 'user-001', display_value: 'User One' },
            },
          ],
        });
      }
      return Promise.reject(new Error('Unexpected request'));
    });

    const response = await request(buildTestApp(minimalConfig))
      .get('/api/snow-relay/my-changes');

    const change = response.body[0];
    // Verify all expected fields are present and correctly mapped
    expect(change).toHaveProperty('key');
    expect(change).toHaveProperty('summary');
    expect(change).toHaveProperty('state');
    expect(change).toHaveProperty('priority');
    expect(change).toHaveProperty('assignedTo');
    expect(change.key).toBe('CHG0000001');
    expect(change.summary).toBe('Full field test');
  });
});

// ── PATCH /api/snow-relay/change/:changeKey ────────────────────────────────

describe('PATCH /api/snow-relay/change/:changeKey', () => {
  const minimalConfig = {
    jira: { baseUrl: '', pat: '' },
    snow: { baseUrl: 'https://acme.service-now.com', username: 'svc_toolbox', password: 'secret' },
    github: { pat: '' },
    sslVerify: true,
  };

  afterEach(() => {
    jest.clearAllMocks();
    nock.cleanAll();
  });

  it('TestPatchChange_MapsSelectedEnvironmentFieldsIntoTheRelayPayload', async () => {
    const relayBridge = require('../../src/routes/relayBridge');
    let capturedPatchRequest = null;

    jest.spyOn(relayBridge, 'submitRelayRequest').mockImplementation((system, request) => {
      if (request.method === 'GET' && request.url.includes('change_request?sysparm_query=number=')) {
        return Promise.resolve({
          result: [{ sys_id: 'change-sys-id-1' }],
        });
      }

      if (request.method === 'PATCH' && request.url.includes('/api/now/v2/table/change_request/change-sys-id-1')) {
        capturedPatchRequest = request;
        return Promise.resolve({});
      }

      return Promise.reject(new Error('Unexpected request'));
    });

    const response = await request(buildTestApp(minimalConfig))
      .patch('/api/snow-relay/change/CHG0001234')
      .send({
        shortDescription: 'Update network infrastructure',
        description: 'Detailed rollout plan',
        chgBasicInfo: {
          category: 'software',
          changeType: 'normal',
          environment: 'prod',
          assignmentGroup: { sysId: 'group-1', displayName: 'Cloud Team' },
        },
        chgPlanningAssessment: {
          impact: '3',
          systemAvailabilityImplication: 'none',
          hasBeenTested: 'yes',
          hasBeenPerformedPreviously: 'no',
          successProbability: 'high',
          canBeBackedOut: 'yes',
        },
        chgPlanningContent: {
          implementationPlan: 'Implement plan',
          backoutPlan: 'Backout plan',
          testPlan: 'Test plan',
        },
        relEnvironment: {
          isEnabled: false,
          plannedStartDate: '',
          plannedEndDate: '',
          configItem: { sysId: '', displayName: '' },
          impactedPersonsAware: '',
        },
        prdEnvironment: {
          isEnabled: true,
          plannedStartDate: '2026-06-01T10:00',
          plannedEndDate: '2026-06-01T11:00',
          configItem: { sysId: 'ci-123', displayName: 'Payroll Production Cluster' },
          impactedPersonsAware: 'yes',
        },
        pfixEnvironment: {
          isEnabled: false,
          plannedStartDate: '',
          plannedEndDate: '',
          configItem: { sysId: '', displayName: '' },
          impactedPersonsAware: '',
        },
      });

    expect(response.status).toBe(204);
    expect(capturedPatchRequest.body.u_environment).toBe('prod');
    expect(capturedPatchRequest.body.cmdb_ci).toBe('ci-123');
    expect(capturedPatchRequest.body.u_impacted_persons_aware).toBe('yes');
    expect(capturedPatchRequest.body.start_date).toBe('2026-06-01T10:00');
    expect(capturedPatchRequest.body.end_date).toBe('2026-06-01T11:00');
    expect(capturedPatchRequest.body.u_change_tested).toBe('yes');
    expect(capturedPatchRequest.body.implementation_plan).toBe('Implement plan');
  });

  it('TestPatchChange_AllowsClearingSelectedEnvironmentFields', async () => {
    const relayBridge = require('../../src/routes/relayBridge');
    let capturedPatchRequest = null;

    jest.spyOn(relayBridge, 'submitRelayRequest').mockImplementation((system, request) => {
      if (request.method === 'GET' && request.url.includes('change_request?sysparm_query=number=')) {
        return Promise.resolve({
          result: [{ sys_id: 'change-sys-id-2' }],
        });
      }

      if (request.method === 'PATCH' && request.url.includes('/api/now/v2/table/change_request/change-sys-id-2')) {
        capturedPatchRequest = request;
        return Promise.resolve({});
      }

      return Promise.reject(new Error('Unexpected request'));
    });

    const response = await request(buildTestApp(minimalConfig))
      .patch('/api/snow-relay/change/CHG0001235')
      .send({
        shortDescription: 'Update network infrastructure',
        chgBasicInfo: {
          environment: 'prod',
          assignmentGroup: { sysId: 'group-1', displayName: 'Cloud Team' },
          configItem: { sysId: 'stale-ci', displayName: 'Old Config Item' },
        },
        chgPlanningAssessment: {
          impactedPersonsAware: 'stale-aware',
        },
        relEnvironment: {
          isEnabled: false,
          plannedStartDate: '',
          plannedEndDate: '',
          configItem: { sysId: '', displayName: '' },
          impactedPersonsAware: '',
        },
        prdEnvironment: {
          isEnabled: true,
          plannedStartDate: '',
          plannedEndDate: '',
          configItem: { sysId: '', displayName: '' },
          impactedPersonsAware: '',
        },
        pfixEnvironment: {
          isEnabled: false,
          plannedStartDate: '',
          plannedEndDate: '',
          configItem: { sysId: '', displayName: '' },
          impactedPersonsAware: '',
        },
      });

    expect(response.status).toBe(204);
    expect(capturedPatchRequest.body.cmdb_ci).toBe('');
    expect(capturedPatchRequest.body.u_impacted_persons_aware).toBe('');
    expect(capturedPatchRequest.body.start_date).toBe('');
    expect(capturedPatchRequest.body.end_date).toBe('');
  });
});

// ── /api/releases ───────────────────────────────────────────────────────────

describe('GET /api/releases', () => {
  afterEach(() => nock.cleanAll());

  it('lists recent published releases, filtering out prereleases/drafts', async () => {
    nock('https://api.github.com')
      .get('/repos/mikejsmith1985/NodeToolbox/releases')
      .query({ per_page: '10' })
      .reply(200, [
        { tag_name: 'v0.45.0', name: 'v0.45.0', published_at: '2026-07-06T00:00:00Z', body: 'notes', draft: false, prerelease: false },
        { tag_name: 'v0.44.0', name: 'v0.44.0', published_at: '2026-07-05T00:00:00Z', body: '', draft: false, prerelease: false },
        { tag_name: 'v0.99.0', name: 'beta', published_at: '2026-07-07T00:00:00Z', body: '', draft: false, prerelease: true },
        { tag_name: 'v0.98.0', name: 'draft', published_at: '2026-07-08T00:00:00Z', body: '', draft: true, prerelease: false },
      ]);

    const configuration = {
      jira:   { baseUrl: 'https://acme.atlassian.net', pat: 'jira-pat' },
      snow:   { baseUrl: '', username: '', password: '' },
      github: { baseUrl: 'https://api.github.com', pat: '' },
      sslVerify: true,
    };
    const response = await request(buildTestApp(configuration)).get('/api/releases');

    expect(response.status).toBe(200);
    expect(response.body.currentVersion).toBeTruthy();
    expect(response.body.releases.map((release) => release.version)).toEqual(['0.45.0', '0.44.0']);
  });

  it('returns 502 when GitHub is unreachable', async () => {
    nock('https://api.github.com')
      .get('/repos/mikejsmith1985/NodeToolbox/releases')
      .query({ per_page: '10' })
      .reply(500, 'boom');

    const configuration = {
      jira:   { baseUrl: 'https://acme.atlassian.net', pat: 'jira-pat' },
      snow:   { baseUrl: '', username: '', password: '' },
      github: { baseUrl: 'https://api.github.com', pat: '' },
      sslVerify: true,
    };
    const response = await request(buildTestApp(configuration)).get('/api/releases');
    expect(response.status).toBe(502);
    expect(response.body.error).toBeTruthy();
  });
});
