// confluenceStorageText.test.ts — Proves Confluence storage-format markup becomes readable plain text.
//
// The PO Tool shows a fetched Confluence page as reference material beside a Feature draft. It must be
// readable, and it must NOT be injected as HTML — remote markup rendered raw is an XSS surface, and the
// workspace only ever needs the words. See specs/017-po-feature-tools/research.md (R2c).

import { describe, expect, it } from 'vitest';

import { readConfluenceStorageText } from './confluenceStorageText';

describe('readConfluenceStorageText', () => {
  it('strips tags so only the readable words remain', () => {
    expect(readConfluenceStorageText('<p>Claim submission</p>')).toBe('Claim submission');
  });

  it('turns line breaks into new lines', () => {
    expect(readConfluenceStorageText('First<br/>Second')).toBe('First\nSecond');
  });

  it('accepts the unclosed break Confluence sometimes emits', () => {
    expect(readConfluenceStorageText('First<br>Second')).toBe('First\nSecond');
  });

  it('ends a line where a block element ends, matching how the page reads', () => {
    expect(readConfluenceStorageText('<p>One</p><p>Two</p>')).toBe('One\nTwo');
  });

  it('keeps list items on separate lines so bullet content stays legible', () => {
    expect(readConfluenceStorageText('<ul><li>Alpha</li><li>Beta</li></ul>')).toBe('Alpha\nBeta');
  });

  it('separates headings from the text beneath them', () => {
    expect(readConfluenceStorageText('<h2>Scope</h2><p>In scope</p>')).toBe('Scope\nIn scope');
  });

  it('decodes the entities Confluence uses so text does not read as markup', () => {
    expect(readConfluenceStorageText('<p>A&nbsp;&amp;&nbsp;B</p>')).toBe('A & B');
    expect(readConfluenceStorageText('<p>&lt;tag&gt;</p>')).toBe('<tag>');
    expect(readConfluenceStorageText('<p>&quot;quoted&quot;</p>')).toBe('"quoted"');
  });

  it('drops Confluence structured-macro markup rather than showing it to the PO', () => {
    const storageValue =
      '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>Heads up</p></ac:rich-text-body></ac:structured-macro>';

    expect(readConfluenceStorageText(storageValue)).toBe('Heads up');
  });

  it('reads a table as lines rather than one run-on string', () => {
    const storageValue = '<table><tbody><tr><td>Feature</td></tr><tr><td>Estimate</td></tr></tbody></table>';

    expect(readConfluenceStorageText(storageValue)).toContain('Feature');
    expect(readConfluenceStorageText(storageValue)).toContain('Estimate');
  });

  it('trims surrounding whitespace so the workspace shows no leading blank lines', () => {
    expect(readConfluenceStorageText('<p>  Padded  </p>')).toBe('Padded');
  });

  it('returns empty text for an empty page rather than throwing', () => {
    expect(readConfluenceStorageText('')).toBe('');
  });

  it('never emits a script tag, however the markup is shaped', () => {
    // Defence in depth: this text is rendered as text, but it must not carry executable markup either.
    const storageValue = '<p>Safe</p><script>alert(1)</script>';

    const readableText = readConfluenceStorageText(storageValue);
    expect(readableText).not.toContain('<script>');
    expect(readableText).not.toContain('alert(1)');
  });

  it('collapses runs of blank lines so a sparse page stays compact', () => {
    expect(readConfluenceStorageText('<p>One</p><p></p><p></p><p>Two</p>')).toBe('One\nTwo');
  });
});

describe('readConfluenceStorageText — images become named placeholders', () => {
  it('keeps a trace of an attached image instead of deleting it', () => {
    // Stripping every tag deleted images without a trace: a page whose point was an architecture
    // diagram arrived as a gap between two bullets, and nothing downstream could tell (GH #376).
    const text = readConfluenceStorageText(
      '<p>Potential Risk</p><ac:image ac:align="center"><ri:attachment ri:filename="logical-architecture.png" /></ac:image><p>Potential work</p>',
    );

    expect(text).toContain('[Image: logical-architecture.png]');
  });

  it('leaves the placeholder where the image sat, so the sentences around it still explain it', () => {
    const text = readConfluenceStorageText(
      '<p>Before the diagram</p><ac:image><ri:attachment ri:filename="d.png" /></ac:image><p>After the diagram</p>',
    );

    const lines = text.split('\n');

    expect(lines.indexOf('Before the diagram')).toBeLessThan(lines.indexOf('[Image: d.png]'));
    expect(lines.indexOf('[Image: d.png]')).toBeLessThan(lines.indexOf('After the diagram'));
  });

  it('prefers alt text, which describes the diagram better than a file name', () => {
    const text = readConfluenceStorageText(
      '<ac:image ac:alt="Logical Architecture - Online Enrollment Intake"><ri:attachment ri:filename="p31.png" /></ac:image>',
    );

    expect(text).toBe('[Image: Logical Architecture - Online Enrollment Intake]');
  });

  it('names an external image by its file name rather than its whole url', () => {
    const text = readConfluenceStorageText('<ac:image><ri:url ri:value="https://example.com/a/b/flow.png?v=2" /></ac:image>');

    expect(text).toBe('[Image: flow.png]');
  });

  it('handles a plain img tag, which some Confluence content still carries', () => {
    expect(readConfluenceStorageText('<img src="/download/attachments/1/chart.png" />')).toBe('[Image: chart.png]');
  });

  it('says an image is there even when the markup gives it no name at all', () => {
    // "unnamed" is still worth far more than silence: it tells a reader something is missing here.
    expect(readConfluenceStorageText('<ac:image></ac:image>')).toBe('[Image: unnamed]');
  });

  it('marks every image on a page, not just the first', () => {
    const text = readConfluenceStorageText(
      '<ac:image><ri:attachment ri:filename="one.png" /></ac:image><ac:image><ri:attachment ri:filename="two.png" /></ac:image>',
    );

    expect(text).toContain('[Image: one.png]');
    expect(text).toContain('[Image: two.png]');
  });

  it('leaves a page with no images exactly as it was', () => {
    expect(readConfluenceStorageText('<p>Just words</p>')).toBe('Just words');
  });
});
