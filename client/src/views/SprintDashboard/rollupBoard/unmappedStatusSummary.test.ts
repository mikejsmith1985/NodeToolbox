// unmappedStatusSummary.test.ts — Proves the Unmapped column explains itself: which states are sitting
// there, how many issues each accounts for, and which column already came closest to claiming them.

import { describe, expect, it } from 'vitest';

import {
  describeStatusPair,
  describeUnmappedBoardShare,
  describeUnmappedStatusGroup,
  summarizeUnmappedStatuses,
} from './unmappedStatusSummary.ts';
import { UNMAPPED_COLUMN_ID, type RenderedColumn, type RollupBoardItem } from './rollupBoardTypes.ts';

function buildItem(key: string, statusName: string, subStatusValue: string | null, columnId = UNMAPPED_COLUMN_ID) {
  return { key, statusName, subStatusValue, columnId } as unknown as RollupBoardItem;
}

const COLUMNS: RenderedColumn[] = [
  {
    id: 'col-working',
    name: 'Working',
    order: 0,
    mappings: [{ jiraStatusName: 'In Progress', subStatusValue: 'Working' }],
    isUnmappedColumn: false,
  },
  { id: UNMAPPED_COLUMN_ID, name: 'Unmapped', order: 99, mappings: [], isUnmappedColumn: true },
];

describe('describeStatusPair', () => {
  it('names both halves, because a card can be unmapped on the sub-status alone', () => {
    expect(describeStatusPair('In Progress', 'Code Review')).toBe('In Progress / Code Review');
  });

  it('names just the status when there is no sub-status, rather than a trailing slash', () => {
    expect(describeStatusPair('Triage', null)).toBe('Triage');
    expect(describeStatusPair('Triage', '   ')).toBe('Triage');
  });
});

describe('summarizeUnmappedStatuses', () => {
  it('ignores everything that already has a column', () => {
    const groups = summarizeUnmappedStatuses(
      [buildItem('DEV-1', 'In Progress', 'Working', 'col-working')],
      UNMAPPED_COLUMN_ID,
      COLUMNS,
    );

    expect(groups).toEqual([]);
  });

  it('groups by state so one missing mapping is one line, not forty-seven', () => {
    const groups = summarizeUnmappedStatuses(
      [
        buildItem('DEV-1', 'In Progress', 'Code Review'),
        buildItem('DEV-2', 'In Progress', 'Code Review'),
        buildItem('DEV-3', 'Triage', null),
      ],
      UNMAPPED_COLUMN_ID,
      COLUMNS,
    );

    expect(groups).toHaveLength(2);
    expect(groups[0].issueCount).toBe(2);
  });

  it('puts the state holding the most issues first — that mapping clears the most cards', () => {
    const groups = summarizeUnmappedStatuses(
      [
        buildItem('DEV-1', 'Triage', null),
        buildItem('DEV-2', 'In Progress', 'Code Review'),
        buildItem('DEV-3', 'In Progress', 'Code Review'),
      ],
      UNMAPPED_COLUMN_ID,
      COLUMNS,
    );

    expect(groups[0].statusName).toBe('In Progress');
  });

  it('names the column that already claims the status under another sub-status', () => {
    const [group] = summarizeUnmappedStatuses(
      [buildItem('DEV-1', 'In Progress', 'Code Review')],
      UNMAPPED_COLUMN_ID,
      COLUMNS,
    );

    expect(group.nearestColumnName).toBe('Working');
  });

  it('names no column when nothing claims the status at all', () => {
    const [group] = summarizeUnmappedStatuses([buildItem('DEV-1', 'Triage', null)], UNMAPPED_COLUMN_ID, COLUMNS);

    expect(group.nearestColumnName).toBeNull();
  });

  it('treats a blank sub-status as none, so the same state never splits into two groups', () => {
    const groups = summarizeUnmappedStatuses(
      [buildItem('DEV-1', 'Triage', null), buildItem('DEV-2', 'Triage', '  ')],
      UNMAPPED_COLUMN_ID,
      COLUMNS,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].issueCount).toBe(2);
  });

  it('names a few examples without listing every issue', () => {
    const groups = summarizeUnmappedStatuses(
      ['DEV-1', 'DEV-2', 'DEV-3', 'DEV-4', 'DEV-5'].map((key) => buildItem(key, 'Triage', null)),
      UNMAPPED_COLUMN_ID,
      COLUMNS,
    );

    expect(groups[0].issueCount).toBe(5);
    expect(groups[0].exampleIssueKeys).toHaveLength(3);
  });
});

describe('describeUnmappedStatusGroup', () => {
  it('says what is unclaimed and which column would most likely claim it', () => {
    const [group] = summarizeUnmappedStatuses(
      [buildItem('DEV-1', 'In Progress', 'Code Review')],
      UNMAPPED_COLUMN_ID,
      COLUMNS,
    );

    const sentence = describeUnmappedStatusGroup(group);
    expect(sentence).toContain('In Progress / Code Review');
    expect(sentence).toContain('Working');
    expect(sentence).toContain('DEV-1');
  });

  it('sends the user to Board setup when no column claims the status at all', () => {
    const [group] = summarizeUnmappedStatuses([buildItem('DEV-1', 'Triage', null)], UNMAPPED_COLUMN_ID, COLUMNS);

    expect(describeUnmappedStatusGroup(group)).toContain('No column claims this status at all');
  });
});

describe('describeUnmappedBoardShare', () => {
  it('says nothing when a handful of issues are unmapped, which is ordinary', () => {
    expect(describeUnmappedBoardShare(3, 100)).toBe('');
  });

  it('raises it once Unmapped holds a tenth of the board', () => {
    const notice = describeUnmappedBoardShare(25, 92);

    expect(notice).toContain('25 of 92');
    expect(notice).toContain('27%');
    expect(notice).toContain('Board setup');
  });

  it('says nothing at all on a board with nothing unmapped, or nothing on it', () => {
    expect(describeUnmappedBoardShare(0, 92)).toBe('');
    expect(describeUnmappedBoardShare(0, 0)).toBe('');
    expect(describeUnmappedBoardShare(5, 0)).toBe('');
  });

  it('fires exactly at the threshold, not just above it', () => {
    expect(describeUnmappedBoardShare(10, 100)).not.toBe('');
    expect(describeUnmappedBoardShare(9, 100)).toBe('');
  });
});
