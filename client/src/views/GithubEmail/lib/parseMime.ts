// parseMime.ts — A minimal, dependency-free RFC-822/MIME reader for GitHub notification emails.
//
// GitHub notification emails are regular, well-formed messages (ASCII headers; a single text/plain
// body or a multipart/alternative of text/plain + text/html; quoted-printable or base64 encoding).
// A full MIME library is unwarranted, so this hand-rolls exactly the pieces those emails use. It runs
// in BOTH the browser (client unit tests) and the Node server (bundled engine), so it relies only on
// cross-environment primitives (atob, TextDecoder) — never Node's Buffer.

/** A parsed MIME message: headers plus whichever body parts were present. */
export interface MimeMessage {
  /** Lower-cased header name → all values for that header, in order. */
  headers: Map<string, string[]>;
  /** Decoded text/plain body, or null when the message had none. */
  textPlain: string | null;
  /** Decoded text/html body, or null when the message had none. */
  textHtml: string | null;
}

/** Returns the first value of a header (case-insensitive), or null when absent. */
export function getHeader(message: MimeMessage, headerName: string): string | null {
  const values = message.headers.get(headerName.toLowerCase());
  return values && values.length > 0 ? values[0] : null;
}

/** Splits raw source into the header block and the body at the first blank line. */
function splitHeadersAndBody(rawSource: string): { headerBlock: string; body: string } {
  const normalized = rawSource.replace(/\r\n/g, '\n');
  const separatorIndex = normalized.indexOf('\n\n');
  if (separatorIndex === -1) {
    return { headerBlock: normalized, body: '' };
  }
  return {
    headerBlock: normalized.slice(0, separatorIndex),
    body: normalized.slice(separatorIndex + 2),
  };
}

/** Parses a header block into a name→values map, unfolding continuation (folded) lines. */
function parseHeaderBlock(headerBlock: string): Map<string, string[]> {
  const headers = new Map<string, string[]>();
  const unfoldedLines: string[] = [];
  for (const line of headerBlock.split('\n')) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfoldedLines.length > 0) {
      // A folded continuation of the previous header value.
      unfoldedLines[unfoldedLines.length - 1] += ' ' + line.trim();
    } else if (line.trim() !== '') {
      unfoldedLines.push(line);
    }
  }
  for (const line of unfoldedLines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) {
      continue;
    }
    const name = line.slice(0, colonIndex).trim().toLowerCase();
    const value = decodeEncodedWords(line.slice(colonIndex + 1).trim());
    const existing = headers.get(name);
    if (existing) {
      existing.push(value);
    } else {
      headers.set(name, [value]);
    }
  }
  return headers;
}

/** Decodes a base64 string to text, treating the decoded bytes as UTF-8. Cross-environment. */
function decodeBase64ToText(base64Value: string): string {
  const cleaned = base64Value.replace(/\s+/g, '');
  if (cleaned === '') {
    return '';
  }
  try {
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return base64Value;
  }
}

/** Decodes quoted-printable body text: =XX hex bytes (UTF-8 aware) and soft line breaks. */
function decodeQuotedPrintable(value: string): string {
  // Drop soft line breaks first ("=" at end of a line).
  const withoutSoftBreaks = value.replace(/=\r?\n/g, '');
  const byteValues: number[] = [];
  for (let index = 0; index < withoutSoftBreaks.length; index += 1) {
    const character = withoutSoftBreaks[index];
    if (character === '=' && index + 2 < withoutSoftBreaks.length) {
      const hex = withoutSoftBreaks.slice(index + 1, index + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        byteValues.push(parseInt(hex, 16));
        index += 2;
        continue;
      }
    }
    // Ordinary character — push its UTF-8 bytes (charCodeAt is fine for the ASCII the body uses).
    byteValues.push(character.charCodeAt(0) & 0xff);
  }
  return new TextDecoder('utf-8').decode(new Uint8Array(byteValues));
}

/** Decodes a part's body according to its Content-Transfer-Encoding header. */
function decodePartBody(body: string, contentTransferEncoding: string | null): string {
  const encoding = (contentTransferEncoding || '').trim().toLowerCase();
  if (encoding === 'base64') {
    return decodeBase64ToText(body);
  }
  if (encoding === 'quoted-printable') {
    return decodeQuotedPrintable(body);
  }
  return body; // 7bit / 8bit / binary / none — already plain text
}

/** Decodes RFC-2047 encoded words (=?charset?B/Q?text?=) commonly used in Subject lines. */
function decodeEncodedWords(headerValue: string): string {
  return headerValue.replace(/=\?[^?]+\?([BbQq])\?([^?]*)\?=/g, (_match, encodingLetter, encodedText) => {
    if (encodingLetter.toUpperCase() === 'B') {
      return decodeBase64ToText(encodedText);
    }
    // Q-encoding: like quoted-printable but "_" means space.
    return decodeQuotedPrintable(encodedText.replace(/_/g, ' '));
  });
}

/** Reads the Content-Type of a header map, returning its media type and boundary (if any). */
function readContentType(headers: Map<string, string[]>): { mediaType: string; boundary: string | null } {
  const rawContentType = (headers.get('content-type') || [''])[0] || '';
  const mediaType = rawContentType.split(';')[0].trim().toLowerCase();
  const boundaryMatch = rawContentType.match(/boundary="?([^";]+)"?/i);
  return { mediaType, boundary: boundaryMatch ? boundaryMatch[1] : null };
}

/** Assigns a decoded part body to textPlain or textHtml on the result, by media type. */
function assignPart(result: MimeMessage, mediaType: string, decodedBody: string): void {
  if (mediaType.startsWith('text/plain') && result.textPlain === null) {
    result.textPlain = decodedBody;
  } else if (mediaType.startsWith('text/html') && result.textHtml === null) {
    result.textHtml = decodedBody;
  }
}

/**
 * Parses one multipart body into its parts, assigning text/plain and text/html.
 *
 * Only one level of nesting is handled directly; a nested multipart part is descended into once,
 * which covers the multipart/mixed → multipart/alternative shape GitHub occasionally sends.
 */
function parseMultipart(body: string, boundary: string, result: MimeMessage, depth: number): void {
  const rawParts = body.split('--' + boundary);
  for (const rawPart of rawParts) {
    const trimmed = rawPart.replace(/^\r?\n/, '');
    if (trimmed === '' || trimmed.startsWith('--')) {
      continue; // preamble, epilogue, or the closing boundary marker
    }
    const { headerBlock, body: partBody } = splitHeadersAndBody(trimmed);
    const partHeaders = parseHeaderBlock(headerBlock);
    const { mediaType, boundary: nestedBoundary } = readContentType(partHeaders);
    if (mediaType.startsWith('multipart/') && nestedBoundary && depth < 3) {
      parseMultipart(partBody, nestedBoundary, result, depth + 1);
      continue;
    }
    // Drop the single trailing newline that precedes the part's closing boundary delimiter.
    const trimmedPartBody = partBody.replace(/\r?\n$/, '');
    const decodedBody = decodePartBody(trimmedPartBody, (partHeaders.get('content-transfer-encoding') || [null])[0]);
    assignPart(result, mediaType, decodedBody);
  }
}

/**
 * Parses a raw email source string into headers and decoded text/plain + text/html bodies.
 *
 * Never throws on malformed input — a message it cannot decode yields empty bodies and whatever
 * headers it could read, so the caller can decide to route the file to an error folder.
 */
export function parseMime(rawSource: string): MimeMessage {
  const result: MimeMessage = { headers: new Map(), textPlain: null, textHtml: null };
  const { headerBlock, body } = splitHeadersAndBody(rawSource || '');
  result.headers = parseHeaderBlock(headerBlock);

  const { mediaType, boundary } = readContentType(result.headers);
  if (mediaType.startsWith('multipart/') && boundary) {
    parseMultipart(body, boundary, result, 0);
  } else {
    const decodedBody = decodePartBody(body, getHeader(result, 'content-transfer-encoding'));
    if (mediaType.startsWith('text/html')) {
      result.textHtml = decodedBody;
    } else {
      // Default (text/plain or unspecified) → treat as plain text.
      result.textPlain = decodedBody;
    }
  }
  return result;
}
