// test/e2e/issue-31.spec.js — E2E tests for GitHub Issue #31.
//
// Tests three user-visible bugs:
//   1. Unreadable (ANSI/control) characters appearing in the Reports Hub
//   2. Version mismatch: UI showing v0.0.13 instead of v0.0.14
//   3. RELAY dependency shown when PAT/proxy credentials are configured
//
// These are written as RED tests first (TDD). They describe the expected
// user experience — run them before the fix to confirm they fail, then
// run after the fix to confirm they pass.

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

test.describe('Bug 2 — Version: UI must show v0.0.14 everywhere', () => {
  test('page <title> contains the correct version', async ({ page }) => {
    await loadDashboard(page);
    const title = await page.title();
    // Must NOT show the stale 0.0.13 version
    expect(title).not.toContain('0.0.13');
    // Must show the correct version from package.json
    expect(title).toContain('0.0.14');
  });

  test('API /api/proxy-status returns version 0.0.14', async ({ page }) => {
    const response = await page.request.get('/api/proxy-status');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.version).toBe('0.0.14');
  });

  test('TOOLBOX_VERSION JS constant in the page is 0.0.14', async ({ page }) => {
    await loadDashboard(page);
    const version = await page.evaluate(() => {
      return typeof TOOLBOX_VERSION !== 'undefined' ? TOOLBOX_VERSION : null;
    });
    expect(version).not.toBe('0.0.13');
    expect(version).toBe('0.0.14');
  });

  test('version badge element shows v0.0.14 on the home screen', async ({ page }) => {
    await loadDashboard(page);
    // The badge is rendered by homeInit() — give it a moment to run
    await page.waitForTimeout(500);
    const badgeText = await page.evaluate(() => {
      const badgeElement = document.getElementById('tbx-version-badge');
      return badgeElement ? badgeElement.textContent : null;
    });
    // Badge may not be visible on every view, but when it exists it must show the right version
    if (badgeText !== null) {
      expect(badgeText).not.toContain('0.0.13');
      expect(badgeText).toContain('0.0.14');
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
