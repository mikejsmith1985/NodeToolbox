// test/unit/portManager.test.js — Unit tests for port conflict detection and recovery.
//
// Validates that portManager.js correctly detects occupied ports, identifies
// whether an existing NodeToolbox instance is running there, and handles
// conflict resolution (reuse vs. kill) without breaking normal startup.

'use strict';

const net          = require('net');
const http         = require('http');
const childProcess = require('child_process');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Starts a plain net.Server on a random available port.
 * Returns { server, port } so tests can bind and unbind cleanly.
 *
 * @returns {Promise<{ server: net.Server, port: number }>}
 */
function startTcpBlocker() {
  return new Promise((resolve, reject) => {
    const blockingServer = net.createServer();
    blockingServer.listen(0, '127.0.0.1', () => {
      const boundPort = blockingServer.address().port;
      resolve({ server: blockingServer, port: boundPort });
    });
    blockingServer.on('error', reject);
  });
}

/**
 * Starts an HTTP server that returns a JSON body on every request.
 * Used to simulate live NodeToolbox or an unrelated service.
 *
 * @param {object} responseBody - JSON object sent in every response
 * @returns {Promise<{ server: http.Server, port: number }>}
 */
function startHttpResponder(responseBody) {
  return new Promise((resolve, reject) => {
    const httpServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseBody));
    });
    httpServer.listen(0, '127.0.0.1', () => {
      const boundPort = httpServer.address().port;
      resolve({ server: httpServer, port: boundPort });
    });
    httpServer.on('error', reject);
  });
}

/**
 * Closes a net.Server or http.Server and waits for it to fully shut down.
 *
 * @param {net.Server | http.Server} serverToClose
 * @returns {Promise<void>}
 */
function closeServer(serverToClose) {
  return new Promise((resolve) => serverToClose.close(resolve));
}

// ── Lazy require so module path resolves after branch creation ─────────────────

let portManager;
beforeAll(() => {
  // Module may not exist yet (RED phase) — Jest will report the require error
  // as a test failure, which is the expected TDD behaviour.
  portManager = require('../../src/utils/portManager');
});

// ── isPortInUse ───────────────────────────────────────────────────────────────

describe('isPortInUse', () => {
  it('returns false when nothing is listening on the port', async () => {
    // Port 59991 is unlikely to be bound on any developer or CI machine.
    // If this test flickers, bump the port number.
    const result = await portManager.isPortInUse(59991);
    expect(result).toBe(false);
  });

  it('returns true when a TCP server is actively listening on the port', async () => {
    const { server: blockingServer, port: blockedPort } = await startTcpBlocker();
    try {
      const result = await portManager.isPortInUse(blockedPort);
      expect(result).toBe(true);
    } finally {
      await closeServer(blockingServer);
    }
  });
});

// ── probeForRunningNodeToolbox ────────────────────────────────────────────────

describe('probeForRunningNodeToolbox', () => {
  it('returns true when /api/proxy-status responds with proxy: true', async () => {
    const { server: nodeToolboxSimulator, port: simulatorPort } =
      await startHttpResponder({ proxy: true, version: '1.0.0' });
    try {
      const result = await portManager.probeForRunningNodeToolbox(simulatorPort);
      expect(result).toBe(true);
    } finally {
      await closeServer(nodeToolboxSimulator);
    }
  });

  it('returns false when the server responds with proxy: false', async () => {
    const { server: otherServiceServer, port: otherPort } =
      await startHttpResponder({ proxy: false });
    try {
      const result = await portManager.probeForRunningNodeToolbox(otherPort);
      expect(result).toBe(false);
    } finally {
      await closeServer(otherServiceServer);
    }
  });

  it('returns false when the port has no listener (connection refused)', async () => {
    // Port 59992 should be free — connection will be refused immediately
    const result = await portManager.probeForRunningNodeToolbox(59992);
    expect(result).toBe(false);
  });

  it('returns false when the server returns a non-JSON response', async () => {
    // Simulate a plain web server (IIS, nginx) serving HTML on this port
    const htmlServer = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body>Not NodeToolbox</body></html>');
    });
    const boundPort = await new Promise((resolve) => {
      htmlServer.listen(0, '127.0.0.1', () => resolve(htmlServer.address().port));
    });
    try {
      const result = await portManager.probeForRunningNodeToolbox(boundPort);
      expect(result).toBe(false);
    } finally {
      await closeServer(htmlServer);
    }
  });

  it('returns false when the response body has proxy field missing', async () => {
    // Edge case: valid JSON but not a NodeToolbox status response
    const { server: partialServer, port: partialPort } =
      await startHttpResponder({ status: 'ok' });
    try {
      const result = await portManager.probeForRunningNodeToolbox(partialPort);
      expect(result).toBe(false);
    } finally {
      await closeServer(partialServer);
    }
  });
});

// ── killProcessOnPort ─────────────────────────────────────────────────────────

describe('killProcessOnPort', () => {
  afterEach(() => jest.restoreAllMocks());

  it('executes a platform kill command that references the port number', async () => {
    // We only verify that exec is called with the right port — we do NOT
    // actually kill any process during unit tests.
    const execSpy = jest
      .spyOn(childProcess, 'exec')
      .mockImplementation((command, callback) => callback(null, '', ''));

    await portManager.killProcessOnPort(5555);

    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(execSpy.mock.calls[0][0]).toMatch(/5555/);
  });

  it('returns true when the kill command exits without an error', async () => {
    jest
      .spyOn(childProcess, 'exec')
      .mockImplementation((command, callback) => callback(null, '', ''));

    const wasKilled = await portManager.killProcessOnPort(5555);
    expect(wasKilled).toBe(true);
  });

  it('returns false when the kill command fails (e.g. access denied)', async () => {
    jest
      .spyOn(childProcess, 'exec')
      .mockImplementation((command, callback) =>
        callback(new Error('Access denied'), '', 'Access denied')
      );

    const wasKilled = await portManager.killProcessOnPort(5555);
    expect(wasKilled).toBe(false);
  });
});

// ── resolvePortConflict ───────────────────────────────────────────────────────

describe('resolvePortConflict', () => {
  afterEach(() => jest.restoreAllMocks());

  it('opens browser and exits with code 0 when NodeToolbox is already running', async () => {
    // Start a real NodeToolbox-like responder so the HTTP probe gets proxy: true
    const { server: liveNodeToolbox, port: livePort } =
      await startHttpResponder({ proxy: true, version: '1.0.0' });

    const mockOpenBrowser = jest.fn();
    const exitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation(() => { /* suppress actual exit in tests */ });

    try {
      // Pass killWaitMs = 0 so the test doesn't sleep for 1.5 seconds
      await portManager.resolvePortConflict(livePort, mockOpenBrowser, 0);
    } finally {
      await closeServer(liveNodeToolbox);
    }

    expect(mockOpenBrowser).toHaveBeenCalledWith(livePort);
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('does NOT call process.exit when the occupant is not NodeToolbox', async () => {
    // Start a non-NodeToolbox HTTP server so the probe returns false
    const { server: foreignServer, port: foreignPort } =
      await startHttpResponder({ status: 'ok' });

    jest
      .spyOn(childProcess, 'exec')
      .mockImplementation((command, callback) => callback(null, '', ''));

    const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});

    try {
      await portManager.resolvePortConflict(foreignPort, jest.fn(), 0);
    } finally {
      await closeServer(foreignServer);
    }

    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('attempts to kill the process when the occupant is not NodeToolbox', async () => {
    const { server: foreignServer, port: foreignPort } =
      await startHttpResponder({ status: 'ok' });

    const execSpy = jest
      .spyOn(childProcess, 'exec')
      .mockImplementation((command, callback) => callback(null, '', ''));

    jest.spyOn(process, 'exit').mockImplementation(() => {});

    try {
      await portManager.resolvePortConflict(foreignPort, jest.fn(), 0);
    } finally {
      await closeServer(foreignServer);
    }

    expect(execSpy).toHaveBeenCalledTimes(1);
    expect(execSpy.mock.calls[0][0]).toMatch(String(foreignPort));
  });

  it('does NOT kill when NodeToolbox is already running (reuse path)', async () => {
    const { server: liveNodeToolbox, port: livePort } =
      await startHttpResponder({ proxy: true });

    const execSpy = jest
      .spyOn(childProcess, 'exec')
      .mockImplementation((command, callback) => callback(null, '', ''));

    jest.spyOn(process, 'exit').mockImplementation(() => {});

    try {
      await portManager.resolvePortConflict(livePort, jest.fn(), 0);
    } finally {
      await closeServer(liveNodeToolbox);
    }

    // Should reuse, not kill
    expect(execSpy).not.toHaveBeenCalled();
  });
});

// ── server.js — launchServer async startup integration ───────────────────────

describe('server.js — port conflict recovery integration', () => {
  const SERVER_SOURCE = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', 'server.js'),
    'utf8'
  );

  it('imports portManager for conflict detection', () => {
    // The server must use portManager — confirms the integration is wired up
    expect(SERVER_SOURCE).toMatch(/portManager|resolvePortConflict|isPortInUse/);
  });

  it('uses an async startup function instead of a bare app.listen call', () => {
    // Bare app.listen at the top level cannot handle async pre-flight checks.
    // The startup must be wrapped in an async function.
    expect(SERVER_SOURCE).toMatch(/async\s+function\s+launchServer|launchServer\s*=\s*async/);
  });

  it('calls launchServer when executed as main module', () => {
    // The entry point guard must call the async launcher
    expect(SERVER_SOURCE).toMatch(/launchServer\s*\(/);
  });
});
