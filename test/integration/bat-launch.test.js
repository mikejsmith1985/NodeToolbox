// test/integration/bat-launch.test.js — Functional validation that Launch Toolbox.bat
// actually starts the server and keeps it alive after the launcher exits.
//
// This test executes the real bat file via cmd.exe (exactly as a user double-clicking
// it would), then verifies the server responds on port 5555 AFTER the bat process has
// exited. That "after the bat exits" check is specifically what catches the /b-flag
// bug from v0.0.6 — with /b the server dies when the launcher window closes.
//
// No Jira, GitHub, or ServiceNow credentials are required. Cleanup uses
// `taskkill /F /PID` (a native Windows cmd built-in) to avoid PowerShell
// Stop-Process restrictions in restricted shell environments.

'use strict';

const http              = require('http');
const path              = require('path');
const { spawnSync,
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

beforeAll(async () => {
  // Kill anything already holding port 5555 so we start clean
  const staleServerPid = findPidOnPort(SERVER_PORT);
  if (staleServerPid) {
    forceKillPid(staleServerPid);
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  // Execute Launch Toolbox.bat through cmd.exe — identical to a user double-clicking.
  // spawnSync blocks until cmd.exe (the bat process) exits.
  // The bat's `start "NodeToolbox Server" node server.js --open` spawns node in a
  // NEW window that is NOT a child of this cmd.exe — it outlives the bat process.
  // That is exactly the behaviour we are testing.
  spawnSync('cmd.exe', ['/c', BAT_FILE_PATH], {
    cwd:      REPO_ROOT,
    encoding: 'utf8',
    timeout:  60_000,   // npm ci can take up to 60s on first run
  });

  // The bat has now exited. If the /b bug were present the server would be dead.
  // Wait for the server that the bat spawned to become reachable.
  await waitForServerReady();
}, SERVER_READY_MS + 65_000);

afterAll(() => {
  // Shut down the server the bat started using taskkill — no PowerShell needed
  const serverPid = findPidOnPort(SERVER_PORT);
  forceKillPid(serverPid);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Launch Toolbox.bat — real execution validation', () => {
  it('server is alive on port 5555 AFTER the bat process has exited', async () => {
    // The critical assertion: the server must outlive the launcher.
    // With the old `start /b` bug the server died when cmd.exe closed.
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

