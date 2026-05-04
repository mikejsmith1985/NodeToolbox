// test/unit/toolboxHtml.test.js — Static analysis tests for public/toolbox.html.
//
// Validates that toolbox.html has been correctly wired to use NodeToolbox's
// server-side proxy when served by NodeToolbox, and that the legacy in-app
// connection wizard has been fully removed.

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Test Fixtures ─────────────────────────────────────────────────────────────

const TOOLBOX_HTML_PATH = path.join(__dirname, '..', '..', 'public', 'toolbox.html');

/** Full content of toolbox.html, read once for all tests in this module. */
const toolboxHtmlContent = fs.readFileSync(TOOLBOX_HTML_PATH, 'utf8');

// ── NodeToolbox Auto-Wire ─────────────────────────────────────────────────────

describe('toolbox.html — NodeToolbox proxy auto-wire', () => {

  it('declares IS_NODETOOLBOX_SERVER detection constant', () => {
    expect(toolboxHtmlContent).toContain('IS_NODETOOLBOX_SERVER');
  });

  it('declares NODETOOLBOX_ORIGIN variable', () => {
    expect(toolboxHtmlContent).toContain('NODETOOLBOX_ORIGIN');
  });

  it('routes tbxJiraRequest through /jira-proxy when on NodeToolbox', () => {
    expect(toolboxHtmlContent).toContain('/jira-proxy');
  });

  it('routes tbxSnowRequest through /snow-proxy when on NodeToolbox', () => {
    expect(toolboxHtmlContent).toContain('/snow-proxy');
  });

  it('routes crJiraFetch through /jira-proxy when on NodeToolbox', () => {
    // crJiraFetch is the Change Request generator fetch — must also use the proxy
    const crJiraFetchStart = toolboxHtmlContent.indexOf('function crJiraFetch');
    const crJiraFetchBody  = toolboxHtmlContent.slice(crJiraFetchStart, crJiraFetchStart + 800);
    expect(crJiraFetchBody).toContain('/jira-proxy');
  });

  it('routes crSnowFetch through /snow-proxy when on NodeToolbox', () => {
    const crSnowFetchStart = toolboxHtmlContent.indexOf('function crSnowFetch');
    const crSnowFetchBody  = toolboxHtmlContent.slice(crSnowFetchStart, crSnowFetchStart + 800);
    expect(crSnowFetchBody).toContain('/snow-proxy');
  });

});

// ── HTML Hygiene ──────────────────────────────────────────────────────────────

describe('toolbox.html — HTML hygiene', () => {

  it('contains no BOM (U+FEFF) byte-order-mark characters', () => {
    // BOM characters appear as garbled glyphs in some browsers.
    // They must not appear anywhere in the HTML after the file opening.
    const hasBom = toolboxHtmlContent.includes('\uFEFF');
    expect(hasBom).toBe(false);
  });

});

// ── Home Page Grid ────────────────────────────────────────────────────────────

describe('toolbox.html — home page card grid', () => {

  it('includes an Admin Hub card in the home page view', () => {
    // Admin Hub was implemented but its card was missing from the home grid.
    // The card must exist as an actual DOM element (not just in a JS querySelector string).
    // The onclick handler pattern distinguishes a real card from a JS selector string.
    expect(toolboxHtmlContent).toContain("onclick=\"showView('admin-hub')\"");
  });

});

// ── Proxy Mode Credential Warnings ───────────────────────────────────────────

describe('toolbox.html — SNow Hub credential warning in proxy mode', () => {

  it('crCheckCredWarnings does not show Jira warning when running in NodeToolbox proxy mode', () => {
    // When IS_NODETOOLBOX_SERVER is true the relay is not used, so CRG.relay.jiraReady
    // is never set. The warning must be suppressed for proxy-mode users.
    const functionStart = toolboxHtmlContent.indexOf('function crCheckCredWarnings');
    const functionBody  = toolboxHtmlContent.slice(functionStart, functionStart + 800);
    expect(functionBody).toContain('IS_NODETOOLBOX_SERVER');
  });

});

// ── Dev Workspace PAT Test ────────────────────────────────────────────────────

describe('toolbox.html — Dev Workspace Jira PAT test', () => {

  it('devTestJiraPAT routes through tbxJiraRequest when IS_NODETOOLBOX_SERVER is true', () => {
    // Direct fetch() is CORS-blocked in the browser. In proxy mode the request
    // must go through the server-side /jira-proxy endpoint via tbxJiraRequest.
    const functionStart = toolboxHtmlContent.indexOf('function devTestJiraPAT');
    const functionBody  = toolboxHtmlContent.slice(functionStart, functionStart + 800);
    expect(functionBody).toContain('IS_NODETOOLBOX_SERVER');
    expect(functionBody).toContain('tbxJiraRequest');
  });

});

// ── Dev Workspace Wizard Scope ────────────────────────────────────────────────

describe('toolbox.html — Dev Workspace setup wizard', () => {

  it('welcome step (devWizS0) does not advertise Git Hooks as a supported feature', () => {
    // Git Hooks require offline PowerShell execution and are not supported in
    // the NodeToolbox browser environment. The welcome card must be removed.
    const s0Start = toolboxHtmlContent.indexOf('function devWizS0');
    const s0Body  = toolboxHtmlContent.slice(s0Start, s0Start + 1200);
    expect(s0Body).not.toContain('Git Hooks');
  });

  it('workflow step (devWizS4) does not offer Git Hooks as a workflow option', () => {
    const s4Start = toolboxHtmlContent.indexOf('function devWizS4');
    const s4Body  = toolboxHtmlContent.slice(s4Start, s4Start + 1500);
    expect(s4Body).not.toContain('Git Hooks');
  });

  it('summary step (devWizS5) does not reference the Hook Generator tab', () => {
    // The Hook Generator tab is unsupported. The wizard summary must not direct
    // the user to a tab that does not exist or does not function correctly.
    const s5Start = toolboxHtmlContent.indexOf('function devWizS5');
    // Use a 2500-char slice to capture the full function body (the function is ~300 lines of JS strings)
    const s5Body  = toolboxHtmlContent.slice(s5Start, s5Start + 2500);
    expect(s5Body).not.toContain('Hook Generator');
  });

});

// ── Reports Hub Connection Bar (proxy-mode) ───────────────────────────────────
//
// Four bugs caused the Reports Hub connection bar to always show grey dots and a
// non-functional Connect button when the proxy server was running:
//
//   1. 'rh' prefix was absent from tbxUpdateConnBar's bars array — the update
//      loop silently skipped Reports Hub on every proxy-probe completion.
//   2. tbxRunProxyProbe() never called tbxUpdateConnBar() after writing
//      tbxProxyStatus — so even bars that ARE in the array missed the result
//      when the user was already on the view.
//   3. rhOnOpen() passed no connectFn to tbxInitConnBar → tbxConnect() was used,
//      which opens a relay popup window (broken in proxy mode).
//   4. connectedViaProxy used !tbxJiraReady() which returns false in proxy mode,
//      so the mode label always read "relay" instead of "proxy".

describe('toolbox.html — Reports Hub connection bar proxy fixes', () => {

  it('tbxUpdateConnBar bars array includes the rh (Reports Hub) prefix', () => {
    // Without this entry the update loop never touches the Reports Hub conn-bar
    // DOM nodes, so dots stay grey and the Connect button stays visible even when
    // the proxy server is fully connected.
    const updateConnBarStart = toolboxHtmlContent.indexOf('function tbxUpdateConnBar');
    const updateConnBarBody  = toolboxHtmlContent.slice(updateConnBarStart, updateConnBarStart + 1200);
    expect(updateConnBarBody).toContain("prefix:'rh'");
  });

  it('rhConnect() function exists and is proxy-mode aware', () => {
    // rhConnect() must exist so Reports Hub can provide its own connect handler,
    // mirroring the pattern used by snhConnect() for SNow Hub.
    expect(toolboxHtmlContent).toContain('function rhConnect');
    const rhConnectStart = toolboxHtmlContent.indexOf('function rhConnect');
    const rhConnectBody  = toolboxHtmlContent.slice(rhConnectStart, rhConnectStart + 400);
    expect(rhConnectBody).toContain('IS_NODETOOLBOX_SERVER');
  });

  it("rhConnect() redirects to Toolbox Settings in proxy mode instead of opening a relay popup", () => {
    // In proxy mode the relay popup is irrelevant; the user must configure
    // credentials via Settings.  Opening a popup window (tbxConnect) would be
    // a no-op or confusing, so we redirect to 'toolbox-settings' instead.
    const rhConnectStart = toolboxHtmlContent.indexOf('function rhConnect');
    const rhConnectBody  = toolboxHtmlContent.slice(rhConnectStart, rhConnectStart + 400);
    expect(rhConnectBody).toContain("showView('toolbox-settings')");
  });

  it('rhOnOpen() passes rhConnect as the connectFn to tbxInitConnBar', () => {
    // Without 'rhConnect' the bar defaults to tbxConnect(), which opens a relay
    // popup — this is the Connect button being broken in proxy mode.
    const rhOnOpenStart = toolboxHtmlContent.indexOf('function rhOnOpen');
    const rhOnOpenBody  = toolboxHtmlContent.slice(rhOnOpenStart, rhOnOpenStart + 300);
    expect(rhOnOpenBody).toContain("'rhConnect'");
  });

  it('tbxRunProxyProbe() calls tbxUpdateConnBar() after storing tbxProxyStatus', () => {
    // Without this call, all conn-bar dots remain grey for the lifetime of the
    // current view whenever the probe completes while the view is already open.
    const probeStart       = toolboxHtmlContent.indexOf('function tbxRunProxyProbe');
    // Use 3500 chars — the tbxProxyStatus write and the tbxUpdateConnBar() call that
    // follows are ~2833 chars into the function, past the original 2500 estimate.
    const probeBody        = toolboxHtmlContent.slice(probeStart, probeStart + 3500);
    const statusWriteIdx   = probeBody.indexOf("sessionStorage.setItem('tbxProxyStatus'");
    expect(statusWriteIdx).toBeGreaterThan(-1);
    // tbxUpdateConnBar must be called after the status is stored (not before).
    const afterStatusWrite = probeBody.slice(statusWriteIdx);
    expect(afterStatusWrite).toContain('tbxUpdateConnBar()');
  });

  it('connectedViaProxy label in tbxUpdateConnBar does not rely on !tbxJiraReady()', () => {
    // !tbxJiraReady() evaluates to false in IS_NODETOOLBOX_SERVER mode because
    // tbxJiraReady() returns true unconditionally in proxy mode — meaning
    // connectedViaProxy was always false and the label always read "relay".
    const updateConnBarStart = toolboxHtmlContent.indexOf('function tbxUpdateConnBar');
    // Use 3600 chars — connectedViaProxy is ~3195 chars into the function, past the
    // original 2500-char estimate.
    const updateConnBarBody  = toolboxHtmlContent.slice(updateConnBarStart, updateConnBarStart + 3600);
    const connViaProxyIdx    = updateConnBarBody.indexOf('connectedViaProxy =');
    expect(connViaProxyIdx).toBeGreaterThan(-1);
    const connViaProxyLine   = updateConnBarBody.slice(connViaProxyIdx, connViaProxyIdx + 200);
    expect(connViaProxyLine).not.toContain('!tbxJiraReady()');
  });

});

// ── Home Screen Default + Reports Hub Auto-load ───────────────────────────────
//
// Root bugs:
//   1. tbxHomeInit() contained a one-shot requestAnimationFrame block that
//      redirected every first page load to 'reports-hub', bypassing the home
//      screen.  The Home Screen should be the landing view.
//
//   2. rhOnOpen() did not reset stale RH_STATE.generating* flags before calling
//      rhShowTab().  If a fetch was abandoned mid-flight (user navigated away
//      before the API responded), generatingFeatures stayed true on re-entry and
//      rhShowTab()'s guard condition (!generatingFeatures && !loadedFeatures)
//      blocked the auto-load, leaving the panel empty until a manual ↻ Refresh.

describe('toolbox.html — home screen default and Reports Hub auto-load', () => {

  it('homeInit does NOT auto-route to reports-hub on first session load', () => {
    // The requestAnimationFrame block that called showView('reports-hub') must be
    // gone — the Home Screen is now the default landing view.
    const homeInitStart = toolboxHtmlContent.indexOf('function homeInit()');
    expect(homeInitStart).toBeGreaterThan(-1);
    // Scan the function body (generous 1500-char window covers the whole function).
    const homeInitBody = toolboxHtmlContent.slice(homeInitStart, homeInitStart + 1500);
    expect(homeInitBody).not.toContain("showView('reports-hub')");
  });

  it('homeInit does NOT set the tbxHomeAutoRouted session flag', () => {
    // The auto-route relied on sessionStorage 'tbxHomeAutoRouted' as a one-shot
    // guard.  With the auto-route gone the flag should also be removed from homeInit.
    const homeInitStart = toolboxHtmlContent.indexOf('function homeInit()');
    const homeInitBody  = toolboxHtmlContent.slice(homeInitStart, homeInitStart + 1500);
    expect(homeInitBody).not.toContain('tbxHomeAutoRouted');
  });

  it('rhOnOpen resets generatingFeatures before calling rhShowTab so stale in-flight state cannot block auto-load', () => {
    // Without this reset, navigating away mid-fetch leaves generatingFeatures=true;
    // subsequent opens of Reports Hub skip the auto-load because rhShowTab's guard
    // condition (!generatingFeatures && !loadedFeatures) evaluates to false.
    const rhOnOpenStart = toolboxHtmlContent.indexOf('function rhOnOpen()');
    expect(rhOnOpenStart).toBeGreaterThan(-1);
    // 1300-char window: the reset lines are ~940 chars into the function body
    // due to the explanatory comment block added above them.
    const rhOnOpenBody = toolboxHtmlContent.slice(rhOnOpenStart, rhOnOpenStart + 1300);
    expect(rhOnOpenBody).toContain('generatingFeatures = false');
  });

});

// ── Connection Wizard Removal ─────────────────────────────────────────────────

describe('toolbox.html — in-app connection wizard removed', () => {

  it('does not contain the connection wizard overlay element', () => {
    expect(toolboxHtmlContent).not.toContain('id="tbx-conn-wiz-overlay"');
  });

  it('does not contain the CONN_WIZ state object', () => {
    expect(toolboxHtmlContent).not.toContain('var CONN_WIZ');
  });

  it('does not contain the wizard step-3 Python/Node setup function', () => {
    expect(toolboxHtmlContent).not.toContain('function tbxConnWizStep3');
  });

  it('does not contain the wizard render function', () => {
    expect(toolboxHtmlContent).not.toContain('function tbxConnWizRender');
  });

});

// ── Version Display ───────────────────────────────────────────────────────────
//
// TOOLBOX_VERSION in toolbox.html must match the version in package.json.
// The release script patches both files; this test catches any drift between them.

describe('toolbox.html — TOOLBOX_VERSION matches package.json', () => {

  it('TOOLBOX_VERSION literal matches the version in package.json', () => {
    const pkg = JSON.parse(
      require('fs').readFileSync(
        require('path').join(__dirname, '..', '..', 'package.json'),
        'utf8'
      )
    );
    // Expect the exact string assignment to be present.
    const expectedAssignment = `var TOOLBOX_VERSION = '${pkg.version}'`;
    expect(toolboxHtmlContent).toContain(expectedAssignment);
  });

});

// ── Proxy Auto-Detect on Startup ──────────────────────────────────────────────
//
// tbxAutoDetectProxy() must be called in a startup IIFE so the connection bar
// turns green immediately when the page loads — without requiring any user action.

describe('toolbox.html — proxy auto-detect fires on startup', () => {

  it('tbxAutoDetectProxy is defined', () => {
    expect(toolboxHtmlContent).toContain('function tbxAutoDetectProxy()');
  });

  it('a startup IIFE calls tbxAutoDetectProxy() guarded by IS_NODETOOLBOX_SERVER', () => {
    // The startup block must be an IIFE that only runs the probe when the page
    // is served by the NodeToolbox server — not when opened as a bare file://.
    expect(toolboxHtmlContent).toContain('IS_NODETOOLBOX_SERVER');
    expect(toolboxHtmlContent).toContain('tbxAutoDetectProxy()');
    // Verify the call is wrapped in an IIFE (not a loose top-level call that
    // could run before the DOM is ready or before the function is defined).
    const startupIifePattern = /\(function\s*\(\)\s*\{[^}]*IS_NODETOOLBOX_SERVER[^}]*tbxAutoDetectProxy\(\)/s;
    expect(startupIifePattern.test(toolboxHtmlContent)).toBe(true);
  });

});
