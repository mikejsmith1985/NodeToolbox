// reportMarkup.ts — Writes a readiness report in the markup of wherever it is being pasted.
//
// The report was written in Markdown and pasted into a Jira comment, where `## Definition of Ready` and
// `**Business objective**` appeared exactly like that — hashes, asterisks and all — because Jira Data Center
// renders its own wiki markup, not Markdown. A report nobody can read in the place they read Jira issues is not
// a report.
//
// So the shaping of a report (what is a heading, what is a bullet, what is bold) is decided once, and only the
// characters differ per destination. Two renderers, one set of decisions, which is what stops the Jira copy and
// the Markdown copy from slowly saying different things.

/**
 * Where the report is going.
 *
 * `html` is what this Jira actually stores in a description — its rich-text editor keeps HTML, which is why a
 * pasted `##` or `h2.` showed up as those characters rather than as a heading. It is the flavour Toolbox writes
 * when it puts the review on the Epic itself.
 */
export type ReportFlavour = 'jira' | 'markdown' | 'html';

/** What each copy destination is called on its button. HTML is written by Toolbox, never copied by hand. */
export const FLAVOUR_LABELS: Record<ReportFlavour, string> = {
  jira: 'Copy for Jira',
  markdown: 'Copy as Markdown',
  html: 'Copy as HTML',
};

/** The shaping operations a report needs, whichever markup it ends up in. */
export interface ReportMarkup {
  /** A heading at the given level (1 is the report title). */
  heading: (level: 1 | 2 | 3, text: string) => string;
  /** Emphasised text, inline. */
  bold: (text: string) => string;
  /** A bullet at the given depth, 1 being top level. */
  bullet: (depth: 1 | 2, text: string) => string;
  /** The header row of a table. */
  tableHeader: (cells: readonly string[]) => string;
  /** One body row of a table. */
  tableRow: (cells: readonly string[]) => string;
  /** Text shown as-is, for a JQL query nobody should read as markup. */
  code: (text: string) => string;
  /** Rows that must follow the header row, or none when the markup needs none. */
  tableSeparator: (columnCount: number) => string[];
  /**
   * Turns the finished lines into the document.
   *
   * A line-based markup simply joins them. HTML cannot: a bullet is only a bullet inside a list, so its lines
   * have to be gathered into one before anything renders. Keeping that here means the report is still SHAPED
   * once, whichever markup it ends up in.
   */
  finalize: (lines: readonly string[]) => string;
}

/** Joins lines as a line-based markup does. */
function joinLines(lines: readonly string[]): string {
  return lines.join('\n');
}

/** Markdown: what Teams, Confluence and GitHub read. */
const MARKDOWN_MARKUP: ReportMarkup = {
  heading: (level, text) => `${'#'.repeat(level)} ${text}`,
  bold: (text) => `**${text}**`,
  bullet: (depth, text) => `${depth === 1 ? '' : '  '}- ${text}`,
  tableHeader: (cells) => `| ${cells.join(' | ')} |`,
  tableRow: (cells) => `| ${cells.join(' | ')} |`,
  code: (text) => `\`${text}\``,
  tableSeparator: (columnCount) => [`| ${Array.from({ length: columnCount }, () => '---').join(' | ')} |`],
  finalize: joinLines,
};

/**
 * Jira wiki markup: what a Jira Data Center comment or description renders.
 *
 * `h2.` rather than `##`, single asterisks for bold, and nesting by repeating the bullet character rather than by
 * indenting — indentation is ignored, which is why the pasted report came out flat.
 */
const JIRA_MARKUP: ReportMarkup = {
  heading: (level, text) => `h${level}. ${text}`,
  bold: (text) => `*${text}*`,
  bullet: (depth, text) => `${'*'.repeat(depth)} ${text}`,
  tableHeader: (cells) => `||${cells.join('||')}||`,
  tableRow: (cells) => `|${cells.join('|')}|`,
  code: (text) => `{{${text}}}`,
  // Jira's table header row carries its own markup, so nothing follows it.
  tableSeparator: () => [],
  finalize: joinLines,
};

/** Keeps the report's own text from being read as markup once it is inside an HTML description. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Marks a line as a bullet at a depth, so finalize can gather the run into a list. */
const HTML_BULLET_PREFIXES = ['LI1', 'LI2'];

/** Marks a line as a table row, so finalize can gather the run into one table. */
const HTML_ROW_PREFIX = 'TR';

/**
 * HTML: what this Jira's rich-text editor stores in a description.
 *
 * Bullets and rows are emitted with a private marker rather than as finished tags, because a list item only
 * renders inside its list and a row only inside its table — the surrounding element cannot be known one line at
 * a time. `finalize` gathers each run and closes it.
 */
const HTML_MARKUP: ReportMarkup = {
  heading: (level, text) => `<h${level}>${escapeHtml(text)}</h${level}>`,
  bold: (text) => `<strong>${escapeHtml(text)}</strong>`,
  bullet: (depth, text) => `${HTML_BULLET_PREFIXES[depth - 1]}${text}`,
  tableHeader: (cells) => `${HTML_ROW_PREFIX}<th>${cells.map(escapeHtml).join('</th><th>')}</th>`,
  tableRow: (cells) => `${HTML_ROW_PREFIX}<td>${cells.map(escapeHtml).join('</td><td>')}</td>`,
  code: (text) => `<code>${escapeHtml(text)}</code>`,
  tableSeparator: () => [],
  finalize: (lines) => finalizeHtml(lines),
};

/** Whether a line is already an element, or is plain prose that needs a paragraph around it. */
function isHtmlElement(line: string): boolean {
  return line.startsWith('<');
}

/** Closes whichever list or table is open, if any. */
function closeOpenBlocks(openTags: string[]): string[] {
  return openTags.splice(0).reverse();
}

/**
 * Turns the marked lines into real HTML: runs of bullets become one list, rows become one table.
 *
 * Written as a single pass over the lines because the structure is entirely decided by where a run starts and
 * ends, and a second pass would have to work that out again.
 */
function finalizeHtml(lines: readonly string[]): string {
  const htmlParts: string[] = [];
  const openTags: string[] = [];

  lines.forEach((line) => {
    const bulletDepth = HTML_BULLET_PREFIXES.findIndex((prefix) => line.startsWith(prefix)) + 1;

    if (bulletDepth > 0) {
      const wantedTags = Array.from({ length: bulletDepth }, () => '</ul>');
      while (openTags.length > wantedTags.length || (openTags.length > 0 && openTags[0] !== '</ul>')) {
        htmlParts.push(openTags.pop()!);
      }
      while (openTags.length < wantedTags.length) {
        htmlParts.push('<ul>');
        openTags.push('</ul>');
      }
      htmlParts.push(`<li>${line.slice(HTML_BULLET_PREFIXES[bulletDepth - 1].length)}</li>`);
      return;
    }

    if (line.startsWith(HTML_ROW_PREFIX)) {
      if (openTags[0] !== '</table>') {
        htmlParts.push(...closeOpenBlocks(openTags), '<table>');
        openTags.push('</table>');
      }
      htmlParts.push(`<tr>${line.slice(HTML_ROW_PREFIX.length)}</tr>`);
      return;
    }

    htmlParts.push(...closeOpenBlocks(openTags));
    if (line.trim() !== '') {
      htmlParts.push(isHtmlElement(line) ? line : `<p>${line}</p>`);
    }
  });

  return [...htmlParts, ...closeOpenBlocks(openTags)].join('');
}

/** The writer for one destination. */
export function buildReportMarkup(flavour: ReportFlavour): ReportMarkup {
  if (flavour === 'jira') {
    return JIRA_MARKUP;
  }
  return flavour === 'html' ? HTML_MARKUP : MARKDOWN_MARKUP;
}

/**
 * Makes one cell safe for a table row.
 *
 * A summary containing a pipe would end the cell early and shift every column after it, which turns a readable
 * table into a puzzle. Newlines do the same to a row.
 */
export function escapeTableCell(cellText: string): string {
  return cellText.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
