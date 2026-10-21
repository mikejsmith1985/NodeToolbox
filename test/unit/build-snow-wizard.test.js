// build-snow-wizard.test.js — Proves the SNow Wizard build writes ONE self-contained HTML file that is the app itself.

'use strict';

const path = require('path');

const fs = require('fs');

const {
  createModuleReplacementPlugin,
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
    expect(pageHtml).toContain('<div id="wizard-root"></div><script>run()</script>');
    expect(findExternalReferences(pageHtml)).toEqual([]);
  });

  it('escapes a closing script tag inside the inlined script', () => {
    expect(escapeInlineScript('a="</script>"')).toBe('a="<\\/script>"');
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
    const baseCss = fs.readFileSync(path.join(__dirname, '../../client/src/snowWizard/shell/wizardPage.css'), 'utf8');
    expect(baseCss).toMatch(/select option,\s*select optgroup\s*\{[^}]*background-color:\s*var\(--color-input-bg\)[^}]*color:\s*var\(--color-text-primary\)/);
  });
});
