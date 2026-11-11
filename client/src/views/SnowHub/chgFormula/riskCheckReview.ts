// riskCheckReview.ts — Reads a pasted risk-check review into findings a person can scan (GH #395).
//
// The review comes back as one line per Formula Card field ("GAP | Blast Radius — … — Fix: …"). Shown as raw
// text, fifty long lines run off the screen and the few that matter are buried among the passes. Reading
// the lines into findings lets the Results step lead with the verdict and the gaps. Assistants decorate
// their replies (bullets, bold), so the reading is tolerant — and any line it cannot read is kept as a
// note, never dropped.
//
// Google's AI Mode, the team's only assistant since 2026-11 (GH #499), ignores line formats but completes a table. So the
// review is also read from a filled-in table ("Item | Answer | Finding | Fix", markdown or tab-separated, columns in any
// order), and — since a table carries no VERDICT line — the verdict is then counted from the findings themselves.

import { findHeaderColumns, splitReplyCellsKeepingBlanks } from '../../../utils/aiReplyTable.ts';
import { restoreMarkerLineBreaks, stripCodeFences } from './assistantReplyText.ts';
import { CHG_TEXT_FIELD_LABELS, type ChgTextFieldKey } from './formulaCard.ts';

/**
 * PASS / GAP / N/A answer a card field; YES / NO answer a quality-gate question. INFO is a fact only the
 * owner has (a name, a time, a test result — and every [CONFIRM: …]); RECORD is a record field to set in the
 * change form. Neither is something an AI rewrite of the text can close, so neither is a gap.
 */
export type RiskCheckFindingStatus = 'PASS' | 'GAP' | 'N/A' | 'YES' | 'NO' | 'INFO' | 'RECORD';

/** One line of the review: which field or question, and what the reviewer found. */
export interface RiskCheckFinding {
  status: RiskCheckFindingStatus;
  field: string;
  detail: string;
  fix: string;
}

/** The whole review, read. */
export interface RiskCheckReview {
  /** The text after "VERDICT:" (or, for a table reply, the verdict counted from its rows), or null when there is none. */
  verdict: string | null;
  isReady: boolean;
  findings: RiskCheckFinding[];
  /** Lines that are neither a finding nor the verdict, kept so nothing the reviewer wrote is lost. */
  unparsedLines: string[];
}

/** How many [CONFIRM: …] placeholders one drafted field still holds. */
export interface ConfirmPlaceholderCount {
  fieldKey: ChgTextFieldKey;
  fieldLabel: string;
  placeholderCount: number;
}

// What begins each review line. Copying can flatten the review into one paragraph, so these are put back
// at line starts before reading.
const REVIEW_LINE_MARKERS: readonly string[] = ['PASS', 'GAP', 'N/A', 'YES', 'NO', 'NEEDS INFO', 'INFO', 'RECORD', 'VERDICT'];

// A finding line: its status, then a "|" or ":" separator, then the rest.
const FINDING_LINE_PATTERN = /^(PASS|GAP|N\/A|NA|YES|NEEDS INFO|INFO|RECORD|NO)\s*[|:]\s*(.+)$/i;
const VERDICT_LINE_PATTERN = /^VERDICT\s*:\s*(.+)$/i;
// The "— Fix: …" tail of a gap line; any dash style the assistant used.
const FIX_SEPARATOR_PATTERN = /\s+[—–-]+\s*Fix\s*:\s*/i;
// The field / detail separator: a spaced dash of any kind.
const DETAIL_SEPARATOR_PATTERN = /\s+[—–-]+\s+/;
// Leading list and emphasis markup assistants put before a line.
const LEADING_MARKUP_PATTERN = /^[\s>*•#_`-]+/;
const CONFIRM_PLACEHOLDER_PATTERN = /\[CONFIRM:[^\]]*\]/gi;

// ── The review as a filled-in table (GH #499) ──

/** The line the review table follows in the prompt; skipped when the reply echoes it. */
export const RISK_CHECK_TABLE_MARKER = 'RISK_CHECK_TABLE:';
/** The review table's header, in the order the prompt lays it out. */
export const RISK_CHECK_TABLE_HEADER: readonly string[] = ['Item', 'Answer', 'Finding', 'Fix'];

/** The columns a review table has, found by header text whatever order or wording the assistant used. */
type RiskTableColumnKey = 'item' | 'status' | 'finding' | 'fix';
const RISK_TABLE_COLUMNS: Readonly<Record<RiskTableColumnKey, RegExp>> = {
  item: /^(?:item|field|card field|formula card field|question|check|criteri)/i,
  status: /^(?:answer|status|result|rating|verdict|outcome)$/i,
  finding: /^(?:finding|details?|why|reason|notes?|comments?|explanation|observation|rationale|assessment)/i,
  fix: /^(?:fix|suggested fix|recommend|action|remediation)/i,
};
// An answer cell's words, mapped to a status; first match wins, so "NEEDS INFO" is INFO and "N/A" is never "NO".
const STATUS_CELL_PATTERNS: ReadonlyArray<readonly [RegExp, RiskCheckFindingStatus]> = [
  [/\bneeds?\s+info\b|\bquestion\b/i, 'INFO'],
  [/\bn\/a\b|^na$|not\s+applicable/i, 'N/A'],
  [/\bpass(?:ed|es)?\b/i, 'PASS'],
  [/\bgap\b|\bfail(?:ed|s)?\b/i, 'GAP'],
  [/\binfo\b/i, 'INFO'],
  [/\brecord\b/i, 'RECORD'],
  [/\byes\b/i, 'YES'],
  [/\bno\b/i, 'NO'],
];
// A cell that says nothing: the blank left unfilled, or an assistant's own way of writing nothing.
const EMPTY_CELL_PATTERN = /^(?:_{2,}|-{1,2}|—|n\/a|none|null)$/i;
// A blank answer cell still waiting to be filled in.
const UNFILLED_CELL_PATTERN = /^_{2,}$/;
// A markdown table's divider row, or the echoed marker line — neither is a note.
const TABLE_NOISE_LINE_PATTERN = /^(?:[\s|:-]+|RISK_CHECK_TABLE:?)$/i;

/** A review line with its list bullets and bold / italic markers taken off. */
function stripLineMarkup(rawLine: string): string {
  return rawLine.replace(LEADING_MARKUP_PATTERN, '').replace(/\*\*|__/g, '').trim();
}

/** "NA" and "n/a" are the same answer as "N/A"; "NEEDS INFO" is the same answer as "INFO". */
function normaliseStatus(rawStatus: string): RiskCheckFindingStatus {
  const upperStatus = rawStatus.toUpperCase();
  if (upperStatus === 'NA') return 'N/A';
  if (upperStatus === 'NEEDS INFO') return 'INFO';
  return upperStatus as RiskCheckFindingStatus;
}

/** Splits "<field> — <detail> — Fix: <fix>" into its three parts; missing parts come back empty. */
function readFindingBody(findingBody: string): Pick<RiskCheckFinding, 'field' | 'detail' | 'fix'> {
  const [beforeFix, ...fixParts] = findingBody.split(FIX_SEPARATOR_PATTERN);
  const [field, ...detailParts] = beforeFix.split(DETAIL_SEPARATOR_PATTERN);
  return {
    field: field.trim(),
    detail: detailParts.join(' — ').trim(),
    fix: fixParts.join(' ').trim(),
  };
}

/** A finding's name in comparable form: lower-case letters and digits only. */
export function normaliseFindingName(findingName: string): string {
  return findingName.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── Reading a table row ──

/** Where a review table's columns sit when these cells are its header row, or null when they are not it. */
function findRiskTableColumns(cells: readonly string[]): Record<RiskTableColumnKey, number> | null {
  const columnIndexes = findHeaderColumns(cells, RISK_TABLE_COLUMNS);
  return columnIndexes && columnIndexes.item !== undefined && columnIndexes.status !== undefined ? columnIndexes : null;
}

/** One table cell's text, or '' for a blank, "___", "—" or "N/A" written where nothing applies. */
function readTableCell(cells: readonly string[], columnIndex: number | undefined): string {
  const cellText = columnIndex === undefined ? '' : (cells[columnIndex] ?? '').trim();
  return EMPTY_CELL_PATTERN.test(cellText) ? '' : cellText;
}

/** The status an answer cell gives ("✅ PASS", "Gap", "Needs info"), or null when it gives none (still "___"). */
function readStatusCell(cellText: string): RiskCheckFindingStatus | null {
  const trimmedText = cellText.trim();
  if (trimmedText === '' || UNFILLED_CELL_PATTERN.test(trimmedText)) return null;
  const statusEntry = STATUS_CELL_PATTERNS.find(([statusPattern]) => statusPattern.test(trimmedText));
  return statusEntry ? statusEntry[1] : null;
}

/** One table row as a finding, or null when its item or its answer is still blank. */
function readTableFinding(cells: readonly string[], columns: Record<RiskTableColumnKey, number>): RiskCheckFinding | null {
  const field = readTableCell(cells, columns.item);
  const status = readStatusCell(cells[columns.status] ?? '');
  if (field === '' || status === null) return null;
  return { status, field, detail: readTableCell(cells, columns.finding), fix: readTableCell(cells, columns.fix) };
}

/** True when the reply holds a review table — its line breaks are then real, so no marker is put back on its own line. */
function hasReviewTable(reviewText: string): boolean {
  return reviewText.split(/\r?\n/).some((replyLine) => findRiskTableColumns(splitReplyCellsKeepingBlanks(replyLine)) !== null);
}

/** A table finding replaces an earlier one for the same item — a follow-up's answer supersedes the first reply's. */
function addTableFinding(findings: RiskCheckFinding[], tableFinding: RiskCheckFinding): void {
  const itemKey = normaliseFindingName(tableFinding.field);
  const earlierIndex = findings.findIndex((finding) => normaliseFindingName(finding.field) === itemKey);
  if (earlierIndex === -1) findings.push(tableFinding);
  else findings[earlierIndex] = tableFinding;
}

// ── The verdict ──

/**
 * The verdict counted from the findings (the text after "VERDICT: "): ready only when nothing is unsettled, otherwise
 * each kind counted apart. Shared with the review's re-rendering, so every way of reaching a verdict words it alike.
 */
export function describeVerdict(findings: readonly RiskCheckFinding[]): string {
  const gapCount = findings.filter((finding) => finding.status === 'GAP' || finding.status === 'NO').length;
  const infoCount = findings.filter((finding) => finding.status === 'INFO').length;
  const recordCount = findings.filter((finding) => finding.status === 'RECORD').length;
  if (gapCount + infoCount + recordCount === 0) {
    return 'READY FOR APPROVAL';
  }
  const verdictParts = [
    gapCount > 0 ? `${gapCount} gap(s)` : 'no text gaps',
    ...(infoCount > 0 ? [`${infoCount} ${infoCount === 1 ? 'fact' : 'facts'} needed from you`] : []),
    ...(recordCount > 0 ? [`${recordCount} ${recordCount === 1 ? 'record field' : 'record fields'} to set`] : []),
  ];
  return `NOT READY — ${verdictParts.join('; ')}.`;
}

// ── Reading a review ──

/** The running state of a read: the review so far, and the table layout once its header row was seen. */
interface ReviewReadState {
  review: RiskCheckReview;
  tableColumns: Record<RiskTableColumnKey, number> | null;
  wasTableRead: boolean;
}

/** Reads one table line: a header (re-reading the layout), an answered row, or a still-blank row. False when it is none. */
function readTableLine(rawLine: string, readState: ReviewReadState): boolean {
  const cells = splitReplyCellsKeepingBlanks(rawLine);
  if (cells.length < 2) return false;
  const headerColumns = findRiskTableColumns(cells);
  if (headerColumns) {
    readState.tableColumns = headerColumns;
    return true;
  }
  if (readState.tableColumns === null) return false;
  const tableFinding = readTableFinding(cells, readState.tableColumns);
  if (tableFinding === null) {
    // A row whose answer is still "___" is left out on purpose: it is what the follow-up asks for.
    return readTableCell(cells, readState.tableColumns.item) !== '' && readStatusCell(cells[readState.tableColumns.status] ?? '') === null;
  }
  addTableFinding(readState.review.findings, tableFinding);
  readState.wasTableRead = true;
  return true;
}

/** Reads one line in the line format the review used to ask for: the verdict, a finding, or a note. */
function readReviewLine(rawLine: string, review: RiskCheckReview): void {
  const line = stripLineMarkup(rawLine);
  if (line === '' || TABLE_NOISE_LINE_PATTERN.test(line)) {
    return;
  }
  const verdictMatch = VERDICT_LINE_PATTERN.exec(line);
  if (verdictMatch) {
    review.verdict = verdictMatch[1].trim();
    return;
  }
  const findingMatch = FINDING_LINE_PATTERN.exec(line);
  if (findingMatch) {
    review.findings.push({ status: normaliseStatus(findingMatch[1]), ...readFindingBody(findingMatch[2]) });
    return;
  }
  review.unparsedLines.push(line);
}

/**
 * Reads a pasted review — the part before any corrections — into its verdict, findings and notes. Both the asked-for
 * table and the "STATUS | field — detail" lines are read. A table carries no VERDICT line, so its verdict is counted
 * from its findings.
 */
export function parseRiskCheckReview(reviewText: string): RiskCheckReview {
  const cleanedReview = stripCodeFences(reviewText);
  const readState: ReviewReadState = {
    review: { verdict: null, isReady: false, findings: [], unparsedLines: [] },
    tableColumns: null,
    wasTableRead: false,
  };
  // A flattened line-format reply gets its markers back on their own lines; a table's line breaks are already real.
  const restoredReview = hasReviewTable(cleanedReview) ? cleanedReview : restoreMarkerLineBreaks(cleanedReview, REVIEW_LINE_MARKERS);
  for (const rawLine of restoredReview.split(/\r?\n/)) {
    if (!readTableLine(rawLine, readState)) readReviewLine(rawLine, readState.review);
  }
  const { review } = readState;
  if (review.verdict === null && readState.wasTableRead) {
    review.verdict = describeVerdict(review.findings);
  }
  review.isReady = review.verdict !== null && /READY FOR APPROVAL/i.test(review.verdict) && !/NOT READY/i.test(review.verdict);
  return review;
}

/**
 * The drafted fields that still hold [CONFIRM: …] placeholders, and how many each. These are the facts only
 * a person can supply, so the Results step names where they are.
 */
export function countConfirmPlaceholders(fieldValues: Readonly<Record<ChgTextFieldKey, string>>): ConfirmPlaceholderCount[] {
  return (Object.keys(CHG_TEXT_FIELD_LABELS) as ChgTextFieldKey[])
    .map((fieldKey) => ({
      fieldKey,
      fieldLabel: CHG_TEXT_FIELD_LABELS[fieldKey],
      placeholderCount: (fieldValues[fieldKey] ?? '').match(CONFIRM_PLACEHOLDER_PATTERN)?.length ?? 0,
    }))
    .filter((count) => count.placeholderCount > 0);
}
