// automationMoveAudit.test.ts — Which status changes belong to the automation, and which do not.
//
// Jira credits every change to the account the app authenticates as, so history alone cannot answer
// "did the automation cancel this?". What CAN answer it is timing: a run posts its comment and fires
// its transition within the same few seconds, and a person does not.

import { describe, expect, it } from 'vitest';

import {
  AUTOMATION_MOVE_WINDOW_MS,
  correlateAutomationMoves,
  filterMoveAuditRows,
  type MoveAuditRow,
} from './automationMoveAudit.ts';

const COMMENT_AT = '2026-08-18T14:30:00.000+0000';

function changelogEntry(atIso: string, toStatus: string) {
  return { created: atIso, items: [{ field: 'status', toString: toStatus, fromString: 'In Progress' }] };
}

describe('correlateAutomationMoves', () => {
  it('claims a status change made seconds after an automation comment', () => {
    const moves = correlateAutomationMoves([COMMENT_AT], [changelogEntry('2026-08-18T14:30:04.000+0000', 'Cancelled')]);

    expect(moves).toEqual([{ toStatus: 'Cancelled', fromStatus: 'In Progress', atIso: '2026-08-18T14:30:04.000+0000' }]);
  });

  it('claims one made just BEFORE the comment — the transition can fire first', () => {
    const moves = correlateAutomationMoves([COMMENT_AT], [changelogEntry('2026-08-18T14:29:50.000+0000', 'Done')]);

    expect(moves.map((move) => move.toStatus)).toEqual(['Done']);
  });

  it('leaves a change outside the window alone rather than blaming the automation for it', () => {
    // Three minutes is deliberately generous for a slow Jira; four hours is somebody at a keyboard.
    const moves = correlateAutomationMoves([COMMENT_AT], [changelogEntry('2026-08-18T18:30:00.000+0000', 'Cancelled')]);

    expect(moves).toEqual([]);
  });

  it('uses a three-minute window on each side', () => {
    expect(AUTOMATION_MOVE_WINDOW_MS).toBe(3 * 60 * 1000);
  });

  it('ignores changelog entries that are not status changes', () => {
    const assigneeChange = { created: '2026-08-18T14:30:02.000+0000', items: [{ field: 'assignee', toString: 'Alex' }] };

    expect(correlateAutomationMoves([COMMENT_AT], [assigneeChange])).toEqual([]);
  });

  it('finds nothing when the issue was never commented on by the automation', () => {
    expect(correlateAutomationMoves([], [changelogEntry(COMMENT_AT, 'Cancelled')])).toEqual([]);
  });

  it('does not report the same change twice when two comments bracket it', () => {
    const moves = correlateAutomationMoves(
      ['2026-08-18T14:30:00.000+0000', '2026-08-18T14:30:30.000+0000'],
      [changelogEntry('2026-08-18T14:30:10.000+0000', 'Cancelled')],
    );

    expect(moves).toHaveLength(1);
  });
});

describe('filterMoveAuditRows', () => {
  const ROWS: MoveAuditRow[] = [
    {
      issueKey: 'ENFCT-2020', issueSummary: 'Add letters that Prod support clears', currentStatus: 'Cancelled',
      isCurrentStatusDone: true, commentCount: 2,
      automationMoves: [{ toStatus: 'Cancelled', fromStatus: 'Code Review', atIso: COMMENT_AT }],
    },
    {
      issueKey: 'ENFCT-1530', issueSummary: 'MEET Fallout for Hospice', currentStatus: 'In Progress',
      isCurrentStatusDone: false, commentCount: 1, automationMoves: [],
    },
  ];

  it('matches on issue key, case-insensitively', () => {
    expect(filterMoveAuditRows(ROWS, 'enfct-2020', false).map((row) => row.issueKey)).toEqual(['ENFCT-2020']);
  });

  it('matches on summary text too, because that is how people remember an issue', () => {
    expect(filterMoveAuditRows(ROWS, 'hospice', false).map((row) => row.issueKey)).toEqual(['ENFCT-1530']);
  });

  it('matches on the status the automation moved it to — the question that started this', () => {
    expect(filterMoveAuditRows(ROWS, 'cancelled', false).map((row) => row.issueKey)).toEqual(['ENFCT-2020']);
  });

  it('narrows to issues the automation actually moved when asked', () => {
    expect(filterMoveAuditRows(ROWS, '', true).map((row) => row.issueKey)).toEqual(['ENFCT-2020']);
  });

  it('returns everything for an empty query, rather than nothing', () => {
    expect(filterMoveAuditRows(ROWS, '   ', false)).toHaveLength(2);
  });
});
