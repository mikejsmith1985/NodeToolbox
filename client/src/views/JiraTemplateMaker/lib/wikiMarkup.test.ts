// wikiMarkup.test.ts — Unit tests for editor-document → Jira wiki-markup serialization.

import { describe, expect, it } from 'vitest';

import { serializeWikiMarkup } from './wikiMarkup.ts';
import type { WikiDoc } from './wikiMarkup.ts';

describe('serializeWikiMarkup', () => {
  it('renders bold, italic, and inline code spans', () => {
    const doc: WikiDoc = [{ type: 'paragraph', spans: [
      { text: 'normal ' },
      { text: 'bold', bold: true },
      { text: ' and ' },
      { text: 'em', italic: true },
      { text: ' and ' },
      { text: 'code', code: true },
    ] }];
    expect(serializeWikiMarkup(doc)).toBe('normal *bold* and _em_ and {{code}}');
  });

  it('renders headings at levels 1-3', () => {
    const doc: WikiDoc = [
      { type: 'heading', level: 1, spans: [{ text: 'Title' }] },
      { type: 'heading', level: 3, spans: [{ text: 'Sub' }] },
    ];
    expect(serializeWikiMarkup(doc)).toBe('h1. Title\n\nh3. Sub');
  });

  it('renders bullet and numbered lists', () => {
    const doc: WikiDoc = [
      { type: 'bulletList', items: [[{ text: 'one' }], [{ text: 'two' }]] },
      { type: 'orderedList', items: [[{ text: 'first' }], [{ text: 'second' }]] },
    ];
    expect(serializeWikiMarkup(doc)).toBe('* one\n* two\n\n# first\n# second');
  });

  it('renders links, wrapping any inline formatting inside the link text', () => {
    const doc: WikiDoc = [{ type: 'paragraph', spans: [
      { text: 'see ' },
      { text: 'the docs', bold: true, link: 'https://example.com' },
    ] }];
    expect(serializeWikiMarkup(doc)).toBe('see [*the docs*|https://example.com]');
  });

  it('renders fenced code blocks', () => {
    const doc: WikiDoc = [{ type: 'codeBlock', text: 'const x = 1;' }];
    expect(serializeWikiMarkup(doc)).toBe('{code}\nconst x = 1;\n{code}');
  });

  it('returns an empty string for an empty document', () => {
    expect(serializeWikiMarkup([])).toBe('');
  });
});
