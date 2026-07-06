// fetchTeamVelocity.ts — Computes a Scrum team's average velocity (completed points/sprint) over the
// most recent N closed sprints, so it can drive the Feature Canvas sprint-box capacity.
//
// Mirrors the Metrics tab's velocity definition (points of committed-and-completed issues, excluding
// work added mid-sprint) so the canvas budget matches the "avg velocity" shown there.

import { jiraGet } from '../../services/jiraApi.ts';
import { computeAverageVelocity } from './sprintMetrics.ts';

interface ClosedSprint {
  id: number;
  name: string;
  startDate?: string;
}

/** Paginates the board's closed sprints and returns the most-recent N in chronological order. */
async function fetchRecentClosedSprints(boardId: number, sprintWindow: number): Promise<ClosedSprint[]> {
  const collected: ClosedSprint[] = [];
  let startAt = 0;
  for (let page = 0; page < 20; page += 1) {
    const response = await jiraGet<{ values?: ClosedSprint[]; isLast?: boolean }>(
      `/rest/agile/1.0/board/${boardId}/sprint?state=closed&startAt=${startAt}&maxResults=50`,
    );
    const values = response.values ?? [];
    collected.push(...values);
    if (response.isLast || values.length === 0) {
      break;
    }
    startAt += values.length;
  }
  return collected
    .sort((left, right) => new Date(right.startDate ?? '').getTime() - new Date(left.startDate ?? '').getTime())
    .slice(0, sprintWindow)
    .reverse();
}

/** Reads a sprint-report issue's story points from Jira's estimate statistic (current, else original). */
function readSprintReportPoints(issue: Record<string, unknown>): number {
  const currentEstimate = issue.currentEstimateStatistic as { statFieldValue?: { value?: number | string } } | undefined;
  const originalEstimate = issue.estimateStatistic as { statFieldValue?: { value?: number | string } } | undefined;
  return Number(currentEstimate?.statFieldValue?.value ?? originalEstimate?.statFieldValue?.value ?? 0);
}

/**
 * Returns the team's average velocity (completed points/sprint) over the last `sprintWindow` closed
 * sprints, or null when the board has no closed sprints (so callers can fall back to a manual value).
 */
export async function fetchTeamVelocity(boardId: number, sprintWindow: number): Promise<number | null> {
  const closedSprints = await fetchRecentClosedSprints(boardId, sprintWindow);
  if (closedSprints.length === 0) {
    return null;
  }
  const sprintRows = await Promise.all(
    closedSprints.map(async (sprint) => {
      try {
        const report = await jiraGet<{
          contents?: {
            completedIssues?: Array<Record<string, unknown> & { key?: string }>;
            issueKeysAddedDuringSprint?: Record<string, boolean>;
          };
        }>(`/rest/greenhopper/1.0/rapid/charts/sprintreport?rapidViewId=${boardId}&sprintId=${sprint.id}`);
        const contents = report.contents;
        if (!contents) {
          return { completedPoints: 0 };
        }
        const addedKeys = new Set(Object.keys(contents.issueKeysAddedDuringSprint ?? {}));
        const completedCommitted = (contents.completedIssues ?? []).filter((issue) => !addedKeys.has(String(issue.key ?? '')));
        const completedPoints = completedCommitted.reduce((sum, issue) => sum + readSprintReportPoints(issue), 0);
        return { completedPoints };
      } catch {
        return { completedPoints: 0 };
      }
    }),
  );
  return computeAverageVelocity(sprintRows);
}
