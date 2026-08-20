// defaultBoardColumns.ts — The board every team starts with, instead of a blank one.
//
// A team opening the Roll-Up Board for the first time used to get no columns at all: every issue
// landed in Unmapped, and the board was useless until somebody sat down and rebuilt the enterprise
// workflow by hand. That is a lot of setup to ask for a layout that is the same for every team here,
// and it made a lost vocabulary a rebuild rather than an inconvenience.
//
// These are the org's actual columns, so a fresh install shows a working board immediately. They are
// a STARTING POINT, not a rule — a team edits them like any other columns, and once a team has saved
// its own set this file is never consulted again for them.
//
// The pairs matter. Two columns share the status `Working` (Working and Code Review) and FOUR share
// `Ready for Testing` (Internal Test Ready, SL, INT and BT Testing): the sub-status is the only
// thing telling them apart, which is why a board with no sub-status field cannot express this
// workflow at all. Internal Test Ready is the one with NO sub-status — the gap between dev finishing
// and testing starting, which every other column implicitly assumed away.

import type { BoardColumn } from './rollupBoardTypes.ts';

/** One rung of the default board: the team's name for it, and the Jira state it stands for. */
const DEFAULT_COLUMN_DEFINITIONS: Array<[columnName: string, jiraStatusName: string, subStatusValue: string | null]> = [
  ['To Do', 'To Do', null],
  ['Triage', 'Triage', null],
  ['Ready to Work', 'Ready to Work', null],
  ['Working', 'Working', null],
  ['Code Review', 'Working', 'Code Review'],
  // Dev complete and deployed to the Dev environment, waiting for shift-left test to pick it up.
  // The state has no sub-status at all, which is why it matched no column and landed in Unmapped —
  // and it is the state that releases the [SL] story to start, so it is worth a column of its own.
  ['Internal Test Ready', 'Ready for Testing', null],
  ['SL Testing', 'Ready for Testing', 'Testing'],
  ['INT Testing', 'Ready for Testing', 'Integration Test'],
  ['BT Testing', 'Ready for Testing', 'Ready for UAT'],
  ['Ready to Accept', 'Ready to Accept', null],
  ['Accepted - Done', 'Accepted - Done', null],
  ['Cancelled', 'Cancelled', null],
];

/**
 * Builds the default column set.
 *
 * Returns a fresh array every call rather than a shared constant: these become a team's editable
 * columns, and handing out one shared object would let an edit on one team's board silently change
 * what the next team starts with.
 */
export function buildDefaultBoardColumns(): BoardColumn[] {
  return DEFAULT_COLUMN_DEFINITIONS.map(([columnName, jiraStatusName, subStatusValue], columnIndex) => ({
    id: `col-${columnIndex + 1}`,
    name: columnName,
    order: columnIndex,
    mappings: [{ jiraStatusName, subStatusValue }],
  }));
}
