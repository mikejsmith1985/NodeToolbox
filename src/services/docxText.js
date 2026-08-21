// docxText.js — Turning a Word document into text the prompts can use.
//
// A .docx is a ZIP, so it cannot travel through the relay as text: reading the response with
// .text() decodes the bytes as UTF-8 and destroys them. It arrives base64-encoded instead, and this
// is where it becomes readable again.
//
// The conversion itself is mammoth's, not ours. A .docx is a solved problem with a long tail —
// numbered lists, tables, footnotes, styles — and hand-rolling a ZIP reader to pull `document.xml`
// out would work on the first document somebody tried and quietly mangle the fourth.
//
// The failure mode this guards is the quiet one. A payload that is damaged, or was never a .docx,
// must be REFUSED — a page of mojibake is still a string, and would be handed to an assistant as if
// it were a standard.

'use strict';

const mammoth = require('mammoth');

/** Whether a file name is a Word document this can read. */
function isDocxFileName(fileName) {
  return String(fileName || '').toLowerCase().endsWith('.docx');
}

/**
 * Reads a base64-encoded .docx into plain text.
 *
 * Paragraphs are kept apart: mammoth returns them newline-separated, and running them together
 * would turn a structured document into one unreadable line the moment it reached a prompt.
 *
 * @param {string} base64Content - the document's bytes, base64-encoded by the relay
 * @returns {Promise<string>}
 */
async function readDocxTextFromBase64(base64Content) {
  const encoded = String(base64Content || '').trim();
  if (encoded === '') {
    throw new Error('That document could not be read — nothing came back from SharePoint.');
  }

  let extracted;
  try {
    extracted = await mammoth.extractRawText({ buffer: Buffer.from(encoded, 'base64') });
  } catch (parseError) {
    const detail = parseError instanceof Error ? parseError.message : String(parseError);
    throw new Error(`That document could not be read as a Word file — ${detail}`);
  }

  return String((extracted && extracted.value) || '').trim();
}

module.exports = { isDocxFileName, readDocxTextFromBase64 };
