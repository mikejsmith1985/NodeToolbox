// replyTable.test.ts — Proves table-shaped assistant replies are read however the assistant lays them out.
//
// Built from what Google's AI Mode really returned (GH #499): a table pasted as tabs or pipes, with a header row,
// bold marks and lengths in hours. The reader must find the asked-for columns by name and never guess a missing one.

import { describe, expect, it } from 'vitest';

import {
  FILL_IN_BLANK,
  buildFillInTable,
  buildFormatFixPrompt,
  findHeaderColumns,
  readDurationCellMinutes,
  splitReplyCells,
} from './replyTable.ts';

describe('splitReplyCells', () => {
  it('reads pipes with or without the outer ones, and drops bold and code marks', () => {
    expect(splitReplyCells('| **T1** | 30 | `15` |')).toEqual(['T1', '30', '15']);
    expect(splitReplyCells('T1 | 30 | 15')).toEqual(['T1', '30', '15']);
  });

  it('reads a table copied from a web page, which arrives tab-separated', () => {
    expect(splitReplyCells('CTASK02\tT1 — Technical Checkout\t1.0 Hour')).toEqual(['CTASK02', 'T1 — Technical Checkout', '1.0 Hour']);
  });

  it('treats a markdown divider row as no cells', () => {
    expect(splitReplyCells('| --- | :--: | -- |')).toEqual([]);
    expect(splitReplyCells('-- | -- | --')).toEqual([]);
  });
});

describe('readDurationCellMinutes', () => {
  it('reads minutes and hours however they are worded', () => {
    expect(readDurationCellMinutes('30')).toBe(30);
    expect(readDurationCellMinutes('1.5 Hours')).toBe(90);
    expect(readDurationCellMinutes('1.0 Hour')).toBe(60);
    expect(readDurationCellMinutes('1h 30m')).toBe(90);
    expect(readDurationCellMinutes('45 mins')).toBe(45);
    expect(readDurationCellMinutes('~20 min')).toBe(20);
    expect(readDurationCellMinutes('about 15 minutes')).toBe(15);
  });

  it('never reads a date, a range, a blank or zero as a length', () => {
    expect(readDurationCellMinutes('2026-11-12T14:30')).toBeNull();
    expect(readDurationCellMinutes('30-45')).toBeNull();
    expect(readDurationCellMinutes(FILL_IN_BLANK)).toBeNull();
    expect(readDurationCellMinutes('0')).toBeNull();
    expect(readDurationCellMinutes('Deploy')).toBeNull();
  });
});

describe('findHeaderColumns', () => {
  const wantedColumns = { implementation: /implement/i, validation: /validat/i, backout: /back.?out/i };

  it('finds each asked-for column by its header, wherever the assistant put it', () => {
    expect(findHeaderColumns(['Task', 'Duration', 'Implementation (min)', 'Validation', 'Back-out'], wantedColumns))
      .toEqual({ implementation: 2, validation: 3, backout: 4 });
  });

  it('is not a header row when fewer than two asked-for columns are named', () => {
    expect(findHeaderColumns(['Task', 'Implementation', 'Why'], wantedColumns)).toBeNull();
  });

  it('is never an answer row, even one whose reason names the columns', () => {
    expect(findHeaderColumns(['T1', '30', '15', '20', 'validation and backout are quick'], wantedColumns)).toBeNull();
  });
});

describe('the fill-in table', () => {
  it('lists every row with a blank for each answer, under a named header', () => {
    expect(buildFillInTable(['Task', 'Minutes', 'Why'], [['CTASK001 — Deploy'], ['CTASK002 — Checkout']])).toEqual([
      'Task | Minutes | Why',
      `CTASK001 — Deploy | ${FILL_IN_BLANK} | ${FILL_IN_BLANK}`,
      `CTASK002 — Checkout | ${FILL_IN_BLANK} | ${FILL_IN_BLANK}`,
    ]);
  });

  it('asks for the same table again, unchanged rows, nothing else, when a reply strayed', () => {
    const fixPrompt = buildFormatFixPrompt('TIMELINE:', ['Task | Minutes', `T1 — Deploy | ${FILL_IN_BLANK}`]);
    expect(fixPrompt).toContain('was not in the form I need');
    expect(fixPrompt).toContain('Do not add, remove, rename or renumber');
    expect(fixPrompt).toContain(`TIMELINE:\nTask | Minutes\nT1 — Deploy | ${FILL_IN_BLANK}`);
  });
});
