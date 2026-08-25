// automationMoveUndo.test.ts — Putting back an issue the automation moved.
//
// The intake cancelled live development work (GH #375). Both fixes since then stop it happening
// again; neither puts back the issues already moved, and a list of twenty-one keys to fix by hand is
// not much better than no list at all.
//
// The decision has two halves, and only the first is interesting. WHERE should this issue go back
// to — the status it was in before the automation touched it. And is that still the right thing to
// do — which it is not, if somebody has already moved it somewhere else since.

import { describe, expect, it, vi } from 'vitest';

import {
  planAutomationMoveUndo,
  selectUndoableRows,
  undoAutomationMove,
  undoAutomationMoves,
} from './automationMoveUndo.ts';
import type { MoveAuditRow } from './automationMoveAudit.ts';

function row(overrides: Partial<MoveAuditRow> = {}): MoveAuditRow {
  return {
    issueKey: 'ENFCT-2019',
    issueSummary: 'Automate cleanup',
    currentStatus: 'Cancelled',
    isCurrentStatusDone: true,
    lastStatusChange: null,
    commentCount: 1,
    automationMoves: [{ fromStatus: 'Working', toStatus: 'Cancelled', atIso: '2026-08-21T15:30:36.000+0000' }],
    ...overrides,
  };
}

describe('planAutomationMoveUndo', () => {
  it('sends the issue back to the status it was in before the automation touched it', () => {
    const plan = planAutomationMoveUndo(row());

    expect(plan.canUndo).toBe(true);
    expect(plan.targetStatusName).toBe('Working');
  });

  it('uses the LAST automation move, which is the one that left the issue where it is', () => {
    // An issue the automation moved twice was walked to its current status by the second move.
    // Undoing the first would put it somewhere it has not been since.
    const plan = planAutomationMoveUndo(row({
      currentStatus: 'Cancelled',
      automationMoves: [
        { fromStatus: 'To Do', toStatus: 'Working', atIso: '2026-08-12T10:00:00.000+0000' },
        { fromStatus: 'Working', toStatus: 'Cancelled', atIso: '2026-08-13T17:25:47.000+0000' },
      ],
    }));

    expect(plan.targetStatusName).toBe('Working');
  });

  it('refuses when somebody has already moved the issue on', () => {
    // The current status no longer matches where the automation left it, so a person has been here
    // since. Putting it back would undo THEIR decision, which is the mistake this whole thread began
    // with, only in the other direction.
    const plan = planAutomationMoveUndo(row({ currentStatus: 'Ready for Testing' }));

    expect(plan.canUndo).toBe(false);
    expect(plan.reason).toMatch(/already moved/i);
  });

  it('refuses an issue the automation never moved', () => {
    const plan = planAutomationMoveUndo(row({ automationMoves: [] }));

    expect(plan.canUndo).toBe(false);
    expect(plan.reason).toMatch(/no automation move/i);
  });

  it('refuses when the automation did not record where it came from', () => {
    // Without a from-status there is nowhere to put it back to, and guessing would be worse than
    // leaving it alone.
    const plan = planAutomationMoveUndo(row({
      automationMoves: [{ fromStatus: '', toStatus: 'Cancelled', atIso: '2026-08-21T15:30:00.000+0000' }],
    }));

    expect(plan.canUndo).toBe(false);
    expect(plan.reason).toMatch(/where it came from/i);
  });

  it('compares statuses ignoring case and space, as Jira reports them inconsistently', () => {
    const plan = planAutomationMoveUndo(row({ currentStatus: '  cancelled ' }));
    expect(plan.canUndo).toBe(true);
  });

  it('refuses to put an issue back where it already is', () => {
    // A no-op dressed as an action. Offering it would waste a write and read as though something
    // had been fixed.
    const plan = planAutomationMoveUndo(row({
      currentStatus: 'Working',
      automationMoves: [{ fromStatus: 'Working', toStatus: 'Working', atIso: '2026-08-21T15:30:00.000+0000' }],
    }));

    expect(plan.canUndo).toBe(false);
  });
});

describe('selectUndoableRows', () => {
  it('picks out only the rows an undo would actually change', () => {
    const rows = [
      row({ issueKey: 'A-1' }),
      row({ issueKey: 'A-2', currentStatus: 'Ready for Testing' }),
      row({ issueKey: 'A-3', automationMoves: [] }),
    ];

    expect(selectUndoableRows(rows).map((each) => each.row.issueKey)).toEqual(['A-1']);
  });

  it('carries each plan with its row, so the button knows where it is sending the issue', () => {
    const [first] = selectUndoableRows([row()]);
    expect(first.plan.targetStatusName).toBe('Working');
  });

  it('returns nothing for an empty audit rather than throwing', () => {
    expect(selectUndoableRows([])).toEqual([]);
  });
});

describe('undoAutomationMove', () => {
  /** Offers the transitions a workflow really would, keyed by destination. */
  function deps(transitions: { id: string; name: string; toName: string }[], applyTransition = vi.fn()) {
    return {
      fetchTransitions: vi.fn(async () => transitions.map((each) => ({
        id: each.id,
        name: each.name,
        to: { name: each.toName, statusCategory: { name: 'In Progress' } },
      }))),
      applyTransition,
    };
  }

  it('fires the transition that lands on the target status', async () => {
    // Chosen by DESTINATION, not by name. A workflow may call the move back to Working anything at
    // all, and matching on a label would work in one project and silently fail in the next.
    const applyTransition = vi.fn();
    const outcome = await undoAutomationMove(row(), deps([
      { id: '31', name: 'Reopen for development', toName: 'Working' },
      { id: '41', name: 'Close', toName: 'Done' },
    ], applyTransition));

    expect(outcome.didMove).toBe(true);
    expect(applyTransition).toHaveBeenCalledWith('ENFCT-2019', '31');
  });

  it('says plainly when Jira will not go there, and lists what it will do', async () => {
    // The expected failure, not an exceptional one: Cancelled is often near-terminal with one way
    // out, and the operator needs to know so they can walk it back by hand.
    const outcome = await undoAutomationMove(row(), deps([{ id: '41', name: 'Reopen', toName: 'To Do' }]));

    expect(outcome.didMove).toBe(false);
    expect(outcome.reason).toMatch(/no transition/i);
    expect(outcome.reason).toContain('To Do');
    expect(outcome.reason).toMatch(/by hand/i);
  });

  it('never writes when the plan already refused', async () => {
    const applyTransition = vi.fn();
    const fetchTransitions = vi.fn();
    const outcome = await undoAutomationMove(
      row({ currentStatus: 'Ready for Testing' }),
      { fetchTransitions, applyTransition },
    );

    expect(outcome.didMove).toBe(false);
    expect(fetchTransitions).not.toHaveBeenCalled();
    expect(applyTransition).not.toHaveBeenCalled();
  });

  it('reports a failed write rather than claiming the issue is back', async () => {
    const applyTransition = vi.fn(async () => { throw new Error('403 Forbidden'); });
    const outcome = await undoAutomationMove(row(), deps([{ id: '31', name: 'Reopen', toName: 'Working' }], applyTransition));

    expect(outcome.didMove).toBe(false);
    expect(outcome.reason).toMatch(/403 Forbidden/);
  });

  it('reports a transitions lookup that failed', async () => {
    const outcome = await undoAutomationMove(row(), {
      fetchTransitions: vi.fn(async () => { throw new Error('Jira is down'); }),
      applyTransition: vi.fn(),
    });

    expect(outcome.didMove).toBe(false);
    expect(outcome.reason).toMatch(/Jira is down/);
  });
});

describe('undoAutomationMoves', () => {
  it('carries on through the batch when one issue has no way back', async () => {
    // A run of twenty that abandoned at the fourth would leave sixteen untouched and nothing said.
    const applyTransition = vi.fn();
    const outcomes = await undoAutomationMoves([row({ issueKey: 'A-1' }), row({ issueKey: 'A-2' })], {
      fetchTransitions: vi.fn(async (issueKey: string) => (issueKey === 'A-1'
        ? []
        : [{ id: '31', name: 'Reopen', to: { name: 'Working', statusCategory: { name: 'In Progress' } } }])),
      applyTransition,
    });

    expect(outcomes.map((outcome) => outcome.didMove)).toEqual([false, true]);
  });
});
