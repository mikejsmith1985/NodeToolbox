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
