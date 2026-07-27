// rewriteReviewDoc.ts — The Confluence-page review surface for a bulk re-write batch (spec 030, GH #220).
//
// The reviewing PO does not edit JSON or a read-only HTML file. Instead the tool WRITES a before/after
// table to a Confluence page (Confluence storage format), the PO edits the "Proposed" cells and ticks an
// Approve checkbox right on the page, and the tool READS the page back to pick up those edits + approvals.
// The page is the single, durable, human-editable round-trip surface.
//
// Layout: a two-column comparison — for each issue a full-width header row (Jira key + summary + Approve
// task), then a "Description" row and an "Acceptance Criteria" row, each with the read-only BEFORE and the
// editable PROPOSED side by side (a narrow section-label gutter keeps the Proposed cells pure content so the
// read-back is clean). Proposed lines still carrying a ⚠ validation marker are highlighted.
//
// Round-trip rules: the table is located on read-back by its header labels (Confluence's sanitizer strips
// inline styles and unknown attributes, so a data- marker is unreliable — header text is stable). The
// Approve state is a Confluence task checkbox: <ac:task-status>complete</ac:task-status> means approved.

import type { BatchExportInput } from './rewriteBatchModel';

/** One row read back off the page: the (possibly PO-edited) proposal plus whether Approve was ticked. */
export interface ReviewPageRow {
  jiraKey: string;
  description: string;
  acceptanceCriteria: string;
  isApproved: boolean;
}

/** The three column headers — the middle two are the side-by-side comparison; the first is the row label. */
const COLUMN_HEADERS = ['Section', 'Before', 'Proposed — edit here'] as const;
const KEY_PATTERN = /[A-Z][A-Z0-9]+-\d+/;
/** Confluence highlight applied to a proposed line that carries a ⚠ validation marker (the review hot-spots). */
const VALIDATION_HIGHLIGHT_STYLE = 'background-color: #fff3b0;';

/** Escapes the five XML entities so arbitrary issue text is safe inside Confluence storage markup. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Renders multi-line text as one <p> per line so it stays readable AND editable in Confluence. When
 * `highlightValidation` is on, a line carrying a ⚠ validation marker is highlighted so the reviewer's eye
 * goes straight to the sections that need business/technical sign-off.
 */
function toParagraphs(text: string, highlightValidation = false): string {
  return text.split('\n').map((line) => {
    if (line.trim() === '') {
      return '<p>&nbsp;</p>';
    }
    const escaped = escapeXml(line);
    if (highlightValidation && line.includes('⚠')) {
      return `<p><span style="${VALIDATION_HIGHLIGHT_STYLE}">${escaped}</span></p>`;
    }
    return `<p>${escaped}</p>`;
  }).join('');
}

/** An unchecked Confluence task — the PO ticks it in the page to approve the issue. */
function buildApproveTask(jiraKey: string, taskId: number): string {
  return `<ac:task-list><ac:task><ac:task-id>${taskId}</ac:task-id>`
    + `<ac:task-status>incomplete</ac:task-status>`
    + `<ac:task-body>Approve ${escapeXml(jiraKey)}</ac:task-body></ac:task></ac:task-list>`;
}

/** The full-width row that opens each issue: its key + summary and the Approve checkbox. */
function buildIssueHeaderRow(item: BatchExportInput, taskId: number): string {
  return `<tr><td colspan="3"><p><strong>${escapeXml(item.jiraKey)} — ${escapeXml(item.original.summary)}</strong></p>`
    + `${buildApproveTask(item.jiraKey, taskId)}</td></tr>`;
}

/** One comparison row: a section label, the read-only before, and the editable proposed (highlighted). */
function buildComparisonRow(label: string, beforeText: string, proposedText: string): string {
  return `<tr><td><p><strong>${label}</strong></p></td>`
    + `<td>${toParagraphs(beforeText)}</td>`
    + `<td>${toParagraphs(proposedText, true)}</td></tr>`;
}

/**
 * Builds the full Confluence storage body for a batch's review page: an intro line, then per issue a header
 * row and the Description + Acceptance Criteria comparison rows (before | proposed side by side).
 */
export function buildReviewPageStorage(items: BatchExportInput[]): string {
  const headerRow = `<tr>${COLUMN_HEADERS.map((label) => `<th>${label}</th>`).join('')}</tr>`;
  const bodyRows = items.map((item, index) => [
    buildIssueHeaderRow(item, index + 1),
    buildComparisonRow('Description', item.original.description, item.proposed.description),
    buildComparisonRow('Acceptance Criteria', item.original.acceptanceCriteria, item.proposed.acceptanceCriteria),
  ].join('')).join('');

  return [
    '<p>Bulk re-write review — <strong>Before</strong> and <strong>Proposed</strong> sit side by side for each',
    ' issue. Edit the <strong>Proposed</strong> column as needed, tick <strong>Approve</strong> in each issue&apos;s',
    ' header, then click <strong>Write approved to Jira</strong> back in NodeToolbox. Highlighted lines still need',
    ' business/technical validation.</p>',
    `<table><thead>${headerRow}</thead><tbody>${bodyRows}</tbody></table>`,
  ].join('');
}

/** Joins a cell's block children with newlines so multi-line proposed text survives the round-trip. */
function readCellText(cell: Element): string {
  const paragraphs = Array.from(cell.querySelectorAll('p'));
  const source = paragraphs.length > 0 ? paragraphs : [cell];
  return source
    .map((node) => (node.textContent ?? '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * True when the cell holds a COMPLETED Confluence task. Matched on the serialized markup rather than by DOM
 * traversal because the `<ac:task-status>` namespaced tag serializes inconsistently across parsers — the
 * storage string form (`<ac:task-status>complete</ac:task-status>`) is stable.
 */
function readIsApproved(cell: Element): boolean {
  return /<ac:task-status>\s*complete\s*<\/ac:task-status>/i.test(cell.innerHTML);
}

/** Finds the review table by matching its header labels — resilient to Confluence stripping attributes. */
function findReviewTable(documentNode: Document): HTMLTableElement | null {
  const tables = Array.from(documentNode.getElementsByTagName('table'));
  return tables.find((table) => {
    const headerText = Array.from(table.querySelectorAll('th')).map((th) => (th.textContent ?? '').trim());
    return headerText.includes('Before') && headerText.some((text) => text.startsWith('Proposed'));
  }) ?? null;
}

/**
 * Parses a review page's storage back into rows. Walks the table: a full-width (single-cell) row opens an
 * issue (key + Approve); the "Description" / "Acceptance Criteria" rows carry the edited proposal in their
 * third cell. Rows without a recognizable issue are ignored rather than guessed. Empty when no review table.
 */
export function parseReviewPageStorage(storageValue: string): ReviewPageRow[] {
  const documentNode = new DOMParser().parseFromString(`<div>${storageValue}</div>`, 'text/html');
  const reviewTable = findReviewTable(documentNode);
  if (reviewTable === null) {
    return [];
  }

  const rows: ReviewPageRow[] = [];
  let current: ReviewPageRow | null = null;

  for (const rowElement of Array.from(reviewTable.querySelectorAll('tbody > tr'))) {
    const cells = Array.from(rowElement.children);

    // A single-cell (full-width) row opens a new issue.
    if (cells.length === 1) {
      if (current) {
        rows.push(current);
      }
      const keyMatch = KEY_PATTERN.exec(cells[0].textContent ?? '');
      current = keyMatch
        ? { jiraKey: keyMatch[0], description: '', acceptanceCriteria: '', isApproved: readIsApproved(cells[0]) }
        : null;
      continue;
    }

    // A comparison row: the section label is in the first cell, the edited proposal in the third.
    if (cells.length >= 3 && current) {
      const label = (cells[0].textContent ?? '').trim().toLowerCase();
      if (label.startsWith('description')) {
        current.description = readCellText(cells[2]);
      } else if (label.startsWith('acceptance')) {
        current.acceptanceCriteria = readCellText(cells[2]);
      }
    }
  }
  if (current) {
    rows.push(current);
  }
  return rows;
}
