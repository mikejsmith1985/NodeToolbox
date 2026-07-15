// sourceModel.test.ts — Proves every gathered source can say where it came from, whatever kind it is
// (FR-024), and that a workbook is only ever reference material.

import { describe, expect, it } from 'vitest';

import {
  describeSourceOrigin,
  describeSourceTitle,
  formatWorkbookRowsAsText,
  mintSourceId,
  readSourceText,
  type ReferencedSource,
} from './sourceModel';

const CONFLUENCE_SOURCE: ReferencedSource = {
  kind: 'confluence',
  id: 'confluence-1',
  title: 'Claims brief',
  pageUrl: 'https://wiki/wiki/spaces/ART/pages/12345/Claims',
  pageId: '12345',
  text: 'Claimants cannot attach documents today.',
  fetchedAtIso: '2026-07-15T09:00:00.000Z',
};

const WORKBOOK_SOURCE: ReferencedSource = {
  kind: 'workbook',
  id: 'workbook-1',
  fileName: 'volumes.xlsx',
  sheetName: 'Summary',
  availableSheetNames: ['Summary', 'Detail'],
  rows: [{ Region: 'North', Claims: '3000' }],
};

const JIRA_SOURCE: ReferencedSource = {
  kind: 'jira',
  id: 'jira-1',
  issueKey: 'ABC-9',
  summary: 'Document storage spike',
  status: 'Done',
};

const PASTE_SOURCE: ReferencedSource = {
  kind: 'paste',
  id: 'paste-1',
  label: 'Teams thread with Jana',
  text: 'Jana confirmed the vendor SLA is 48 hours.',
};

describe('describeSourceOrigin — every source says where it came from (FR-024)', () => {
  it('gives a Confluence page its URL, so the PO can go back to the page itself', () => {
    expect(describeSourceOrigin(CONFLUENCE_SOURCE)).toBe(
      'https://wiki/wiki/spaces/ART/pages/12345/Claims',
    );
  });

  it('names the sheet when a workbook has several, so the reader is not misled', () => {
    expect(describeSourceOrigin(WORKBOOK_SOURCE)).toBe('volumes.xlsx · sheet "Summary"');
  });

  it('names only the file when there is one sheet, because the sheet adds nothing', () => {
    expect(describeSourceOrigin({ ...WORKBOOK_SOURCE, availableSheetNames: ['Summary'] })).toBe(
      'volumes.xlsx',
    );
  });

  it('gives a Jira source its key', () => {
    expect(describeSourceOrigin(JIRA_SOURCE)).toBe('ABC-9');
  });

  it('says plainly that a pasted note was pasted', () => {
    expect(describeSourceOrigin(PASTE_SOURCE)).toBe('Pasted');
  });
});

describe('describeSourceTitle', () => {
  it('titles each source readably', () => {
    expect(describeSourceTitle(CONFLUENCE_SOURCE)).toBe('Claims brief');
    expect(describeSourceTitle(WORKBOOK_SOURCE)).toBe('volumes.xlsx');
    expect(describeSourceTitle(JIRA_SOURCE)).toBe('ABC-9 — Document storage spike');
    expect(describeSourceTitle(PASTE_SOURCE)).toBe('Teams thread with Jana');
  });

  it('falls back to something meaningful when a title is missing', () => {
    expect(describeSourceTitle({ ...CONFLUENCE_SOURCE, title: '' })).toBe('Confluence page');
    expect(describeSourceTitle({ ...PASTE_SOURCE, label: '' })).toBe('Pasted note');
  });
});

describe('readSourceText', () => {
  it('reads a Confluence page as its text', () => {
    expect(readSourceText(CONFLUENCE_SOURCE)).toBe('Claimants cannot attach documents today.');
  });

  it('reads a Jira source as key, status, and summary', () => {
    expect(readSourceText(JIRA_SOURCE)).toBe('ABC-9 (Done): Document storage spike');
  });

  it('reads a workbook as readable lines', () => {
    expect(readSourceText(WORKBOOK_SOURCE)).toBe('Region: North · Claims: 3000');
  });
});

describe('formatWorkbookRowsAsText', () => {
  it('says so plainly when a sheet has no rows', () => {
    expect(formatWorkbookRowsAsText([])).toBe('(no rows)');
  });

  it('skips empty cells rather than printing bare column names', () => {
    expect(formatWorkbookRowsAsText([{ Region: 'North', Notes: '' }])).toBe('Region: North');
  });

  it('stops short on a huge sheet and SAYS it stopped, rather than truncating silently', () => {
    const manyRows = Array.from({ length: 120 }, (_, rowIndex) => ({ Row: String(rowIndex + 1) }));

    const formattedText = formatWorkbookRowsAsText(manyRows);

    expect(formattedText).toContain('and 70 more rows');
    expect(formattedText.split('\n')).toHaveLength(51);
  });
});

describe('mintSourceId', () => {
  it('mints an id unique within the workspace', () => {
    expect(mintSourceId([], 'paste')).toBe('paste-1');
    expect(mintSourceId([PASTE_SOURCE], 'paste')).toBe('paste-2');
  });

  it('keeps ids separate per kind, so removing one never disturbs another', () => {
    expect(mintSourceId([PASTE_SOURCE], 'confluence')).toBe('confluence-1');
  });

  it('skips ids already taken, however the workspace was assembled', () => {
    const sources = [PASTE_SOURCE, { ...PASTE_SOURCE, id: 'paste-2' }];

    expect(mintSourceId(sources, 'paste')).toBe('paste-3');
  });
});
