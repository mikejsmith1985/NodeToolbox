// docxText.test.js — Turning a Word document into text the prompts can use.
//
// A .docx is a ZIP, so it cannot travel through the relay as text — reading the response with
// .text() decodes the bytes as UTF-8 and destroys them. It arrives base64-encoded instead, and this
// is where it becomes readable again.
//
// The failure mode worth guarding is the quiet one: a document that arrives damaged, or is not a
// .docx at all, must be reported rather than turned into a page of mojibake that then gets fed to
// an assistant as if it were a standard.

'use strict';

const { readDocxTextFromBase64, isDocxFileName } = require('./docxText');

describe('isDocxFileName', () => {
  test('recognises a Word document', () => {
    expect(isDocxFileName('Enrollment Spec.docx')).toBe(true);
  });

  test('ignores case, because SharePoint preserves whatever was typed', () => {
    expect(isDocxFileName('SPEC.DOCX')).toBe(true);
  });

  test('is not fooled by a name that merely mentions docx', () => {
    expect(isDocxFileName('how-to-write-docx.txt')).toBe(false);
    expect(isDocxFileName('docx')).toBe(false);
  });

  test('refuses the older binary .doc, which this cannot read', () => {
    // A different format entirely. Accepting it would produce an error deep in the parser instead of
    // a plain "cannot read this" at the point somebody chose the file.
    expect(isDocxFileName('Legacy.doc')).toBe(false);
  });
});

describe('readDocxTextFromBase64', () => {
  test('reports damaged content rather than returning mojibake', async () => {
    // The quiet failure: text that is technically a string, is meaningless, and would be fed to an
    // assistant as if it were a standard. Refusing is the only honest answer.
    await expect(readDocxTextFromBase64(Buffer.from('not a zip at all').toString('base64')))
      .rejects.toThrow(/could not be read/i);
  });

  test('reports an empty payload plainly', async () => {
    await expect(readDocxTextFromBase64('')).rejects.toThrow(/could not be read/i);
  });

  test('reads a real Word document into its text', async () => {
    // Built here rather than committed as a fixture binary, so what is being parsed is visible.
    const documentBase64 = await buildMinimalDocxBase64('The contrast ratio must be at least 4.5 to 1.');
    const text = await readDocxTextFromBase64(documentBase64);

    expect(text).toContain('The contrast ratio must be at least 4.5 to 1.');
  });

  test('keeps paragraphs apart rather than running them into one line', async () => {
    const documentBase64 = await buildMinimalDocxBase64('First paragraph.', 'Second paragraph.');
    const text = await readDocxTextFromBase64(documentBase64);

    expect(text).toMatch(/First paragraph\.[\s\S]*Second paragraph\./);
    expect(text).not.toContain('First paragraph.Second paragraph.');
  });
});

/**
 * Builds the smallest genuine .docx holding the given paragraphs, as base64.
 *
 * A real ZIP with the two parts Word requires, so the test exercises the actual parser rather than a
 * stub of it.
 */
function buildMinimalDocxBase64(...paragraphs) {
  const JSZip = require('jszip');
  const zip = new JSZip();

  zip.file('[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Override PartName="/word/document.xml" '
    + 'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '</Types>');

  zip.folder('_rels').file('.rels',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" '
    + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
    + 'Target="word/document.xml"/></Relationships>');

  const bodyXml = paragraphs
    .map((paragraph) => `<w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p>`)
    .join('');
  zip.folder('word').file('document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${bodyXml}</w:body></w:document>`);

  return zip.generateAsync({ type: 'base64' });
}
