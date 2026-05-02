// src/utils/portManager.js — Port conflict detection and graceful recovery at startup.
//
// When NodeToolbox starts, it first checks whether the target port is already
// occupied. If it is, we kill the occupant (whatever it is) and let startup
// proceed. We NEVER reuse an existing NodeToolbox instance: it might be an older
// buggy version that continues serving broken responses.
//
// Why kill instead of reuse: v0.0.9/v0.0.10 had a critical HTML-serving bug.
// If a user launched the fixed v0.0.11+ exe while an old v0.0.9 session was
// stuck on port 5555, the old "reuse" logic would open the browser to the broken
// server and exit immediately. Killing the old instance ensures only the newest
// version runs, which prevents the "HTML not found" regression on corporate PCs.

'use strict';

const net          = require('net');
const http         = require('http');
const childProcess = require('child_process');

// ── Constants ─────────────────────────────────────────────────────────────────

/** Maximum milliseconds to wait for the NodeToolbox HTTP probe to respond */
const HTTP_PROBE_TIMEOUT_MS = 2000;

/**
 * Default milliseconds to pause after killing a process before retrying listen().
 * Allows the OS to fully release the port binding before the next attempt.
 */
const DEFAULT_KILL_WAIT_MS = 1500;

/** API path that NodeToolbox exposes — used to identify a live instance */
const PROXY_STATUS_PATH = '/api/proxy-status';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Tests whether a TCP server is currently listening on the given port.
 * Uses a non-destructive connection attempt — connects and immediately destroys.
 *
 * @param {number} port - The TCP port to probe
 * @returns {Promise<boolean>} true if something is listening, false if the port is free
 */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const testSocket = net.createConnection({ port, host: '127.0.0.1' });

    // Connection succeeded → something is listening
    testSocket.once('connect', () => {
      testSocket.destroy();
      resolve(true);
    });

    // Connection refused or timed out → port is free
    testSocket.once('error', () => {
      resolve(false);
    });
  });
}

/**
 * Makes an HTTP GET to /api/proxy-status on the given port and checks whether
 * the response identifies the server as a NodeToolbox instance (proxy: true).
 *
 * Returns false on any error — connection refused, timeout, invalid JSON, or
 * a response that doesn't carry the NodeToolbox signature.
 *
 * @param {number} port - The TCP port to probe
 * @returns {Promise<boolean>} true only if a live NodeToolbox is confirmed there
 */
function probeForRunningNodeToolbox(port) {
  return new Promise((resolve) => {
    const requestOptions = {
      hostname: '127.0.0.1',
      port,
      path:     PROXY_STATUS_PATH,
      method:   'GET',
      timeout:  HTTP_PROBE_TIMEOUT_MS,
    };

    const probeRequest = http.request(requestOptions, (response) => {
      let rawBody = '';
      response.on('data', (chunk) => { rawBody += chunk; });
      response.on('end', () => {
        try {
          const parsedBody = JSON.parse(rawBody);
          // Only accept if the field is explicitly true — not just truthy
          resolve(parsedBody.proxy === true);
        } catch (_parseError) {
          // Non-JSON response → not NodeToolbox
          resolve(false);
        }
      });
    });

    // Request-level errors (ECONNREFUSED, ECONNRESET, etc.)
    probeRequest.on('error', () => resolve(false));

    // Timeout fires before 'error' — destroy so the error event completes the flow
    probeRequest.on('timeout', () => {
      probeRequest.destroy();
      resolve(false);
    });

    probeRequest.end();
  });
}

/**
 * Attempts to kill the process currently occupying the given TCP port.
 *
 * On Windows: uses PowerShell Get-NetTCPConnection to resolve the PID, then
 *             Stop-Process -Force to terminate it.
 * On macOS/Linux: uses lsof to find the PID, then kill -9.
 *
 * Returns true if the kill command exited without an error code.
 * Returns false if the command failed (e.g. access denied, PID not found).
 *
 * @param {number} port - The TCP port whose owner should be terminated
 * @returns {Promise<boolean>} true if the kill ran without error
 */
function killProcessOnPort(port) {
  return new Promise((resolve) => {
    const killCommand = buildKillCommand(port);

    childProcess.exec(killCommand, (execError) => {
      resolve(!execError);
    });
  });
}

/**
 * Resolves a port conflict before NodeToolbox binds its listener.
 *
 * Kills whatever process is currently occupying the port, then waits
 * killWaitMs for the OS to release the binding before returning.
 *
 * The caller proceeds with app.listen() after this function returns.
 * If the port is still occupied after the kill (e.g. access denied),
 * the existing server.on('error') EADDRINUSE handler catches it.
 *
 * WHY NO REUSE: Before v0.0.13, this function detected an existing NodeToolbox
 * instance and opened a browser to it (reuse path). That caused "HTML not found"
 * on corporate PCs — the old stuck session was a buggy pre-fix version, so
 * redirecting the user to it kept them on a broken server. Killing always ensures
 * only the newest version runs.
 *
 * @param {number}   port                - The port that is already in use
 * @param {function} openBrowserCallback - Kept for API compatibility; no longer called here.
 *                                         The server opens the browser after app.listen() succeeds.
 * @param {number}   [killWaitMs]        - Override the post-kill wait (default 1500ms; use 0 in tests)
 * @returns {Promise<void>}
 */
async function resolvePortConflict(port, openBrowserCallback, killWaitMs = DEFAULT_KILL_WAIT_MS) {
  console.log('');
  console.log('  ⚠  Port ' + port + ' is occupied. Attempting to free it...');
  console.log('     (Any previous NodeToolbox session will be replaced by this launch.)');

  await killProcessOnPort(port);

  if (killWaitMs > 0) {
    await pause(killWaitMs);
  }
}

// ── Private Helpers ───────────────────────────────────────────────────────────

/**
 * Builds the shell command that finds and kills the process occupying a port.
 * The command is platform-specific but always references the port number.
 *
 * @param {number} port
 * @returns {string} Shell command string
 */
function buildKillCommand(port) {
  if (process.platform === 'win32') {
    // PowerShell one-liner: find the owning PID via Get-NetTCPConnection, kill it.
    // -ErrorAction SilentlyContinue prevents a non-zero exit if no match is found.
    return (
      'powershell -NoProfile -Command "' +
      '$ownerPid = (Get-NetTCPConnection -LocalPort ' + port +
      ' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess);' +
      ' if ($ownerPid) { Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue }"'
    );
  }

  // macOS / Linux: lsof lists the PID listening on the port; kill -9 terminates it
  return 'lsof -ti tcp:' + port + ' | xargs kill -9 2>/dev/null || true';
}

/**
 * Returns a Promise that resolves after the given number of milliseconds.
 * Named "pause" rather than "sleep" to be self-documenting in async flows.
 *
 * @param {number} durationMs
 * @returns {Promise<void>}
 */
function pause(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  isPortInUse,
  probeForRunningNodeToolbox,
  killProcessOnPort,
  resolvePortConflict,
};
