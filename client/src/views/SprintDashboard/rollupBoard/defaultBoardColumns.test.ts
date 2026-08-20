// defaultBoardColumns.test.ts — A first-time board has to be usable, not blank.

import { describe, expect, it } from 'vitest';

import { buildDefaultBoardColumns } from './defaultBoardColumns.ts';

describe('buildDefaultBoardColumns', () => {
  it('ships the org workflow in delivery order', () => {
    const columnNames = buildDefaultBoardColumns().map((column) => column.name);

    expect(columnNames).toEqual([
      'To Do', 'Triage', 'Ready to Work', 'Working', 'Code Review',
      'SL Testing', 'INT Testing', 'BT Testing',
      'Ready to Accept', 'Accepted - Done', 'Cancelled',
    ]);
  });

  it('separates the columns that share a Jira status by sub-status', () => {
    // The load-bearing pairs. Working covers both Working and Code Review; Ready for Testing covers
    // SL, INT and BT — so without the sub-status these five columns collapse into two.
    const columnsByName = new Map(buildDefaultBoardColumns().map((column) => [column.name, column]));

    expect(columnsByName.get('Working')?.mappings).toEqual([{ jiraStatusName: 'Working', subStatusValue: null }]);
    expect(columnsByName.get('Code Review')?.mappings).toEqual([{ jiraStatusName: 'Working', subStatusValue: 'Code Review' }]);
    expect(columnsByName.get('SL Testing')?.mappings).toEqual([{ jiraStatusName: 'Ready for Testing', subStatusValue: 'Testing' }]);
    expect(columnsByName.get('INT Testing')?.mappings).toEqual([{ jiraStatusName: 'Ready for Testing', subStatusValue: 'Integration Test' }]);
    expect(columnsByName.get('BT Testing')?.mappings).toEqual([{ jiraStatusName: 'Ready for Testing', subStatusValue: 'Ready for UAT' }]);
  });

  it('gives every column a distinct id and a position matching its place in the list', () => {
    const columns = buildDefaultBoardColumns();

    expect(new Set(columns.map((column) => column.id)).size).toBe(columns.length);
    expect(columns.map((column) => column.order)).toEqual(columns.map((_column, index) => index));
  });

  it('hands out a fresh set each time, so one team editing cannot change what the next team gets', () => {
    const firstTeamColumns = buildDefaultBoardColumns();
    firstTeamColumns[0].name = 'Renamed by team A';

    expect(buildDefaultBoardColumns()[0].name).toBe('To Do');
  });

  it('claims exactly one Jira state per column, so nothing starts ambiguous', () => {
    expect(buildDefaultBoardColumns().every((column) => column.mappings.length === 1)).toBe(true);
  });
});
