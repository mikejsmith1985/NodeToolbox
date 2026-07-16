// buildBurnDownData.ts - Reconstructs a sprint's burn-down from issue changelogs.
//
// Lives apart from SprintDashboardView because it is a pure calculation over Jira data, not part of
// the view. Exporting it from the component file also broke Fast Refresh: a module that exports both
// a component and something else cannot be hot-swapped, so every edit to that 7,000-line view forced
// a full reload.

import type { JiraIssue } from '../../types/jira.ts';
import { isDeliveredIssue, isDeliveredWorkflowStatusName } from '../../utils/workflowDelivery.ts';

/** Defined here rather than imported: the view keeps its own copy, as do several other modules. */
const MS_PER_DAY = 86_400_000;

// The column names of the series this produces. They live with the calculation that emits them; the
// chart imports them so the producer and the reader can never disagree about a key.
export const BURN_IDEAL_KEY = 'ideal';
export const BURN_REMAINING_KEY = 'remaining';
export const BURN_COMPLETED_KEY = 'completed';
export const BURN_PROJECTED_KEY = 'projected';

/**
 * Checks whether a given status counts as completed for burn-down purposes.
 * "Completed" follows the ART delivered rule (Ready for QA or later), so the chart burns when work
 * reaches External Testing — the team's Definition of Done — not only at statusCategory Done.
 */
function isStatusDelivered(statusName: string, issue: JiraIssue): boolean {
  if (!statusName) return false;
  if (statusName.toLowerCase() === issue.fields.status.name.toLowerCase()) {
    return isDeliveredIssue(issue);
  }
  return isDeliveredWorkflowStatusName(statusName);
}

/**
 * Builds burn-down chart data points for the ideal, remaining, and completed lines.
 * Reconstructs issue status over each day of the sprint using issue changelogs.
 */
export function buildBurnDownData(
  sprintStartDate: string,
  sprintEndDate: string,
  issues: JiraIssue[],
  isClosed: boolean,
) {
  const startMs = new Date(sprintStartDate).getTime();
  const endMs = new Date(sprintEndDate).getTime();
  const totalDays = Math.max(1, Math.ceil((endMs - startMs) / MS_PER_DAY));

  const todayMs = Date.now();
  const todayDayIndex = Math.floor((todayMs - startMs) / MS_PER_DAY);

  // Pre-parse issues, their creation date, and status transitions from the changelog
  const parsedIssues = issues.map((issue) => {
    const createdMs = new Date(issue.fields.created).getTime();
    const updatedMs = new Date(issue.fields.updated).getTime();

    const transitions: Array<{ timestamp: number; from: string; to: string }> = [];
    if (issue.changelog && Array.isArray(issue.changelog.histories)) {
      for (const history of issue.changelog.histories) {
        if (!history.created) continue;
        const ts = new Date(history.created).getTime();
        for (const item of history.items) {
          if (item.field === 'status') {
            transitions.push({
              timestamp: ts,
              from: item.fromString || '',
              to: item.toString || '',
            });
          }
        }
      }
    }
    // Sort transitions chronologically
    transitions.sort((a, b) => a.timestamp - b.timestamp);

    return {
      issue,
      createdMs,
      updatedMs,
      transitions,
    };
  });

  return Array.from({ length: totalDays + 1 }, (_, dayIndex) => {
    const dayTimestamp = startMs + dayIndex * MS_PER_DAY;

    // Ideal burndown trends from totalIssues down to 0
    const totalIssues = issues.length;
    const ideal = Math.round(totalIssues - (totalIssues / totalDays) * dayIndex);

    // Calculate projected burnup to show the linear path from 0 to total issues across the sprint
    const projected = Math.round((totalIssues / totalDays) * dayIndex);

    // Only plot remaining and completed for past/current days if active, or all days if closed
    const showPlot = isClosed || dayIndex <= todayDayIndex;

    let remaining: number | undefined = undefined;
    let completed: number | undefined = undefined;

    if (showPlot) {
      let activeCount = 0;
      let doneCount = 0;

      for (const parsed of parsedIssues) {
        // Issue did not exist on this day yet (creation date fallback check)
        if (parsed.createdMs > dayTimestamp) {
          continue;
        }

        // No initialiser: every branch below assigns it, and seeding '' only hid that fact — an
        // unassigned path would now be a compile error rather than a silently empty status.
        let statusName: string;
        if (parsed.transitions.length === 0) {
          // Fallback when no changelog is available:
          // If the issue is currently done, check if we are past the issue's updated timestamp.
          // Otherwise assume it was not done (e.g. "To Do")
          const isCurrentlyDelivered = isDeliveredIssue(parsed.issue);
          if (isCurrentlyDelivered) {
            if (dayTimestamp >= parsed.updatedMs) {
              statusName = parsed.issue.fields.status.name;
            } else {
              statusName = 'To Do';
            }
          } else {
            statusName = parsed.issue.fields.status.name;
          }
        } else {
          // Trace history to determine status on this day
          if (dayTimestamp < parsed.transitions[0].timestamp) {
            statusName = parsed.transitions[0].from;
          } else {
            let lastTx = parsed.transitions[0];
            for (const tx of parsed.transitions) {
              if (tx.timestamp <= dayTimestamp) {
                lastTx = tx;
              } else {
                break;
              }
            }
            statusName = lastTx.to;
          }
        }

        const isDone = isStatusDelivered(statusName, parsed.issue);
        if (isDone) {
          doneCount++;
        } else {
          activeCount++;
        }
      }

      remaining = activeCount;
      completed = doneCount;
    }

    return {
      day: dayIndex,
      [BURN_IDEAL_KEY]: ideal,
      [BURN_REMAINING_KEY]: remaining,
      [BURN_COMPLETED_KEY]: completed,
      [BURN_PROJECTED_KEY]: projected,
    };
  });
}
