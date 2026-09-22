// intakeAnnotatedNotes.ts — The PO's original notes, line for line, with each item's Epic written back in beside it:
// "• AEP — DENP-905 (new Epic, Enrollment scope)". This is what gets shared, so everyone can see which Epic covers
// which piece of scope (GH #387).
//
// Every annotation comes from the summary table's own rows, so the two can never disagree.

import { readSettledValue, type EpicIntake, type IntakeItem, type SummaryRow } from './epicIntakeModel.ts';
import { buildSummaryRows } from './intakeSummary.ts';

/** What sits between a line and its Epic. */
const ANNOTATION_SEPARATOR = ' — ';

/** The notes both ways: plain text for anywhere, and HTML with the keys as links for email, Teams or Confluence. */
export interface AnnotatedNotes {
  text: string;
  html: string;
}

function isSharedItem(item: IntakeItem): boolean {
  return readSettledValue(item.decisions.owner) === 'shared';
}

/** What a row's outcome says beside its line. The key comes first, so it is the first thing a reader sees. */
function describeOutcome(row: SummaryRow, item: IntakeItem): string {
  switch (row.action) {
    case 'created':
      return `${row.jiraKey} (new Epic${isSharedItem(item) ? ', Enrollment scope' : ''})`;
    case 'existing':
      return `${row.jiraKey} (existing Epic)`;
    case 'ready':
      return 'ready to create';
    case 'skippedFulfillment':
      return 'Fulfillment — no Enrollment Epic';
    case 'failed':
      return 'Epic not created — the create failed';
    case 'open':
      return 'not decided yet';
    default:
      return 'not created';
  }
}

/** The annotation for each item, keyed by the line number of the item's first line. */
function readAnnotationsByLine(intake: EpicIntake, jiraBaseUrl: string): Map<number, { row: SummaryRow; description: string }> {
  const { workRows, otherRows } = buildSummaryRows(intake, jiraBaseUrl);
  const annotations = new Map<number, { row: SummaryRow; description: string }>();
  for (const row of [...workRows, ...otherRows]) {
    const item = intake.items.find((candidate) => candidate.id === row.itemId);
    if (item !== undefined && item.lineNumbers.length > 0) {
      annotations.set(item.lineNumbers[0], { row, description: describeOutcome(row, item) });
    }
  }
  return annotations;
}

/**
 * The line numbers Toolbox inserted as each source's title — not part of the PO's notes, so not shared back. Titles
 * were added in order, one before each source's lines, so walking the lines in order finds each exactly once.
 */
function readSourceTitleLineNumbers(intake: EpicIntake): Set<number> {
  const titleLineNumbers = new Set<number>();
  let nextTitleIndex = 0;
  for (const line of intake.lines) {
    if (line.outlineLevel === 0 && line.text === intake.sourceTitles[nextTitleIndex]) {
      titleLineNumbers.add(line.lineNumber);
      nextTitleIndex += 1;
    }
  }
  return titleLineNumbers;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderHtmlLine(rawText: string, annotation: { row: SummaryRow; description: string } | undefined): string {
  if (annotation === undefined) {
    return escapeHtml(rawText);
  }
  const { row, description } = annotation;
  const linkedDescription = row.jiraKey && row.jiraUrl
    ? escapeHtml(description).replace(escapeHtml(row.jiraKey), `<a href="${escapeHtml(row.jiraUrl)}">${escapeHtml(row.jiraKey)}</a>`)
    : escapeHtml(description);
  return `${escapeHtml(rawText)}${ANNOTATION_SEPARATOR}<strong>${linkedDescription}</strong>`;
}

/**
 * Rebuilds the notes as pasted — bullets, tabs and order kept — with each item's first line followed by its Epic,
 * or by why it has none. Lines that are not the start of an item are left exactly as they were.
 */
export function buildAnnotatedNotes(intake: EpicIntake, jiraBaseUrl: string): AnnotatedNotes {
  const annotations = readAnnotationsByLine(intake, jiraBaseUrl);
  const titleLineNumbers = readSourceTitleLineNumbers(intake);
  const noteLines = intake.lines.filter((line) => !titleLineNumbers.has(line.lineNumber));
  const textLines = noteLines.map((line) => {
    const annotation = annotations.get(line.lineNumber);
    return annotation === undefined ? line.rawText : `${line.rawText}${ANNOTATION_SEPARATOR}${annotation.description}`;
  });
  const htmlLines = noteLines.map((line) => renderHtmlLine(line.rawText, annotations.get(line.lineNumber)));
  return {
    text: textLines.join('\n'),
    html: `<div style="white-space: pre-wrap;">${htmlLines.join('<br>')}</div>`,
  };
}
