// pastedRichText.test.ts — Keeping the shape of a pasted page, not just its words.

import { describe, expect, it } from 'vitest';

import { convertPastedHtmlToText, readPastedText, renderTableAsMarkdown } from './pastedRichText.ts';

/** Parses a fragment and hands back its first table, the way the converter finds one. */
function tableFrom(html: string): Element {
  return new DOMParser().parseFromString(html, 'text/html').querySelector('table') as Element;
}

describe('renderTableAsMarkdown', () => {
  it('keeps which column a value was in — the thing a flattened paste destroys', () => {
    // The real case: a Billing Grid comparing current states against an assumption. Every cell
    // survives a plain paste; what it meant does not.
    const markdown = renderTableAsMarkdown(tableFrom(`
      <table>
        <tr><td>Process</td><td>Blue Current State</td><td>Purple Current State</td><td>Assumption</td></tr>
        <tr><td>LIS Processing</td><td>Consolidated statements</td><td>LIS-to-Subscriber</td><td>Blue gains flexibility</td></tr>
      </table>
    `));

    expect(markdown).toBe([
      '| Process | Blue Current State | Purple Current State | Assumption |',
      '| --- | --- | --- | --- |',
      '| LIS Processing | Consolidated statements | LIS-to-Subscriber | Blue gains flexibility |',
    ].join('\n'));
  });

  it('treats the first row as the header even when it is not marked up as one', () => {
    // OneNote and Word emit header rows as ordinary <td> with bold inside, so requiring <th> would
    // leave most real tables headerless — and a Markdown table without a header is not a table.
    const markdown = renderTableAsMarkdown(tableFrom('<table><tr><td><b>A</b></td><td><b>B</b></td></tr><tr><td>1</td><td>2</td></tr></table>'));

    expect(markdown.split('\n')[1]).toBe('| --- | --- |');
  });

  it('pads a ragged row rather than dropping it', () => {
    // A short row is a real thing in a hand-maintained grid; losing it would lose content silently.
    const markdown = renderTableAsMarkdown(tableFrom('<table><tr><td>A</td><td>B</td></tr><tr><td>only</td></tr></table>'));

    expect(markdown).toContain('| only |  |');
  });

  it('escapes a pipe so one cell cannot break the table around it', () => {
    const markdown = renderTableAsMarkdown(tableFrom('<table><tr><td>a|b</td></tr></table>'));

    expect(markdown).toContain('a\\|b');
  });

  it('collapses the whitespace a rich editor leaves in a cell', () => {
    const markdown = renderTableAsMarkdown(tableFrom('<table><tr><td>  one\n  two  </td></tr></table>'));

    expect(markdown).toContain('| one two |');
  });

  it('renders nothing for a table with no rows', () => {
    expect(renderTableAsMarkdown(tableFrom('<table></table>'))).toBe('');
  });
});

describe('convertPastedHtmlToText', () => {
  it('keeps a table and the prose around it', () => {
    const text = convertPastedHtmlToText(`
      <h1>Billing Grid</h1>
      <p>Guidelines apply.</p>
      <table><tr><td>Process</td><td>State</td></tr><tr><td>LIS</td><td>Consolidated</td></tr></table>
      <p>Ask of Blue Business.</p>
    `);

    expect(text).toContain('Billing Grid');
    expect(text).toContain('| Process | State |');
    expect(text).toContain('Ask of Blue Business.');
  });

  it('does not emit a table-s cells twice', () => {
    // The walk must not also treat the cells as loose text, which would duplicate every value.
    const text = convertPastedHtmlToText('<table><tr><td>LIS Processing</td></tr></table>');

    expect(text.match(/LIS Processing/g)).toHaveLength(1);
  });

  it('keeps a list as a list, because that is a different claim from a paragraph', () => {
    const text = convertPastedHtmlToText('<ul><li>Runout is separate</li><li>Migration is separate</li></ul>');

    expect(text).toContain('- Runout is separate');
    expect(text).toContain('- Migration is separate');
  });

  it('puts paragraphs on their own lines', () => {
    const text = convertPastedHtmlToText('<p>First.</p><p>Second.</p>');

    expect(text.split('\n').filter((line) => line !== '')).toEqual(['First.', 'Second.']);
  });

  it('does not leave stacks of blank lines behind', () => {
    expect(convertPastedHtmlToText('<div><div><p>One.</p></div></div>')).toBe('One.');
  });

  it('returns nothing for an empty fragment', () => {
    expect(convertPastedHtmlToText('')).toBe('');
    expect(convertPastedHtmlToText('<p></p>')).toBe('');
  });
});

describe('readPastedText', () => {
  it('prefers the HTML flavour, which is the one carrying the tables', () => {
    const text = readPastedText('<table><tr><td>A</td><td>B</td></tr></table>', 'A B');

    expect(text).toContain('| A | B |');
  });

  it('falls back to plain text when the paste carried no HTML', () => {
    // An ordinary paste from a plain-text editor, not an error.
    expect(readPastedText('', 'just words')).toBe('just words');
  });

  it('falls back when the HTML yields nothing readable', () => {
    // An image-only paste must not blank the plain text beside it.
    expect(readPastedText('<img src="x.png">', 'the caption')).toBe('the caption');
  });

  it('falls back rather than throwing on unparseable HTML', () => {
    expect(readPastedText('<<<not html', 'the words')).toBeTruthy();
  });
});
