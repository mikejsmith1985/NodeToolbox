// agingBulkTransition.ts — Plans and executes a "move these issues to one status" batch for the Aging triage.
//
// The cleanup action lets a reviewer transition a whole feature and its supporting issues to one target
// status (e.g. Cancelled / Closed) in a single pass. Different issues sit in different current statuses and
// therefore offer different workflow transitions, so this module (1) summarises which target statuses are
// reachable across the selected issues and (2) runs the batch, matching each issue's transition to the chosen
// status and recording a per-issue outcome. Following the app's commit pattern, one issue failing or lacking
// the transition never aborts the rest. It is pure orchestration — every Jira call is injected by the caller.

import type { JiraTransition } from '../../types/jira.ts';

// ── Public types ─────────────────────────────────────────────────────────────

/** How one issue's transition attempt ended. */
export type BulkTransitionOutcome = 'done' | 'skipped' | 'failed';

/** The result of attempting one issue's transition, surfaced as a per-row badge in the UI. */
export interface BulkTransitionResult {
  issueKey: string;
  outcome: BulkTransitionOutcome;
  message: string;
}

/** One reachable target status across the selected issues, plus how many of them can actually reach it. */
export interface TargetStatusOption {
  statusName: string;
  /** How many of the selected issues offer a transition to this status. */
  availableCount: number;
}

/** Injected Jira call that applies one transition to one issue (e.g. saveFeatureReviewTransition). */
export type ApplyTransition = (issueKey: string, transitionId: string) => Promise<void>;

// ── Planning ───────────────────────────────────────────────────────────────

/** Finds the transition that lands an issue on the given destination status, matched case-insensitively. */
export function findTransitionToStatus(
  transitions: readonly JiraTransition[],
  targetStatusName: string,
): JiraTransition | null {
  const normalizedTarget = targetStatusName.trim().toLowerCase();
  return transitions.find((transition) => transition.to.name.trim().toLowerCase() === normalizedTarget) ?? null;
}

/**
 * Summarises the target statuses reachable across the selected issues: every destination status any issue can
 * transition to, each with a count of how many issues can reach it. Sorted most-widely-available first so the
 * status that applies to the whole batch surfaces at the top of the picker; ties broken alphabetically.
 */
export function summarizeTargetStatuses(transitionsByKey: ReadonlyMap<string, readonly JiraTransition[]>): TargetStatusOption[] {
  const availabilityByStatus = new Map<string, number>();
  for (const transitions of transitionsByKey.values()) {
    // Count each destination status once per issue, even if the workflow offers two routes to it.
    const statusesForIssue = new Set(transitions.map((transition) => transition.to.name));
    for (const statusName of statusesForIssue) {
      availabilityByStatus.set(statusName, (availabilityByStatus.get(statusName) ?? 0) + 1);
    }
  }
  return Array.from(availabilityByStatus.entries())
    .map(([statusName, availableCount]) => ({ statusName, availableCount }))
    .sort((first, second) => second.availableCount - first.availableCount || first.statusName.localeCompare(second.statusName));
}

// ── Execution ────────────────────────────────────────────────────────────────

/**
 * Runs the batch: for each selected issue, applies the transition that reaches the chosen target status via
 * the injected apply call, recording a per-issue outcome. An issue with no transition to the target is
 * skipped (not failed) with a clear reason; an apply error is recorded as a failure. Issues are processed
 * sequentially to stay gentle on Jira, and one issue's outcome never affects another's.
 */
export async function runBulkTransition(
  issueKeys: readonly string[],
  targetStatusName: string,
  transitionsByKey: ReadonlyMap<string, readonly JiraTransition[]>,
  applyTransition: ApplyTransition,
): Promise<BulkTransitionResult[]> {
  const results: BulkTransitionResult[] = [];
  for (const issueKey of issueKeys) {
    const transition = findTransitionToStatus(transitionsByKey.get(issueKey) ?? [], targetStatusName);
    if (transition === null) {
      results.push({ issueKey, outcome: 'skipped', message: `No transition to "${targetStatusName}" from its current status.` });
      continue;
    }
    try {
      await applyTransition(issueKey, transition.id);
      results.push({ issueKey, outcome: 'done', message: `Moved to ${transition.to.name}.` });
    } catch (caughtError) {
      results.push({ issueKey, outcome: 'failed', message: caughtError instanceof Error ? caughtError.message : 'Transition failed.' });
    }
  }
  return results;
}
