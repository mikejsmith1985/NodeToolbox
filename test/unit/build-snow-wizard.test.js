// build-snow-wizard.test.js — Proves the SNow Wizard build writes ONE self-contained HTML file and enforces the bookmark budget.

'use strict';

const path = require('path');

const fs = require('fs');

const {
  INSTALL_PAYLOAD_ELEMENT_ID,
  INSTALL_PAYLOAD_KIND,
  buildInstallPayloadBlock,
  WIZARD_BOOKMARK_BUDGET_BYTES,
  createModuleReplacementPlugin,
  assertWithinBookmarkBudget,
  escapeInlineScript,
  findExternalReferences,
  wrapHtmlDocument,
} = require('../../scripts/build-snow-wizard.js');

describe('wrapHtmlDocument', () => {
  it('produces one complete document with the style and script inlined', () => {
    const pageHtml = wrapHtmlDocument({ title: 'SNow Wizard', styleSource: 'body{margin:0}', scriptSource: 'run()' });

    expect(pageHtml.startsWith('<!doctype html>')).toBe(true);
    expect(pageHtml).toContain('<meta charset="utf-8">');
    expect(pageHtml).toContain('<title>SNow Wizard</title>');
    expect(pageHtml).toContain('<style>body{margin:0}</style>');
    expect(pageHtml).toContain('<script>run()</script>');
    expect(findExternalReferences(pageHtml)).toEqual([]);
  });

  it('escapes a closing script tag inside the inlined script', () => {
    expect(escapeInlineScript('a="</script>"')).toBe('a="<\\/script>"');
  });
});

describe('buildInstallPayloadBlock', () => {
  it('writes the Wizard as inert JSON that no "<" inside can end early, with its code pre-escaped for a script', () => {
    const block = buildInstallPayloadBlock({ version: 'v1.2.3', appSource: 'a="</script>";b<c', styleSource: 'p{}' });
    const jsonText = block.slice(block.indexOf('>') + 1, block.lastIndexOf('</script>'));

    expect(block.startsWith(`<script type="application/json" id="${INSTALL_PAYLOAD_ELEMENT_ID}">`)).toBe(true);
    expect(jsonText).not.toContain('<');
    expect(JSON.parse(jsonText)).toEqual({ kind: INSTALL_PAYLOAD_KIND, version: 'v1.2.3', appSource: 'a="<\\/script>";b<c', styleSource: 'p{}' });
  });

  it('uses the same block id and kind the Wizard looks for', () => {
    const installSource = fs.readFileSync(path.join(__dirname, '../../client/src/snowWizard/install/wizardInstall.ts'), 'utf8');
    expect(installSource).toContain(`payloadElementId: '${INSTALL_PAYLOAD_ELEMENT_ID}'`);
    expect(installSource).toContain(`payloadKind: '${INSTALL_PAYLOAD_KIND}'`);
  });
});

describe('findExternalReferences', () => {
  it('lists every script, stylesheet or font fetched from another address', () => {
    const pageHtml = '<script src="https://cdn.example.com/x.js"></script><link rel="stylesheet" href="http://x/y.css"><style>@import url("https://f/g.css");</style>';
    expect(findExternalReferences(pageHtml)).toEqual([
      'https://cdn.example.com/x.js',
      'http://x/y.css',
      'https://f/g.css',
    ]);
  });

  it('ignores plain links the user may click', () => {
    expect(findExternalReferences('<a href="https://jira.example.com">Jira</a>')).toEqual([]);
  });
});

describe('assertWithinBookmarkBudget', () => {
  it('accepts a bookmark at the budget', () => {
    expect(() => assertWithinBookmarkBudget(WIZARD_BOOKMARK_BUDGET_BYTES)).not.toThrow();
  });

  it('fails the build, naming both sizes, when the bookmark is over budget', () => {
    expect(() => assertWithinBookmarkBudget(WIZARD_BOOKMARK_BUDGET_BYTES + 1)).toThrow(/over the 1572864-byte budget/);
  });
});

describe('createModuleReplacementPlugin', () => {
  function captureResolver(replacedModules) {
    let resolveHandler = null;
    createModuleReplacementPlugin(replacedModules).setup({ onResolve: (_options, handler) => { resolveHandler = handler; } });
    return resolveHandler;
  }

  const originalFile = path.resolve('client/src/services/relayBridgeApi.ts');
  const replacementFile = path.resolve('client/src/snowWizard/transport/relayBridgeShim.ts');

  it('swaps an import that resolves to the original file, however it is written', () => {
    const resolveHandler = captureResolver([{ original: originalFile, replacement: replacementFile }]);
    expect(resolveHandler({ path: './relayBridgeApi.ts', resolveDir: path.resolve('client/src/services') })).toEqual({ path: replacementFile });
    expect(resolveHandler({ path: '../services/relayBridgeApi.ts', resolveDir: path.resolve('client/src/hooks') })).toEqual({ path: replacementFile });
  });

  it('leaves every other import to esbuild', () => {
    const resolveHandler = captureResolver([{ original: originalFile, replacement: replacementFile }]);
    expect(resolveHandler({ path: './snowApi.ts', resolveDir: path.resolve('client/src/services') })).toBeUndefined();
  });
});

describe('Wizard base styles', () => {
  // The Wizard does not inline Toolbox's global.css, so the open-dropdown colour fix must live in its own base sheet
  // (GH #456: the open option list painted light text on a white list).
  it('paints every open dropdown list with the dark input background and readable text', () => {
    const baseCss = require('fs').readFileSync(path.join(__dirname, '../../client/src/snowWizard/probe/probePage.css'), 'utf8');
    expect(baseCss).toMatch(/select option,\s*select optgroup\s*\{[^}]*background-color:\s*var\(--color-input-bg\)[^}]*color:\s*var\(--color-text-primary\)/);
  });
});
