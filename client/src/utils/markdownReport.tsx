// markdownReport.tsx — Renders a constrained subset of Markdown into safe React elements.
//
// Framework-first note: the client bundles no Markdown library, and pulling one into the packaged
// Windows .exe purely to display an AI-generated report is disproportionate. This renderer covers
// exactly the shapes our AI Assist reports emit — headings, bold, inline code, bullet/ordered lists,
// and GFM pipe tables — and is inherently injection-safe because every value becomes a React text
// node (React escapes it), never raw HTML.

import { createElement, type ReactElement, type ReactNode } from 'react';

// Matches inline **bold** or `code` spans so surrounding prose can be split around them.
const INLINE_EMPHASIS_PATTERN = /\*\*([^*]+)\*\*|`([^`]+)`/g;

// A heading line: one-to-six leading hashes followed by the heading text.
const ATX_HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;

// The lowest heading level we emit — a report panel sits inside an existing card, so its top
// heading should render as an <h3> rather than a page-dominating <h1>.
const HEADING_BASE_LEVEL = 2;
const MAX_HEADING_LEVEL = 6;

/**
 * Splits one inline text run into React nodes, converting **bold** to <strong> and `code`
 * to <code>. Plain text between spans is returned as string nodes (React escapes them).
 */
function renderInlineText(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursorIndex = 0;
  let tokenIndex = 0;

  INLINE_EMPHASIS_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_EMPHASIS_PATTERN.exec(text)) !== null) {
    if (match.index > cursorIndex) {
      nodes.push(text.slice(cursorIndex, match.index));
    }
    const spanKey = `${keyPrefix}-inline-${tokenIndex}`;
    if (match[1] !== undefined) {
      nodes.push(<strong key={spanKey}>{match[1]}</strong>);
    } else {
      nodes.push(<code key={spanKey}>{match[2]}</code>);
    }
    cursorIndex = match.index + match[0].length;
    tokenIndex += 1;
  }

  if (cursorIndex < text.length) {
    nodes.push(text.slice(cursorIndex));
  }
  return nodes;
}

/** Removes leading/trailing pipes and returns the trimmed cell values of a table row. */
function splitTableRowCells(line: string): string[] {
  let inner = line.trim();
  if (inner.startsWith('|')) inner = inner.slice(1);
  if (inner.endsWith('|')) inner = inner.slice(0, -1);
  return inner.split('|').map((cell) => cell.trim());
}

/** True when a line is the header/body row of a pipe table (starts with a pipe). */
function isTableRowLine(line: string): boolean {
  return line.trim().startsWith('|');
}

/** True when a line is the `| --- | :--: |` separator that follows a table header. */
function isTableSeparatorLine(line: string | undefined): boolean {
  if (!line || !line.includes('|')) return false;
  const cells = splitTableRowCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
}

/** True when a line begins an unordered list item (`- ` or `* `). */
function isUnorderedListLine(line: string): boolean {
  return /^\s*[-*]\s+/.test(line);
}

/** True when a line begins an ordered list item (`1. `). */
function isOrderedListLine(line: string): boolean {
  return /^\s*\d+\.\s+/.test(line);
}

/** Renders one Markdown heading, clamping the level so it never dominates the host card. */
function renderHeadingBlock(hashCount: number, text: string, blockKey: string): ReactElement {
  const headingLevel = Math.min(hashCount + HEADING_BASE_LEVEL, MAX_HEADING_LEVEL);
  // headingLevel is clamped to 3..6, so the tag is always a valid heading element.
  const headingTag = `h${headingLevel}` as 'h3' | 'h4' | 'h5' | 'h6';
  return createElement(headingTag, { key: blockKey }, renderInlineText(text, blockKey));
}

/** Renders a pipe table starting at `startIndex`; returns the element and the next line index. */
function renderTableBlock(
  lines: string[],
  startIndex: number,
  blockKey: string,
): { element: ReactElement; nextIndex: number } {
  const headerCells = splitTableRowCells(lines[startIndex]);
  let rowIndex = startIndex + 2; // skip the header row and its separator row
  const bodyRows: string[][] = [];
  while (rowIndex < lines.length && isTableRowLine(lines[rowIndex])) {
    bodyRows.push(splitTableRowCells(lines[rowIndex]));
    rowIndex += 1;
  }

  const element = (
    <table key={blockKey}>
      <thead>
        <tr>
          {headerCells.map((headerCell, columnIndex) => (
            <th key={`${blockKey}-h-${columnIndex}`} scope="col">{renderInlineText(headerCell, `${blockKey}-h-${columnIndex}`)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {bodyRows.map((rowCells, bodyRowIndex) => (
          <tr key={`${blockKey}-r-${bodyRowIndex}`}>
            {rowCells.map((rowCell, columnIndex) => (
              <td key={`${blockKey}-r-${bodyRowIndex}-${columnIndex}`}>{renderInlineText(rowCell, `${blockKey}-r-${bodyRowIndex}-${columnIndex}`)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
  return { element, nextIndex: rowIndex };
}

/** Renders a consecutive run of list items into a <ul> or <ol>; returns element and next index. */
function renderListBlock(
  lines: string[],
  startIndex: number,
  blockKey: string,
): { element: ReactElement; nextIndex: number } {
  const isOrdered = isOrderedListLine(lines[startIndex]) && !isUnorderedListLine(lines[startIndex]);
  const matchesThisList = (line: string) => (isOrdered ? isOrderedListLine(line) : isUnorderedListLine(line));

  let rowIndex = startIndex;
  const itemTexts: string[] = [];
  while (rowIndex < lines.length && matchesThisList(lines[rowIndex])) {
    itemTexts.push(lines[rowIndex].replace(/^\s*(?:[-*]|\d+\.)\s+/, ''));
    rowIndex += 1;
  }

  const listItems = itemTexts.map((itemText, itemIndex) => (
    <li key={`${blockKey}-li-${itemIndex}`}>{renderInlineText(itemText, `${blockKey}-li-${itemIndex}`)}</li>
  ));
  const element = isOrdered
    ? <ol key={blockKey}>{listItems}</ol>
    : <ul key={blockKey}>{listItems}</ul>;
  return { element, nextIndex: rowIndex };
}

/** True when a line starts any recognized non-paragraph block (heading, table, or list). */
function startsNonParagraphBlock(lines: string[], index: number): boolean {
  const line = lines[index];
  if (ATX_HEADING_PATTERN.test(line)) return true;
  if (isUnorderedListLine(line) || isOrderedListLine(line)) return true;
  return isTableRowLine(line) && isTableSeparatorLine(lines[index + 1]);
}

/** Gathers consecutive prose lines into a single paragraph; returns element and next index. */
function renderParagraphBlock(
  lines: string[],
  startIndex: number,
  blockKey: string,
): { element: ReactElement; nextIndex: number } {
  let rowIndex = startIndex;
  const paragraphLines: string[] = [];
  while (
    rowIndex < lines.length
    && lines[rowIndex].trim() !== ''
    && !startsNonParagraphBlock(lines, rowIndex)
  ) {
    paragraphLines.push(lines[rowIndex].trim());
    rowIndex += 1;
  }

  const paragraphText = paragraphLines.join(' ');
  return { element: <p key={blockKey}>{renderInlineText(paragraphText, blockKey)}</p>, nextIndex: rowIndex };
}

/**
 * Renders a constrained Markdown string (headings, bold, inline code, lists, pipe tables,
 * and paragraphs) into a React fragment. Unknown syntax falls through to plain paragraph text,
 * so a malformed report degrades gracefully rather than throwing.
 */
export function renderMarkdownReport(markdown: string): ReactElement {
  const lines = String(markdown ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let lineIndex = 0;
  let blockCounter = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    if (line.trim() === '') {
      lineIndex += 1;
      continue;
    }

    const blockKey = `md-block-${blockCounter}`;
    blockCounter += 1;

    const headingMatch = ATX_HEADING_PATTERN.exec(line);
    if (headingMatch) {
      blocks.push(renderHeadingBlock(headingMatch[1].length, headingMatch[2], blockKey));
      lineIndex += 1;
      continue;
    }

    if (isTableRowLine(line) && isTableSeparatorLine(lines[lineIndex + 1])) {
      const { element, nextIndex } = renderTableBlock(lines, lineIndex, blockKey);
      blocks.push(element);
      lineIndex = nextIndex;
      continue;
    }

    if (isUnorderedListLine(line) || isOrderedListLine(line)) {
      const { element, nextIndex } = renderListBlock(lines, lineIndex, blockKey);
      blocks.push(element);
      lineIndex = nextIndex;
      continue;
    }

    const { element, nextIndex } = renderParagraphBlock(lines, lineIndex, blockKey);
    blocks.push(element);
    lineIndex = nextIndex;
  }

  return <>{blocks}</>;
}
