// outlookMessageSource.ts — Reading a saved Outlook message (.msg) as reference material.
//
// A great deal of what a Feature has to be written from was decided in email, and the record of it is
// a folder of .msg files somebody dragged out of Outlook. Forwarding them somewhere readable loses the
// thread; pasting them by hand loses the sender and the date, which are usually the two facts that
// settle an argument about what was agreed and when.
//
// A .msg is an OLE2 compound file — the same container as a legacy .xls — holding one stream per MAPI
// property. That container parser ALREADY SHIPS as `cfb`, so the work here is not reading the file
// format; it is knowing which of several hundred property streams carry the six things a person
// actually needs, and in which of several encodings.
//
// Two rules make it reliable rather than lucky:
//
//   - EVERY TEXT PROPERTY IS TRIED IN BOTH ENCODINGS. The same property exists as `…001F` (UTF-16) and
//     `…001E` (8-bit), and which one an .msg carries depends on the Outlook that saved it. Reading only
//     one of them works perfectly until somebody hands you a file from a different mail client.
//   - THE HTML BODY IS A FALLBACK, NOT A PREFERENCE. A plain-text body is already what we want; the
//     HTML one has to be reduced, and reducing markup we did not have to touch is a way to lose things.
//
// Pure aside from the container parse: no fetch, no storage, no clock.

import { convertPastedHtmlToText } from './pastedRichText.ts';
import { mintSourceId, type EmailSource, type ReferencedSource } from './sourceModel';

/** What the file picker and dropzone accept for a saved message. */
export const EMAIL_FILE_ACCEPT = '.msg';

/** An OLE2 compound file begins with this, whatever the file is named. */
const COMPOUND_FILE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0];

/** Thrown when a message cannot be read, so the tab can say something a PO understands. */
export class OutlookMessageReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutlookMessageReadError';
  }
}

/**
 * The MAPI property tags this reader looks for, by what they mean rather than by their number.
 *
 * The four hex digits are the property id; the encoding suffix is appended when the stream is looked
 * up, because the same property is stored under two different names depending on the encoding.
 */
const PROPERTY_IDS = {
  subject: '0037',
  senderName: '0C1A',
  senderEmail: '0C1F',
  displayTo: '0E04',
  displayCc: '0E03',
  plainBody: '1000',
  transportHeaders: '007D',
} as const;

/** The two text encodings a MAPI string property can be stored in: UTF-16, then 8-bit. */
const TEXT_ENCODING_SUFFIXES = ['001F', '001E'] as const;

/** The HTML body, which is stored as bytes rather than as a string property. */
const HTML_BODY_STREAM_SUFFIX = '10130102';

/** One entry in the compound file, reduced to what this reader needs. */
export interface CompoundFileEntry {
  name: string;
  content: Uint8Array | number[];
}

/** Decodes a UTF-16 little-endian property stream, which is how Outlook stores Unicode text. */
function decodeUtf16(contentBytes: Uint8Array): string {
  const characters: string[] = [];
  for (let byteIndex = 0; byteIndex + 1 < contentBytes.length; byteIndex += 2) {
    characters.push(String.fromCharCode(contentBytes[byteIndex] | (contentBytes[byteIndex + 1] << 8)));
  }
  return characters.join('');
}

/** Decodes an 8-bit property stream, the encoding older senders still produce. */
function decodeSingleByte(contentBytes: Uint8Array): string {
  return new TextDecoder('windows-1252', { fatal: false }).decode(contentBytes);
}

/** A stream's bytes, whichever array shape the container parser handed back. */
function readEntryBytes(entry: CompoundFileEntry): Uint8Array {
  return entry.content instanceof Uint8Array ? entry.content : new Uint8Array(entry.content);
}

/**
 * Reads one text property, trying UTF-16 first and 8-bit second.
 *
 * Trying both is what makes this work on a message saved by something other than the Outlook build
 * that happened to be tested — reading only the Unicode form succeeds right up until it silently does not.
 */
export function readTextProperty(entries: readonly CompoundFileEntry[], propertyId: string): string {
  for (const encodingSuffix of TEXT_ENCODING_SUFFIXES) {
    const streamName = `__substg1.0_${propertyId}${encodingSuffix}`;
    const entry = entries.find((candidate) => candidate.name.toUpperCase().endsWith(streamName.toUpperCase()));
    if (entry === undefined) {
      continue;
    }
    const contentBytes = readEntryBytes(entry);
    const decoded = encodingSuffix === '001F' ? decodeUtf16(contentBytes) : decodeSingleByte(contentBytes);
    if (decoded.trim() !== '') {
      return decoded.trim();
    }
  }
  return '';
}

/** Reads the HTML body and reduces it to text, reusing the table-preserving converter. */
function readHtmlBody(entries: readonly CompoundFileEntry[]): string {
  const entry = entries.find((candidate) => candidate.name.toUpperCase().endsWith(HTML_BODY_STREAM_SUFFIX));
  if (entry === undefined) {
    return '';
  }
  return convertPastedHtmlToText(decodeSingleByte(readEntryBytes(entry)));
}

/**
 * Reads the date the message was sent from its transport headers.
 *
 * The headers are used rather than the binary `PR_CLIENT_SUBMIT_TIME` property because the header is a
 * string this can read directly, while the property is a Windows FILETIME buried in a packed stream —
 * far more code for a date that is already written down in plain words a few streams away.
 *
 * Returns the header's own text rather than a parsed date: a date that failed to parse should read as
 * the sender wrote it, not disappear.
 */
export function readSentDate(transportHeaders: string): string {
  const dateHeaderMatch = /^Date:\s*(.+)$/im.exec(transportHeaders);
  return dateHeaderMatch === null ? '' : dateHeaderMatch[1].trim();
}

/**
 * Assembles the message into readable text, headed by who sent it and when.
 *
 * The header lines are part of the text rather than metadata beside it, because this text is what
 * rides into a prompt: an assistant reading "we agreed to defer runout" needs to know who said it and
 * when, and a field on a record it never sees cannot tell it.
 */
export function buildMessageText(message: {
  subject: string;
  senderName: string;
  senderEmail: string;
  displayTo: string;
  displayCc: string;
  sentDate: string;
  body: string;
}): string {
  const senderLine = message.senderEmail === '' || message.senderEmail === message.senderName
    ? message.senderName
    : `${message.senderName} <${message.senderEmail}>`;

  const headerLines = [
    message.subject === '' ? '' : `Subject: ${message.subject}`,
    senderLine.trim() === '' ? '' : `From: ${senderLine}`,
    message.displayTo === '' ? '' : `To: ${message.displayTo}`,
    message.displayCc === '' ? '' : `Cc: ${message.displayCc}`,
    message.sentDate === '' ? '' : `Sent: ${message.sentDate}`,
  ].filter((line) => line !== '');

  return [...headerLines, '', message.body].join('\n').trim();
}

/** Rejects a file whose first bytes are not a compound file's, however it happens to be named. */
function assertLooksLikeCompoundFile(fileData: ArrayBuffer): void {
  const leadingBytes = new Uint8Array(fileData.slice(0, COMPOUND_FILE_SIGNATURE.length));
  const isCompoundFile = COMPOUND_FILE_SIGNATURE.every(
    (expectedByte, byteIndex) => leadingBytes[byteIndex] === expectedByte,
  );
  if (!isCompoundFile) {
    throw new OutlookMessageReadError(
      'That file is not a saved Outlook message — its contents do not start the way a .msg does. An email '
        + 'saved as .eml or .txt is a different format; paste its text in as a note instead.',
    );
  }
}

/** Everything worth keeping from one message's property streams. */
export function readMessageFromEntries(entries: readonly CompoundFileEntry[]): {
  subject: string;
  senderName: string;
  senderEmail: string;
  displayTo: string;
  displayCc: string;
  sentDate: string;
  body: string;
} {
  const plainBody = readTextProperty(entries, PROPERTY_IDS.plainBody);

  return {
    subject: readTextProperty(entries, PROPERTY_IDS.subject),
    senderName: readTextProperty(entries, PROPERTY_IDS.senderName),
    senderEmail: readTextProperty(entries, PROPERTY_IDS.senderEmail),
    displayTo: readTextProperty(entries, PROPERTY_IDS.displayTo),
    displayCc: readTextProperty(entries, PROPERTY_IDS.displayCc),
    sentDate: readSentDate(readTextProperty(entries, PROPERTY_IDS.transportHeaders)),
    // The plain body is already what we want; the HTML one has to be reduced, and reducing markup we
    // did not have to touch is a way to lose things.
    body: plainBody !== '' ? plainBody : readHtmlBody(entries),
  };
}

/** The shape this reader needs from the container parser, named so it can be tested without one. */
export interface CompoundFileReader {
  (fileData: ArrayBuffer): Promise<CompoundFileEntry[]>;
}

/** The one entry field this reader reads, described without pulling in `cfb`'s absent types. */
interface CompoundFileIndexEntry {
  name?: unknown;
  content?: Uint8Array | number[];
}

/**
 * Reads the compound file's entries using `cfb`.
 *
 * Loaded by dynamic import, matching how SheetJS is used here — most sessions never open a message,
 * so the parser's weight stays out of the main bundle.
 */
async function readCompoundFileEntries(fileData: ArrayBuffer): Promise<CompoundFileEntry[]> {
  const cfb = await import('cfb');
  const container = cfb.read(new Uint8Array(fileData), { type: 'array' }) as { FileIndex: CompoundFileIndexEntry[] };
  return container.FileIndex.map((entry) => ({ name: String(entry.name ?? ''), content: entry.content ?? [] }));
}

/**
 * Reads a saved Outlook message into a source the workspace can carry.
 *
 * The container reader is injectable so this is testable without a real .msg on disk.
 */
export async function readOutlookMessageSource(
  file: File,
  existingSources: readonly ReferencedSource[],
  readEntries: CompoundFileReader = readCompoundFileEntries,
): Promise<EmailSource> {
  const fileData = await file.arrayBuffer();
  assertLooksLikeCompoundFile(fileData);

  let message: ReturnType<typeof readMessageFromEntries>;
  try {
    message = readMessageFromEntries(await readEntries(fileData));
  } catch (thrownError) {
    const reason = thrownError instanceof Error ? thrownError.message : String(thrownError);
    throw new OutlookMessageReadError(`"${file.name}" could not be read as an Outlook message: ${reason}`);
  }

  if (message.body.trim() === '' && message.subject.trim() === '') {
    throw new OutlookMessageReadError(
      `"${file.name}" is a saved message with no subject and no readable body — there is nothing in it to read.`,
    );
  }

  return {
    kind: 'email',
    id: mintSourceId(existingSources, 'email'),
    fileName: file.name,
    subject: message.subject,
    senderName: message.senderName,
    sentDate: message.sentDate,
    text: buildMessageText(message),
  };
}
