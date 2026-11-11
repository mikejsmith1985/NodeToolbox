// promptFile.ts — Turns an AI prompt too long for Google AI Mode's message box into a file to attach (pure).
//
// GH #499: AI Mode's message box takes 2,048 characters and silently drops the rest. Every useful prompt (the risk
// check alone is ~44,000 characters) is longer than that, and splitting into parts fails the same way. AI Mode can
// attach files, so a long prompt goes in as a PDF, sent with a short message that asks for the request inside it to be
// answered. The PDF is written here by hand. Article VII drift: no PDF writer is a dependency (pdfjs-dist only
// READS PDFs), and a plain-text page needs only Courier, so a ~100-line writer beats a new package in a single-file build.

// ── Named constants ──

/** The most Google's AI Mode message box takes; what is pasted past this is silently dropped. */
export const AI_MODE_MESSAGE_CHARACTER_LIMIT = 2_048;

// US Letter, in PDF points (1/72 inch).
const PAGE_WIDTH_POINTS = 612;
const PAGE_HEIGHT_POINTS = 792;
const PAGE_MARGIN_POINTS = 36;
const FONT_SIZE_POINTS = 9;
const LINE_HEIGHT_POINTS = 11;
// Courier is fixed-width: every character is 0.6 of the font size wide, so a line holds a known count of characters.
const COURIER_CHARACTER_WIDTH_RATIO = 0.6;
const CHARACTERS_PER_LINE = Math.floor((PAGE_WIDTH_POINTS - (2 * PAGE_MARGIN_POINTS)) / (FONT_SIZE_POINTS * COURIER_CHARACTER_WIDTH_RATIO));
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT_POINTS - (2 * PAGE_MARGIN_POINTS)) / LINE_HEIGHT_POINTS);
// The highest character code written as itself; anything above is written as an octal escape.
const HIGHEST_PLAIN_CHARACTER_CODE = 126;
const LOWEST_PLAIN_CHARACTER_CODE = 32;
// Characters outside the PDF's WinAnsi encoding, spelled out so their meaning survives.
const SPELLED_OUT_CHARACTERS: Readonly<Record<string, string>> = {
  '→': '->', '←': '<-', '⇒': '=>', '✓': '[x]', '✔': '[x]', '✗': '[ ]', '✘': '[ ]', '≥': '>=', '≤': '<=', '⚠': '(!)',
};
// Typographic marks the PDF's WinAnsi encoding carries at its own codes (Latin-1 covers the rest up to 255).
const WIN_ANSI_CHARACTER_CODES: Readonly<Record<string, number>> = {
  '€': 0x80, '‚': 0x82, '„': 0x84, '…': 0x85, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96,
  '—': 0x97, '™': 0x99,
};
// Latin-1's printable letters (é, ü, ·) share their codes with WinAnsi.
const LOWEST_LATIN1_PRINTABLE_CODE = 160;
const HIGHEST_LATIN1_CHARACTER_CODE = 255;
const UNKNOWN_CHARACTER_TEXT = '?';
const TAB_AS_SPACES = '    ';
const XREF_OFFSET_DIGITS = 10;

// ── Message and size ──

/** True when a prompt is longer than AI Mode's message box takes, so it must go in as a file. */
export function isPromptTooLongToPaste(promptText: string): boolean {
  return promptText.length > AI_MODE_MESSAGE_CHARACTER_LIMIT;
}

/** The short message sent with the attached prompt file — always within AI Mode's box. */
export function buildPromptFileMessage(fileName: string): string {
  return `The attached file "${fileName}" is my complete request. Read every page of it, then follow its instructions `
    + 'exactly, including the reply format it asks for at the end. Do not summarise the file — answer the request in it.';
}

// ── PDF text ──

/** One character as the PDF's text writes it: itself, an octal escape for its WinAnsi code, or spelled out. */
function encodePdfCharacter(character: string): string {
  if (character === '\\' || character === '(' || character === ')') return `\\${character}`;
  if (SPELLED_OUT_CHARACTERS[character]) return SPELLED_OUT_CHARACTERS[character];
  const characterCode = WIN_ANSI_CHARACTER_CODES[character] ?? character.charCodeAt(0);
  if (characterCode >= LOWEST_PLAIN_CHARACTER_CODE && characterCode <= HIGHEST_PLAIN_CHARACTER_CODE) return character;
  const isWinAnsi = WIN_ANSI_CHARACTER_CODES[character] !== undefined
    || (characterCode >= LOWEST_LATIN1_PRINTABLE_CODE && characterCode <= HIGHEST_LATIN1_CHARACTER_CODE);
  return isWinAnsi ? `\\${characterCode.toString(8).padStart(3, '0')}` : UNKNOWN_CHARACTER_TEXT;
}

/** A line of the prompt broken into pieces that each fit across the page — nothing past the margin is lost. */
function wrapLine(lineText: string): string[] {
  const characters = Array.from(lineText.replace(/\t/g, TAB_AS_SPACES));
  if (characters.length === 0) return [''];
  const wrappedLines: string[] = [];
  let remainingCharacters = characters;
  while (remainingCharacters.length > CHARACTERS_PER_LINE) {
    // Break after the last space that fits, so words stay whole; a single word longer than a line is cut.
    const lastSpaceIndex = remainingCharacters.lastIndexOf(' ', CHARACTERS_PER_LINE);
    const breakIndex = lastSpaceIndex > 0 ? lastSpaceIndex + 1 : CHARACTERS_PER_LINE;
    wrappedLines.push(remainingCharacters.slice(0, breakIndex).join(''));
    remainingCharacters = remainingCharacters.slice(breakIndex);
  }
  wrappedLines.push(remainingCharacters.join(''));
  return wrappedLines;
}

/** The prompt as page-sized groups of printed lines. */
function layOutPages(promptText: string): string[][] {
  const printedLines = promptText.replace(/\r\n?/g, '\n').split('\n').flatMap(wrapLine);
  const pages: string[][] = [];
  for (let startIndex = 0; startIndex < printedLines.length; startIndex += LINES_PER_PAGE) {
    pages.push(printedLines.slice(startIndex, startIndex + LINES_PER_PAGE));
  }
  return pages.length > 0 ? pages : [['']];
}

/** One page's drawing instructions: every line, top to bottom, in 9-point Courier. */
function buildPageContent(pageLines: readonly string[]): string {
  const firstBaseline = PAGE_HEIGHT_POINTS - PAGE_MARGIN_POINTS - FONT_SIZE_POINTS;
  const lineInstructions = pageLines.map((pageLine) => `(${Array.from(pageLine).map(encodePdfCharacter).join('')}) Tj T*`);
  return ['BT', `/F1 ${FONT_SIZE_POINTS} Tf`, `${LINE_HEIGHT_POINTS} TL`, `${PAGE_MARGIN_POINTS} ${firstBaseline} Td`, ...lineInstructions, 'ET'].join('\n');
}

// ── PDF file ──

/** The PDF's objects in order: catalog, page tree, font, then a page and its content for every page. */
function buildPdfObjects(pages: readonly string[][]): string[] {
  const firstPageObjectNumber = 4;
  const pageObjectNumbers = pages.map((_page, pageIndex) => firstPageObjectNumber + (pageIndex * 2));
  const pageObjects = pages.flatMap((pageLines, pageIndex) => {
    const contentText = buildPageContent(pageLines);
    return [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH_POINTS} ${PAGE_HEIGHT_POINTS}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObjectNumbers[pageIndex] + 1} 0 R >>`,
      `<< /Length ${contentText.length} >>\nstream\n${contentText}\nendstream`,
    ];
  });
  return [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((objectNumber) => `${objectNumber} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
    ...pageObjects,
  ];
}

/**
 * The prompt as a PDF file's bytes: plain Courier text, wrapped to the page, that any PDF reader (and AI Mode's file
 * attachment) reads back as text. Every byte is ASCII — characters above it are octal escapes — so a string's length
 * is its byte length and the cross-reference offsets are exact.
 */
export function buildPromptPdfBytes(promptText: string): Uint8Array {
  const pdfObjects = buildPdfObjects(layOutPages(promptText));
  let pdfText = '%PDF-1.4\n';
  const objectOffsets: number[] = [];
  pdfObjects.forEach((objectBody, objectIndex) => {
    objectOffsets.push(pdfText.length);
    pdfText += `${objectIndex + 1} 0 obj\n${objectBody}\nendobj\n`;
  });
  const xrefOffset = pdfText.length;
  const xrefLines = objectOffsets.map((objectOffset) => `${String(objectOffset).padStart(XREF_OFFSET_DIGITS, '0')} 00000 n \n`);
  pdfText += `xref\n0 ${pdfObjects.length + 1}\n0000000000 65535 f \n${xrefLines.join('')}`;
  pdfText += `trailer\n<< /Size ${pdfObjects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Uint8Array.from(pdfText, (character) => character.charCodeAt(0));
}
