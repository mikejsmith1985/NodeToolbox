// test/unit/exe-launch.test.js — Validates exe-specific startup behaviour.
//
// The pkg-bundled .exe sets process.pkg to a truthy value at runtime.
// These tests verify that server.js uses that flag correctly so the exe
// works out-of-the-box when a user double-clicks it — no command-line flags needed.
//
// Static-asset path resolution is also verified: PUBLIC_DIRECTORY_PATH must be
// derived from __dirname (which pkg remaps to the snapshot FS root) so that
// toolbox.html is served correctly from inside the bundle.

'use strict';

const fs   = require('fs');
const path = require('path');

const REPO_ROOT          = path.join(__dirname, '..', '..');
const SERVER_JS_PATH     = path.join(REPO_ROOT, 'server.js');
const STATIC_SERVER_PATH = path.join(REPO_ROOT, 'src', 'utils', 'staticFileServer.js');
const SERVER_SOURCE      = fs.readFileSync(SERVER_JS_PATH, 'utf8');
const STATIC_SOURCE      = fs.readFileSync(STATIC_SERVER_PATH, 'utf8');

// ── server.js — exe auto-open behaviour ───────────────────────────────────────

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

// ── staticFileServer.js — pkg snapshot path compatibility ────────────────────

describe('staticFileServer.js — pkg snapshot path compatibility', () => {
  it('derives PUBLIC_DIRECTORY_PATH from __dirname so pkg remaps it correctly', () => {
    // pkg replaces __dirname with the snapshot FS path at bundle time.
    // Hard-coded absolute paths (e.g. process.cwd()) would point outside the
    // bundle and cause a 404 for every request to GET /.
    expect(STATIC_SOURCE).toMatch(/__dirname/);
  });

  it('does NOT use process.cwd() to locate public/ (breaks inside pkg bundle)', () => {
    // process.cwd() returns the directory the user launched the exe from —
    // not the bundle root — so public/toolbox.html would never be found.
    expect(STATIC_SOURCE).not.toMatch(/process\.cwd\(\)/);
  });
});
