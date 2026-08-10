// sprintPiReconciliation.ts — Finds work that is in a PI's sprints but carries no PI value.
//
// Every PI-scoped tab queries `<PI field> = "PI 26.4"`, so an issue whose PI field was never filled in
// is invisible everywhere at once — not shown as a problem, simply absent. That is the worst kind of
// gap, because a board that silently omits work looks like a board with less work rather than a board
// that is wrong. It hides its own failure.
//
// Sprint membership is the independent second opinion. A sprint sits inside a PI's dates whether or not
// anyone remembered to fill in the field, so comparing the two finds exactly the issues the PI query
// cannot see. This module decides WHICH sprints belong to the PI and what to ask Jira for; it performs
// no requests itself.

import { parsePiDateRange } from '../ArtView/hooks/artHelpers.ts';
import type { BoardSprint } from '../../services/jiraApi.ts';

// ── Named constants ──

/** A ceiling on how many issue keys are named in the warning before it becomes unreadable. */
export const MAX_NAMED_MISMATCHES = 10;

// ── Choosing the sprints ──

/** A sprint's own window, or null when Jira has not given it dates yet. */
function readSprintWindow(sprint: BoardSprint): { startDate: Date; endDate: Date } | null {
  if (!sprint.startDate || !sprint.endDate) return null;
  const startDate = new Date(sprint.startDate);
  const endDate = new Date(sprint.endDate);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  return { startDate, endDate };
}

export interface SprintSelection {
  /** Sprints whose dates place them inside the PI. */
  sprintsInPi: BoardSprint[];
  /** Sprints that could not be judged because Jira gave them no dates. Reported, never guessed at. */
  undatedSprintNames: string[];
}

/**
 * Picks the sprints that fall inside a PI's date range.
 *
 * The PI label carries its own window — "PI 26.4 (07/30/26 - 10/07/26)" — so the two are compared on
 * dates rather than on names. Matching on names would tie this to one team's sprint-naming habit and
 * break the first time somebody renamed a sprint.
 *
 * A sprint counts as inside the PI when the two windows OVERLAP at all, because a sprint that straddles
 * a PI boundary still carries work that belongs to the PI.
 */
export function selectSprintsInPiWindow(
  sprints: readonly BoardSprint[],
  piName: string,
): SprintSelection {
  const piWindow = parsePiDateRange(piName);
  if (!piWindow) return { sprintsInPi: [], undatedSprintNames: [] };

  const sprintsInPi: BoardSprint[] = [];
  const undatedSprintNames: string[] = [];

  for (const sprint of sprints ?? []) {
    const sprintWindow = readSprintWindow(sprint);
    if (!sprintWindow) {
      undatedSprintNames.push(sprint.name);
      continue;
    }
    const doWindowsOverlap = sprintWindow.startDate <= piWindow.endDate
      && sprintWindow.endDate >= piWindow.startDate;
    if (doWindowsOverlap) sprintsInPi.push(sprint);
  }

  return { sprintsInPi, undatedSprintNames };
}

// ── Asking Jira for the gap ──

/**
 * Builds the query for issues sitting in these sprints with no PI value at all.
 *
 * Only an EMPTY PI field is treated as the defect. An issue tagged to a *different* PI is a legitimate
 * carry-over and saying otherwise would turn normal practice into a permanent warning.
 *
 * @returns The JQL, or null when there are no sprints to ask about — the caller must then skip the
 *          request entirely rather than send a query that would match the whole project.
 */
export function buildMistaggedSprintIssueJql(
  sprintIds: readonly number[],
  piFieldReference: string,
): string | null {
  if (sprintIds.length === 0 || !piFieldReference) return null;
  return `sprint in (${sprintIds.join(', ')}) AND ${piFieldReference} is EMPTY ORDER BY key ASC`;
}

// ── Describing what was found ──

export interface SprintPiMismatch {
  issueKey: string;
  summary: string;
  statusName: string;
}

export interface SprintPiReconciliation {
  mismatches: SprintPiMismatch[];
  /** Sprint names that were compared, so the operator can see what the check actually covered. */
  searchedSprintNames: string[];
  undatedSprintNames: string[];
}

/** Reads the handful of fields the warning needs off a Jira issue. */
export function toMismatch(issue: {
  key: string;
  fields?: { summary?: string; status?: { name?: string } };
}): SprintPiMismatch {
  return {
    issueKey: String(issue.key),
    summary: String(issue.fields?.summary ?? ''),
    statusName: String(issue.fields?.status?.name ?? ''),
  };
}

/**
 * Turns the reconciliation into one sentence a person can act on.
 *
 * The issue keys are named rather than merely counted, because "3 issues are missing their PI" sends
 * somebody hunting while "ENCUC-2208, ENCUC-2210 are missing their PI" can be fixed immediately.
 */
export function describeReconciliation(reconciliation: SprintPiReconciliation): string {
  const { mismatches } = reconciliation;
  if (mismatches.length === 0) return '';

  const namedKeys = mismatches.slice(0, MAX_NAMED_MISMATCHES).map((mismatch) => mismatch.issueKey);
  const remainingCount = mismatches.length - namedKeys.length;
  const remainderText = remainingCount > 0 ? ` and ${remainingCount} more` : '';
  const issueWord = mismatches.length === 1 ? 'issue is' : 'issues are';

  return `${mismatches.length} ${issueWord} in this PI's sprints but have no PI value, so every`
    + ` PI-scoped tab is missing them: ${namedKeys.join(', ')}${remainderText}.`;
}
