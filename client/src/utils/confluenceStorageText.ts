// confluenceStorageText.ts — Reduces Confluence storage-format markup to readable plain text.
//
// Why this exists: the server has an equivalent stripper, but it is CommonJS under `src/` and cannot be
// imported by the React client. This is the client-side counterpart, used when a Confluence page is
// pulled into a workspace as reference material.
//
// Why text and not HTML: the page is reference reading, not something to re-render. Injecting remote
// markup would mean `dangerouslySetInnerHTML` on content this app does not control, and there is no
// sanitizer in the project — a real XSS surface for zero benefit. Text is all the workspace needs.
//
// This goes slightly further than the server's version, which only has to satisfy a machine parser:
// it also drops script/style CONTENT, breaks table cells onto their own lines, and collapses blank
// runs — because a human reads this.
//
// Images become NAMED PLACEHOLDERS rather than nothing. Stripping every tag deleted them without a
// trace, so a page whose point was an architecture diagram arrived as a gap between two bullets and
// nothing downstream could tell anything was missing. The placeholder stays where the image sat, so
// the sentences around it still say what it was for.

/** Elements whose content must never survive into the text — their bodies are not readable prose. */
const NON_CONTENT_ELEMENT_PATTERN = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Confluence wraps macros in these; the wrapper is noise but the rich-text body inside is real content. */
const MACRO_PARAMETER_PATTERN = /<ac:parameter\b[^>]*>[\s\S]*?<\/ac:parameter>/gi;

/** A line break in the source is a line break in the reading. */
const LINE_BREAK_PATTERN = /<br\s*\/?>/gi;

/** Closing a block element ends a line, matching how the rendered page reads. */
const BLOCK_ELEMENT_CLOSE_PATTERN = /<\/(p|div|h[1-6]|li|td|th|tr|blockquote)>/gi;

/** Any remaining markup, once the structural cases above have had their say. */
const ANY_TAG_PATTERN = /<[^>]+>/g;

/**
 * A Confluence image, wrapper and all.
 *
 * Matched BEFORE the general tag strip, because otherwise the strip deletes it without a trace: a page
 * whose whole point is an architecture diagram reads as a gap between two bullet points, and nothing
 * downstream can tell that anything was ever there.
 */
const IMAGE_ELEMENT_PATTERN = /<ac:image\b([^>]*)>([\s\S]*?)<\/ac:image>|<ac:image\b([^>]*)\/>/gi;

/** A plain `<img>`, which some Confluence content still carries. */
const PLAIN_IMAGE_PATTERN = /<img\b([^>]*)\/?>/gi;

/** Matches one attribute's value, with the attribute name spliced in. */
const ATTRIBUTE_VALUE_SOURCE = '\\s*=\\s*"([^"]*)"';

/** Reads one attribute's value out of a tag's attribute text. */
function readAttribute(attributeText: string, attributeName: string): string {
  const match = new RegExp(attributeName + ATTRIBUTE_VALUE_SOURCE, 'i').exec(attributeText);
  return match === null ? '' : match[1].trim();
}

/** The last path segment of a url, which is the closest thing it has to a name. */
function readUrlFileName(urlValue: string): string {
  const withoutQuery = urlValue.split('?')[0];
  return withoutQuery.slice(withoutQuery.lastIndexOf('/') + 1);
}

/**
 * Names an image as well as the markup allows: its alt text, else its file name, else its url.
 *
 * A name is what makes the placeholder useful rather than merely honest. "[Image: unnamed]" says only
 * that something is missing; "[Image: logical-architecture.png]" tells a reader — and an assistant —
 * which diagram belongs at this exact point in the notes.
 */
function describeImage(wrapperAttributes: string, innerMarkup: string): string {
  const altText = readAttribute(wrapperAttributes, 'ac:alt') || readAttribute(wrapperAttributes, 'alt');
  if (altText !== '') {
    return altText;
  }

  const fileName = readAttribute(innerMarkup, 'ri:filename');
  if (fileName !== '') {
    return fileName;
  }

  const urlValue = readAttribute(innerMarkup, 'ri:value') || readAttribute(innerMarkup, 'src');
  const urlFileName = urlValue === '' ? '' : readUrlFileName(urlValue);
  return urlFileName !== '' ? urlFileName : 'unnamed';
}

/**
 * Replaces every image with a named placeholder, in the position the image occupied.
 *
 * Position is the whole point. A diagram listed at the end of the page has lost the thing that made it
 * meaningful — which paragraph it was illustrating. Left where it sat, the surrounding sentences say
 * what it is for.
 */
function markImages(storageValue: string): string {
  const placeholderFor = (wrapperAttributes: string, innerMarkup: string): string =>
    '\n[Image: ' + describeImage(wrapperAttributes, innerMarkup) + ']\n';

  return storageValue
    .replace(IMAGE_ELEMENT_PATTERN, (_wholeMatch, pairedAttributes, innerMarkup, selfClosingAttributes) =>
      placeholderFor(pairedAttributes ?? selfClosingAttributes ?? '', innerMarkup ?? ''))
    .replace(PLAIN_IMAGE_PATTERN, (_wholeMatch, attributes) => placeholderFor(attributes, attributes));
}


/** Three or more line breaks read as a gap; two is enough, and blank-only lines add nothing. */
const BLANK_LINE_RUN_PATTERN = /\n\s*\n+/g;

/** The named entities Confluence actually emits. Ordered so `&amp;` is decoded last. */
const HTML_ENTITY_REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/&nbsp;/gi, ' '],
  [/&lt;/gi, '<'],
  [/&gt;/gi, '>'],
  [/&quot;/gi, '"'],
  [/&#39;|&apos;/gi, "'"],
  // Last: decoding this first would turn "&amp;lt;" into "<" instead of the literal "&lt;".
  [/&amp;/gi, '&'],
];

/**
 * Converts a Confluence page's storage-format value into readable plain text.
 *
 * Safe to call with any string — an empty or unreadable page yields empty text rather than throwing,
 * because a source that cannot be read must never take the workspace down with it.
 */
export function readConfluenceStorageText(storageValue: string): string {
  const decodedText = markImages(String(storageValue ?? ''))
    .replace(NON_CONTENT_ELEMENT_PATTERN, '')
    .replace(MACRO_PARAMETER_PATTERN, '')
    .replace(LINE_BREAK_PATTERN, '\n')
    .replace(BLOCK_ELEMENT_CLOSE_PATTERN, '\n')
    .replace(ANY_TAG_PATTERN, '');

  const withDecodedEntities = HTML_ENTITY_REPLACEMENTS.reduce(
    (text, [entityPattern, replacement]) => text.replace(entityPattern, replacement),
    decodedText,
  );

  return withDecodedEntities
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(BLANK_LINE_RUN_PATTERN, '\n')
    .trim();
}
