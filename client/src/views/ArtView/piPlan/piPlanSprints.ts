// piPlanSprints.ts — Ensures the PI's sprints exist before assignment (spec 028, US4). Existing board
// sprints are reused; only sprints the board does not yet cover are created, exactly once. Every call
// DELEGATES to the reused primitives (getBoardSprints, createSprint) — no new Jira behavior. Idempotent:
// a re-run recognises the sprints created last time and creates nothing new (FR-055).

import { createSprint, getBoardSprints } from '../../../services/jiraApi.ts';

/** One sprint the plan wants to exist, from the planner's projected calendar. */
export interface DesiredSprint {
  name: string;
  startIso: string;
  endIso: string;
}

/** The outcome: a name→id map for assignment, plus the names actually created this run. */
export interface EnsureSprintsResult {
  idByName: Record<string, number>;
  createdNames: string[];
}

/**
 * Reconciles the desired sprint calendar against the board. Reuses every existing sprint by name and
 * creates only the missing ones. On a dry run, reports what would be created without writing.
 */
export async function ensureSprints(
  desiredSprints: DesiredSprint[],
  boardId: number,
  options: { dryRun?: boolean } = {},
): Promise<EnsureSprintsResult> {
  const existing = await getBoardSprints(boardId);
  const idByName: Record<string, number> = {};
  existing.forEach((sprint) => { idByName[sprint.name] = sprint.id; });

  const createdNames: string[] = [];
  for (const desired of desiredSprints) {
    if (idByName[desired.name] != null) {
      continue; // already on the board — reuse, never duplicate
    }
    createdNames.push(desired.name);
    if (options.dryRun) {
      continue;
    }
    const created = await createSprint({
      name: desired.name,
      originBoardId: boardId,
      startDate: desired.startIso,
      endDate: desired.endIso,
    });
    idByName[created.name] = created.id;
  }
  return { idByName, createdNames };
}
