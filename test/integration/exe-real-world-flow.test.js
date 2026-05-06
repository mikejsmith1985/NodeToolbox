// test/integration/exe-real-world-flow.test.js — End-to-end test that
// simulates the EXACT experience of a user who has never seen the project.
//
// The test copies the .exe to a clean temp directory (no source tree, no
// node_modules, no client/dist) and verifies the exe self-contains the React
// SPA via its pkg snapshot. This confirms that client/dist/**/* was correctly
// bundled at build time (via the "assets" array in package.json) so the app
// works for users who only have the .exe file.
//
// Flow exercised:
//   1. Start exe from isolated temp directory
//   2. Server responds on port 5555
//   3. GET / → 302 redirect to /setup (no config present yet)
//   4. POST /api/setup with minimal Jira credentials
//   5. GET / → 200 with the React SPA HTML from the pkg snapshot
//
// If no .exe exists in dist/ (e.g. CI without a pre-built binary), the suite
// skips gracefully — only one placeholder test runs.

'use strict';

const path    = require('path');
const fs      = require('fs');
const http    = require('http');
const { spawnSync } = require('child_process');

const PROJECT_ROOT      = path.join(__dirname, '..', '..');
const DIST_DIR          = path.join(PROJECT_ROOT, 'dist');
// The legacy public/toolbox.html no longer exists — the app now serves the
// React SPA from client/dist/ which is bundled into the exe via pkg assets.
const TEMP_EXE_DIR      = path.join(require('os').tmpdir(), 'nodetoolbox-test-' + Date.now());

// Config path matches loader.js: %APPDATA%\NodeToolbox\toolbox-proxy.json
const CONFIG_FILE_PATH  = path.join(
  process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming'),
  'NodeToolbox', 'toolbox-proxy.json'
);
const BACKUP_CONFIG_PATH = CONFIG_FILE_PATH + '.integration-test-bak';

/** Server port — must match DEFAULT_PORT in server.js */
const PROXY_SERVER_PORT = 5555;

/** Maximum time (ms) to poll for the server to accept connections */
const SERVER_START_TIMEOUT_MS = 20_000;

/** Polling interval (ms) while waiting for the server to start */
const POLL_INTERVAL_MS = 500;

// Integration tests are slow — allow 60 s total for this suite
jest.setTimeout(60_000);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Finds the most recent nodetoolbox exe in the dist directory.
 * Returns the absolute path, or null if none found.
 *
 * @returns {string|null}
 */
function findExeInDist() {
  if (!fs.existsSync(DIST_DIR)) return null;
  const exeEntries = fs.readdirSync(DIST_DIR)
    .filter((fileName) => fileName.startsWith('nodetoolbox-') && fileName.endsWith('.exe'));
  if (exeEntries.length === 0) return null;
  // Sort descending so the highest version comes first
  exeEntries.sort().reverse();
  return path.join(DIST_DIR, exeEntries[0]);
}

/**
 * Polls http://localhost:{port}/ until the server accepts connections or the
 * timeout is exceeded.
 *
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} true when server responds, false on timeout
 */
function waitForServer(port, timeoutMs) {
  return new Promise((resolve) => {
    const startTime = Date.now();

    const tryConnect = () => {
      const req = http.get('http://localhost:' + port + '/', (res) => {
        res.resume();
        resolve(true);
      });
      req.on('error', () => {
        if (Date.now() - startTime >= timeoutMs) {
          resolve(false);
        } else {
          setTimeout(tryConnect, POLL_INTERVAL_MS);
        }
      });
      req.setTimeout(POLL_INTERVAL_MS, () => req.destroy());
    };

    tryConnect();
  });
}

/**
 * Makes a POST request to /api/setup with minimal Jira credentials.
 * Returns the response status and Location header.
 *
 * @returns {Promise<{status: number, location: string}>}
 */
function postSetupCredentials() {
  return new Promise((resolve, reject) => {
    const requestBody = JSON.stringify({
      jiraBaseUrl: 'https://jira.example.com',
      jiraPat:     'integration-test-token',
    });
    const requestOptions = {
      hostname: 'localhost',
      port:     PROXY_SERVER_PORT,
      path:     '/api/setup',
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
    };
    const req = http.request(requestOptions, (res) => {
      res.resume();
      resolve({ status: res.statusCode, location: res.headers.location || '/' });
    });
    req.on('error', reject);
    req.write(requestBody);
    req.end();
  });
}

/**
 * Makes a GET request to the given path and returns status + body text.
 *
 * @param {string} urlPath
 * @returns {Promise<{status: number, contentType: string, body: string}>}
 */
function getPage(urlPath) {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:' + PROXY_SERVER_PORT + urlPath, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({
        status:      res.statusCode,
        contentType: res.headers['content-type'] || '',
        body,
      }));
    }).on('error', reject);
  });
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('exe real-world flow — React SPA served from pkg snapshot (not real disk)', () => {
  let exeProcess = null;

  beforeAll(async () => {
    const exePath = findExeInDist();
    if (!exePath) {
      // No exe in dist/ — skip gracefully. CI builds may not have the exe.
      return;
    }

    // Create an isolated temp directory with ONLY the exe — no source tree, no client/dist/.
    fs.mkdirSync(TEMP_EXE_DIR, { recursive: true });
    const tempExePath = path.join(TEMP_EXE_DIR, path.basename(exePath));
    fs.copyFileSync(exePath, tempExePath);

    // Back up any existing config so the exe starts in "fresh install" state.
    // Without this, a previously saved config causes GET / to return 200 (dashboard)
    // instead of 302 (redirect to /setup), breaking the setup-wizard part of the test.
    if (fs.existsSync(CONFIG_FILE_PATH)) {
      fs.copyFileSync(CONFIG_FILE_PATH, BACKUP_CONFIG_PATH);
      fs.unlinkSync(CONFIG_FILE_PATH);
    }

    // Start the exe from the isolated temp directory.
    exeProcess = require('child_process').spawn(tempExePath, [], {
      cwd:      TEMP_EXE_DIR,
      stdio:    'ignore',
      detached: false,
    });

    const serverIsReady = await waitForServer(PROXY_SERVER_PORT, SERVER_START_TIMEOUT_MS);
    if (!serverIsReady) {
      exeProcess.kill('SIGKILL');
      throw new Error('Exe server did not start within ' + SERVER_START_TIMEOUT_MS + 'ms');
    }
  });

  afterAll(() => {
    // Kill the exe process first, then restore files.
    if (exeProcess) {
      try { exeProcess.kill('SIGKILL'); } catch (_e) { /* already stopped */ }
    }
    // Restore the config file that was backed up before the test.
    if (fs.existsSync(BACKUP_CONFIG_PATH)) {
      try { fs.copyFileSync(BACKUP_CONFIG_PATH, CONFIG_FILE_PATH); } catch (_e) { /* best effort */ }
      try { fs.unlinkSync(BACKUP_CONFIG_PATH); } catch (_e) { /* best effort */ }
    }
    // Clean up the temp directory.
    try { fs.rmSync(TEMP_EXE_DIR, { recursive: true, force: true }); } catch (_e) { /* best effort */ }
  });

  it('skips if no exe in dist/ (CI environment without a pre-built binary)', () => {
    // This placeholder passes vacuously when no exe is present.
    // The real assertions are in the tests below.
    expect(true).toBe(true);
  });

  it('server starts and responds on port 5555', async () => {
    if (!exeProcess) return; // no exe — skip
    const initialResponse = await getPage('/');
    // Server should either redirect to /setup or serve the dashboard — either way it responds
    expect([200, 302]).toContain(initialResponse.status);
  });

  it('GET / redirects to /setup when no config is present', async () => {
    if (!exeProcess) return;
    const response = await getPage('/');
    // First launch: no config → must redirect to setup wizard
    expect(response.status).toBe(302);
  });

  it('POST /api/setup with valid credentials returns 302 redirect to /', async () => {
    if (!exeProcess) return;
    const setupResult = await postSetupCredentials();
    expect(setupResult.status).toBe(302);
    expect(setupResult.location).toBe('/');
  });

  it('GET / after setup returns 200 with the React SPA HTML from the pkg snapshot', async () => {
    if (!exeProcess) return;
    const dashboardResponse = await getPage('/');
    // This is the critical assertion: client/dist/**/* must be bundled in the exe
    // via the pkg "assets" array in package.json. Without bundling, the server
    // returns 503 "React build not found" instead of 200.
    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.contentType).toMatch(/text\/html/i);
    expect(dashboardResponse.body).toMatch(/<!DOCTYPE html>/i);
  });

  it('dashboard does NOT show the "React build not found" error page', async () => {
    if (!exeProcess) return;
    const dashboardResponse = await getPage('/');
    // The 503 error page from buildClientNotBuiltPage() must NOT appear.
    // Its presence would mean client/dist/ was not bundled into the exe snapshot.
    expect(dashboardResponse.body).not.toContain('React build not found');
    expect(dashboardResponse.body).not.toContain('NodeToolbox — Build Required');
  });
});
