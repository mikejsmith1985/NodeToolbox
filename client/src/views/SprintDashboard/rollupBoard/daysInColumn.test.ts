// daysInColumn.test.ts — How long a card has been sitting where it is.

import { describe, expect, it } from 'vitest';

import { countDaysInColumn, readColumnEntryIso, type ColumnChangeHistory } from './daysInColumn.ts';

const SUB_STATUS_FIELD_NAMES = ['Status Summary'];

function change(createdIso: string, field: string, toValue: string): ColumnChangeHistory {
  return { created: createdIso, items: [{ field, toString: toValue }] };
}

function entryFor(
  changeHistories: ColumnChangeHistory[],
  statusName = 'Working',
  subStatusValue: string | null = null,
  createdIso: string | null = '2026-08-01T09:00:00.000Z',
) {
  return readColumnEntryIso({
    changeHistories,
    statusName,
    subStatusValue,
    subStatusFieldNames: SUB_STATUS_FIELD_NAMES,
    createdIso,
  });
}

describe('readColumnEntryIso', () => {
  it('reads the moment the card moved into its current status', () => {
    expect(entryFor([change('2026-08-20T09:00:00.000Z', 'status', 'Working')]))
      .toBe('2026-08-20T09:00:00.000Z');
  });

  it('takes the LAST entry, so a card that bounced back is aged from its return', () => {
    const entry = entryFor([
      change('2026-08-05T09:00:00.000Z', 'status', 'Working'),
      change('2026-08-10T09:00:00.000Z', 'status', 'Ready for QA'),
      change('2026-08-20T09:00:00.000Z', 'status', 'Working'),
    ]);

    expect(entry).toBe('2026-08-20T09:00:00.000Z');
  });

  it('takes the SUB-STATUS entry when it is later — the column is the pair', () => {
    // A card moved from "Working · Dev" to "Working · Code Review" entered a new column without its
    // status changing at all. Reporting by status alone would age it from whenever work began.
    const entry = entryFor([
      change('2026-08-05T09:00:00.000Z', 'status', 'Working'),
      change('2026-08-22T09:00:00.000Z', 'Status Summary', 'Code Review'),
    ], 'Working', 'Code Review');

    expect(entry).toBe('2026-08-22T09:00:00.000Z');
  });

  it('keeps the STATUS entry when it is the later of the two', () => {
    const entry = entryFor([
      change('2026-08-22T09:00:00.000Z', 'Status Summary', 'Code Review'),
      change('2026-08-24T09:00:00.000Z', 'status', 'Working'),
    ], 'Working', 'Code Review');

    expect(entry).toBe('2026-08-24T09:00:00.000Z');
  });

  it('ignores a move into a DIFFERENT status', () => {
    expect(entryFor([change('2026-08-20T09:00:00.000Z', 'status', 'Ready for QA')], 'Working'))
      .toBe('2026-08-01T09:00:00.000Z');
  });

  it('ignores changes to unrelated fields', () => {
    expect(entryFor([change('2026-08-20T09:00:00.000Z', 'assignee', 'Working')]))
      .toBe('2026-08-01T09:00:00.000Z');
  });

  it('falls back to the creation date for work that has never moved', () => {
    // The honest answer: it has been in this column since it existed.
    expect(entryFor([])).toBe('2026-08-01T09:00:00.000Z');
  });

  it('reports nothing rather than a zero when even the creation date is unknown', () => {
    // A zero would claim the card just arrived, which is the opposite of "we do not know".
    expect(entryFor([], 'Working', null, null)).toBeNull();
  });

  it('matches a sub-status field by whichever name this instance uses', () => {
    const entry = readColumnEntryIso({
      changeHistories: [change('2026-08-22T09:00:00.000Z', 'Sub-Status', 'Integration Test')],
      statusName: 'Ready for Testing',
      subStatusValue: 'Integration Test',
      subStatusFieldNames: ['Status Summary', 'Sub-Status'],
      createdIso: '2026-08-01T09:00:00.000Z',
    });

    expect(entry).toBe('2026-08-22T09:00:00.000Z');
  });

  it('does not look for a sub-status the card does not have', () => {
    expect(entryFor([change('2026-08-20T09:00:00.000Z', 'status', 'Working')], 'Working', null))
      .toBe('2026-08-20T09:00:00.000Z');
  });
});

describe('countDaysInColumn', () => {
  const NOW_ISO = '2026-08-25T12:00:00.000Z';

  it('counts whole calendar days, weekends included', () => {
    // Anybody looking at a board to find stuck work means elapsed time. A card that has sat over a
    // weekend has sat over a weekend.
    expect(countDaysInColumn('2026-08-19T12:00:00.000Z', NOW_ISO)).toBe(6);
  });

  it('floors, so a card that moved this morning reads 0 rather than rounding up', () => {
    expect(countDaysInColumn('2026-08-25T08:00:00.000Z', NOW_ISO)).toBe(0);
  });

  it('never reports a negative age, whatever the clocks say', () => {
    expect(countDaysInColumn('2026-08-26T12:00:00.000Z', NOW_ISO)).toBe(0);
  });

  it('reports nothing when the entry moment is unknown', () => {
    expect(countDaysInColumn(null, NOW_ISO)).toBeNull();
  });

  it('reports nothing rather than NaN for an unreadable timestamp', () => {
    expect(countDaysInColumn('not a date', NOW_ISO)).toBeNull();
  });
});
