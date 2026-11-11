// aiReplyTable.ts — Reads table-shaped assistant replies, and builds the fill-in table a prompt ends with.
//
// The team moved from Copilot to Google's AI Mode, a search answer engine that answers in its own shape: a table copied
// from a web page (tabs), a header row in an order of its choosing, lengths in hours (GH #499). Asking it to complete a
// table already listing every task is followed far more reliably than asking it to invent a line format, and reading
// columns by their header copes with whatever order it uses. A reply that still strays gets a short follow-up asking for
// the same table — nothing missing is ever guessed.

// ── Named constants ──

/** The blank the assistant replaces with its answer. */
export const FILL_IN_BLANK = '___';
// Bold and code marks an assistant puts around a table cell. Underscores are left alone: the blank is made of them.
const MARKDOWN_MARK_PATTERN = /\*\*|`/g;
// A markdown table's divider cell: "---", ":--:", "--".
const DIVIDER_CELL_PATTERN = /^:?-{2,}:?$/;
// Words an assistant puts before a length it is not sure of: "~30", "about 15 minutes", "approx. 1 hour".
const APPROXIMATE_PREFIX_PATTERN = /^(?:~|≈|about|around|approx(?:imately|\.)?|est(?:imated|\.)?)\s*/i;
// One cell's length: "30", "30 min", "1h 30m", "1.5 hours", "2 hrs".
const DURATION_CELL_PATTERN = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*(?:m(?:in(?:ute)?s?)?)?)?$/i;
const MINUTES_PER_HOUR = 60;
/** A row naming at least this many asked-for columns is the reply's header row. */
const MINIMUM_HEADER_MATCHES = 2;

// ── Reading a reply ──

/**
 * A reply line as cells: split on "|" (the asked-for form or a markdown table), else on tabs (a table copied from a web
 * page), else on commas. A markdown divider row has no cells.
 */
export function splitReplyCells(replyLine: string): string[] {
  const plainLine = replyLine.replace(MARKDOWN_MARK_PATTERN, '').trim();
  const separator = plainLine.includes('|') ? '|' : plainLine.includes('\t') ? '\t' : ',';
  const cells = plainLine.split(separator).map((cellText) => cellText.trim()).filter((cellText) => cellText !== '');
  return cells.length > 0 && cells.every((cellText) => DIVIDER_CELL_PATTERN.test(cellText)) ? [] : cells;
}

/**
 * A reply line as cells, keeping a blank cell in its place so the columns after it stay aligned: "KEY |  | note" is three
 * cells. Only the empty edges an outer "|" leaves are dropped. A markdown divider row has no cells.
 */
export function splitReplyCellsKeepingBlanks(replyLine: string): string[] {
  const plainLine = replyLine.replace(MARKDOWN_MARK_PATTERN, '').trim();
  const separator = plainLine.includes('|') ? '|' : plainLine.includes('	') ? '	' : null;
  if (separator === null) return [];
  const cells = plainLine.split(separator).map((cellText) => cellText.trim());
  if (separator === '|' && cells[0] === '') cells.shift();
  if (separator === '|' && cells[cells.length - 1] === '') cells.pop();
  const filledCells = cells.filter((cellText) => cellText !== '');
  return filledCells.length > 0 && filledCells.every((cellText) => DIVIDER_CELL_PATTERN.test(cellText)) ? [] : cells;
}

/** A cell's length in whole minutes, or null when it is not one length above zero (a title, a date, a range, a blank). */
export function readDurationCellMinutes(cellText: string): number | null {
  const lengthText = cellText.trim().replace(APPROXIMATE_PREFIX_PATTERN, '');
  const durationMatch = DURATION_CELL_PATTERN.exec(lengthText);
  if (!durationMatch || (durationMatch[1] === undefined && durationMatch[2] === undefined)) return null;
  const totalMinutes = Number(durationMatch[1] ?? 0) * MINUTES_PER_HOUR + Number(durationMatch[2] ?? 0);
  return totalMinutes > 0 ? Math.round(totalMinutes) : null;
}

/**
 * Where each asked-for column sits when these cells are a header row, or null when they are not one. Each column is
 * matched by its own pattern, the first match winning, so "Implementation (min)" and "Back-out" are both found.
 */
export function findHeaderColumns<TColumnKey extends string>(
  cells: readonly string[],
  wantedColumns: Readonly<Record<TColumnKey, RegExp>>,
): Record<TColumnKey, number> | null {
  // A row holding a length is an answer, however its reason is worded ("validation and backout are quick").
  if (cells.some((cellText) => readDurationCellMinutes(cellText) !== null)) return null;
  const columnIndexes = {} as Record<TColumnKey, number>;
  const claimedIndexes = new Set<number>();
  for (const [columnKey, headerPattern] of Object.entries(wantedColumns) as [TColumnKey, RegExp][]) {
    const columnIndex = cells.findIndex((cellText, cellIndex) => !claimedIndexes.has(cellIndex) && headerPattern.test(cellText));
    if (columnIndex === -1) continue;
    columnIndexes[columnKey] = columnIndex;
    claimedIndexes.add(columnIndex);
  }
  return Object.keys(columnIndexes).length >= MINIMUM_HEADER_MATCHES ? columnIndexes : null;
}

// ── Building the prompt's table ──

/**
 * The table the prompt ends with: the header, then one row per task with its naming cells filled in and a blank for
 * every answer. The assistant only has to replace the blanks, so it cannot add, drop or renumber a task.
 */
export function buildFillInTable(headerCells: readonly string[], rowNamingCells: readonly (readonly string[])[]): string[] {
  return [
    headerCells.join(' | '),
    ...rowNamingCells.map((namingCells) => {
      const blankCells = Array.from({ length: Math.max(headerCells.length - namingCells.length, 0) }, () => FILL_IN_BLANK);
      return [...namingCells, ...blankCells].join(' | ');
    }),
  ];
}

/** The rule lines that go before a fill-in table, worded for an assistant that answers in its own shape. */
export function describeFillInRules(replyMarker: string): string[] {
  return [
    `Answer ONLY by copying the table below, starting with the line ${replyMarker}, and replacing every ${FILL_IN_BLANK} with your answer.`,
    'Keep every row, in this order, with its task exactly as written. Do not add, remove, rename or renumber tasks, '
      + 'do not add columns, and do not give start or end times — the schedule is worked out from your answers.',
    'Write nothing before or after the table, and ask no questions: when something is unclear, give your best estimate.',
  ];
}

/**
 * The follow-up for a reply that strayed from the table: the same table again, with only the rows still unanswered.
 * It asks for the form, never for new estimates, so a reply that was right in substance is kept.
 */
export function buildFormatFixPrompt(replyMarker: string, fillInTable: readonly string[]): string {
  return [
    'Your last reply was not in the form I need, so it could not be read.',
    ...describeFillInRules(replyMarker),
    'Keep the estimates you already gave where you gave them.',
    '',
    replyMarker,
    ...fillInTable,
  ].join('\n');
}
