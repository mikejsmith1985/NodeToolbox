// test/unit/pkg-snapshot.test.js — Verifies that the static file server pre-loads
// toolbox.html at module startup using fs.readFileSync (which IS patched by
// @yao-pkg/pkg for snapshot assets) rather than relying on fs.existsSync (which
// is NOT reliably patched). This ensures the dashboard loads correctly when the
// server is run as the bundled .exe on any machine, not just the build machine.
//
// Root cause (Issue #22): After the setup wizard on a corporate PC, the browser
// is redirected to GET /. serveStaticFile() calls findToolboxHtml(), which uses
// fs.existsSync to check paths. In the pkg exe, existsSync is not patched for
// snapshot assets, so it returns false for all paths and the 404 "File Not Found"
// page is served instead of the dashboard.

'use strict';

const path    = require('path');
const fs      = require('fs');
const express = require('express');
const request = require('supertest');

// ── Pre-load cache export ──────────────────────────────────────────────────────

describe('staticFileServer — pkg snapshot pre-load cache (Issue #22)', () => {
  let staticFileServer;

  beforeAll(() => {
    // Use a fresh require so module-level side-effects (readFileSync) are exercised
    jest.resetModules();
    staticFileServer = require('../../src/utils/staticFileServer');
  });

  it('exports cachedDashboardHtml as a string (not undefined or null) when public/toolbox.html exists', () => {
    // Before the fix: module does not export cachedDashboardHtml at all → undefined.
    // After the fix: it is pre-loaded with the full HTML string.
    const { cachedDashboardHtml } = staticFileServer;
    const publicHtmlPath = path.join(__dirname, '..', '..', 'public', 'toolbox.html');
    const isHtmlOnDisk = fs.existsSync(publicHtmlPath);

    if (isHtmlOnDisk) {
      // The file exists in the test environment — the cache MUST be populated.
      expect(typeof cachedDashboardHtml).toBe('string');
      expect(cachedDashboardHtml.length).toBeGreaterThan(0);
    } else {
      // File genuinely absent (e.g. CI with no public/) — null is acceptable.
      expect(cachedDashboardHtml).toBeNull();
    }
  });

  it('cachedDashboardHtml contains valid HTML markup', () => {
    const { cachedDashboardHtml } = staticFileServer;
    if (cachedDashboardHtml === null) {
      // No file to validate — pass vacuously
      return;
    }
    expect(cachedDashboardHtml).toMatch(/<html/i);
    expect(cachedDashboardHtml).toMatch(/<\/html>/i);
  });
});

// ── Middleware serves from cache when existsSync is stubbed to false ───────────

describe('serveStaticFile — serves dashboard from cache when existsSync fails (pkg simulation)', () => {
  let originalExistsSync;
  let testModule;

  beforeAll(() => {
    // Replace fs.existsSync with a stub that always returns false — this simulates
    // the @yao-pkg/pkg environment where existsSync is not patched for snapshot
    // assets. The readFileSync-based cache should mean the middleware still works.
    jest.resetModules();
    originalExistsSync = fs.existsSync;
    fs.existsSync = () => false;
    testModule = require('../../src/utils/staticFileServer');
  });

  afterAll(() => {
    fs.existsSync = originalExistsSync;
    jest.resetModules();
  });

  it('returns 200 with HTML for GET / even when existsSync always returns false', async () => {
    // Before the fix: findToolboxHtml() returns null → 404 "File Not Found" page.
    // After the fix: cachedDashboardHtml is served → 200 dashboard.
    const { serveStaticFile, cachedDashboardHtml } = testModule;

    if (cachedDashboardHtml === null) {
      // public/toolbox.html was absent even for readFileSync — nothing to assert.
      return;
    }

    const testApp = express();
    testApp.use(serveStaticFile());

    const response = await request(testApp).get('/');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/);
  });

  it('served HTML content matches the pre-loaded cache exactly', async () => {
    const { serveStaticFile, cachedDashboardHtml } = testModule;

    if (cachedDashboardHtml === null) {
      return;
    }

    const testApp = express();
    testApp.use(serveStaticFile());

    const response = await request(testApp).get('/');
    // The response body should be byte-for-byte identical to the cached string.
    // This confirms the middleware is serving the cache, not re-reading the disk.
    expect(response.text).toBe(cachedDashboardHtml);
  });
});
