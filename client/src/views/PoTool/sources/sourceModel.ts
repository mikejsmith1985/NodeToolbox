// sourceModel.ts — The material a PO gathers while composing a Feature.
//
// The whole point of the composition workspace is to end context-switching: the Confluence brief, the
// spreadsheet of volumes, the related Jira tickets and the PO's own notes sit in ONE place beside the
// draft. So every source, however it arrived, must be able to say where it came from — a PO reading
// their own workspace a week later needs to know whether a number came from a spreadsheet or a hallway
// conversation (FR-024).
//
// A source is reference material. No row of a spreadsheet ever becomes an issue: that is Jira Intake's
// job, not this one.

/** A Confluence page pulled in by URL. */
export interface ConfluenceSource {
  kind: 'confluence';
  id: string;
  title: string;
  /** Kept even though the content is fetched, so the PO can go back to the page itself. */
  pageUrl: string;
  pageId: string;
  /** Storage markup reduced to readable text — never injected as HTML. */
  text: string;
  fetchedAtIso: string;
}

/** A spreadsheet the PO dropped in. */
export interface WorkbookSource {
  kind: 'workbook';
  id: string;
  fileName: string;
  /** Which sheet is being referenced. */
  sheetName: string;
  /** Every sheet in the file, so a multi-sheet workbook never silently shows only the first. */
  availableSheetNames: string[];
  /** Rows as header→cell text. Reference material; never turned into issues. */
  rows: Record<string, string>[];
}

/** An existing Jira issue the Feature relates to. */
export interface JiraSource {
  kind: 'jira';
  id: string;
  issueKey: string;
  summary: string;
  status: string;
}

/** Anything the PO pasted — a Teams thread, an email, a hallway note. */
export interface PasteSource {
  kind: 'paste';
  id: string;
  /** What the PO called it, so it is identifiable later. */
  label: string;
  text: string;
}

export type ReferencedSource = ConfluenceSource | WorkbookSource | JiraSource | PasteSource;

/**
 * Describes where a source came from, for display beside it.
 *
 * Every variant answers this, because "which of these did that figure come from?" is the question a PO
 * asks of their own workspace, and an unattributed blob of text cannot answer it.
 */
export function describeSourceOrigin(source: ReferencedSource): string {
  switch (source.kind) {
    case 'confluence':
      return source.pageUrl;
    case 'workbook':
      return source.availableSheetNames.length > 1
        ? `${source.fileName} · sheet "${source.sheetName}"`
        : source.fileName;
    case 'jira':
      return source.issueKey;
    case 'paste':
      return 'Pasted';
  }
}

/** A short human label for the source, used as its heading. */
export function describeSourceTitle(source: ReferencedSource): string {
  switch (source.kind) {
    case 'confluence':
      return source.title || 'Confluence page';
    case 'workbook':
      return source.fileName;
    case 'jira':
      return `${source.issueKey} — ${source.summary}`;
    case 'paste':
      return source.label || 'Pasted note';
  }
}

/** The source's content as plain text — what the AI prompt sends and the panel shows. */
export function readSourceText(source: ReferencedSource): string {
  switch (source.kind) {
    case 'confluence':
    case 'paste':
      return source.text;
    case 'jira':
      return `${source.issueKey} (${source.status}): ${source.summary}`;
    case 'workbook':
      return formatWorkbookRowsAsText(source.rows);
  }
}

/** Rows above this are summarised rather than listed — a PO cannot read 5,000 lines anyway. */
const MAX_WORKBOOK_ROWS_IN_TEXT = 50;

/** Renders workbook rows as readable lines, and says plainly when it has stopped short. */
export function formatWorkbookRowsAsText(rows: readonly Record<string, string>[]): string {
  if (rows.length === 0) {
    return '(no rows)';
  }
  const shownRows = rows.slice(0, MAX_WORKBOOK_ROWS_IN_TEXT);
  const renderedRows = shownRows.map((row) =>
    Object.entries(row)
      .filter(([, cellValue]) => cellValue.trim() !== '')
      .map(([columnName, cellValue]) => `${columnName}: ${cellValue}`)
      .join(' · '),
  );
  if (rows.length > shownRows.length) {
    renderedRows.push(`… and ${rows.length - shownRows.length} more rows (open the file to see them all)`);
  }
  return renderedRows.join('\n');
}

/** Mints an id unique within the workspace, so React keys and removal stay stable. */
export function mintSourceId(existingSources: readonly ReferencedSource[], kind: ReferencedSource['kind']): string {
  const usedIds = new Set(existingSources.map((source) => source.id));
  let candidateIndex = 1;
  while (usedIds.has(`${kind}-${candidateIndex}`)) {
    candidateIndex += 1;
  }
  return `${kind}-${candidateIndex}`;
}
