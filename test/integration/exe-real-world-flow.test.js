// test/integration/exe-real-world-flow.test.js — End-to-end test that
// simulates the EXACT experience of a user who has never seen the project.
//
// The test copies the .exe to a clean temp directory (no public/ folder,
// no node_modules, no source tree) and temporarily renames public/toolbox.html
// on the build machine to ensure the exe cannot fall back to reading from the
// build machine's real disk. This confirms that toolbox.html is genuinely
// served from the pkg snapshot (the JS module embedded at build time) and NOT
// from the filesystem, which would be unavailable on any machine other than the
// one that built the exe.
//
// Flow exercised:
//   1. Start exe from isolated temp directory
//   2. Server responds on port 5555
//   3. GET / → 302 redirect to /setup (no config present yet)
//   4. POST /api/setup with minimal Jira credentials
//   5. GET / → 200 with the dashboard HTML from the snapshot
//
// Before the fix (v0.0.10): Step 5 returns 404 "File Not Found" because
// readFileSync falls through to the real disk path which doesn't exist.
// After the fix: Step 5 returns 200 because the HTML is bundled as a JS module.

'use strict';

const path    = require('path');
const fs      = require('fs');
const http    = require('http');
const { spawnSync } = require('child_process');

const PROJECT_ROOT      = path.join(__dirname, '..', '..');
const DIST_DIR          = path.join(PROJECT_ROOT, 'dist');
const PUBLIC_HTML_PATH  = path.join(PROJECT_ROOT, 'public', 'toolbox.html');
const BACKUP_HTML_PATH  = PUBLIC_HTML_PATH + '.bak';
const TEMP_EXE_DIR      = path.join(require('os').tmpdir(), 'nodetoolbox-test-' + Date.now());

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

describe('exe real-world flow — dashboard served from pkg snapshot (not real disk)', () => {
  let exeProcess = null;

  beforeAll(async () => {
    const exePath = findExeInDist();
    if (!exePath) {
      // No exe in dist/ — skip gracefully. CI builds may not have the exe.
      return;
    }

    // Create an isolated temp directory with ONLY the exe — no source tree, no public/.
    fs.mkdirSync(TEMP_EXE_DIR, { recursive: true });
    const tempExePath = path.join(TEMP_EXE_DIR, path.basename(exePath));
    fs.copyFileSync(exePath, tempExePath);

    // Rename public/toolbox.html on the build machine so the exe cannot fall
    // back to reading from the real disk (which would give a false pass on the
    // build machine where the path C:\...\public\toolbox.html exists).
    if (fs.existsSync(PUBLIC_HTML_PATH)) {
      fs.renameSync(PUBLIC_HTML_PATH, BACKUP_HTML_PATH);
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
    // Kill the exe process first, then restore the HTML file.
    if (exeProcess) {
      try { exeProcess.kill('SIGKILL'); } catch (_e) { /* already stopped */ }
    }
    // Always restore the renamed HTML file, even if a test failed.
    if (fs.existsSync(BACKUP_HTML_PATH)) {
      fs.renameSync(BACKUP_HTML_PATH, PUBLIC_HTML_PATH);
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

  it('GET / after setup returns 200 with the dashboard HTML from the pkg snapshot', async () => {
    if (!exeProcess) return;
    const dashboardResponse = await getPage('/');
    // This is the critical assertion. Before the fix: 404 "File Not Found".
    // After the fix: 200 with the full toolbox.html dashboard.
    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.contentType).toMatch(/text\/html/i);
    expect(dashboardResponse.body).toMatch(/<!DOCTYPE html>/i);
  });

  it('dashboard does NOT show the "toolbox.html not found" error page', async () => {
    if (!exeProcess) return;
    const dashboardResponse = await getPage('/');
    // The exact error page string from buildHtmlNotFoundPage() must NOT appear.
    expect(dashboardResponse.body).not.toContain('toolbox.html not found');
    expect(dashboardResponse.body).not.toContain('NodeToolbox — File Not Found');
  });
});
