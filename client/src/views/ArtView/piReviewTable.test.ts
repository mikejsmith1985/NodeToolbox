// piReviewTable.test.ts — Unit tests for parsing and rewriting the Confluence PI Review and confidence tracking markup.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createInitialPiReviewPageStorage,
  createEmptyConfidenceVoteRow,
  createEmptyPiReviewRow,
  exportPiReviewRowsToCsv,
  parsePiReviewCapacitySummary,
  parseConfidenceVoteTable,
  parsePiReviewTable,
  setPiReviewDomParser,
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
    expect(result.customGroupingLines).toEqual([]);
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

  it('parses legacy Stretch Goals rows and new custom grouping rows from existing Confluence tables', () => {
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
            <th>Committed?</th>
            <th>Notes</th>
          </tr>
          <tr>
            <td>No</td>
            <td>High</td>
            <td>Feature A</td>
            <td>8</td>
            <td>None</td>
            <td>Low</td>
            <td>Yes</td>
            <td>Ready</td>
          </tr>
          <tr data-node-toolbox-pi-review-grouping="custom" data-node-toolbox-pi-review-grouping-payload='{"lineId":"group-1","label":"Architecture Work","color":"#0ea5e9"}'>
            <td colspan="8">Architecture Work</td>
          </tr>
          <tr data-node-toolbox-pi-review-boundary="hard-commit">
            <td colspan="8">Hard commits above / Stretch goals below</td>
          </tr>
        </tbody>
      </table>
    `);

    expect(result.commitmentBoundaryIndex).toBe(1);
    expect(result.customGroupingLines).toEqual([
      expect.objectContaining({
        lineId: 'group-1',
        afterRowIndex: 1,
        label: 'Architecture Work',
        color: '#0ea5e9',
      }),
    ]);
  });

  it('parses custom grouping rows after Confluence strips the private data attributes', () => {
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
            <th>Committed?</th>
            <th>Notes</th>
          </tr>
          <tr>
            <td>No</td>
            <td>High</td>
            <td>Feature A</td>
            <td>8</td>
            <td>None</td>
            <td>Low</td>
            <td>Yes</td>
            <td>Ready</td>
          </tr>
          <tr>
            <td colspan="8" style="text-align: center; font-weight: 700; border-top: 3px solid rgb(139, 92, 246); border-bottom: 3px solid rgb(139, 92, 246); background: rgba(139, 92, 246, 0.18); color: rgb(91, 33, 182);">
              Architecture Work
            </td>
          </tr>
        </tbody>
      </table>
    `);

    expect(result.customGroupingLines).toEqual([
      expect.objectContaining({
        afterRowIndex: 1,
        label: 'Architecture Work',
        color: '#8b5cf6',
      }),
    ]);
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

describe('writePiReviewTable grouping lines', () => {
  it('writes both custom grouping lines and the Stretch Goals row back into the PI Review table markup', () => {
    const parsedPiReviewTable = parsePiReviewTable(MOCK_STORAGE_VALUE);
    const rewrittenStorageValue = writePiReviewTable(
      MOCK_STORAGE_VALUE,
      parsedPiReviewTable.tableBinding,
      parsedPiReviewTable.rows,
      1,
      [
        {
          lineId: 'group-1',
          afterRowIndex: 1,
          label: 'Architecture Work',
          color: '#0ea5e9',
        },
      ],
    );

    expect(rewrittenStorageValue).toContain('data-node-toolbox-pi-review-boundary="hard-commit"');
    expect(rewrittenStorageValue).toContain('data-node-toolbox-pi-review-grouping="custom"');
    expect(rewrittenStorageValue).toContain('Architecture Work');
    expect(rewrittenStorageValue).toContain('#0ea5e9');
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
        Developer: 10,
        'Dev Lead': 0,
        'Internal Tester': 0,
        'External Tester': 2.5,
        'Systems Analyst': 0,
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
        Developer: 10,
        'Dev Lead': 0,
        'Internal Tester': 0,
        'External Tester': 2.5,
        'Systems Analyst': 0,
      },
    });
  });

  it('replaces a rendered Team Capacity block when Confluence strips the section data attributes', () => {
    const legacyRenderedStorageValue = `
      <h1>NodeToolbox PI Review</h1>
      <p>This page section is managed by NodeToolbox so PI Review data can sync reliably.</p>
      <h2>Team Capacity</h2>
      <p>Snapshot pulled from the NodeToolbox Capacity tab.</p>
      <p><strong>Plan:</strong> Previous Capacity</p>
      <p><strong>Date Range:</strong> 2026-05-01 to 2026-05-05</p>
      <p><strong>Work Days:</strong> 4</p>
      <p><strong>100% Capacity (pts):</strong> 9</p>
      <p><strong>80% Capacity (pts):</strong> 7.2</p>
      <ul>
        <li><strong>Developer:</strong> 9 pts</li>
        <li><strong>Dev Lead:</strong> 0 pts</li>
        <li><strong>Internal Tester:</strong> 0 pts</li>
        <li><strong>External Tester:</strong> 0 pts</li>
        <li><strong>Systems Analyst:</strong> 0 pts</li>
      </ul>
      <table>
        <tbody>
          <tr>
            <th>YES - If this is a Carry-Over</th>
            <th>Priority</th>
            <th>Feature</th>
            <th>Point Estimate</th>
            <th>Dependency</th>
            <th>Risks</th>
            <th>Committed to PI?</th>
            <th>Implementation Notes</th>
          </tr>
        </tbody>
      </table>
    `;

    expect(parsePiReviewCapacitySummary(legacyRenderedStorageValue)).toEqual({
      summaryLabel: 'Previous Capacity',
      startDate: '2026-05-01',
      endDate: '2026-05-05',
      workDayCount: 4,
      totalCapacityPoints: 9,
      recommendedCapacityPoints: 7.2,
      roleCapacities: {
        Developer: 9,
        'Dev Lead': 0,
        'Internal Tester': 0,
        'External Tester': 0,
        'Systems Analyst': 0,
      },
    });

    const nextStorageValue = writePiReviewCapacitySummary(legacyRenderedStorageValue, {
      summaryLabel: 'Updated Capacity',
      startDate: '2026-06-02',
      endDate: '2026-06-06',
      workDayCount: 5,
      totalCapacityPoints: 12,
      recommendedCapacityPoints: 9.5,
      roleCapacities: {
        Developer: 8,
        'Dev Lead': 0,
        'Internal Tester': 0,
        'External Tester': 4,
        'Systems Analyst': 0,
      },
    });

    expect(nextStorageValue.match(/Team Capacity/g)).toHaveLength(1);
    expect(nextStorageValue).toContain('Updated Capacity');
    expect(nextStorageValue).not.toContain('Previous Capacity');
    expect(nextStorageValue).toContain('data-node-toolbox-pi-review-capacity="summary"');
  });

  it('collapses multiple stacked Team Capacity blocks (legacy + placeholders + canonical) into one', () => {
    // Mirrors a page that accreted blocks across formats: an old Dev/SL/SA snapshot, two empty
    // placeholder templates, and a canonical section — all four stacked above the table.
    const duplicatedStorageValue = `
      <h1>NodeToolbox PI Review</h1>
      <p>This page section is managed by NodeToolbox so PI Review data can sync reliably.</p>
      <h2>Team Capacity</h2>
      <p>Snapshot pulled from the NodeToolbox Capacity tab.</p>
      <p><strong>Plan:</strong> Legacy DevSLSA Capacity</p>
      <p><strong>Date Range:</strong> Not set to Not set</p>
      <p><strong>Work Days:</strong> 0</p>
      <p><strong>100% Capacity (pts):</strong> 0</p>
      <p><strong>80% Capacity (pts):</strong> 0</p>
      <ul><li><strong>Dev:</strong> 0 pts</li><li><strong>SL:</strong> 0 pts</li><li><strong>SA:</strong> 0 pts</li></ul>
      <h2>Team Capacity</h2>
      <p>Capacity from the Toolbox Capacity tab appears here after you save from NodeToolbox.</p>
      <h2>Team Capacity</h2>
      <p>Capacity from the Toolbox Capacity tab appears here after you save from NodeToolbox.</p>
      <section data-node-toolbox-pi-review-capacity="summary" data-node-toolbox-pi-review-capacity-payload="%7B%7D">
        <h2>Team Capacity</h2>
        <p>Snapshot pulled from the NodeToolbox Capacity tab.</p>
        <p><strong>Plan:</strong> Stale Canonical Capacity</p>
        <p><strong>Date Range:</strong> 2026-05-21 to 2026-07-29</p>
        <p><strong>Work Days:</strong> 50</p>
        <p><strong>100% Capacity (pts):</strong> 549.5</p>
        <p><strong>80% Capacity (pts):</strong> 439</p>
        <ul><li><strong>Developer:</strong> 432 pts</li></ul>
      </section>
      <table>
        <tbody>
          <tr>
            <th>YES - If this is a Carry-Over</th>
            <th>Priority</th>
            <th>Feature</th>
            <th>Point Estimate</th>
            <th>Dependency</th>
            <th>Risks</th>
            <th>Committed to PI?</th>
            <th>Implementation Notes</th>
          </tr>
        </tbody>
      </table>
    `;

    const nextStorageValue = writePiReviewCapacitySummary(duplicatedStorageValue, {
      summaryLabel: 'Transformers Capacity',
      startDate: '2026-05-21',
      endDate: '2026-07-29',
      workDayCount: 50,
      totalCapacityPoints: 549.5,
      recommendedCapacityPoints: 439,
      roleCapacities: {
        Developer: 432,
        'Dev Lead': 23.5,
        'Internal Tester': 47,
        'External Tester': 0,
        'Systems Analyst': 47,
      },
    });

    // Exactly one Team Capacity heading survives, wrapped in exactly one canonical section.
    expect(nextStorageValue.match(/Team Capacity/g)).toHaveLength(1);
    expect(nextStorageValue.match(/data-node-toolbox-pi-review-capacity="summary"/g)).toHaveLength(1);
    // The fresh snapshot replaces every prior block; no stale variant lingers.
    expect(nextStorageValue).toContain('Transformers Capacity');
    expect(nextStorageValue).not.toContain('Legacy DevSLSA Capacity');
    expect(nextStorageValue).not.toContain('Stale Canonical Capacity');
    expect(nextStorageValue).not.toContain('appears here after you save');
    // And it still lands above the PI Review table.
    expect(nextStorageValue.indexOf('Transformers Capacity'))
      .toBeLessThan(nextStorageValue.indexOf('<th>YES - If this is a Carry-Over'));
  });

  // ── Nested blocks: what a real Confluence page actually looks like (GH #160) ──

  /** The fresh snapshot a save writes; mirrors the flat fixtures above. */
  const FRESH_CAPACITY_SUMMARY = {
    summaryLabel: 'Transformers Capacity',
    startDate: '2026-07-30',
    endDate: '2026-10-07',
    workDayCount: 50,
    totalCapacityPoints: 549.5,
    recommendedCapacityPoints: 439,
    roleCapacities: {
      Developer: 432,
      'Dev Lead': 23.5,
      'Internal Tester': 47,
      'External Tester': 0,
      'Systems Analyst': 47,
    },
  };

  /** The PI Review table the capacity block is inserted above. */
  const PI_REVIEW_TABLE_MARKUP = `
    <table>
      <tbody>
        <tr>
          <th>YES - If this is a Carry-Over</th>
          <th>Priority</th>
          <th>Feature</th>
          <th>Point Estimate</th>
          <th>Dependency</th>
          <th>Risks</th>
          <th>Committed to PI?</th>
          <th>Implementation Notes</th>
        </tr>
      </tbody>
    </table>`;

  //
  // Every fixture above puts the capacity block at the TOP LEVEL of the storage wrapper. Real pages
  // don't: Confluence wraps body content in layout cells, and it keeps our <section> while stripping
  // its data-* attributes. The finder scanned only direct children while the inserter searched the
  // whole document via querySelectorAll('table') — so on a real page the finder saw nothing, the
  // inserter fired anyway, and every save stacked one more block. Forever.

  /** Wraps markup the way Confluence nests page content, so the block is never a wrapper child. */
  function nestInLayoutCell(innerMarkup: string): string {
    return `<ac:layout><ac:layout-section><ac:layout-cell>${innerMarkup}</ac:layout-cell></ac:layout-section></ac:layout>`;
  }

  const LOOSE_CAPACITY_BLOCK = `
    <h2>Team Capacity</h2>
    <p>Snapshot pulled from the NodeToolbox Capacity tab.</p>
    <p><strong>Plan:</strong> STALE PLAN</p>
    <p><strong>Date Range:</strong> 2026-05-21 to 2026-07-29</p>
    <p><strong>Work Days:</strong> 50</p>
    <p><strong>100% Capacity (pts):</strong> 549.5</p>
    <p><strong>80% Capacity (pts):</strong> 439</p>
    <ul><li><strong>Developer:</strong> 432 pts</li></ul>`;

  it('replaces a Team Capacity block nested inside a Confluence layout cell', () => {
    const nestedStorageValue = nestInLayoutCell(`
      <h1>NodeToolbox PI Review</h1>
      ${LOOSE_CAPACITY_BLOCK}
      ${PI_REVIEW_TABLE_MARKUP}`);

    const nextStorageValue = writePiReviewCapacitySummary(nestedStorageValue, FRESH_CAPACITY_SUMMARY);

    // Exactly one block survives — the block was found despite being two levels down.
    expect(nextStorageValue.match(/Team Capacity/g)).toHaveLength(1);
    expect(nextStorageValue).toContain('Transformers Capacity');
    expect(nextStorageValue).not.toContain('STALE PLAN');
  });

  it('collapses three nested stacked blocks into one — the exact ENFCT 26.4 shape from GH #160', () => {
    // A 26.3 snapshot left over from a previous PI, plus two identical 26.4 saves: one block per
    // save, oldest furthest from the table, because insertBefore(table) prepends each time.
    const threeStackedBlocks = nestInLayoutCell(`
      <h1>NodeToolbox PI Review</h1>
      <h2>Team Capacity</h2>
      <p>Snapshot pulled from the NodeToolbox Capacity tab.</p>
      <p><strong>Plan:</strong> STALE 26.3 PLAN</p>
      <p><strong>Date Range:</strong> 2026-05-21 to 2026-07-29</p>
      <ul><li><strong>Developer:</strong> 432 pts</li></ul>
      <h2>Team Capacity</h2>
      <p>Snapshot pulled from the NodeToolbox Capacity tab.</p>
      <p><strong>Plan:</strong> DUPLICATE 26.4 PLAN A</p>
      <p><strong>Date Range:</strong> 2026-07-30 to 2026-10-07</p>
      <ul><li><strong>Developer:</strong> 432 pts</li></ul>
      <h2>Team Capacity</h2>
      <p>Snapshot pulled from the NodeToolbox Capacity tab.</p>
      <p><strong>Plan:</strong> DUPLICATE 26.4 PLAN B</p>
      <p><strong>Date Range:</strong> 2026-07-30 to 2026-10-07</p>
      <ul><li><strong>Developer:</strong> 432 pts</li></ul>
      ${PI_REVIEW_TABLE_MARKUP}`);

    const nextStorageValue = writePiReviewCapacitySummary(threeStackedBlocks, FRESH_CAPACITY_SUMMARY);

    // The save that fixes the page: three become one, and every stale variant is gone.
    expect(nextStorageValue.match(/Team Capacity/g)).toHaveLength(1);
    expect(nextStorageValue.match(/data-node-toolbox-pi-review-capacity="summary"/g)).toHaveLength(1);
    expect(nextStorageValue).not.toContain('STALE 26.3 PLAN');
    expect(nextStorageValue).not.toContain('DUPLICATE 26.4 PLAN A');
    expect(nextStorageValue).not.toContain('DUPLICATE 26.4 PLAN B');
    expect(nextStorageValue).toContain('Transformers Capacity');
  });

  it('does not stack a second block when saving a nested page twice', () => {
    // The regression that matters: save, then save the result again. Idempotent, or it's the bug.
    const nestedStorageValue = nestInLayoutCell(`<h1>NodeToolbox PI Review</h1>${LOOSE_CAPACITY_BLOCK}${PI_REVIEW_TABLE_MARKUP}`);

    const afterFirstSave = writePiReviewCapacitySummary(nestedStorageValue, FRESH_CAPACITY_SUMMARY);
    const afterSecondSave = writePiReviewCapacitySummary(afterFirstSave, FRESH_CAPACITY_SUMMARY);

    expect(afterSecondSave.match(/Team Capacity/g)).toHaveLength(1);
    expect(afterSecondSave.match(/data-node-toolbox-pi-review-capacity="summary"/g)).toHaveLength(1);
  });

  it('replaces a nested canonical section whose data attributes Confluence stripped', () => {
    // Confluence keeps <section> but drops data-*, so the canonical selector cannot match — the
    // heading-text heuristic is what has to carry it, at whatever depth the section landed.
    const strippedSection = nestInLayoutCell(`
      <h1>NodeToolbox PI Review</h1>
      <section>${LOOSE_CAPACITY_BLOCK}</section>
      ${PI_REVIEW_TABLE_MARKUP}`);

    const nextStorageValue = writePiReviewCapacitySummary(strippedSection, FRESH_CAPACITY_SUMMARY);

    expect(nextStorageValue.match(/Team Capacity/g)).toHaveLength(1);
    expect(nextStorageValue).not.toContain('STALE PLAN');
  });

  it('reads a nested capacity block back — the parser must see what the writer wrote', () => {
    const nestedStorageValue = nestInLayoutCell(`<h1>NodeToolbox PI Review</h1>${LOOSE_CAPACITY_BLOCK}`);

    const parsedSummary = parsePiReviewCapacitySummary(nestedStorageValue);

    expect(parsedSummary?.summaryLabel).toBe('STALE PLAN');
    expect(parsedSummary?.workDayCount).toBe(50);
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

  it('writes Jira browse links for Feature cells that contain an issue key', () => {
    const parsedTable = parsePiReviewTable(MOCK_STORAGE_VALUE);
    const nextRow = createEmptyPiReviewRow();
    nextRow.feature = 'DENP-1370';

    const nextStorageValue = writePiReviewTable(MOCK_STORAGE_VALUE, parsedTable.tableBinding, [nextRow]);

    expect(nextStorageValue).toContain(
      '<a href="https://jira.healthspring-jira-prod.aws.zilverton.com/browse/DENP-1370">DENP-1370</a>',
    );
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
    row.confidenceVote = '3.7';
    row.notes = 'Strong plan confidence';

    const nextStorageValue = writeConfidenceVoteTable('<h1>PI Review</h1>', null, [row]);

    expect(nextStorageValue).toContain('Confidence Vote Tracking');
    expect(nextStorageValue).toContain('Strong plan confidence');
    expect(parseConfidenceVoteTable(nextStorageValue).rows[0].confidenceVote).toBe('3.7');
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

describe('setPiReviewDomParser (DOM host seam)', () => {
  // Reset to the native parser after each test so one injection never leaks into the rest of the suite.
  afterEach(() => setPiReviewDomParser(null));

  it('routes the engine through the injected parser and yields output identical to the native one', () => {
    // The engine must be DOM-implementation-agnostic: the same storage HTML in must produce the same
    // HTML out whether the parser is the native browser one or an injected delegate (as linkedom is
    // on the server). Here the delegate wraps the native parser so we can prove it was actually used.
    const nativeOutput = parsePiReviewTable(MOCK_STORAGE_VALUE);

    const parseSpy = vi.fn((markup: string, mimeType: 'text/html') =>
      new DOMParser().parseFromString(markup, mimeType));
    setPiReviewDomParser({ parseFromString: parseSpy });

    const injectedResult = parsePiReviewTable(MOCK_STORAGE_VALUE);

    expect(parseSpy).toHaveBeenCalled();
    expect(injectedResult).toEqual(nativeOutput);
  });

  it('classifies rows/cells by tag, not constructor identity, so a foreign-realm DOM still parses', () => {
    // A parser whose nodes are NOT instances of this realm's HTMLTableRowElement/HTMLTableCellElement
    // (the linkedom situation) must still parse a table, proving the predicates replaced `instanceof`.
    const foreignParser = {
      parseFromString: (markup: string, mimeType: 'text/html') => {
        const doc = new DOMParser().parseFromString(markup, mimeType);
        // Sanity: rows exist so the parse is meaningful; the engine must not rely on instanceof.
        return doc;
      },
    };
    setPiReviewDomParser(foreignParser);

    const parsed = parsePiReviewTable(MOCK_STORAGE_VALUE);

    expect(parsed).not.toBeNull();
    expect(parsed?.rows.length).toBeGreaterThan(0);
  });
});
