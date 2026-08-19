// automationMoveAudit.ts — Which status changes belong to the automation, and which do not.
//
// The question this answers is "did our automation cancel this issue?", and it is hard for one
// specific reason: the app authenticates to Jira AS the operator, so Jira's history credits every
// change to them either way. Reading the issue's history proves nothing in either direction.
//
// Timing does. An intake run posts its comment and fires its transition inside the same few seconds
// of the same run; a person doing it by hand does not happen to also leave an automation-signed
// comment moments earlier. So a status change within a short window of an automation comment is
// attributed to the automation, and one outside it is left alone.
//
// The window is deliberately generous — three minutes each side — because a slow Jira can stretch a
// run, and the cost of the two errors is not symmetric: missing a cancellation the automation caused
// leaves a real problem unfound, while over-claiming one merely sends somebody to look at an issue.

/** How far from an automation comment a status change is still credited to the same run. */
export const AUTOMATION_MOVE_WINDOW_MS = 3 * 60 * 1000;

/** One status change attributed to the automation. */
export interface AutomationMove {
  toStatus: string;
  fromStatus: string;
  atIso: string;
}

/** One changelog history entry, reduced to what attribution needs. */
export interface ChangelogHistoryEntry {
  created?: string;
  items?: Array<{ field?: string; toString?: string; fromString?: string }>;
}

/** One audited issue: what the automation said, what it did, and where the issue stands now. */
export interface MoveAuditRow {
  issueKey: string;
  issueSummary: string;
  currentStatus: string;
  /** True when the issue now sits in Jira's Done category — Cancelled and Closed included. */
  isCurrentStatusDone: boolean;
  commentCount: number;
  automationMoves: AutomationMove[];
}

/** Milliseconds for an ISO stamp, or null when it cannot be read. */
function readInstantMs(isoText: string | undefined): number | null {
  if (!isoText) return null;
  const parsedMs = new Date(isoText).getTime();
  return Number.isFinite(parsedMs) ? parsedMs : null;
}

/**
 * Attributes status changes to the automation by their closeness to its comments.
 *
 * A change is claimed once, however many comments bracket it — the issue moved once, and reporting
 * it twice would inflate every count built on this.
 */
export function correlateAutomationMoves(
  automationCommentIsos: readonly string[],
  changelogHistories: readonly ChangelogHistoryEntry[],
): AutomationMove[] {
  const commentInstants = automationCommentIsos
    .map(readInstantMs)
    .filter((instantMs): instantMs is number => instantMs !== null);
  if (commentInstants.length === 0) return [];

  const claimedMoves: AutomationMove[] = [];
  for (const history of changelogHistories) {
    const changedAtMs = readInstantMs(history.created);
    if (changedAtMs === null) continue;

    const statusItem = (history.items ?? []).find((item) => item.field === 'status');
    if (!statusItem) continue;

    const isNearAnyComment = commentInstants
      .some((commentMs) => Math.abs(changedAtMs - commentMs) <= AUTOMATION_MOVE_WINDOW_MS);
    if (!isNearAnyComment) continue;

    claimedMoves.push({
      toStatus: statusItem.toString ?? '(unknown)',
      fromStatus: statusItem.fromString ?? '(unknown)',
      atIso: history.created ?? '',
    });
  }

  return claimedMoves;
}

/** Everything about one row a free-text search should look at. */
function buildSearchableText(row: MoveAuditRow): string {
  return [
    row.issueKey,
    row.issueSummary,
    row.currentStatus,
    ...row.automationMoves.map((move) => `${move.fromStatus} ${move.toStatus}`),
  ].join(' ').toLowerCase();
}

/**
 * Narrows the audit to what somebody is actually looking for.
 *
 * The search covers the status the automation moved an issue TO, not just its key and summary —
 * because the question that produced this feature was "which ones did it cancel?", and typing
 * "cancelled" should answer it directly.
 */
export function filterMoveAuditRows(
  rows: readonly MoveAuditRow[],
  queryText: string,
  onlyMovedByAutomation: boolean,
): MoveAuditRow[] {
  const normalizedQuery = queryText.trim().toLowerCase();
  return rows
    .filter((row) => !onlyMovedByAutomation || row.automationMoves.length > 0)
    .filter((row) => normalizedQuery === '' || buildSearchableText(row).includes(normalizedQuery));
}
