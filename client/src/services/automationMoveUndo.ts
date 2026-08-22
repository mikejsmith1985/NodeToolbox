// automationMoveUndo.ts — Putting back an issue the automation moved.
//
// The intake cancelled live development work (GH #375). The fixes since then stop it happening
// again; neither puts back the issues already moved, and a list of twenty-one keys to correct by
// hand is not much better than no list at all.
//
// The audit already knows where each issue came from, because the changelog records it. This turns
// that into a decision: where should the issue go back to, and is putting it there still the right
// thing to do?
//
// The second question is the one that matters. If somebody has already moved the issue on, the
// automation is no longer the last word on it — and putting it back would override a person's
// decision, which is the exact mistake this whole thread started with, only in the other direction.

import type { MoveAuditRow } from './automationMoveAudit.ts';
import type { JiraTransition } from '../types/jira.ts';

/** What an undo would do to one issue, or why it would not. */
export interface AutomationMoveUndoPlan {
  canUndo: boolean;
  /** Where the issue would go back to. Empty when there is nothing to undo. */
  targetStatusName: string;
  /** Why not, in words somebody can act on. Empty when the undo is available. */
  reason: string;
}

/** One row paired with its plan, so a button knows both the issue and its destination. */
export interface UndoableAuditRow {
  row: MoveAuditRow;
  plan: AutomationMoveUndoPlan;
}

/** Compares two status names the way Jira's own inconsistency requires. */
function isSameStatus(leftStatus: string, rightStatus: string): boolean {
  return leftStatus.trim().toLowerCase() === rightStatus.trim().toLowerCase();
}

/**
 * Works out whether one audited issue can be put back, and where to.
 *
 * The LAST automation move is the one that decides. An issue the automation walked twice reached its
 * current status by the second move; undoing the first would send it somewhere it has not been
 * since, which is a different and worse kind of wrong.
 */
export function planAutomationMoveUndo(row: MoveAuditRow): AutomationMoveUndoPlan {
  const lastMove = row.automationMoves[row.automationMoves.length - 1];
  if (!lastMove) {
    return { canUndo: false, targetStatusName: '', reason: 'No automation move to undo.' };
  }

  const targetStatusName = lastMove.fromStatus.trim();
  if (targetStatusName === '') {
    return {
      canUndo: false,
      targetStatusName: '',
      reason: 'The changelog does not say where it came from, so there is nowhere to put it back to.',
    };
  }

  // The issue is no longer where the automation left it, so somebody has been here since. Their
  // decision is the current one, and an undo would override it.
  if (!isSameStatus(row.currentStatus, lastMove.toStatus)) {
    return {
      canUndo: false,
      targetStatusName,
      reason: `Already moved on — it is in "${row.currentStatus}" now, not "${lastMove.toStatus}".`,
    };
  }

  if (isSameStatus(row.currentStatus, targetStatusName)) {
    return {
      canUndo: false,
      targetStatusName,
      reason: `It is already in "${targetStatusName}".`,
    };
  }

  return { canUndo: true, targetStatusName, reason: '' };
}

/** Narrows an audit to the rows an undo would actually change, each with its destination. */
export function selectUndoableRows(rows: readonly MoveAuditRow[]): UndoableAuditRow[] {
  return rows
    .map((row) => ({ row, plan: planAutomationMoveUndo(row) }))
    .filter((entry) => entry.plan.canUndo);
}

/** What one attempted undo did, or why it did not. */
export interface AutomationMoveUndoOutcome {
  issueKey: string;
  didMove: boolean;
  targetStatusName: string;
  reason: string;
}

/** The two Jira calls an undo needs, injected so the whole thing is provable with no Jira. */
export interface AutomationMoveUndoDeps {
  fetchTransitions: (issueKey: string) => Promise<JiraTransition[]>;
  applyTransition: (issueKey: string, transitionId: string) => Promise<void>;
}

/**
 * Puts one issue back, or explains why it could not be.
 *
 * The transition is chosen by DESTINATION, not by name: a workflow may call the move back to Working
 * anything at all, and matching on a label would work in one project and silently fail in the next.
 *
 * A status Jira will not transition to is the expected failure, not an exceptional one. Cancelled is
 * often a near-terminal state with one way out, and "Working is not reachable from Cancelled" is
 * something the operator needs told plainly so they can walk it back through the workflow by hand.
 */
export async function undoAutomationMove(
  row: MoveAuditRow,
  deps: AutomationMoveUndoDeps,
): Promise<AutomationMoveUndoOutcome> {
  const plan = planAutomationMoveUndo(row);
  if (!plan.canUndo) {
    return { issueKey: row.issueKey, didMove: false, targetStatusName: plan.targetStatusName, reason: plan.reason };
  }

  let transitions: JiraTransition[];
  try {
    transitions = await deps.fetchTransitions(row.issueKey);
  } catch (fetchError) {
    const detail = fetchError instanceof Error ? fetchError.message : String(fetchError);
    return { issueKey: row.issueKey, didMove: false, targetStatusName: plan.targetStatusName, reason: detail };
  }

  const matchingTransition = transitions.find((transition) =>
    isSameStatus(transition.to?.name ?? '', plan.targetStatusName));
  if (!matchingTransition) {
    const availableNames = transitions.map((transition) => transition.to?.name ?? '?').join(', ');
    return {
      issueKey: row.issueKey,
      didMove: false,
      targetStatusName: plan.targetStatusName,
      reason: `Jira offers no transition from "${row.currentStatus}" to "${plan.targetStatusName}"`
        + `${availableNames === '' ? '' : ` — only: ${availableNames}`}. Walk it back by hand.`,
    };
  }

  try {
    await deps.applyTransition(row.issueKey, matchingTransition.id);
  } catch (applyError) {
    const detail = applyError instanceof Error ? applyError.message : String(applyError);
    return { issueKey: row.issueKey, didMove: false, targetStatusName: plan.targetStatusName, reason: detail };
  }

  return { issueKey: row.issueKey, didMove: true, targetStatusName: plan.targetStatusName, reason: '' };
}

/**
 * Puts back every issue asked for, one at a time.
 *
 * One failure never stops the rest: a run of twenty that abandoned at the fourth because its
 * workflow had no way back would leave sixteen issues untouched and nothing said about them.
 */
export async function undoAutomationMoves(
  rows: readonly MoveAuditRow[],
  deps: AutomationMoveUndoDeps,
): Promise<AutomationMoveUndoOutcome[]> {
  const outcomes: AutomationMoveUndoOutcome[] = [];
  for (const row of rows) {
    outcomes.push(await undoAutomationMove(row, deps));
  }
  return outcomes;
}
