// pdfSource.ts — Reading a PDF into the workspace as reference material.
//
// A requirements pack, a vendor's design note, a signed-off specification — the material a Feature is
// written from is very often a PDF, and until now the only way to get one into a prompt was to open
// it, select all, and paste, which loses its page structure and takes a person's afternoon.
//
// Two things about this reader are deliberate:
//
//   - PAGE BOUNDARIES ARE KEPT. "Page 12 says X" is how people cite a specification to each other, and
//     an extract that cannot say which page a requirement came from cannot be checked by the person
//     who has to sign it off.
//   - A PDF WITH NO TEXT IS REPORTED, NOT RETURNED EMPTY. A scanned document is a picture of words;
//     pdf.js finds nothing in it and succeeds. Handing back an empty source would put a document in
//     the workspace that silently contributes nothing to every prompt it rides in.
//
// pdf.js is loaded by dynamic import, matching how SheetJS is used here: the parser is large and most
// sessions never open a PDF, so its weight stays out of the main bundle.

import { mintSourceId, type PdfSource, type ReferencedSource } from './sourceModel';

/** What the file picker and dropzone accept for a PDF. */
export const PDF_FILE_ACCEPT = '.pdf';

/** Every PDF begins with this, whatever the file is named. */
const PDF_FILE_SIGNATURE = [0x25, 0x50, 0x44, 0x46]; // "%PDF"

/** Thrown when a PDF cannot be read, so the tab can say something a PO understands. */
export class PdfReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfReadError';
  }
}

/**
 * One piece of text pdf.js found, reduced to what assembling a page needs.
 *
 * `hasEOL` is pdf.js's own signal that a line ended here. Using it beats inferring line breaks from
 * coordinates: a two-column layout has items at wildly different positions on the same visual line,
 * and a coordinate rule turns that into scrambled prose.
 */
export interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
}

/** Assembles one page's items into text, honouring the line ends pdf.js reports. */
export function assemblePageText(items: readonly PdfTextItem[]): string {
  const lines: string[] = [];
  let currentLine = '';

  items.forEach((item) => {
    currentLine += item.str;
    if (item.hasEOL === true) {
      lines.push(currentLine.trim());
      currentLine = '';
    }
  });

  if (currentLine.trim() !== '') {
    lines.push(currentLine.trim());
  }

  return lines.filter((line) => line !== '').join('\n');
}

/**
 * Joins the pages into one readable document, each under its own page marker.
 *
 * Pages that came back empty are still numbered, so page seven is page seven whether or not page six
 * had any text on it — an off-by-one in a citation is worse than a blank section.
 */
export function buildPdfDocumentText(pageTexts: readonly string[]): string {
  return pageTexts
    .map((pageText, pageIndex) => `--- Page ${pageIndex + 1} ---\n${pageText === '' ? '(no text on this page)' : pageText}`)
    .join('\n\n');
}

/** True when a PDF yielded no words at all — almost always a scan rather than a text document. */
export function isPdfTextEmpty(pageTexts: readonly string[]): boolean {
  return pageTexts.every((pageText) => pageText.trim() === '');
}

/** Rejects a file whose first bytes are not a PDF's, however it happens to be named. */
function assertLooksLikePdf(fileData: ArrayBuffer): void {
  const leadingBytes = new Uint8Array(fileData.slice(0, PDF_FILE_SIGNATURE.length));
  const isPdf = PDF_FILE_SIGNATURE.every((expectedByte, byteIndex) => leadingBytes[byteIndex] === expectedByte);
  if (!isPdf) {
    throw new PdfReadError('That file is not a PDF — its contents do not start the way a PDF does, whatever it is named.');
  }
}

/** The shape this reader needs from pdf.js, named so the reader can be tested without loading it. */
export interface PdfDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<{ getTextContent: () => Promise<{ items: readonly unknown[] }> }>;
}

export interface PdfDocumentLoader {
  (fileData: ArrayBuffer): Promise<PdfDocument>;
}

/**
 * Keeps only the items that carry text.
 *
 * pdf.js also emits marked-content markers — structural boundaries with no words in them. They are not
 * text and have no `str`, so a page that mixes them would otherwise assemble as "undefined" runs.
 */
export function readTextItems(items: readonly unknown[]): PdfTextItem[] {
  return items.filter((item): item is PdfTextItem =>
    typeof item === 'object' && item !== null && typeof (item as PdfTextItem).str === 'string');
}

/** Loads pdf.js on demand and points it at its own worker, which Vite fingerprints for us. */
async function loadPdfDocument(fileData: ArrayBuffer): Promise<PdfDocument> {
  const pdfjs = await import('pdfjs-dist');
  const workerModuleUrl = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerModuleUrl.default;

  return pdfjs.getDocument({ data: new Uint8Array(fileData) }).promise;
}

/** Reads every page's text in order. */
export async function readPdfPageTexts(fileData: ArrayBuffer, loadDocument: PdfDocumentLoader): Promise<string[]> {
  const pdfDocument = await loadDocument(fileData);
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    const page = await pdfDocument.getPage(pageNumber);
    const textContent = await page.getTextContent();
    pageTexts.push(assemblePageText(readTextItems(textContent.items)));
  }

  return pageTexts;
}

/**
 * Reads a PDF file into a source the workspace can carry.
 *
 * The loader is injectable so the reader itself is testable; production passes the real pdf.js.
 */
export async function readPdfSource(
  file: File,
  existingSources: readonly ReferencedSource[],
  loadDocument: PdfDocumentLoader = loadPdfDocument,
): Promise<PdfSource> {
  const fileData = await file.arrayBuffer();
  assertLooksLikePdf(fileData);

  let pageTexts: string[];
  try {
    pageTexts = await readPdfPageTexts(fileData, loadDocument);
  } catch (thrownError) {
    const reason = thrownError instanceof Error ? thrownError.message : String(thrownError);
    throw new PdfReadError(`"${file.name}" could not be read as a PDF: ${reason}`);
  }

  if (isPdfTextEmpty(pageTexts)) {
    throw new PdfReadError(
      `"${file.name}" has no text in it — it is almost certainly a scan, which is a picture of words rather `
        + 'than words. Nothing here could be read, so it has not been added.',
    );
  }

  return {
    kind: 'pdf',
    id: mintSourceId(existingSources, 'pdf'),
    fileName: file.name,
    pageCount: pageTexts.length,
    text: buildPdfDocumentText(pageTexts),
  };
}
