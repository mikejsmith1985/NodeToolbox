// piReviewTable.test.ts — Unit tests for parsing and rewriting the Confluence PI Review and confidence tracking markup.

import { describe, expect, it } from 'vitest';

import {
  createInitialPiReviewPageStorage,
  createEmptyConfidenceVoteRow,
  createEmptyPiReviewRow,
  exportPiReviewRowsToCsv,
  parsePiReviewCapacitySummary,
  parsePiReviewRowsFromSpreadsheetSheets,
  parseConfidenceVoteTable,
  parsePiReviewTable,
  writeConfidenceVoteTable,
  writePiReviewCapacitySummary,
  writePiReviewTable,
} from './piReviewTable.ts';

const MOCK_STORAGE_VALUE = `
  <h1>PI Review</h1>
  <table>
    <tbody>
      <tr>
        <th>YES - If this is a Carry-Over from a 26.2 Commit?</th>
        <th>Priority</th>
        <th>Feature</th>
        <th>Point Estimate</th>
        <th>Dependency</th>
        <th>Risks</th>
        <th>Committed?</th>
        <th>Notes</th>
      </tr>
      <tr>
        <td>Yes</td>
        <td>P1</td>
        <td>Feature A</td>
        <td>8</td>
        <td>Platform</td>
        <td>Vendor delay</td>
        <td>Yes</td>
        <td>Needs review</td>
      </tr>
    </tbody>
  </table>
  <h2>Confidence Vote Tracking</h2>
  <table>
    <tbody>
      <tr>
        <th>Week Of</th>
        <th>Fist of Five</th>
        <th>Notes</th>
      </tr>
      <tr>
        <td>2026-05-19</td>
        <td>4</td>
        <td>Green for the week</td>
      </tr>
    </tbody>
  </table>
`;

describe('parsePiReviewTable', () => {
  it('parses the first matching PI Review table from the Confluence storage body', () => {
    const result = parsePiReviewTable(MOCK_STORAGE_VALUE);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].feature).toBe('Feature A');
    expect(result.rows[0].carryOver).toBe('Yes');
  });

  it('finds the real header row when title rows appear above the PI Review headers', () => {
    const result = parsePiReviewTable(`
      <table>
        <tbody>
          <tr>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
          <tr>
            <th></th>
            <th></th>
            <th colspan="2">26.3 ask from the Business / PO</th>
            <th></th>
            <th></th>
            <th></th>
            <th></th>
          </tr>
          <tr>
            <th>YES - If this is a Carry-Over from a 26.2 Commit?</th>
            <th>Priority</th>
            <th>Feature</th>
            <th>Point Estimate</th>
            <th>Dependency</th>
            <th>Risks</th>
            <th>Committed?</th>
            <th>Notes</th>
          </tr>
          <tr>
            <td>No</td>
            <td>High</td>
            <td>Feature B</td>
            <td>13</td>
            <td>None</td>
            <td>N/A</td>
            <td>Yes</td>
            <td>Ready</td>
          </tr>
        </tbody>
      </table>
    `);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].feature).toBe('Feature B');
  });

  it('accepts practical header variants instead of requiring exact label text', () => {
    const result = parsePiReviewTable(`
      <table>
        <tbody>
          <tr>
            <th>Carry Over?</th>
            <th>Business Priority</th>
            <th>Candidate Feature</th>
            <th>Estimate</th>
            <th>Dependencies</th>
            <th>Risk / Issue</th>
            <th>Committed to PI?</th>
            <th>Comments</th>
          </tr>
          <tr>
            <td>No</td>
            <td>High</td>
            <td>Feature C</td>
            <td>21</td>
            <td>External API</td>
            <td>Vendor delay</td>
            <td>Yes</td>
            <td>Track closely</td>
          </tr>
        </tbody>
      </table>
    `);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].feature).toBe('Feature C');
    expect(result.rows[0].dependency).toBe('External API');
  });

  it('parses optional Dev Work and Test Support columns when they are present', () => {
    const result = parsePiReviewTable(`
      <table>
        <tbody>
          <tr>
            <th>Carry-Over</th>
            <th>Priority</th>
            <th>Feature</th>
            <th>Point Estimate</th>
            <th>Dependency</th>
            <th>Risks</th>
            <th>Committed to PI?</th>
            <th>Implementation Notes</th>
            <th>Dev Work</th>
            <th>Test Support</th>
          </tr>
          <tr>
            <td>No</td>
            <td>High</td>
            <td>Feature with split work</td>
            <td>8</td>
            <td>None</td>
            <td>Low</td>
            <td>Yes</td>
            <td>Needs both teams</td>
            <td>Yes</td>
            <td>Yes</td>
          </tr>
        </tbody>
      </table>
    `);

    expect(result.tableBinding.columnOrder).toContain('devWork');
    expect(result.tableBinding.columnOrder).toContain('testSupport');
    expect(result.rows[0].devWork).toBe('Yes');
    expect(result.rows[0].testSupport).toBe('Yes');
  });

  it('matches the PI Review header row even when Confluence injects an extra blank formatting column', () => {
    const result = parsePiReviewTable(`
      <table>
        <tbody>
          <tr>
            <th></th>
            <th>YES - If this is a Carry-Over from a 26.2 Commit?</th>
            <th>Priority</th>
            <th>Feature</th>
            <th>Point Estimate</th>
            <th>Dependency</th>
            <th>Risks</th>
            <th>Committed?</th>
            <th>Notes</th>
          </tr>
          <tr>
            <td></td>
            <td>No</td>
            <td>Medium</td>
            <td>Feature D</td>
            <td>5</td>
            <td>Shared service</td>
            <td>None</td>
            <td>Yes</td>
            <td>Formatting column present</td>
          </tr>
        </tbody>
      </table>
    `);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].feature).toBe('Feature D');
    expect(result.rows[0].notes).toBe('Formatting column present');
  });

  it('throws a clear error when the page does not contain the required headers', () => {
    expect(() => parsePiReviewTable('<table><tr><th>Wrong</th></tr></table>')).toThrow(
      'No Confluence table was found with the required PI Review headers',
    );
  });
});

describe('parsePiReviewRowsFromSpreadsheetSheets', () => {
  it('imports the Confluence XLSX export shape from GitHub issue 60', () => {
    const importedTable = parsePiReviewRowsFromSpreadsheetSheets([
      {
        sheetName: 'Sheet3',
        rows: [
          [
            'YES - If this is a Carry-Over from a 26.2 Commit?',
            'Priority',
            'Feature ',
            'Point Estimate',
            'Dependency',
            ' Risks',
            ' Committed?',
          ],
          [
            'No',
            'Medium',
            'DENP-1352 - 26.3 Enrollment Support',
            0,
            'TRACKING FEATURE ONLY - No DEV Work',
            'N/A',
            'Tracking feature, no Dev',
          ],
        ],
      },
    ]);

    expect(importedTable.sheetName).toBe('Sheet3');
    expect(importedTable.rows).toHaveLength(1);
    expect(importedTable.rows[0].feature).toBe('DENP-1352 - 26.3 Enrollment Support');
    expect(importedTable.rows[0].pointEstimate).toBe('0');
    expect(importedTable.rows[0].committed).toBe('');
    expect(importedTable.rows[0].notes).toBe('Tracking feature, no Dev');
  });

  it('skips title rows and imports optional checkbox columns when present', () => {
    const importedTable = parsePiReviewRowsFromSpreadsheetSheets([
      {
        sheetName: 'Planning',
        rows: [
          ['26.3 ask from the Business / PO'],
          ['', '', '', ''],
          ['Feature', 'Priority', 'Dev Work', 'Test Support', 'Committed to PI?', 'Notes'],
          ['Feature A', 'High', 'Yes', '', 'Yes', 'Ready'],
        ],
      },
    ]);

    expect(importedTable.importedColumnKeys).toContain('devWork');
    expect(importedTable.importedColumnKeys).toContain('testSupport');
    expect(importedTable.rows[0].devWork).toBe('Yes');
    expect(importedTable.rows[0].testSupport).toBe('');
    expect(importedTable.rows[0].committed).toBe('Yes');
  });

  it('preserves a dedicated notes column when committed also contains narrative text', () => {
    const importedTable = parsePiReviewRowsFromSpreadsheetSheets([
      {
        sheetName: 'Planning',
        rows: [
          ['Carry-Over', 'Priority', 'Feature', 'Estimate', 'Dependency', 'Risks', 'Committed?', 'Notes'],
          ['No', 'High', 'Feature with notes', 8, 'None', 'Low', 'Discuss commitment with PO', 'Keep this implementation note'],
        ],
      },
    ]);

    expect(importedTable.rows[0].committed).toBe('Discuss commitment with PO');
    expect(importedTable.rows[0].notes).toBe('Keep this implementation note');
  });

  it('throws a clear error when no worksheet has enough PI Review columns', () => {
    expect(() =>
      parsePiReviewRowsFromSpreadsheetSheets([
        { sheetName: 'Sheet1', rows: [['Wrong', 'Headers'], ['No', 'Match']] },
      ]),
    ).toThrow('No imported worksheet contained a PI Review table');
  });
});

describe('createInitialPiReviewPageStorage', () => {
  it('creates Toolbox-owned PI Review markup that the parser can read immediately', () => {
    const storageValue = createInitialPiReviewPageStorage();
    const parsedPiReviewTable = parsePiReviewTable(storageValue);
    const parsedConfidenceVoteTable = parseConfidenceVoteTable(storageValue);
    const parsedCapacitySummary = parsePiReviewCapacitySummary(storageValue);

    expect(storageValue).toContain('NodeToolbox PI Review');
    expect(storageValue).toContain('Team Capacity');
    expect(storageValue).toContain('style="width: 100%; table-layout: fixed;"');
    expect(parsedPiReviewTable.tableBinding.columnOrder).toEqual([
      'carryOver',
      'priority',
      'feature',
      'pointEstimate',
      'dependency',
      'risks',
      'committed',
      'notes',
    ]);
    expect(parsedPiReviewTable.rows).toEqual([]);
    expect(parsedConfidenceVoteTable.tableBinding?.columnOrder).toEqual([
      'weekOf',
      'confidenceVote',
      'notes',
    ]);
    expect(parsedCapacitySummary).toBeNull();
  });
});

describe('writePiReviewCapacitySummary', () => {
  it('writes a team capacity section above the PI Review table and can parse it back', () => {
    const nextStorageValue = writePiReviewCapacitySummary(MOCK_STORAGE_VALUE, {
      summaryLabel: 'Alpha Team Capacity',
      startDate: '2026-05-18',
      endDate: '2026-05-22',
      workDayCount: 5,
      totalCapacityPoints: 12.5,
      recommendedCapacityPoints: 10,
      roleCapacities: {
        Dev: 10,
        'Dev Lead': 0,
        QE: 2.5,
        'Test Lead': 0,
        BT: 0,
        SL: 0,
        SA: 0,
        PO: 0,
        TPO: 0,
        SM: 0,
      },
    });

    expect(nextStorageValue).toContain('Team Capacity');
    expect(nextStorageValue).toContain('Alpha Team Capacity');
    expect(nextStorageValue.indexOf('Alpha Team Capacity')).toBeLessThan(nextStorageValue.indexOf('<th>YES - If this is a Carry-Over'));

    expect(parsePiReviewCapacitySummary(nextStorageValue)).toEqual({
      summaryLabel: 'Alpha Team Capacity',
      startDate: '2026-05-18',
      endDate: '2026-05-22',
      workDayCount: 5,
      totalCapacityPoints: 12.5,
      recommendedCapacityPoints: 10,
      roleCapacities: {
        Dev: 10,
        'Dev Lead': 0,
        QE: 2.5,
        'Test Lead': 0,
        BT: 0,
        SL: 0,
        SA: 0,
        PO: 0,
        TPO: 0,
        SM: 0,
      },
    });
  });
});

describe('writePiReviewTable', () => {
  it('rewrites the matched PI Review table rows while preserving the rest of the page body', () => {
    const parsedTable = parsePiReviewTable(MOCK_STORAGE_VALUE);
    const updatedRow = {
      ...parsedTable.rows[0],
      notes: 'Ready for PI planning',
    };

    const nextStorageValue = writePiReviewTable(MOCK_STORAGE_VALUE, parsedTable.tableBinding, [updatedRow]);

    expect(nextStorageValue).toContain('<h1>PI Review</h1>');
    expect(nextStorageValue).toContain('Ready for PI planning');
    expect(nextStorageValue).toContain('style="width: 100%; table-layout: fixed;"');
    expect(nextStorageValue).not.toContain('Needs review');

    const reloadedTable = parsePiReviewTable(nextStorageValue);
    expect(reloadedTable.rows[0].notes).toBe('Ready for PI planning');
  });

  it('preserves title rows that appear above the real PI Review header row when saving', () => {
    const storageValueWithTitleRows = `
      <table>
        <tbody>
          <tr>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
          <tr>
            <th></th>
            <th></th>
            <th colspan="2">26.3 ask from the Business / PO</th>
            <th></th>
            <th></th>
            <th></th>
            <th></th>
          </tr>
          <tr>
            <th>YES - If this is a Carry-Over from a 26.2 Commit?</th>
            <th>Priority</th>
            <th>Feature</th>
            <th>Point Estimate</th>
            <th>Dependency</th>
            <th>Risks</th>
            <th>Committed?</th>
            <th>Notes</th>
          </tr>
          <tr>
            <td>No</td>
            <td>High</td>
            <td>Feature B</td>
            <td>13</td>
            <td>None</td>
            <td>N/A</td>
            <td>Yes</td>
            <td>Ready</td>
          </tr>
        </tbody>
      </table>
    `;
    const parsedTable = parsePiReviewTable(storageValueWithTitleRows);

    const nextStorageValue = writePiReviewTable(storageValueWithTitleRows, parsedTable.tableBinding, [
      {
        ...parsedTable.rows[0],
        notes: 'Still ready',
      },
    ]);

    expect(nextStorageValue).toContain('26.3 ask from the Business / PO');
    expect(nextStorageValue).toContain('Still ready');
  });

  it('preserves extra formatting columns when saving a matched PI Review table', () => {
    const storageValueWithFormattingColumn = `
      <table>
        <tbody>
          <tr>
            <th></th>
            <th>YES - If this is a Carry-Over from a 26.2 Commit?</th>
            <th>Priority</th>
            <th>Feature</th>
            <th>Point Estimate</th>
            <th>Dependency</th>
            <th>Risks</th>
            <th>Committed?</th>
            <th>Notes</th>
          </tr>
          <tr>
            <td></td>
            <td>No</td>
            <td>Medium</td>
            <td>Feature D</td>
            <td>5</td>
            <td>Shared service</td>
            <td>None</td>
            <td>Yes</td>
            <td>Formatting column present</td>
          </tr>
        </tbody>
      </table>
    `;
    const parsedTable = parsePiReviewTable(storageValueWithFormattingColumn);

    const nextStorageValue = writePiReviewTable(storageValueWithFormattingColumn, parsedTable.tableBinding, [
      {
        ...parsedTable.rows[0],
        notes: 'Formatting column still preserved',
      },
    ]);

    expect(nextStorageValue).toContain('<td></td><td>No</td>');
    expect(nextStorageValue).toContain('Formatting column still preserved');
  });

  it('skips the hard-commit boundary marker row while parsing PI Review data', () => {
    const storageValueWithCommitmentBoundary = `
      <table>
        <tbody>
          <tr>
            <th>Carry-Over</th>
            <th>Priority</th>
            <th>Feature</th>
            <th>Point Estimate</th>
            <th>Dependency</th>
            <th>Risks</th>
            <th>Committed to PI?</th>
            <th>Implementation Notes</th>
          </tr>
          <tr>
            <td>No</td>
            <td>1</td>
            <td>Hard commit feature</td>
            <td>8</td>
            <td>None</td>
            <td>Low</td>
            <td>Yes</td>
            <td>Above the line</td>
          </tr>
          <tr data-node-toolbox-pi-review-boundary="hard-commit">
            <td colspan="8">Hard commits above / Stretch goals below</td>
          </tr>
          <tr>
            <td>No</td>
            <td>2</td>
            <td>Stretch goal feature</td>
            <td>5</td>
            <td>None</td>
            <td>Medium</td>
            <td></td>
            <td>Below the line</td>
          </tr>
        </tbody>
      </table>
    `;

    const parsedTable = parsePiReviewTable(storageValueWithCommitmentBoundary);

    expect(parsedTable.rows.map((row) => row.feature)).toEqual(['Hard commit feature', 'Stretch goal feature']);
    expect(parsedTable.commitmentBoundaryIndex).toBe(1);
  });

  it('writes the hard-commit boundary marker between PI Review rows', () => {
    const parsedTable = parsePiReviewTable(MOCK_STORAGE_VALUE);
    const firstRow = {
      ...parsedTable.rows[0],
      feature: 'Hard commit feature',
    };
    const secondRow = {
      ...createEmptyPiReviewRow(),
      feature: 'Stretch goal feature',
      notes: 'Below the line',
    };

    const nextStorageValue = writePiReviewTable(
      MOCK_STORAGE_VALUE,
      parsedTable.tableBinding,
      [firstRow, secondRow],
      1,
    );

    expect(nextStorageValue).toContain('data-node-toolbox-pi-review-boundary="hard-commit"');
    expect(nextStorageValue.indexOf('Hard commit feature')).toBeLessThan(nextStorageValue.indexOf('Hard commits above / Stretch goals below'));
    expect(nextStorageValue.indexOf('Hard commits above / Stretch goals below')).toBeLessThan(nextStorageValue.indexOf('Stretch goal feature'));

    const reloadedTable = parsePiReviewTable(nextStorageValue);
    expect(reloadedTable.commitmentBoundaryIndex).toBe(1);
    expect(reloadedTable.rows.map((row) => row.feature)).toEqual(['Hard commit feature', 'Stretch goal feature']);
  });

  it('writes optional checkbox columns when the table binding includes them', () => {
    const parsedTable = parsePiReviewTable(`
      <table>
        <tbody>
          <tr>
            <th>Carry-Over</th>
            <th>Priority</th>
            <th>Feature</th>
            <th>Point Estimate</th>
            <th>Dependency</th>
            <th>Risks</th>
            <th>Committed to PI?</th>
            <th>Implementation Notes</th>
            <th>Dev Work</th>
            <th>Test Support</th>
          </tr>
        </tbody>
      </table>
    `);
    const nextRow = createEmptyPiReviewRow();
    nextRow.feature = 'Feature with optional flags';
    nextRow.devWork = 'Yes';
    nextRow.testSupport = 'Yes';

    const nextStorageValue = writePiReviewTable('<table><tr><th>Carry-Over</th><th>Priority</th><th>Feature</th><th>Point Estimate</th><th>Dependency</th><th>Risks</th><th>Committed to PI?</th><th>Implementation Notes</th><th>Dev Work</th><th>Test Support</th></tr></table>', parsedTable.tableBinding, [nextRow]);

    expect(nextStorageValue).toContain('<th>Dev Work</th>');
    expect(nextStorageValue).toContain('<th>Test Support</th>');
    expect(nextStorageValue).toContain('Feature with optional flags');
  });
});

describe('parseConfidenceVoteTable', () => {
  it('parses the optional confidence vote table when present', () => {
    const result = parseConfidenceVoteTable(MOCK_STORAGE_VALUE);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].weekOf).toBe('2026-05-19');
    expect(result.rows[0].confidenceVote).toBe('4');
  });

  it('returns an empty result when the confidence vote table is not present', () => {
    const result = parseConfidenceVoteTable('<h1>PI Review</h1>');

    expect(result.rows).toEqual([]);
    expect(result.tableBinding).toBeNull();
  });
});

describe('writeConfidenceVoteTable', () => {
  it('rewrites the matched confidence vote table rows', () => {
    const parsedTable = parseConfidenceVoteTable(MOCK_STORAGE_VALUE);
    const updatedRow = {
      ...parsedTable.rows[0],
      notes: 'Watch the dependency risk',
    };

    const nextStorageValue = writeConfidenceVoteTable(
      MOCK_STORAGE_VALUE,
      parsedTable.tableBinding,
      [updatedRow],
    );

    expect(nextStorageValue).toContain('Watch the dependency risk');
    expect(nextStorageValue).not.toContain('Green for the week');
  });

  it('creates a new confidence vote section when the page does not have one yet', () => {
    const row = createEmptyConfidenceVoteRow();
    row.weekOf = '2026-05-26';
    row.confidenceVote = '5';
    row.notes = 'Strong plan confidence';

    const nextStorageValue = writeConfidenceVoteTable('<h1>PI Review</h1>', null, [row]);

    expect(nextStorageValue).toContain('Confidence Vote Tracking');
    expect(nextStorageValue).toContain('Strong plan confidence');
    expect(parseConfidenceVoteTable(nextStorageValue).rows[0].confidenceVote).toBe('5');
  });
});

describe('exportPiReviewRowsToCsv', () => {
  it('serializes the editable PI Review rows into CSV text', () => {
    const row = createEmptyPiReviewRow();
    row.feature = 'Feature A';
    row.notes = 'Carry over';

    const csvContent = exportPiReviewRowsToCsv([row]);

    expect(csvContent).toContain('Carry-Over,Priority,Feature,Point Estimate,Dependency,Risks,Committed to PI?,Implementation Notes');
    expect(csvContent).toContain('"Feature A"');
    expect(csvContent).toContain('"Carry over"');
  });
});
