// wikiMarkup.ts — Serializes the in-house editor document into Jira (Server/DC) wiki markup.
// Pure (no I/O). Covers the core formatting set resolved in Q3=A: bold, italic, headings,
// bullet/numbered lists, links, inline code, and code blocks. Kept separate from the editor
// component so a future Cloud/ADF serializer can be swapped in behind the same document model.

/** One run of text in a paragraph/heading/list item, with optional formatting. */
export interface WikiInline {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  /** When set, the (formatted) text becomes a wiki link to this URL. */
  link?: string;
}

/** A block-level element of the document. */
export type WikiBlock =
  | { type: 'paragraph'; spans: WikiInline[] }
  | { type: 'heading'; level: 1 | 2 | 3; spans: WikiInline[] }
  | { type: 'bulletList'; items: WikiInline[][] }
  | { type: 'orderedList'; items: WikiInline[][] }
  | { type: 'codeBlock'; text: string };

/** The full editor document. */
export type WikiDoc = WikiBlock[];

/** Wraps a single inline run in its wiki-markup formatting (code → bold → italic → link). */
function serializeInline(span: WikiInline): string {
  let rendered = span.text;
  if (span.code) {
    rendered = `{{${rendered}}}`;
  }
  if (span.bold) {
    rendered = `*${rendered}*`;
  }
  if (span.italic) {
    rendered = `_${rendered}_`;
  }
  if (span.link) {
    rendered = `[${rendered}|${span.link}]`;
  }
  return rendered;
}

/** Joins a run of inline spans into a single wiki-markup string. */
function serializeSpans(spans: WikiInline[]): string {
  return spans.map(serializeInline).join('');
}

/** Serializes one block to its wiki-markup line(s). */
function serializeBlock(block: WikiBlock): string {
  switch (block.type) {
    case 'paragraph':
      return serializeSpans(block.spans);
    case 'heading':
      return `h${block.level}. ${serializeSpans(block.spans)}`;
    case 'bulletList':
      return block.items.map((item) => `* ${serializeSpans(item)}`).join('\n');
    case 'orderedList':
      return block.items.map((item) => `# ${serializeSpans(item)}`).join('\n');
    case 'codeBlock':
      return `{code}\n${block.text}\n{code}`;
    default:
      return '';
  }
}

/**
 * Serializes an editor document to Jira wiki markup. Blocks are separated by a blank line so
 * paragraphs, headings, lists, and code blocks render as distinct elements in Jira.
 */
export function serializeWikiMarkup(doc: WikiDoc): string {
  return doc.map(serializeBlock).join('\n\n');
}
