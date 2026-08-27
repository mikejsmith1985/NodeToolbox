// pdfSource.test.ts — Reading a PDF without losing the page a requirement came from.

import { describe, expect, it } from 'vitest';

import {
  assemblePageText,
  buildPdfDocumentText,
  isPdfTextEmpty,
  PdfReadError,
  readPdfPageTexts,
  readPdfSource,
  readTextItems,
  type PdfDocumentLoader,
} from './pdfSource.ts';

/** A File whose bytes start the way a PDF's do. */
function pdfFile(name = 'spec.pdf'): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])], name);
}

/** A File that is plainly not a PDF, whatever it is called. */
function notAPdfFile(name = 'spec.pdf'): File {
  return new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], name);
}

/** A loader standing in for pdf.js, serving the given pages. */
function loaderFor(pages: readonly { str: string; hasEOL?: boolean }[][]): PdfDocumentLoader {
  return async () => ({
    numPages: pages.length,
    getPage: async (pageNumber: number) => ({
      getTextContent: async () => ({ items: pages[pageNumber - 1] }),
    }),
  });
}

describe('assemblePageText', () => {
  it('breaks lines where pdf.js says a line ended', () => {
    // Inferring breaks from coordinates scrambles a two-column layout; pdf.js already knows.
    const text = assemblePageText([
      { str: 'The system shall' },
      { str: ' accept enrollment.', hasEOL: true },
      { str: 'It shall reject duplicates.', hasEOL: true },
    ]);

    expect(text).toBe('The system shall accept enrollment.\nIt shall reject duplicates.');
  });

  it('keeps a trailing run that never reported a line end', () => {
    expect(assemblePageText([{ str: 'Last words with no EOL' }])).toBe('Last words with no EOL');
  });

  it('drops the blank lines a PDF leaves between paragraphs', () => {
    const text = assemblePageText([
      { str: 'One', hasEOL: true },
      { str: '   ', hasEOL: true },
      { str: 'Two', hasEOL: true },
    ]);

    expect(text).toBe('One\nTwo');
  });

  it('renders a page with nothing on it as empty rather than as whitespace', () => {
    expect(assemblePageText([])).toBe('');
  });
});

describe('readTextItems', () => {
  it('ignores the marked-content markers pdf.js emits alongside text', () => {
    // They are structural boundaries with no words in them, and no `str` — assembling them would put
    // runs of "undefined" through the middle of a page.
    const items = readTextItems([{ str: 'Real text' }, { type: 'beginMarkedContent' }, null, 'loose string']);

    expect(items).toEqual([{ str: 'Real text' }]);
  });
});

describe('buildPdfDocumentText', () => {
  it('marks each page, because "page 12 says X" is how a specification gets cited', () => {
    const text = buildPdfDocumentText(['First page words', 'Second page words']);

    expect(text).toContain('--- Page 1 ---');
    expect(text).toContain('--- Page 2 ---');
    expect(text.indexOf('First page words')).toBeLessThan(text.indexOf('--- Page 2 ---'));
  });

  it('numbers an empty page rather than skipping it, so later pages keep their numbers', () => {
    // An off-by-one in a citation is worse than a blank section.
    const text = buildPdfDocumentText(['One', '', 'Three']);

    expect(text).toContain('--- Page 2 ---\n(no text on this page)');
    expect(text).toContain('--- Page 3 ---\nThree');
  });
});

describe('isPdfTextEmpty', () => {
  it('is true for a document whose every page came back blank', () => {
    expect(isPdfTextEmpty(['', '   ', ''])).toBe(true);
  });

  it('is false when even one page had words on it', () => {
    expect(isPdfTextEmpty(['', 'a requirement'])).toBe(false);
  });
});

describe('readPdfPageTexts', () => {
  it('reads every page, in order', async () => {
    const pageTexts = await readPdfPageTexts(
      new ArrayBuffer(8),
      loaderFor([[{ str: 'Page one', hasEOL: true }], [{ str: 'Page two', hasEOL: true }]]),
    );

    expect(pageTexts).toEqual(['Page one', 'Page two']);
  });
});

describe('readPdfSource', () => {
  it('reads a PDF into a source that keeps its page count', async () => {
    const source = await readPdfSource(
      pdfFile('enrollment-spec.pdf'),
      [],
      loaderFor([[{ str: 'Requirement one', hasEOL: true }], [{ str: 'Requirement two', hasEOL: true }]]),
    );

    expect(source.kind).toBe('pdf');
    expect(source.fileName).toBe('enrollment-spec.pdf');
    expect(source.pageCount).toBe(2);
    expect(source.text).toContain('--- Page 2 ---');
  });

  it('refuses a file that is not a PDF however it is named', async () => {
    // SheetJS taught this lesson: a forgiving parser turns a renamed file into convincing nonsense.
    await expect(readPdfSource(notAPdfFile(), [], loaderFor([[{ str: 'x' }]])))
      .rejects.toThrow(PdfReadError);
  });

  it('says a PDF with no text is almost certainly a scan, rather than adding an empty source', async () => {
    // A scan is a picture of words. pdf.js finds nothing and succeeds; adding it would put a document
    // in the workspace that silently contributes nothing to every prompt it rides in.
    await expect(readPdfSource(pdfFile(), [], loaderFor([[], []])))
      .rejects.toThrow(/almost certainly a scan/);
  });

  it('reports a parser failure against the file that caused it', async () => {
    const failingLoader: PdfDocumentLoader = async () => {
      throw new Error('password required');
    };

    await expect(readPdfSource(pdfFile('locked.pdf'), [], failingLoader))
      .rejects.toThrow(/"locked.pdf" could not be read as a PDF: password required/);
  });

  it('mints an id that does not collide with material already in the workspace', async () => {
    const existing = [{ kind: 'pdf' as const, id: 'pdf-1', fileName: 'a.pdf', pageCount: 1, text: 'x' }];

    const source = await readPdfSource(pdfFile(), existing, loaderFor([[{ str: 'words' }]]));

    expect(source.id).toBe('pdf-2');
  });
});
