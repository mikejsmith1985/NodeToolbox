// rewriteReviewDoc.test.ts — The Confluence review page build + parse round-trip (spec 030, GH #220).
// Proves the before/after table survives a write→edit→read loop: proposed text comes back, an Approve
// tick is detected, the table is found by its headers, and stray rows are ignored.

import { describe, expect, it } from 'vitest';

import { buildReviewPageStorage, parseReviewPageStorage } from './rewriteReviewDoc.ts';
import type { BatchExportInput } from './rewriteBatchModel';

function item(jiraKey: string, description: string, acceptanceCriteria: string): BatchExportInput {
  return {
    jiraKey,
    original: { summary: `${jiraKey} summary`, description: 'old desc', acceptanceCriteria: 'old ac', capturedAtIso: 'x' },
    proposed: { description, acceptanceCriteria, isEdited: false },
  };
}

describe('rewriteReviewDoc round-trip', () => {
  it('writes a before/after table and reads the proposed columns back', () => {
    const items = [
      item('DENP-1', 'Description:\nfirst line\n\nBenefit Hypothesis:\nvalue', 'AC one'),
      item('DASP-2', 'Description:\nsecond feature', 'AC two'),
    ];
    const storage = buildReviewPageStorage(items);
    const rows = parseReviewPageStorage(storage);

    expect(rows.map((row) => row.jiraKey)).toEqual(['DENP-1', 'DASP-2']);
    expect(rows[0].description).toBe('Description:\nfirst line\n\nBenefit Hypothesis:\nvalue');
    expect(rows[0].acceptanceCriteria).toBe('AC one');
    expect(rows[1].description).toBe('Description:\nsecond feature');
    // Freshly published rows are un-ticked.
    expect(rows.every((row) => row.isApproved === false)).toBe(true);
  });

  it('detects an Approve tick (task-status complete) on the row the PO checked', () => {
    const storage = buildReviewPageStorage([item('DENP-1', 'Description:\nx', 'AC')]);
    // Simulate the PO ticking the checkbox in Confluence: the stored status flips to "complete".
    const ticked = storage.replace('<ac:task-status>incomplete</ac:task-status>', '<ac:task-status>complete</ac:task-status>');
    const rows = parseReviewPageStorage(ticked);
    expect(rows[0].isApproved).toBe(true);
  });

  it('reflects the PO editing the proposed text on the page', () => {
    const storage = buildReviewPageStorage([item('DENP-1', 'Description:\noriginal', 'AC')]);
    const edited = storage.replace('original', 'the PO reworded this');
    const rows = parseReviewPageStorage(edited);
    expect(rows[0].description).toContain('the PO reworded this');
  });

  it('returns nothing when the page has no review table', () => {
    expect(parseReviewPageStorage('<p>Just some other Confluence content.</p>')).toEqual([]);
  });

  it('lays out Before and Proposed as side-by-side columns, with a row per section', () => {
    const storage = buildReviewPageStorage([item('DENP-1', 'Description:\nx', 'AC one')]);
    // Before column header sits left of the Proposed column header.
    expect(storage.indexOf('<th>Before</th>')).toBeLessThan(storage.indexOf('<th>Proposed — edit here</th>'));
    // Each issue has a Description row and an Acceptance Criteria row.
    expect(storage).toContain('<strong>Description</strong>');
    expect(storage).toContain('<strong>Acceptance Criteria</strong>');
  });

  it('highlights a validation-marked proposed line and still reads it back clean', () => {
    const items = [item('DENP-1', 'Description:\nok\n\nAssumptions:\n⚠ REQUIRES BUSINESS VALIDATION the details', 'AC')];
    const storage = buildReviewPageStorage(items);
    expect(storage).toContain('background-color'); // the ⚠ line is visually highlighted
    // The highlight is markup only — the parsed text is clean.
    expect(parseReviewPageStorage(storage)[0].description).toContain('⚠ REQUIRES BUSINESS VALIDATION the details');
  });

  it('ignores a stray row with no Jira key', () => {
    const storage = buildReviewPageStorage([item('DENP-1', 'Description:\nx', 'AC')]);
    // A reviewer pastes an extra note row into the table body — it has no key, so it is skipped.
    const withStray = storage.replace('</tbody>', '<tr><td>note</td><td/><td>random</td><td/><td/></tr></tbody>');
    const rows = parseReviewPageStorage(withStray);
    expect(rows.map((row) => row.jiraKey)).toEqual(['DENP-1']);
  });
});
