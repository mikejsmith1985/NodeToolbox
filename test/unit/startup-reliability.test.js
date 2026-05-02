// test/unit/startup-reliability.test.js — Validates that startup failures are
// handled visibly so users on corporate PCs can diagnose and recover from
// port conflicts, missing dependencies, and SSL interception errors.
//
// Compares directly to toolbox-poc.js which has proven corporate-reliability:
//   - server.on('error') handles EADDRINUSE with a human-readable message
//   - Launch Toolbox.bat runs node directly (no start) so errors are visible
//   - sslVerify defaults to false to allow Zscaler/corporate SSL inspection

'use strict';

const fs   = require('fs');
const path = require('path');
const http = require('http');
const net  = require('net');

const REPO_ROOT      = path.join(__dirname, '..', '..');
const SERVER_SOURCE  = fs.readFileSync(path.join(REPO_ROOT, 'server.js'), 'utf8');
const BAT_SOURCE     = fs.readFileSync(path.join(REPO_ROOT, 'Launch Toolbox.bat'), 'utf8');
const LOADER_SOURCE  = fs.readFileSync(path.join(REPO_ROOT, 'src', 'config', 'loader.js'), 'utf8');

// ── server.js — error event handling ─────────────────────────────────────────

describe('server.js — startup error handling', () => {
  it('handles the server error event so EADDRINUSE does not crash silently', () => {
    // Without this handler, a port-in-use error throws an unhandled exception:
    // the console window closes immediately and the user sees nothing.
    // The POC has this handler — NodeToolbox must too.
    expect(SERVER_SOURCE).toMatch(/server\.on\s*\(\s*['"]error['"]/);
  });

  it('prints a human-readable message when the port is already in use', () => {
    // "EADDRINUSE" is the raw OS error code — users need plain English.
    // The error handler must check for this code and explain what to do.
    expect(SERVER_SOURCE).toMatch(/EADDRINUSE/);
  });

  it('keeps the console window open after a startup error so users can read it', () => {
    // On the exe: if we just call process.exit(1), the window closes instantly.
    // We must pause stdin (or equivalent) to keep the window alive long enough
    // for the user to read the error message.
    expect(SERVER_SOURCE).toMatch(/process\.stdin\.resume|readline|process\.env\.PAUSE_ON_ERROR/);
  });

  it('handles unexpected startup exceptions (not just port conflicts)', () => {
    // process.on('uncaughtException') catches any throw during module loading
    // (e.g. a missing npm package) that would otherwise close the window silently.
    expect(SERVER_SOURCE).toMatch(/process\.on\s*\(\s*['"]uncaughtException['"]/);
  });
});

// ── Launch Toolbox.bat — direct execution (no start) ─────────────────────────

describe('Launch Toolbox.bat — direct node execution', () => {
  it('runs node server.js directly, NOT via the start command', () => {
    // "start ..." spawns a detached window. When that child crashes, its window
    // closes silently. Running node directly keeps the bat window open so errors
    // are visible — identical to how toolbox-poc.js is run: "node toolbox-poc.js".
    // The line that launches the server must not begin with "start ".
    const serverStartLine = BAT_SOURCE
      .split('\n')
      .find((line) => line.includes('node server.js'));

    expect(serverStartLine).toBeDefined();
    expect(serverStartLine.trim()).not.toMatch(/^start\s/i);
  });

  it('passes --open to node server.js so the browser auto-opens', () => {
    expect(BAT_SOURCE).toMatch(/node server\.js.*--open/);
  });
});

// ── loader.js — sslVerify default for corporate environments ─────────────────

describe('loader.js — sslVerify defaults to false', () => {
  it('defaults sslVerify to false so corporate SSL inspection does not block requests', () => {
    // toolbox-poc.js line 221: rejectUnauthorized: false
    // This is the setting that makes the POC work on Zscaler / corporate proxy.
    // NodeToolbox must default to the same behaviour. Users who want strict TLS
    // verification can explicitly set sslVerify: true in their config.
    expect(LOADER_SOURCE).toMatch(/sslVerify:\s*false/);
  });
});
