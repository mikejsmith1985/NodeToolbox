// build-snow-wizard.test.js — Proves the SNow Wizard build writes ONE self-contained HTML file and enforces the bookmark budget.

'use strict';

const {
  WIZARD_BOOKMARK_BUDGET_BYTES,
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
