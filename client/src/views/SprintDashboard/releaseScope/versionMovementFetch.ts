// versionMovementFetch.ts — The two Jira searches behind the movement report, and the honest
// failure when one of them is refused.
//
// `fixVersion WAS` is the whole mechanism, and it is the one thing here that varies by Jira
// deployment: not every instance exposes the history operator for this field. When it is refused
// the report does NOT quietly fall back to something smaller — it says the history is unavailable,
// because a departures list that is silently empty reads as "nothing moved", which is the exact
// wrong answer to the question being asked.

import { jiraGet } from '../../../services/jiraApi.ts';
import { fetchIssuesPaged } from '../../../services/fetchIssuesPaged.ts';
import {
  buildCurrentlyInVersionJql,
  buildEverInVersionJql,
  buildVersionSnapshot,
  diffVersionMembership,
  type VersionChangeHistory,
  type VersionMemberIssue,
  type VersionMovement,
  type VersionSnapshot,
} from './versionMovement.ts';

/** The fields a movement row shows. Deliberately small — this is a lookup, not a board. */
const MOVEMENT_FIELDS = 'summary,status,assignee,fixVersions';

/** One page of issues as Jira returns it. */
interface MovementSearchResponse {
  issues?: Array<{
    key: string;
    fields?: {
      summary?: string;
      status?: { name?: string } | null;
      assignee?: { displayName?: string } | null;
      fixVersions?: Array<{ name?: string }> | null;
    };
    changelog?: { histories?: VersionChangeHistory[] };
  }>;
  total?: number;
}

/** How many issues one search page carries, and the ceiling a lookup will not read past. */
const MOVEMENT_PAGE_SIZE = 100;
const MOVEMENT_CEILING = 1000;

/** The movement report plus whatever the run could not establish. */
export interface VersionMovementOutcome {
  movement: VersionMovement;
  /** Every issue ever in the version, with its history — the basis for a point-in-time snapshot. */
  everInIssues: VersionMemberIssue[];
  /**
   * True when Jira refused the history query, so `departed` is empty because nothing is KNOWN — not
   * because nothing left.
   */
  isHistoryUnavailable: boolean;
  /** Jira's own words when it refused, so the reason is not guessed at. */
  historyErrorMessage: string | null;
}

/** Reduces a Jira issue to the shape the comparison reads. */
function toMemberIssue(rawIssue: NonNullable<MovementSearchResponse['issues']>[number]): VersionMemberIssue {
  return {
    key: rawIssue.key,
    summary: rawIssue.fields?.summary ?? '',
    statusName: rawIssue.fields?.status?.name ?? null,
    assigneeDisplayName: rawIssue.fields?.assignee?.displayName ?? null,
    fixVersionNames: (rawIssue.fields?.fixVersions ?? [])
      .map((fixVersion) => (fixVersion.name ?? '').trim())
      .filter((versionName) => versionName !== ''),
    changeHistories: rawIssue.changelog?.histories ?? [],
  };
}

/**
 * Runs one JQL search, paged, and reduces every issue it returns.
 *
 * `expand=changelog` is what makes the history free: who removed a version and what the release held
 * last Friday both come out of the same response, so neither costs a request of its own.
 */
async function searchMembers(jql: string, shouldReadChangelog: boolean): Promise<VersionMemberIssue[]> {
  const changelogExpansion = shouldReadChangelog ? '&expand=changelog' : '';
  const outcome = await fetchIssuesPaged<NonNullable<MovementSearchResponse['issues']>[number]>(
    (startAt, pageSize) => jiraGet<MovementSearchResponse>(
      `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${MOVEMENT_FIELDS}`
      + `&startAt=${startAt}&maxResults=${pageSize}${changelogExpansion}`,
    ).then((response) => ({ issues: response.issues ?? [], total: response.total ?? 0 })),
    { pageSize: MOVEMENT_PAGE_SIZE, ceiling: MOVEMENT_CEILING },
  );

  return outcome.issues.map((rawIssue) => toMemberIssue(rawIssue));
}

/**
 * Works out what has left a fix version, and where it went.
 *
 * The two searches are independent, and the CURRENT one is run regardless: even with no history at
 * all, "here is what is in it now" is worth having, and it is the half that never fails.
 */
export async function loadVersionMovement(
  projectKey: string,
  versionName: string,
): Promise<VersionMovementOutcome> {
  const currentlyInIssues = await searchMembers(buildCurrentlyInVersionJql(projectKey, versionName), false);

  try {
    const everInIssues = await searchMembers(buildEverInVersionJql(projectKey, versionName), true);
    return {
      movement: diffVersionMembership(versionName, everInIssues, currentlyInIssues),
      // Kept so a point-in-time question can be answered without asking Jira again: the history is
      // already in hand, and every "what did it look like on Friday" is then instant and free.
      everInIssues,
      isHistoryUnavailable: false,
      historyErrorMessage: null,
    };
  } catch (caughtError) {
    // Reported, never swallowed: an empty departures list that means "we could not look" is
    // indistinguishable on screen from one that means "nothing left", and they are opposite answers.
    return {
      movement: diffVersionMembership(versionName, [], currentlyInIssues),
      everInIssues: [],
      isHistoryUnavailable: true,
      historyErrorMessage: caughtError instanceof Error ? caughtError.message : 'Jira refused the history query.',
    };
  }
}

/**
 * What the release held at one instant, from a movement run already in hand.
 *
 * Synchronous and free: the change histories arrived with the history search, so asking "and what
 * about Friday at one?" costs nothing and can be answered as fast as the field can be typed into.
 */
export function readVersionSnapshotAt(outcome: VersionMovementOutcome, atIso: string): VersionSnapshot {
  return buildVersionSnapshot(outcome.movement.versionName, outcome.everInIssues, atIso);
}
