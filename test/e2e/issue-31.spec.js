// test/e2e/issue-31.spec.js — E2E tests for GitHub Issue #31.
//
// Tests three user-visible bugs:
//   1. Unreadable (ANSI/control) characters appearing in the Reports Hub
//   2. Version mismatch: UI not showing the same version as the server API
//   3. RELAY dependency shown when PAT/proxy credentials are configured
//
// These are written as RED tests first (TDD). They describe the expected
// user experience — run them before the fix to confirm they fail, then
// run after the fix to confirm they pass.
//
// NOTE: Version tests are intentionally version-agnostic — they compare the
// UI against the live API response rather than a hardcoded string, so they
// remain valid across releases without needing manual updates.

'use strict';

const { test, expect } = require('@playwright/test');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Navigates to the app root and waits for the dashboard or setup wizard.
 * When Jira PAT is configured via env vars the app loads the full dashboard.
 *
 * @param {import('@playwright/test').Page} page
 */
async function loadDashboard(page) {
  await page.goto('/');
  // Wait for either the main app or the setup wizard to become visible
  await page.waitForLoadState('domcontentloaded');
}

// ── Bug 1: Unreadable characters in Reports Hub ───────────────────────────────

test.describe('Bug 1 — Reports Hub: unreadable characters are stripped', () => {
  test('miRenderJiraText strips ANSI escape sequences before rendering', async ({ page }) => {
    await loadDashboard(page);

    // Evaluate the text rendering function directly in the browser context.
    // If the function does not exist yet (before fix), the test will error —
    // but once stripControlCharactersFromText is added and used, it must return clean text.
    const renderedHtml = await page.evaluate(() => {
      // Text with an ANSI color code (ESC[32m ... ESC[0m) that would show as garbage
      const textWithAnsiCode = '\u001b[32mHello World\u001b[0m';

      if (typeof miRenderJiraText !== 'function') {
        throw new Error('miRenderJiraText is not defined — is the dashboard loaded?');
      }
      return miRenderJiraText(textWithAnsiCode);
    });

    // The rendered output must NOT contain the ESC character (\x1b)
    expect(renderedHtml).not.toContain('\u001b');
    // The readable content should still be present
    expect(renderedHtml).toContain('Hello World');
  });

  test('miRenderJiraText strips non-printable control characters before rendering', async ({ page }) => {
    await loadDashboard(page);

    const renderedHtml = await page.evaluate(() => {
      // Bell (0x07), backspace (0x08), and other control chars that appear as garbage
      const textWithControlChars = 'Status: \x07\x08\x0bActive\x0c item';

      if (typeof miRenderJiraText !== 'function') {
        throw new Error('miRenderJiraText is not defined — is the dashboard loaded?');
      }
      return miRenderJiraText(textWithControlChars);
    });

    // Control characters 0x00-0x08, 0x0b, 0x0c, 0x0e-0x1f must be gone
    expect(renderedHtml).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
    // Readable text must survive
    expect(renderedHtml).toContain('Status');
    expect(renderedHtml).toContain('Active');
  });

  test('miRenderJiraText preserves normal Unicode and line breaks', async ({ page }) => {
    await loadDashboard(page);

    const renderedHtml = await page.evaluate(() => {
      const normalText = 'Fix login bug\nSee ticket PROJ-123 — affects ☑ done items';
      if (typeof miRenderJiraText !== 'function') {
        throw new Error('miRenderJiraText is not defined — is the dashboard loaded?');
      }
      return miRenderJiraText(normalText);
    });

    // Line break must be converted to <br>
    expect(renderedHtml).toContain('<br>');
    // Unicode and regular text must survive unharmed
    expect(renderedHtml).toContain('Fix login bug');
    expect(renderedHtml).toContain('PROJ-123');
    expect(renderedHtml).toContain('☑');
  });
});

// ── Bug 2: Version mismatch ───────────────────────────────────────────────────

// These tests are version-agnostic by design: they fetch the current version
// from the API and verify that every UI surface shows that same version.
// This prevents the tests from going stale on every release.
test.describe('Bug 2 — Version: UI must show the same version as the server everywhere', () => {
  test('page <title> contains the same version as the API', async ({ page }) => {
    // Fetch the authoritative version from the server itself
    const apiResponse = await page.request.get('/api/proxy-status');
    expect(apiResponse.status()).toBe(200);
    const { version: apiVersion } = await apiResponse.json();

    await loadDashboard(page);
    const pageTitle = await page.title();

    // Title must match the live API version — never the old hardcoded value
    expect(pageTitle).not.toContain('0.0.13');
    expect(pageTitle).toContain(apiVersion);
  });

  test('API /api/proxy-status returns a real version (not stale 1.0.0 or 0.0.13)', async ({ page }) => {
    const apiResponse = await page.request.get('/api/proxy-status');
    expect(apiResponse.status()).toBe(200);
    const body = await apiResponse.json();

    // server.js used to hardcode '1.0.0' — ensure that regression is gone
    expect(body.version).not.toBe('1.0.0');
    // Stale HTML had 0.0.13 — ensure it was updated
    expect(body.version).not.toBe('0.0.13');
    // Must be a valid semver string
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('TOOLBOX_VERSION JS constant matches the API version', async ({ page }) => {
    const apiResponse = await page.request.get('/api/proxy-status');
    const { version: apiVersion } = await apiResponse.json();

    await loadDashboard(page);
    const toolboxVersion = await page.evaluate(() => {
      // TOOLBOX_VERSION is a global var declared early in toolbox.html
      return typeof TOOLBOX_VERSION !== 'undefined' ? TOOLBOX_VERSION : null;
    });

    // The JS constant must not be stale or null
    expect(toolboxVersion).not.toBeNull();
    expect(toolboxVersion).not.toBe('0.0.13');
    // Must match what the server reports — UI and server must agree
    expect(toolboxVersion).toBe(apiVersion);
  });

  test('version badge element shows the current API version on the home screen', async ({ page }) => {
    const apiResponse = await page.request.get('/api/proxy-status');
    const { version: apiVersion } = await apiResponse.json();

    await loadDashboard(page);
    // homeInit() renders the badge asynchronously — give it a moment
    await page.waitForTimeout(500);
    const badgeText = await page.evaluate(() => {
      const badgeElement = document.getElementById('tbx-version-badge');
      return badgeElement ? badgeElement.textContent : null;
    });

    // When the badge exists it must show the live version, not a stale one
    if (badgeText !== null) {
      expect(badgeText).not.toContain('0.0.13');
      expect(badgeText).toContain(apiVersion);
    }
  });
});

// ── Bug 3: RELAY dependency shown when PAT/proxy is configured ─────────────────

test.describe('Bug 3 — RELAY: warning must not show when Jira is connected via proxy', () => {
  test('relay warning is hidden when /api/proxy-status reports Jira ready', async ({ page }) => {
    // Intercept the proxy-status call to simulate a fully-configured Jira PAT setup.
    // This is the same data the server returns when TBX_JIRA_PAT is set.
    await page.route('/api/proxy-status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          proxy:   true,
          version: '0.0.14',
          jira: {
            configured:     true,
            hasCredentials: true,
            ready:          true,
            baseUrl:        'https://jira.example.com',
          },
          snow: { configured: false, hasCredentials: false, sessionMode: false, ready: false, baseUrl: null },
          github: { configured: false, hasCredentials: false, ready: false },
        }),
      });
    });

    await loadDashboard(page);
    await page.waitForTimeout(800);

    // The relay warning div must be empty (no warning) when Jira is proxy-ready
    const relayWarningContent = await page.evaluate(() => {
      const warningElement = document.getElementById('mi-relay-warn');
      return warningElement ? warningElement.innerHTML.trim() : 'element-not-found';
    });

    expect(relayWarningContent).toBe('');
  });

  test('connection status says "proxy" not "relay" when Jira is connected via PAT', async ({ page }) => {
    // Simulate Jira connected via proxy PAT — no relay bookmarklet involved
    await page.route('/api/proxy-status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          proxy:   true,
          version: '0.0.14',
          jira: {
            configured:     true,
            hasCredentials: true,
            ready:          true,
            baseUrl:        'https://jira.example.com',
          },
          snow: { configured: false, hasCredentials: false, sessionMode: false, ready: false, baseUrl: null },
          github: { configured: false, hasCredentials: false, ready: false },
        }),
      });
    });

    await loadDashboard(page);
    await page.waitForTimeout(800);

    // Inject proxy status into sessionStorage so tbxUpdateConnBar() reads it,
    // then trigger the update that miSyncRelayStatus also calls.
    const connectionModeText = await page.evaluate(() => {
      // Write the mocked proxy status into sessionStorage so the conn bar reads it
      sessionStorage.setItem('tbxProxyStatus', JSON.stringify({
        proxy: true,
        version: '0.0.14',
        jira: { configured: true, hasCredentials: true, ready: true, baseUrl: 'https://jira.example.com' },
      }));
      // Trigger the connection bar update (same function called by miSyncRelayStatus)
      if (typeof tbxUpdateConnBar === 'function') tbxUpdateConnBar();
      if (typeof miSyncRelayStatus === 'function') miSyncRelayStatus();

      // mi-conn-mode is the visible element that shows "proxy" or "relay"
      const modeElement = document.getElementById('mi-conn-mode');
      return modeElement ? modeElement.innerHTML : '';
    });

    // When connected via proxy, the mode label MUST say "proxy" not "relay"
    expect(connectionModeText.toLowerCase()).not.toContain('relay');
    expect(connectionModeText.toLowerCase()).toContain('proxy');
  });

  test('relay warning IS shown when neither relay nor proxy is configured', async ({ page }) => {
    // Simulate a completely unconfigured state — relay warning should appear
    await page.route('/api/proxy-status', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          proxy:   true,
          version: '0.0.14',
          jira: { configured: false, hasCredentials: false, ready: false, baseUrl: null },
          snow: { configured: false, hasCredentials: false, sessionMode: false, ready: false, baseUrl: null },
          github: { configured: false, hasCredentials: false, ready: false },
        }),
      });
    });

    await loadDashboard(page);
    await page.evaluate(() => {
      sessionStorage.setItem('tbxProxyStatus', JSON.stringify({
        proxy: true, version: '0.0.14',
        jira: { configured: false, hasCredentials: false, ready: false, baseUrl: null },
      }));
      if (typeof miSyncRelayStatus === 'function') miSyncRelayStatus();
    });
    await page.waitForTimeout(300);

    const relayWarningContent = await page.evaluate(() => {
      const warningElement = document.getElementById('mi-relay-warn');
      return warningElement ? warningElement.innerHTML.trim() : 'element-not-found';
    });

    // Warning MUST appear when nothing is configured
    expect(relayWarningContent).not.toBe('');
    expect(relayWarningContent.toLowerCase()).toContain('not connected');
  });
});
