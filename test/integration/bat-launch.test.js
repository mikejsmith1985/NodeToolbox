// test/integration/bat-launch.test.js — Functional validation that Launch Toolbox.bat
// actually starts the server and serves HTTP API requests correctly.
//
// This test executes the real bat file via cmd.exe in the background (exactly as a
// user double-clicking it would), then verifies the server responds on port 5555
// while the bat process is running.
//
// The current bat design runs "node server.js" directly in the same cmd window
// (no "start" detachment). The bat process blocks while the server is alive —
// that is intentional, keeping errors visible in the console. The unit test
// bat-launcher.test.js validates the structural absence of /b and start flags.
//
// No Jira, GitHub, or ServiceNow credentials are required. Cleanup uses
// `taskkill /F /PID` (a native Windows cmd built-in) to avoid PowerShell
// Stop-Process restrictions in restricted shell environments.

'use strict';

const http              = require('http');
const path              = require('path');
const { spawn,
        execFileSync,
        execSync }      = require('child_process');

// ── Constants ─────────────────────────────────────────────────────────────────

const REPO_ROOT           = path.join(__dirname, '..', '..');
const BAT_FILE_PATH       = path.join(REPO_ROOT, 'Launch Toolbox.bat');
const SERVER_PORT         = 5555;
const SERVER_READY_MS     = 15_000;
const POLL_INTERVAL_MS    = 400;
const REQUEST_TIMEOUT_MS  = 3_000;

// ── Process-management helpers (Node.js / cmd built-ins — no PowerShell) ──────

/**
 * Returns the PID of the process listening on the given TCP port, or null if
 * nothing is listening. Uses `netstat -ano` (built into every Windows version)
 * so it works without PowerShell or any third-party tool.
 *
 * @param {number} port
 * @returns {number|null}
 */
function findPidOnPort(port) {
  try {
    // netstat -ano lists: Proto  Local  Foreign  State  PID
    // We match lines whose local address ends with :<port> and state is LISTENING.
    const netstatOutput = execSync('netstat -ano', { encoding: 'utf8', timeout: 5000 });
    const matchingLine = netstatOutput
      .split('\n')
      .find((line) => line.includes(':' + port) && line.includes('LISTENING'));

    if (!matchingLine) return null;

    const columns    = matchingLine.trim().split(/\s+/);
    const parsedPid  = parseInt(columns[columns.length - 1], 10);
    return isNaN(parsedPid) ? null : parsedPid;
  } catch {
    return null;
  }
}

/**
 * Terminates a process by PID using `taskkill /F /PID` — a cmd.exe built-in
 * that works in all Windows environments without PowerShell permissions.
 * Silently ignores errors (process may have already exited).
 *
 * @param {number} pid
 */
function forceKillPid(pid) {
  if (!pid) return;
  try {
    execSync('taskkill /F /PID ' + pid, { timeout: 5000 });
  } catch {
    // Already dead — that is fine
  }
}

/**
 * Polls GET /api/proxy-status on localhost:SERVER_PORT until the server responds
 * or the timeout elapses.
 *
 * @returns {Promise<void>} resolves when the server is ready
 */
function waitForServerReady() {
  const deadline = Date.now() + SERVER_READY_MS;

  return new Promise((resolve, reject) => {
    function poll() {
      if (Date.now() >= deadline) {
        reject(new Error(
          'Server did not respond on port ' + SERVER_PORT + ' within ' +
          SERVER_READY_MS + 'ms after bat file exited'
        ));
        return;
      }

      const req = http.request(
        { hostname: 'localhost', port: SERVER_PORT, path: '/api/proxy-status',
          method: 'GET' },
        () => resolve()
      );
      req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy());
      req.on('error', () => setTimeout(poll, POLL_INTERVAL_MS));
      req.end();
    }
    poll();
  });
}

/**
 * Makes a single HTTP GET request and resolves with { statusCode, body }.
 *
 * @param {string} urlPath
 * @returns {Promise<{statusCode: number, body: string}>}
 */
function httpGet(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: 'localhost', port: SERVER_PORT, path: urlPath, method: 'GET' },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end',  () => resolve({ statusCode: res.statusCode, body: responseBody }));
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

// ── Suite setup / teardown ────────────────────────────────────────────────────

// ── Suite setup / teardown ────────────────────────────────────────────────────

/** Reference to the cmd.exe child process that is running the bat file. */
let batChildProcess = null;

beforeAll(async () => {
  // Kill anything already holding port 5555 so we start clean
  const staleServerPid = findPidOnPort(SERVER_PORT);
  if (staleServerPid) {
    forceKillPid(staleServerPid);
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  // Launch the bat file through cmd.exe in the background (spawn, not spawnSync)
  // so the test runner is not blocked while node server.js is running.
  // The bat runs "node server.js" directly — it stays running while the server
  // is alive, which is the intended design (errors stay visible in the console).
  batChildProcess = spawn('cmd.exe', ['/c', BAT_FILE_PATH], {
    cwd:   REPO_ROOT,
    stdio: 'ignore',
  });

  // Wait until the server accepts connections — node starts within a few seconds.
  await waitForServerReady();
}, SERVER_READY_MS + 10_000);

afterAll(() => {
  // Shut down the server by PID (found via netstat — no PowerShell needed)
  const serverPid = findPidOnPort(SERVER_PORT);
  forceKillPid(serverPid);

  // Also terminate the bat/cmd process in case it is still waiting
  if (batChildProcess && !batChildProcess.killed) {
    try { batChildProcess.kill(); } catch { /* already gone */ }
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Launch Toolbox.bat — real execution validation', () => {
  it('server is alive and listening on port 5555', async () => {
    // The server must be running when we check — confirms the bat file
    // successfully launched node server.js and the server bound its port.
    const serverPid = findPidOnPort(SERVER_PORT);
    expect(serverPid).not.toBeNull();
    expect(serverPid).toBeGreaterThan(0);
  });

  it('GET /api/proxy-status returns HTTP 200', async () => {
    const { statusCode } = await httpGet('/api/proxy-status');
    expect(statusCode).toBe(200);
  });

  it('response body confirms proxy mode is active', async () => {
    const { body } = await httpGet('/api/proxy-status');
    const parsedBody = JSON.parse(body);
    expect(parsedBody.proxy).toBe(true);
  });

  it('GET /api/proxy-config returns HTTP 200 with a JSON body', async () => {
    const { statusCode, body } = await httpGet('/api/proxy-config');
    expect(statusCode).toBe(200);
    expect(() => JSON.parse(body)).not.toThrow();
  });

  it('CORS header is present on every response', async () => {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { hostname: 'localhost', port: SERVER_PORT,
          path: '/api/proxy-status', method: 'GET' },
        (res) => {
          try {
            expect(res.headers['access-control-allow-origin']).toBe('*');
            resolve();
          } catch (assertError) {
            reject(assertError);
          }
        }
      );
      req.on('error', reject);
      req.end();
    });
  });
});

