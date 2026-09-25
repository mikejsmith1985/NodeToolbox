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

/** Where the report is going. Jira Data Center reads wiki markup; Teams, Confluence and GitHub read Markdown. */
export type ReportFlavour = 'jira' | 'markdown';

/** What each destination is called on the button that copies it. */
export const FLAVOUR_LABELS: Record<ReportFlavour, string> = {
  jira: 'Copy for Jira',
  markdown: 'Copy as Markdown',
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
};

/** The writer for one destination. */
export function buildReportMarkup(flavour: ReportFlavour): ReportMarkup {
  return flavour === 'jira' ? JIRA_MARKUP : MARKDOWN_MARKUP;
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
