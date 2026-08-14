// selectColumnMapping.test.ts — Proves a column claiming several Jira states writes the right one.
//
// The reported case: a real column named "Accepted/Done" claims both Accepted and Done and holds 106
// issues. Every drop wrote Accepted, because the code took mappings[0] — so dragging a Done issue
// tried to move it to Accepted, and where the workflow has no such step the move just failed.

import { describe, expect, it } from 'vitest';

import { selectColumnMapping } from './selectColumnMapping.ts';
import type { ColumnStatusMapping } from './rollupBoardTypes.ts';

const ACCEPTED: ColumnStatusMapping = { jiraStatusName: 'Accepted', subStatusValue: null };
const DONE: ColumnStatusMapping = { jiraStatusName: 'Done', subStatusValue: null };
const ACCEPTED_OR_DONE = [ACCEPTED, DONE];

describe('selectColumnMapping', () => {
  it('keeps the state the issue is ALREADY in, so a sub-status change writes no status', () => {
    // Dropping a card into the column it already sits in is how you change only its sub-status.
    // Re-writing the status underneath it is a pointless write that can fail on its own.
    const choice = selectColumnMapping(ACCEPTED_OR_DONE, 'Done', ['Accepted'], 'Accepted/Done');

    expect(choice).toEqual({ kind: 'write', mapping: DONE });
  });

  it('writes the claimed state the workflow can actually reach, not simply the first', () => {
    // The bug, exactly: Done is reachable and Accepted is not, and mappings[0] is Accepted.
    const choice = selectColumnMapping(ACCEPTED_OR_DONE, 'In Progress', ['Done'], 'Accepted/Done');

    expect(choice).toEqual({ kind: 'write', mapping: DONE });
  });

  it('takes the first claimed state when several are reachable, rather than asking every time', () => {
    // The team named this column for several states on purpose: any of them is a correct landing
    // place, so a question on every drag would be friction bought with nothing.
    const choice = selectColumnMapping(ACCEPTED_OR_DONE, 'In Progress', ['Accepted', 'Done'], 'Accepted/Done');

    expect(choice).toEqual({ kind: 'write', mapping: ACCEPTED });
  });

  it('compares status names the way Jira does, ignoring case and stray spacing', () => {
    const choice = selectColumnMapping(ACCEPTED_OR_DONE, '  done  ', [], 'Accepted/Done');

    expect(choice).toEqual({ kind: 'write', mapping: DONE });
  });

  it('refuses in the board\'s own terms when the workflow reaches none of them', () => {
    const choice = selectColumnMapping(ACCEPTED_OR_DONE, 'In Progress', ['Code Review'], 'Accepted/Done');

    expect(choice.kind).toBe('refused');
    expect(choice.kind === 'refused' && choice.reason).toContain('Accepted or Done');
    expect(choice.kind === 'refused' && choice.reason).toContain('Code Review');
  });

  it('says so plainly when Jira offers no transitions at all', () => {
    const choice = selectColumnMapping(ACCEPTED_OR_DONE, 'In Progress', [], 'Accepted/Done');

    // With nothing readable it writes the first claim rather than refusing — see below.
    expect(choice.kind).toBe('write');
  });

  it('still writes a single-claim column without consulting the workflow at all', () => {
    // Unambiguous: there is nothing to choose between, so it costs no transition lookup.
    expect(selectColumnMapping([ACCEPTED], 'In Progress', [], 'Accepted')).toEqual({
      kind: 'write', mapping: ACCEPTED,
    });
  });

  it('writes the first claim when the transitions could not be read, rather than refusing', () => {
    // A failed lookup must never be presented as a workflow rule. Attempting the move gets a real
    // answer from Jira; refusing on our own guess invents one.
    const choice = selectColumnMapping(ACCEPTED_OR_DONE, 'In Progress', [], 'Accepted/Done');

    expect(choice).toEqual({ kind: 'write', mapping: ACCEPTED });
  });

  it('refuses a column that claims nothing, which cannot be written to at all', () => {
    const choice = selectColumnMapping([], 'In Progress', ['Done'], 'Not mapped yet');

    expect(choice.kind).toBe('refused');
    expect(choice.kind === 'refused' && choice.reason).toContain('does not claim any Jira status');
  });
});
