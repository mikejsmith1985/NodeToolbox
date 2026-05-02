// src/utils/portManager.js — Port conflict detection and graceful recovery at startup.
//
// When NodeToolbox starts, it first checks whether the target port is already
// occupied. If another NodeToolbox instance is running there, the new launch
// simply opens a browser tab to the existing session and exits (reuse).
// If an unrelated process is using the port, we attempt to kill it so startup
// can proceed. This prevents the "Port already in use" error from silently
// closing the console window on corporate PCs.

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
 * Decision tree:
 *   1. Probe HTTP → is NodeToolbox already running?
 *      YES → open browser to existing session, call process.exit(0). Never returns.
 *      NO  → attempt to kill the occupant, wait killWaitMs, return so caller retries.
 *
 * The caller should proceed with app.listen() after this function returns.
 * If the port is still occupied after the kill attempt, the existing
 * server.on('error') EADDRINUSE handler will catch the failure and display
 * a human-readable message.
 *
 * @param {number}   port                - The port that is already in use
 * @param {function} openBrowserCallback - Called with (port) to open the dashboard
 * @param {number}   [killWaitMs]        - Override the post-kill wait (default 1500ms; use 0 in tests)
 * @returns {Promise<void>}
 */
async function resolvePortConflict(port, openBrowserCallback, killWaitMs = DEFAULT_KILL_WAIT_MS) {
  const isNodeToolboxAlreadyRunning = await probeForRunningNodeToolbox(port);

  if (isNodeToolboxAlreadyRunning) {
    printReuseMessage(port);
    openBrowserCallback(port);

    // Small pause so the browser command has time to dispatch before exit
    await pause(500);
    process.exit(0);
    return; // unreachable — satisfies static analysis tools
  }

  // Unknown process on the port — try to free it and let the caller retry
  console.log('');
  console.log('  ⚠  Port ' + port + ' is occupied by another process.');
  console.log('     Attempting to free it automatically...');

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
 * Prints a friendly message explaining that NodeToolbox is already running
 * and that this new launch will hand off to the existing instance.
 *
 * @param {number} port
 */
function printReuseMessage(port) {
  const dashboardUrl = 'http://localhost:' + port;
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║         NodeToolbox — Already Running        ║');
  console.log('  ╠══════════════════════════════════════════════╣');
  console.log('  ║                                              ║');
  console.log('  ║  An existing NodeToolbox session was found.  ║');
  console.log('  ║  Opening your browser to the dashboard...    ║');
  console.log('  ║                                              ║');
  console.log('  ║  Dashboard → ' + dashboardUrl + '          ║');
  console.log('  ║                                              ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
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
