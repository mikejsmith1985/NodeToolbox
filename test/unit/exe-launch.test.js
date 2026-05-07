// test/unit/exe-launch.test.js — Validates exe-specific startup behaviour.
//
// The pkg-bundled .exe sets process.pkg to a truthy value at runtime.
// These tests verify that server.js and the build pipeline are configured so
// the React SPA is served correctly from inside the exe — independent of
// whether client/dist/ is also present on real disk next to the exe.
//
// Strategy: client/dist/ is baked into src/embeddedClient.js (auto-generated)
// as base64 Buffer literals so pkg embeds the SPA in the JavaScript bytecode.
// This is bulletproof — pkg always bundles JS source — unlike pkg.assets which
// has been observed to silently fail to include the React build.

'use strict';

const fs   = require('fs');
const path = require('path');

const REPO_ROOT          = path.join(__dirname, '..', '..');
const SERVER_JS_PATH     = path.join(REPO_ROOT, 'server.js');
const SERVER_SOURCE      = fs.readFileSync(SERVER_JS_PATH, 'utf8');
const RELEASE_SCRIPT_SRC = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'local-release.ps1'), 'utf8');
const GENERATOR_PATH     = path.join(REPO_ROOT, 'scripts', 'generate-embedded-client.js');

// ── Embedded-client generator ────────────────────────────────────────────────

describe('scripts/generate-embedded-client.js', () => {
  it('exists and emits a base64-encoded module', () => {
    expect(fs.existsSync(GENERATOR_PATH)).toBe(true);
    const generatorSource = fs.readFileSync(GENERATOR_PATH, 'utf8');
    expect(generatorSource).toMatch(/module\.exports/);
    expect(generatorSource).toMatch(/base64/);
  });

  it('writes the embedded module to src/embeddedClient.js', () => {
    const generatorSource = fs.readFileSync(GENERATOR_PATH, 'utf8');
    expect(generatorSource).toMatch(/embeddedClient\.js/);
  });
});

// ── server.js — embedded-client consumption ──────────────────────────────────

describe('server.js — embedded React SPA in pkg mode', () => {
  it('requires the embedded-client module when running as a pkg exe', () => {
    // The exe must serve the SPA from the in-memory embedded map so it works
    // even when no client/dist/ folder is present on disk next to the exe.
    expect(SERVER_SOURCE).toMatch(/process\.pkg[\s\S]{0,400}require\(['"]\.\/src\/embeddedClient['"]\)/);
  });

  it('serves static asset requests from the embedded map in pkg mode', () => {
    // The pkg-mode middleware must look up requests against embeddedClientFiles
    // (the require()'d map) rather than going through the pkg snapshot
    // filesystem, which has been proven unreliable for client/dist assets.
    expect(SERVER_SOURCE).toMatch(/embeddedClientFiles\[/);
  });

  it('serves index.html from the embedded map for the SPA catch-all in pkg mode', () => {
    // React Router needs index.html for any non-API path. In pkg mode this
    // must come from the embedded map, not a filesystem read.
    expect(SERVER_SOURCE).toMatch(/embeddedClientFiles\[['"]index\.html['"]\]/);
  });

  it('falls back to express.static against client/dist for dev and ZIP installs', () => {
    // Outside the pkg exe, the embedded module is not loaded — use the
    // standard Express static middleware against the real filesystem.
    expect(SERVER_SOURCE).toMatch(/express\.static\(clientDistDir\)/);
  });
});

// ── Release pipeline integration ─────────────────────────────────────────────

describe('scripts/local-release.ps1 — embedded-client step', () => {
  it('runs generate-embedded-client.js as part of the release pipeline', () => {
    // The release script must regenerate src/embeddedClient.js after the
    // React build (so the embedded map matches what was built) and before
    // the pkg step (so pkg sees the up-to-date module).
    expect(RELEASE_SCRIPT_SRC).toMatch(/generate-embedded-client\.js/);
  });
});

// ── server.js — pkg exe auto-open ────────────────────────────────────────────

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
    const openBrowserBlock = SERVER_SOURCE.match(
      /if\s*\([^)]*--open[^)]*\)[\s\S]{0,300}openBrowserToDashboard/
    );
    expect(openBrowserBlock).not.toBeNull();
    const conditionText = openBrowserBlock[0];
    expect(conditionText).toMatch(/process\.pkg/);
  });
});
