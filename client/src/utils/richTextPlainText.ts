// richTextPlainText.ts — Converts rich/encoded Jira and ServiceNow text payloads into clean plain text.

const HTML_TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/g;
const NUMERIC_HTML_ENTITY_PATTERN = /&#(x?[0-9a-fA-F]+);?/g;
const NAMED_HTML_ENTITY_LOOKUP: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': '\'',
};

function isRecord(candidateValue: unknown): candidateValue is Record<string, unknown> {
  return typeof candidateValue === 'object' && candidateValue !== null;
}

function collectDocumentText(documentNode: unknown): string {
  if (!isRecord(documentNode)) return '';
  const nodeText = typeof documentNode.text === 'string' ? documentNode.text : '';
  const contentNodes = Array.isArray(documentNode.content) ? documentNode.content : [];
  const childNodeText = contentNodes.map(collectDocumentText).filter(Boolean).join(' ');
  return [nodeText, childNodeText].filter(Boolean).join(' ');
}

function decodeNumericHtmlEntity(entityBody: string): string {
  const isHexEntity = entityBody.startsWith('x') || entityBody.startsWith('X');
  const numericValue = Number.parseInt(isHexEntity ? entityBody.slice(1) : entityBody, isHexEntity ? 16 : 10);
  if (!Number.isFinite(numericValue)) return '';
  return String.fromCodePoint(numericValue);
}

function decodeHtmlEntities(encodedText: string): string {
  const withNamedEntitiesDecoded = Object.entries(NAMED_HTML_ENTITY_LOOKUP).reduce(
    (decodedText, [encodedValue, plainValue]) => decodedText.replaceAll(encodedValue, plainValue),
    encodedText,
  );

  return withNamedEntitiesDecoded.replace(NUMERIC_HTML_ENTITY_PATTERN, (_, entityBody: string) =>
    decodeNumericHtmlEntity(entityBody),
  );
}

function sanitizePlainText(rawText: string): string {
  return decodeHtmlEntities(rawText)
    .replace(HTML_TAG_PATTERN, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Normalizes Jira/SNow rich text payloads into clean plain text suitable for UI display.
 * Supports plain strings and Atlassian document-format objects.
 */
export function normalizeRichTextToPlainText(fieldValue: unknown): string {
  if (typeof fieldValue === 'string') {
    return sanitizePlainText(fieldValue);
  }
  const documentText = collectDocumentText(fieldValue);
  return sanitizePlainText(documentText);
}

