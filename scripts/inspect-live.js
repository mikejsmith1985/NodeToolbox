// scripts/inspect-live.js — Live visual inspection of the running dashboard.
// Run with: node scripts/inspect-live.js
// Takes screenshots of every main view and dumps all relay-related visible DOM
// nodes, so we can see exactly what the user sees after any fix.
'use strict';

const { chromium } = require('playwright');

const BASE_URL = 'http://localhost:5555';

// Mock proxy-status to simulate Jira PAT configured (proxy mode, no relay)
const JIRA_READY_RESPONSE = {
  ok: true,
  version: '0.0.16',
  proxy: true,
  jira: { ready: true, url: 'https://jira.test.example.com', connectedViaProxy: true },
  snow: { ready: false },
  github: { ready: false }
};

/**
 * Returns all visible (non-CSS-hidden) text nodes in the page that contain
 * the word "relay" (case-insensitive), for regression checking.
 */
async function getVisibleRelayText(page) {
  return page.evaluate(() => {
    function isVisible(el) {
      while (el) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        el = el.parentElement;
      }
      return true;
    }
    return Array.from(document.querySelectorAll('*'))
      .filter(el => el.children.length === 0)
      .filter(el => /relay/i.test(el.textContent.trim()))
      .filter(el => isVisible(el))
      .map(el => el.textContent.trim().substring(0, 180))
      .filter(text => text.length > 3);
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();

  // Inject localStorage/sessionStorage BEFORE the page loads so the wizard is
  // bypassed and the proxy status is already "known" to the client-side code.
  // addInitScript runs before any page JavaScript, so these values are visible
  // from the very first line of toolbox.html's script block.
  await page.addInitScript((proxyStatus) => {
    // Mark the setup wizard as already completed so the main app loads directly.
    localStorage.setItem('tbxWizardDone', '1');

    // Pre-seed the proxy URL that tbxRunProxyProbe would normally set after a
    // successful fetch — this tells all request functions to route via the proxy.
    localStorage.setItem('tbxJiraProxyUrl', 'http://localhost:5555');

    // Pre-seed the cached proxy status so auth widgets render in "connected via
    // proxy" state without waiting for the probe fetch to complete.
    sessionStorage.setItem('tbxProxyStatus', JSON.stringify(proxyStatus));
  }, JIRA_READY_RESPONSE);

  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  const pageTitle = await page.title();
  const toolboxVersion = await page.evaluate(() => typeof TOOLBOX_VERSION !== 'undefined' ? TOOLBOX_VERSION : 'NOT_FOUND');
  const cachedProxyStatus = await page.evaluate(() => {
    try { return JSON.parse(sessionStorage.getItem('tbxProxyStatus') || 'null'); } catch(e) { return null; }
  });
  const wizardVisible = await page.locator('#tbxwiz-overlay').isVisible().catch(() => false);
  console.log('=== VERSION CHECK ===');
  console.log('Title:', pageTitle);
  console.log('TOOLBOX_VERSION:', toolboxVersion);
  console.log('sessionStorage.tbxProxyStatus.jira.ready:', !!(cachedProxyStatus && cachedProxyStatus.jira && cachedProxyStatus.jira.ready));
  console.log('Wizard showing:', wizardVisible);

  await page.screenshot({ path: 'C:/Temp/inspect-01-load.png' });
  console.log('\nScreenshot: C:/Temp/inspect-01-load.png (initial load)');
  await page.screenshot({ path: 'C:/Temp/inspect-02-home.png' });
  console.log('Screenshot: C:/Temp/inspect-02-home.png (main app)');

  // ── Tour each main view ─────────────────────────────────────────────────
  const views = [
    { name: 'my-issues',       label: 'My Issues'       },
    { name: 'sprint-dashboard', label: 'Sprint Dashboard' },
    { name: 'reports-hub',      label: 'Reports Hub'     },
    { name: 'admin-hub',        label: 'Admin Hub'       },
    { name: 'toolbox-settings', label: 'Settings'        },
  ];

  for (const view of views) {
    await page.evaluate((viewName) => {
      if (typeof showView === 'function') showView(viewName);
    }, view.name);
    await page.waitForTimeout(1200);

    const relayText = await getVisibleRelayText(page);
    const screenshotPath = `C:/Temp/inspect-${view.name}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log(`\n=== ${view.label.toUpperCase()} (${view.name}) ===`);
    console.log(`Screenshot: ${screenshotPath}`);
    if (relayText.length === 0) {
      console.log('  ✅ No visible relay text');
    } else {
      console.log(`  ❌ ${relayText.length} relay reference(s) visible:`);
      relayText.forEach((text, i) => console.log(`    ${i + 1}. "${text}"`));
    }
  }

  // ── Reports Hub: ANSI character test ────────────────────────────────────
  console.log('\n=== ANSI STRIPPING TEST ===');
  const ansiResult = await page.evaluate(() => {
    const rawAnsi = '\x1b[32mGreen text\x1b[0m and \x1b[1;31mRed bold\x1b[0m';
    const rawControl = 'normal\x01\x02\x03text';
    if (typeof stripControlCharactersFromText === 'function') {
      const cleanAnsi = stripControlCharactersFromText(rawAnsi);
      const cleanControl = stripControlCharactersFromText(rawControl);
      return { available: true, cleanAnsi, cleanControl };
    }
    if (typeof miRenderJiraText === 'function') {
      return { available: true, note: 'stripControlCharactersFromText not global but miRenderJiraText exists' };
    }
    return { available: false };
  });
  console.log('ANSI strip function result:', JSON.stringify(ansiResult, null, 2));

  await browser.close();
  console.log('\n=== INSPECTION COMPLETE ===');
})().catch(err => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
