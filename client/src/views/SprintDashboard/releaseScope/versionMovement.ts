// versionMovement.ts — Where the issues that used to be in a release went.
//
// A release had 27 issues and now has 15. Jira will happily tell you what is in a version today and
// says nothing at all about what left it, so the only way to answer "where did the other twelve go"
// was to remember. This works it out: everything that was EVER in the version, minus what is still
// there, and for each departure the version it sits in now.
//
// Pure. It builds JQL and compares two lists; the fetching lives with its caller. That is what makes
// the comparison — the part that is easy to get subtly wrong — testable without Jira.

import { escapeJqlValue } from '../../../utils/jqlValue.ts';

/** One issue, reduced to what a movement report reads. */
export interface VersionMemberIssue {
  key: string;
  summary: string;
  statusName: string | null;
  assigneeDisplayName: string | null;
  /** The versions it carries RIGHT NOW, which is where it went. */
  fixVersionNames: string[];
  /** Its change history, when the search asked for it — the source of who removed the version. */
  changeHistories?: VersionChangeHistory[];
}

/** One changelog entry, reduced to what a departure lookup reads. */
export interface VersionChangeHistory {
  created?: string;
  author?: { displayName?: string } | null;
  items?: Array<{ field?: string; fromString?: string | null; toString?: string | null }>;
}

/** When the version was taken off an issue, and by whom. */
export interface VersionDeparture {
  atIso: string;
  byDisplayName: string | null;
}

/** One issue that has left the version, and where it is now. */
export interface DepartedIssue {
  key: string;
  summary: string;
  statusName: string | null;
  assigneeDisplayName: string | null;
  /** Empty means it carries no version at all — dropped rather than moved. */
  movedToVersionNames: string[];
  /**
   * Who took the version off, and when — null when the changelog does not say.
   *
   * The most useful single fact in the report. A release losing twelve issues is rarely twelve
   * decisions: it is usually one person doing one thing (accepting a batch of issues, say) that
   * cleared the field as a side effect, and the author and timestamp are what make that visible.
   */
  departure: VersionDeparture | null;
}

/** The whole answer: what stayed, what left, and where it went. */
export interface VersionMovement {
  versionName: string;
  stillIn: VersionMemberIssue[];
  departed: DepartedIssue[];
  /** Issues in the version now that were never recorded as arriving — the counterpart of departed. */
  arrived: VersionMemberIssue[];
}

/**
 * JQL for every issue that was EVER in this version, whether or not it still is.
 *
 * `fixVersion WAS` is the whole trick, and it is the one thing here that depends on the Jira
 * instance: not every deployment exposes the history operator for this field. The caller is expected
 * to fall back to a changelog scan when Jira refuses it, and to SAY it fell back rather than quietly
 * returning a smaller answer.
 */
export function buildEverInVersionJql(projectKey: string, versionName: string): string {
  return `project = "${escapeJqlValue(projectKey.trim())}"`
    + ` AND fixVersion WAS "${escapeJqlValue(versionName)}" ORDER BY key ASC`;
}

/** JQL for what the version holds today — the 15, in the case that prompted this. */
export function buildCurrentlyInVersionJql(projectKey: string, versionName: string): string {
  return `project = "${escapeJqlValue(projectKey.trim())}"`
    + ` AND fixVersion = "${escapeJqlValue(versionName)}" ORDER BY key ASC`;
}

/** Jira names this field "Fix Version" in a changelog, whatever the API calls it elsewhere. */
const FIX_VERSION_CHANGE_FIELD = 'fix version';

/**
 * When a named version was taken OFF an issue, and by whom.
 *
 * The LAST such entry, not the first: an issue can be added back and removed again, and the
 * departure that explains why it is missing today is the most recent one.
 *
 * Returns null when the history says nothing — never a guessed author. "Removed by somebody, at some
 * point" is worse than an honest blank, because it looks like an answer.
 */
export function readVersionDeparture(
  changeHistories: readonly VersionChangeHistory[] | undefined,
  versionName: string,
): VersionDeparture | null {
  const removals = (changeHistories ?? [])
    .filter((history) => (history.items ?? []).some((item) =>
      (item.field ?? '').trim().toLowerCase() === FIX_VERSION_CHANGE_FIELD
      && (item.fromString ?? '').trim() === versionName))
    .filter((history) => (history.created ?? '') !== '')
    .sort((left, right) => (left.created ?? '').localeCompare(right.created ?? ''));

  const lastRemoval = removals[removals.length - 1];
  if (lastRemoval === undefined) {
    return null;
  }

  return {
    atIso: lastRemoval.created as string,
    byDisplayName: lastRemoval.author?.displayName ?? null,
  };
}

/**
 * Compares the two populations and says what moved.
 *
 * Departed is computed from the EVER list rather than from changelogs: an issue that was once in the
 * version and is not in it now has left, whatever route it took, and a changelog scan would miss one
 * that moved twice. `movedToVersionNames` is read off the issue's current versions for the same
 * reason — where it IS beats where a history entry said it was going.
 *
 * An issue in both lists is unchanged, so it appears in neither `departed` nor `arrived`.
 */
export function diffVersionMembership(
  versionName: string,
  everInIssues: readonly VersionMemberIssue[],
  currentlyInIssues: readonly VersionMemberIssue[],
): VersionMovement {
  const currentKeys = new Set(currentlyInIssues.map((issue) => issue.key));
  const everKeys = new Set(everInIssues.map((issue) => issue.key));

  const departed = everInIssues
    .filter((issue) => !currentKeys.has(issue.key))
    .map((issue) => ({
      key: issue.key,
      summary: issue.summary,
      statusName: issue.statusName,
      assigneeDisplayName: issue.assigneeDisplayName,
      movedToVersionNames: issue.fixVersionNames.filter((name) => name !== versionName),
      departure: readVersionDeparture(issue.changeHistories, versionName),
    }));

  return {
    versionName,
    stillIn: currentlyInIssues.filter((issue) => everKeys.has(issue.key)),
    departed,
    // Present in the version but absent from its own history. Usually means the instance answered
    // the EVER query without history, so this is worth showing rather than folding into `stillIn`.
    arrived: currentlyInIssues.filter((issue) => !everKeys.has(issue.key)),
  };
}

/**
 * Whether one issue carried a named version at a given instant.
 *
 * Worked out by REWINDING: start from what the issue carries today — which is a fact, not a
 * reconstruction — then undo every Fix Version change made after the instant asked about. An entry
 * that added the version means it was absent before that entry; one that removed it means it was
 * present. Whatever state the rewind lands on is the truth at that moment.
 *
 * Rewinding rather than replaying forward matters: a changelog only records changes, so there is no
 * entry establishing the ORIGINAL value, and a forward replay has to guess where to start. Today's
 * value needs no guess.
 */
export function readVersionMembershipAt(
  issue: VersionMemberIssue,
  versionName: string,
  atIso: string,
): boolean {
  let wasInVersion = issue.fixVersionNames.includes(versionName);

  const changesAfter = (issue.changeHistories ?? [])
    .filter((history) => (history.created ?? '') > atIso)
    .sort((left, right) => (right.created ?? '').localeCompare(left.created ?? ''));

  changesAfter.forEach((history) => {
    (history.items ?? []).forEach((item) => {
      if ((item.field ?? '').trim().toLowerCase() !== FIX_VERSION_CHANGE_FIELD) return;
      // Undo it. An add means it was NOT there beforehand; a removal means it was.
      if ((item.toString ?? '').trim() === versionName) wasInVersion = false;
      if ((item.fromString ?? '').trim() === versionName) wasInVersion = true;
    });
  });

  return wasInVersion;
}

/** What a release held at one instant, and how that differs from what it holds now. */
export interface VersionSnapshot {
  versionName: string;
  atIso: string;
  /** Everything the version carried at that instant. */
  membersAt: VersionMemberIssue[];
  /** In it then, not in it now. */
  removedSince: VersionMemberIssue[];
  /** In it now, not in it then. */
  addedSince: VersionMemberIssue[];
}

/**
 * Reconstructs what a release looked like at a given moment.
 *
 * Answers "what was in this release as of Friday at 1pm" — a question Jira cannot be asked directly,
 * and the one that turns "twelve issues vanished" into "these twelve, between then and now".
 *
 * The candidate set is every issue that was EVER in the version, because an issue that has since
 * left is exactly the kind this is looking for; asking only what is in it today would rebuild the
 * present and call it the past.
 */
export function buildVersionSnapshot(
  versionName: string,
  everInIssues: readonly VersionMemberIssue[],
  atIso: string,
): VersionSnapshot {
  const membersAt = everInIssues.filter((issue) => readVersionMembershipAt(issue, versionName, atIso));
  const memberKeysAt = new Set(membersAt.map((issue) => issue.key));
  const membersNow = everInIssues.filter((issue) => issue.fixVersionNames.includes(versionName));
  const memberKeysNow = new Set(membersNow.map((issue) => issue.key));

  return {
    versionName,
    atIso,
    membersAt,
    removedSince: membersAt.filter((issue) => !memberKeysNow.has(issue.key)),
    addedSince: membersNow.filter((issue) => !memberKeysAt.has(issue.key)),
  };
}

/**
 * Groups the departures by where they landed, most-populated first.
 *
 * The question is rarely about one issue. "Twelve went to 08/27/2026 B" is the answer; twelve rows
 * each naming the same destination is the same fact, said twelve times.
 */
export function groupDeparturesByDestination(
  departed: readonly DepartedIssue[],
): Array<{ destination: string; issueKeys: string[] }> {
  const keysByDestination = new Map<string, string[]>();
  const NO_VERSION_LABEL = 'no fix version at all';

  departed.forEach((issue) => {
    const destinations = issue.movedToVersionNames.length > 0
      ? issue.movedToVersionNames
      : [NO_VERSION_LABEL];
    destinations.forEach((destination) => {
      keysByDestination.set(destination, [...(keysByDestination.get(destination) ?? []), issue.key]);
    });
  });

  return [...keysByDestination.entries()]
    .map(([destination, issueKeys]) => ({ destination, issueKeys }))
    .sort((left, right) => right.issueKeys.length - left.issueKeys.length
      || left.destination.localeCompare(right.destination));
}
