// recentVersionChanges.ts — "Show me everything whose fix version was removed today."
//
// The version trace answers "where did THIS release's work go", which needs a release in mind. This
// answers the question you arrive with before you have one: something cleared a batch of fix
// versions this morning, and you want the batch, not a release-by-release hunt.
//
// It deliberately uses NO history JQL. `fixVersion WAS` and `CHANGED` are not exposed on every Jira
// deployment, and this is the fallback that always works: ask for issues updated since a moment —
// a plain, universally supported clause — and read the change history that comes back with them.
//
// Pure. Building the query and reading the histories are separate from fetching them, which is what
// makes the part that is easy to get subtly wrong testable without Jira.

import { escapeJqlValue } from '../../../utils/jqlValue.ts';
import type { VersionChangeHistory, VersionMemberIssue } from './versionMovement.ts';

/** Jira names this field "Fix Version" in a changelog, whatever the API calls it elsewhere. */
const FIX_VERSION_CHANGE_FIELD = 'fix version';

/** One fix-version removal: what came off, when, and who did it. */
export interface FixVersionRemoval {
  issueKey: string;
  summary: string;
  statusName: string | null;
  assigneeDisplayName: string | null;
  /** The versions taken off in this change. */
  removedVersionNames: string[];
  /** What the issue carries now — empty means it is on no release at all. */
  currentVersionNames: string[];
  atIso: string;
  byDisplayName: string | null;
  /**
   * The status change made by the SAME action, when there was one.
   *
   * The decisive fact. Jira records one action as one changelog entry, so a fix version that
   * disappeared in the same entry as a status change was not edited away by hand — a **transition**
   * did both, which means a workflow post-function or a transition screen. That is a Jira
   * configuration answer, and it is the difference between "somebody cleared this" and "the
   * workflow clears this every time anybody moves the issue".
   */
  statusChangeInSameAction: { fromStatus: string; toStatus: string } | null;
}

/**
 * JQL for issues touched since a moment.
 *
 * `updated >=` rather than a history operator on purpose: it is supported everywhere, and an issue
 * whose fix version changed was necessarily updated when it did. The result is a superset, narrowed
 * afterwards by reading the histories — which is the same shape the hygiene scan already uses.
 */
export function buildUpdatedSinceJql(projectKey: string, sinceJqlDateTime: string): string {
  return `project = "${escapeJqlValue(projectKey.trim())}"`
    + ` AND updated >= "${escapeJqlValue(sinceJqlDateTime)}" ORDER BY updated DESC`;
}

/**
 * Formats an instant the way Jira's `updated >=` clause expects: `yyyy/MM/dd HH:mm`.
 *
 * Local wall time, because that is what Jira compares against for a user-facing date clause and what
 * somebody means by "today". Seconds are dropped — Jira's clause does not read them.
 */
export function formatJqlDateTime(instant: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${instant.getFullYear()}/${pad(instant.getMonth() + 1)}/${pad(instant.getDate())}`
    + ` ${pad(instant.getHours())}:${pad(instant.getMinutes())}`;
}

/** Midnight this morning, local — what "today" means to somebody asking this question. */
export function readStartOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Every fix-version REMOVAL recorded on one issue at or after an instant.
 *
 * A single change can take several versions off at once, so each history entry contributes all of
 * its removals rather than only the first. Additions are ignored: adding a release is not the event
 * anybody is hunting, and folding the two together would bury the removals in noise.
 *
 * Returns one entry per CHANGE, not per issue — an issue touched twice in a morning genuinely had
 * two things happen to it, and collapsing them would hide the second.
 */
export function readFixVersionRemovals(
  issue: VersionMemberIssue,
  sinceIso: string,
): FixVersionRemoval[] {
  return (issue.changeHistories ?? [])
    .filter((history) => (history.created ?? '') >= sinceIso)
    .map((history) => ({ history, removedVersionNames: readRemovedVersionNames(history) }))
    .filter((entry) => entry.removedVersionNames.length > 0)
    .map((entry) => ({
      issueKey: issue.key,
      summary: issue.summary,
      statusName: issue.statusName,
      assigneeDisplayName: issue.assigneeDisplayName,
      removedVersionNames: entry.removedVersionNames,
      currentVersionNames: issue.fixVersionNames,
      atIso: entry.history.created as string,
      byDisplayName: entry.history.author?.displayName ?? null,
      statusChangeInSameAction: readStatusChangeInEntry(entry.history),
    }));
}

/** The status change made in the same entry, or null when the entry changed no status. */
function readStatusChangeInEntry(history: VersionChangeHistory): { fromStatus: string; toStatus: string } | null {
  const statusItem = (history.items ?? []).find((item) =>
    (item.field ?? '').trim().toLowerCase() === 'status');
  if (statusItem === undefined) {
    return null;
  }
  return {
    fromStatus: (statusItem.fromString ?? '').trim() || '(none)',
    toStatus: (statusItem.toString ?? '').trim() || '(none)',
  };
}

/** The version names one change entry took off. */
function readRemovedVersionNames(history: VersionChangeHistory): string[] {
  const fixVersionItems = (history.items ?? [])
    .filter((item) => (item.field ?? '').trim().toLowerCase() === FIX_VERSION_CHANGE_FIELD);

  // Versions this same action ADDED. A transition screen re-submits the field it displays, so Jira
  // records a version being taken off and put back in one entry — and reading only `fromString`
  // reported that no-op as a removal, on an issue that plainly still carries the version. Netting
  // the two within the entry is the fix: one action, one net effect.
  const addedVersionNames = new Set(fixVersionItems
    .map((item) => (item.toString ?? '').trim())
    .filter((versionName) => versionName !== ''));

  return fixVersionItems
    .map((item) => (item.fromString ?? '').trim())
    .filter((versionName) => versionName !== '' && !addedVersionNames.has(versionName));
}

/**
 * Every removal across a set of issues, newest first.
 *
 * Newest first because this is read to find out what just happened, and the most recent change is
 * the one being asked about.
 */
export function collectFixVersionRemovals(
  issues: readonly VersionMemberIssue[],
  sinceIso: string,
): FixVersionRemoval[] {
  return issues
    .flatMap((issue) => readFixVersionRemovals(issue, sinceIso))
    .sort((left, right) => right.atIso.localeCompare(left.atIso));
}

/** One person's batch of removals — the shape the answer usually takes. */
export interface RemovalBatch {
  byDisplayName: string;
  removals: FixVersionRemoval[];
}

/**
 * Groups removals by who made them, largest batch first.
 *
 * Because the answer is almost never "twelve issues each lost their release". It is "one person
 * cleared twelve while doing something else", and grouping is what makes that visible in one line
 * instead of twelve rows a reader has to notice the pattern in.
 */
export function groupRemovalsByAuthor(removals: readonly FixVersionRemoval[]): RemovalBatch[] {
  const removalsByAuthor = new Map<string, FixVersionRemoval[]>();

  removals.forEach((removal) => {
    const authorName = removal.byDisplayName ?? 'unattributed';
    removalsByAuthor.set(authorName, [...(removalsByAuthor.get(authorName) ?? []), removal]);
  });

  return [...removalsByAuthor.entries()]
    .map(([byDisplayName, authorRemovals]) => ({ byDisplayName, removals: authorRemovals }))
    .sort((left, right) => right.removals.length - left.removals.length
      || left.byDisplayName.localeCompare(right.byDisplayName));
}

/**
 * How many removals happened as part of a status change, and how many were plain field edits.
 *
 * The question people actually argue about: "is the automation clearing our fix versions?" A
 * removal that rode along with a transition was done BY that transition — no caller has to name the
 * field for it to be cleared, so no amount of reading our own code can rule it in or out. This
 * counts the two populations so the argument can be settled with evidence instead of suspicion.
 */
export function summariseRemovalCauses(
  removals: readonly FixVersionRemoval[],
): { withStatusChange: number; fieldEditOnly: number } {
  const withStatusChange = removals.filter((removal) => removal.statusChangeInSameAction !== null).length;
  return { withStatusChange, fieldEditOnly: removals.length - withStatusChange };
}
