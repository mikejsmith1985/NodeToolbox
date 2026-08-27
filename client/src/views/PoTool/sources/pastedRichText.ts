// pastedRichText.ts — Keeping the shape of what was pasted, not just its words.
//
// A OneNote page in a Teams tab cannot be exported or downloaded, so the only way its content gets
// into a prompt is a copy and a paste. That works — until the page is a table, and the team's
// working notes mostly are: a Billing Grid comparing "Blue current state" against "Purple current
// state" against "Assumption", row by row.
//
// Pasted into a plain textarea, a four-column table collapses into an undifferentiated run of
// sentences. Every cell survives; the thing that made them mean anything — which column they were
// in — does not. An assistant reading that cannot tell a current state from an assumption.
//
// So the HTML flavour of the clipboard is read instead, and tables are rewritten as Markdown, which
// models read reliably and a person can still check by eye.
//
// Pure aside from the DOM parse: no fetch, no storage, no clock.

/** Cell text with the whitespace collapsed and the pipes escaped, so a row cannot break its table. */
function readCellText(cellElement: Element): string {
  return (cellElement.textContent ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

/** One table row's cells, in order. */
function readRowCells(rowElement: Element): string[] {
  return Array.from(rowElement.querySelectorAll('th, td')).map((cellElement) => readCellText(cellElement));
}

/**
 * Renders one HTML table as a Markdown table.
 *
 * The first row becomes the header whether or not it was marked up as one. OneNote and Word both
 * emit header rows as ordinary `<td>` with bold text inside, so requiring `<th>` would leave most
 * real tables headerless — and a Markdown table without a header row is not a table.
 *
 * Ragged rows are padded rather than dropped: a row with fewer cells than the header is a real thing
 * in a hand-maintained grid, and losing it would lose content silently.
 */
export function renderTableAsMarkdown(tableElement: Element): string {
  const rows = Array.from(tableElement.querySelectorAll('tr'))
    .map((rowElement) => readRowCells(rowElement))
    .filter((cells) => cells.length > 0);

  if (rows.length === 0) {
    return '';
  }

  const columnCount = Math.max(...rows.map((cells) => cells.length));
  const padRow = (cells: string[]): string =>
    `| ${[...cells, ...Array(columnCount - cells.length).fill('')].join(' | ')} |`;

  const [headerCells, ...bodyRows] = rows;
  return [
    padRow(headerCells),
    `| ${Array(columnCount).fill('---').join(' | ')} |`,
    ...bodyRows.map((cells) => padRow(cells)),
  ].join('\n');
}

/** Block elements whose content deserves a line of its own in the flattened output. */
const BLOCK_TAG_NAMES = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BR', 'TR']);

/**
 * Turns a pasted HTML fragment into text that keeps its tables.
 *
 * Everything that is not a table is flattened to lines — headings, paragraphs and list items each
 * on their own line — because their structure carries far less than a table's does, and reproducing
 * every nested list as Markdown would add noise for no gain.
 *
 * List items keep a leading dash, because a list of requirements read as a paragraph is a different
 * claim from a list of requirements read as a list.
 */
export function convertPastedHtmlToText(pastedHtml: string): string {
  const parsedDocument = new DOMParser().parseFromString(pastedHtml, 'text/html');
  const bodyElement = parsedDocument.body;
  if (!bodyElement) {
    return '';
  }

  const outputBlocks: string[] = [];

  // Tables are pulled out whole and REMOVED, so the walk below does not also emit their cells as
  // loose lines — which would duplicate every value in the document.
  Array.from(bodyElement.querySelectorAll('table')).forEach((tableElement) => {
    const markdownTable = renderTableAsMarkdown(tableElement);
    if (markdownTable !== '') {
      const placeholder = parsedDocument.createElement('div');
      placeholder.setAttribute('data-markdown-table', String(outputBlocks.length));
      outputBlocks.push(markdownTable);
      tableElement.replaceWith(placeholder);
    } else {
      tableElement.remove();
    }
  });

  const lines: string[] = [];
  const walkNode = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const textValue = (node.textContent ?? '').replace(/\s+/g, ' ');
      if (textValue.trim() !== '') lines.push(textValue.trim());
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as Element;
    const tableIndex = element.getAttribute?.('data-markdown-table');
    if (tableIndex !== null && tableIndex !== undefined) {
      lines.push('', outputBlocks[Number(tableIndex)], '');
      return;
    }

    const tagName = element.tagName.toUpperCase();
    if (tagName === 'LI') {
      const itemText = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (itemText !== '') lines.push(`- ${itemText}`);
      return;
    }

    Array.from(element.childNodes).forEach((childNode) => walkNode(childNode));
    if (BLOCK_TAG_NAMES.has(tagName)) lines.push('');
  };

  Array.from(bodyElement.childNodes).forEach((childNode) => walkNode(childNode));

  // Collapse the runs of blank lines the walk leaves behind, so the result reads as a document
  // rather than as a stack of gaps.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * The best text a paste can offer: the HTML flavour when there is one, the plain flavour otherwise.
 *
 * Falls back rather than failing. A paste from a plain-text editor carries no HTML at all, and that
 * is an ordinary paste, not an error.
 */
export function readPastedText(htmlFlavour: string, plainFlavour: string): string {
  if (htmlFlavour.trim() === '') {
    return plainFlavour;
  }

  try {
    const converted = convertPastedHtmlToText(htmlFlavour);
    // An HTML flavour that yields nothing readable — an image-only paste, say — must not blank a
    // paste that had usable plain text beside it.
    return converted.trim() === '' ? plainFlavour : converted;
  } catch {
    return plainFlavour;
  }
}
