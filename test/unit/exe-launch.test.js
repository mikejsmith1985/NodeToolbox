// test/unit/exe-launch.test.js — Validates exe-specific startup behaviour.
//
// The pkg-bundled .exe sets process.pkg to a truthy value at runtime.
// These tests verify that server.js and package.json are configured so the
// exe is truly self-contained — client/dist/ is bundled inside the snapshot,
// not shipped as a separate folder alongside the exe.

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
    // client/dist/ must be listed in pkg.assets so the React SPA is embedded
    // inside the exe binary. Without this, the exe depends on client/dist/
    // existing on real disk next to it — which fails on corporate PCs where
    // antivirus or sandbox tools run the exe from a temp location.
    const pkgAssets = PACKAGE_JSON.pkg && PACKAGE_JSON.pkg.assets;
    expect(pkgAssets).toBeDefined();
    const assetsArray = Array.isArray(pkgAssets) ? pkgAssets : [pkgAssets];
    const hasClientDist = assetsArray.some(assetPattern =>
      String(assetPattern).includes('client/dist')
    );
    expect(hasClientDist).toBe(true);
  });
});

// ── server.js — static asset base path ────────────────────────────────────────

describe('server.js — static asset base path for pkg exe', () => {
  it('uses __dirname as APP_BASE_DIR for all distributions including the pkg exe', () => {
    // client/dist/ is now bundled inside the exe via pkg.assets, so __dirname
    // (which points to the snapshot root in pkg mode) correctly finds the
    // assets. This makes the exe truly self-contained — no separate client/
    // folder needed. For dev (node server.js) and ZIP installs, __dirname
    // continues to point to the real directory containing server.js.
    expect(SERVER_SOURCE).toMatch(/APP_BASE_DIR\s*=\s*__dirname/);
  });

  it('does NOT rely on process.execPath to locate client/dist/', () => {
    // process.execPath was previously used to locate client/dist/ on real disk
    // next to the exe. Now that client/dist/ is bundled in the snapshot,
    // process.execPath is no longer needed for asset path resolution.
    // This assertion confirms the old brittle pattern has been removed.
    expect(SERVER_SOURCE).not.toMatch(/APP_BASE_DIR[\s\S]{0,80}process\.execPath/);
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

