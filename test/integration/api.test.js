// test/integration/api.test.js — Integration tests for the API routes.
// Tests /api/proxy-status, /api/proxy-config, /api/snow-session, and /api/diagnostic endpoints.

'use strict';

const request = require('supertest');
const express = require('express');
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

    // Bat file should contain the node server.js invocation
    expect(response.text).toContain('node server.js');
  });
});
