// test/unit/exe-launch.test.js — Validates exe-specific startup behaviour.
//
// The pkg-bundled .exe sets process.pkg to a truthy value at runtime.
// These tests verify that server.js uses that flag correctly so the exe
// works out-of-the-box when a user double-clicks it — no command-line flags needed.

'use strict';

const fs   = require('fs');
const path = require('path');

const REPO_ROOT          = path.join(__dirname, '..', '..');
const SERVER_JS_PATH     = path.join(REPO_ROOT, 'server.js');
const SERVER_SOURCE      = fs.readFileSync(SERVER_JS_PATH, 'utf8');

// ── server.js — exe auto-open behaviour ───────────────────────────────────────

describe('server.js — static asset base path for pkg exe', () => {
  it('uses process.execPath directory (not __dirname) as the asset base when process.pkg is set', () => {
    // When bundled with pkg, __dirname is a virtual snapshot path that does not
    // exist on disk. express.static and fs.existsSync do NOT work with virtual
    // paths, so the server must use path.dirname(process.execPath) — the real
    // directory on disk where the exe lives — when process.pkg is truthy.
    // client/dist is then shipped ALONGSIDE the exe in the exe ZIP.
    expect(SERVER_SOURCE).toMatch(/process\.pkg[\s\S]{0,200}process\.execPath/);
  });

  it('falls back to __dirname when NOT running as a pkg exe (dev or ZIP install)', () => {
    // For node server.js (dev) and ZIP install, __dirname correctly points to
    // the server.js location where client/dist lives as a subdirectory.
    expect(SERVER_SOURCE).toMatch(/process\.pkg[\s\S]{0,200}__dirname/);
  });
});

describe('server.js — pkg exe auto-open', () => {
  it('opens the browser automatically when process.pkg is truthy (exe double-click)', () => {
    // When running as a bundled .exe there is no --open argv flag.
    // The server must detect process.pkg and open the browser regardless,
    // otherwise users see a console window with no idea where to navigate.
    expect(SERVER_SOURCE).toMatch(/process\.pkg/);
  });

  it('still opens the browser when --open flag IS passed (bat/CLI path unchanged)', () => {
    // The --open argv path must not be removed — it is used by Launch Toolbox.bat.
    expect(SERVER_SOURCE).toMatch(/process\.argv.*--open|--open.*process\.argv/s);
  });

  it('combines pkg and --open checks in the same browser-open condition', () => {
    // Both triggers must control the same openBrowserToDashboard() call so
    // there is a single code path that either the bat (--open) or the exe
    // (process.pkg) can activate.
    //
    // Scoped to the specific `if` that contains '--open' in the condition
    // itself — avoids matching unrelated `if` blocks added later (e.g.
    // the async launchServer wrapper which also references openBrowserToDashboard).
    const openBrowserBlock = SERVER_SOURCE.match(
      /if\s*\([^)]*--open[^)]*\)[\s\S]{0,300}openBrowserToDashboard/
    );
    expect(openBrowserBlock).not.toBeNull();
    const conditionText = openBrowserBlock[0];
    expect(conditionText).toMatch(/process\.pkg/);
  });
});

