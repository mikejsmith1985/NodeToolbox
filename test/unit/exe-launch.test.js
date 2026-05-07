// test/unit/exe-launch.test.js — Validates exe-specific startup behaviour.
//
// The pkg-bundled .exe sets process.pkg to a truthy value at runtime.
// These tests verify that server.js and package.json are configured so the
// React SPA is served correctly from both the pkg snapshot (self-contained mode)
// and from real disk alongside the exe (fallback mode).

'use strict';

const fs   = require('fs');
const path = require('path');

const REPO_ROOT          = path.join(__dirname, '..', '..');
const SERVER_JS_PATH     = path.join(REPO_ROOT, 'server.js');
const SERVER_SOURCE      = fs.readFileSync(SERVER_JS_PATH, 'utf8');
const PACKAGE_JSON       = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));

// ── package.json — pkg assets configuration ───────────────────────────────────

describe('package.json — pkg assets', () => {
  it('bundles client/dist/**/* inside the exe snapshot', () => {
    // client/dist/ must be listed in pkg.assets so the React SPA can be
    // accessed from the pkg virtual filesystem via fs.readFileSync.
    const pkgAssets = PACKAGE_JSON.pkg && PACKAGE_JSON.pkg.assets;
    expect(pkgAssets).toBeDefined();
    const assetsArray = Array.isArray(pkgAssets) ? pkgAssets : [pkgAssets];
    const hasClientDist = assetsArray.some(assetPattern =>
      String(assetPattern).includes('client/dist')
    );
    expect(hasClientDist).toBe(true);
  });
});

// ── server.js — static asset serving ─────────────────────────────────────────

describe('server.js — pkg-compatible static asset serving', () => {
  it('uses readFileSync to serve static files in pkg exe mode', () => {
    // express.static uses fs.createReadStream internally, which does NOT work
    // reliably with @yao-pkg/pkg's snapshot virtual filesystem.
    // fs.readFileSync IS guaranteed to work with snapshot assets.
    // The server must use a readFileSync-based static middleware when
    // process.pkg is truthy so assets (JS, CSS, icons) are served correctly.
    expect(SERVER_SOURCE).toMatch(/process\.pkg[\s\S]{0,400}readFileSync/);
  });

  it('uses readFileSync for the SPA fallback index.html in pkg exe mode', () => {
    // The SPA catch-all must use fs.readFileSync (not fs.existsSync + res.sendFile)
    // so index.html is served correctly from the snapshot virtual filesystem.
    // fs.existsSync can return false for snapshot paths in some pkg configurations.
    expect(SERVER_SOURCE).toMatch(/readFileSync[\s\S]{0,200}index\.html|index\.html[\s\S]{0,200}readFileSync/);
  });

  it('does not rely on fs.existsSync to check for client/dist/index.html', () => {
    // fs.existsSync can silently return false for snapshot-virtual paths in pkg,
    // causing the 503 "React build not found" page to show even when client/dist
    // IS bundled inside the exe. The server must not use existsSync as a gate.
    expect(SERVER_SOURCE).not.toMatch(/fs\.existsSync\s*\(\s*clientDistIndexPath\s*\)/);
  });
});

// ── server.js — APP_BASE_DIR resolution ───────────────────────────────────────

describe('server.js — static asset base path for pkg exe', () => {
  it('resolves APP_BASE_DIR using __dirname (snapshot root) for the primary path', () => {
    // __dirname in the pkg snapshot points to the snapshot root, where
    // client/dist/ is bundled via pkg.assets. For dev/ZIP distributions,
    // __dirname is the real project directory on disk.
    // The server uses a function to resolve APP_BASE_DIR; __dirname must appear
    // in that resolution logic as the primary/snapshot path.
    expect(SERVER_SOURCE).toMatch(/resolveAppBaseDir[\s\S]{0,400}__dirname/);
  });

  it('falls back to process.execPath directory for real-disk serving in pkg mode', () => {
    // If the snapshot path is not accessible (e.g., pkg.assets misconfigured),
    // the server falls back to path.dirname(process.execPath) — the real
    // directory containing the exe — where client/dist/ is also shipped in
    // the exe-zip as a belt-and-suspenders backup.
    expect(SERVER_SOURCE).toMatch(/process\.execPath/);
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

