// rewriteReviewDoc.ts — The Confluence-page review surface for a bulk re-write batch (spec 030, GH #220).
//
// The reviewing PO does not edit JSON or a read-only HTML file. Instead the tool WRITES a before/after
// table to a Confluence page (Confluence storage format), the PO edits the "Proposed" cells and ticks an
// Approve checkbox right on the page, and the tool READS the page back to pick up those edits + approvals.
// The page is the single, durable, human-editable round-trip surface — replacing the old copy/download/JSON
// buttons. This module owns ONLY the storage build + parse; the network read/write lives in confluenceApi.
//
// Round-trip rule: the table is located on read-back by its header labels (Confluence's storage sanitizer
// strips inline styles and unknown attributes, so a data- marker is not reliable — header text is). The
// Approve state is a Confluence task checkbox: <ac:task-status>complete</ac:task-status> means approved.

import type { BatchExportInput } from './rewriteBatchModel';

/** One row read back off the page: the (possibly PO-edited) proposal plus whether Approve was ticked. */
export interface ReviewPageRow {
  jiraKey: string;
  description: string;
  acceptanceCriteria: string;
  isApproved: boolean;
}

/** The header labels that both identify the table on read-back and order the columns on write. */
const COLUMN_HEADERS = ['Feature', 'Before', 'Proposed Description', 'Proposed Acceptance Criteria', 'Approve'] as const;
const KEY_PATTERN = /[A-Z][A-Z0-9]+-\d+/;

/** Escapes the five XML entities so arbitrary issue text is safe inside Confluence storage markup. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Renders multi-line text as one <p> per line so it stays readable AND editable in Confluence. */
function toParagraphs(text: string): string {
  const lines = text.split('\n');
  return lines.map((line) => `<p>${line.trim() === '' ? '&nbsp;' : escapeXml(line)}</p>`).join('');
}

/** The read-only "before" cell: summary in bold, then description, then the acceptance criteria. */
function buildBeforeCell(original: BatchExportInput['original']): string {
  return [
    `<p><strong>${escapeXml(original.summary)}</strong></p>`,
    toParagraphs(original.description),
    '<p><strong>Acceptance Criteria</strong></p>',
    toParagraphs(original.acceptanceCriteria),
  ].join('');
}

/** An unchecked Confluence task — the PO ticks it in the page to approve the row. */
function buildApproveCell(jiraKey: string, taskId: number): string {
  return `<ac:task-list><ac:task><ac:task-id>${taskId}</ac:task-id>`
    + `<ac:task-status>incomplete</ac:task-status>`
    + `<ac:task-body>Approve ${escapeXml(jiraKey)}</ac:task-body></ac:task></ac:task-list>`;
}

/**
 * Builds the full Confluence storage body for a batch's review page: an intro line telling the PO what to
 * do, then one table row per issue with the before, the editable proposed re-write, and an Approve task.
 */
export function buildReviewPageStorage(items: BatchExportInput[]): string {
  const headerRow = COLUMN_HEADERS.map((label) => `<th>${label}</th>`).join('');
  const bodyRows = items.map((item, index) => {
    const cells = [
      `<td><p><strong>${escapeXml(item.jiraKey)}</strong></p></td>`,
      `<td>${buildBeforeCell(item.original)}</td>`,
      `<td>${toParagraphs(item.proposed.description)}</td>`,
      `<td>${toParagraphs(item.proposed.acceptanceCriteria)}</td>`,
      `<td>${buildApproveCell(item.jiraKey, index + 1)}</td>`,
    ].join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  return [
    '<p>Bulk re-write review. Edit the <strong>Proposed</strong> columns as needed, tick <strong>Approve</strong>',
    ' on the rows to publish, then click <strong>Write approved to Jira</strong> back in NodeToolbox.</p>',
    `<table><thead><tr>${headerRow}</tr></thead><tbody>${bodyRows}</tbody></table>`,
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
 * True when the row's Approve cell holds a COMPLETED Confluence task. Matched on the serialized markup
 * rather than by DOM traversal because the `<ac:task-status>` namespaced tag serializes inconsistently
 * across parsers — the storage string form (`<ac:task-status>complete</ac:task-status>`) is stable.
 */
function readIsApproved(cell: Element): boolean {
  return /<ac:task-status>\s*complete\s*<\/ac:task-status>/i.test(cell.innerHTML);
}

/** Finds the review table by matching its header labels — resilient to Confluence stripping attributes. */
function findReviewTable(documentNode: Document): HTMLTableElement | null {
  const tables = Array.from(documentNode.getElementsByTagName('table'));
  return tables.find((table) => {
    const headerText = Array.from(table.querySelectorAll('th')).map((th) => (th.textContent ?? '').trim());
    return headerText.includes('Proposed Description') && headerText.includes('Approve');
  }) ?? null;
}

/**
 * Parses a review page's storage back into rows. Matches by column position within the located table;
 * rows without a recognizable Jira key (e.g. a stray edit) are skipped rather than guessed. Returns an
 * empty array when the page has no review table (the caller reports that honestly).
 */
export function parseReviewPageStorage(storageValue: string): ReviewPageRow[] {
  const documentNode = new DOMParser().parseFromString(`<div>${storageValue}</div>`, 'text/html');
  const reviewTable = findReviewTable(documentNode);
  if (reviewTable === null) {
    return [];
  }

  const rows: ReviewPageRow[] = [];
  for (const rowElement of Array.from(reviewTable.querySelectorAll('tbody > tr'))) {
    const cells = Array.from(rowElement.children);
    if (cells.length < COLUMN_HEADERS.length) {
      continue; // a malformed / spacer row — skip, do not guess
    }
    const keyMatch = KEY_PATTERN.exec(cells[0].textContent ?? '');
    if (keyMatch === null) {
      continue;
    }
    rows.push({
      jiraKey: keyMatch[0],
      description: readCellText(cells[2]),
      acceptanceCriteria: readCellText(cells[3]),
      isApproved: readIsApproved(cells[4]),
    });
  }
  return rows;
}
