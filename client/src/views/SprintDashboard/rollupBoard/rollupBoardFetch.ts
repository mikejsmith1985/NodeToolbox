// rollupBoardFetch.ts — Retrieves everything the Roll-Up Board needs, in three sweeps.
//
// Sweep 1 re-reads the issues the Team Dashboard has ALREADY scoped, with the extra fields this
// board needs. The scope is the dashboard's — whatever its Sprint / Fix Version / PI selector holds
// — so this board shows the same work as every other tab by construction. Sweep 2 exists because a
// Jira agile board does NOT return sub-tasks, yet sub-tasks are one of the ways this team breaks
// work down. Sweep 3 reads the Features, which live in a different Jira project from the work.
//
// The board promises that nothing is hidden, so this module never trims a result set. A failure in
// sweep 1 is fatal, because half a board that looks whole is worse than an error. A failed
// enrichment chunk is reported rather than swallowed, so the gap is visible.

import { jiraGet, type BoardSprint } from '../../../services/jiraApi.ts';
import { extractHttpStatus } from '../../../services/issueLookup.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import { extractFeatureKeyFromIssueFields } from '../../../utils/featureLink.ts';
import { buildFeaturesInPiJql } from './emptyFeatureScan.ts';
import { fetchConfluencePageByReference } from '../../../services/confluenceApi.ts';
import { parsePiReviewTable } from '../../ArtView/piReviewTable.ts';
import { readCarryOverFeatureKeys } from './carryOverMarks.ts';
import { CARD_DETAIL_FIELDS } from './cardDetail.ts';
import {
  EMPTY_CARRY_OVER_SCOPE,
  buildCarryOverFeatureJql,
  buildCarryOverWorkJql,
  type CarryOverScope,
} from './carryOverScope.ts';
import {
  buildMistaggedSprintIssueJql,
  selectSprintsInPiWindow,
  toMismatch,
  type SprintPiReconciliation,
} from '../sprintPiReconciliation.ts';
import {
  EXPECTED_BOARD_ISSUE_CEILING,
  FEATURE_KEY_CHUNK_SIZE,
  MAX_FEATURE_READ_PROBES,
  type FeatureReadFailure,
  SUBTASK_PARENT_CHUNK_SIZE,
  type LoadFailure,
  type RollupBoardIssueSet,
  type RollupBoardScope,
} from './rollupBoardTypes.ts';

// ── Named constants ──

const SEARCH_MAX_RESULTS = 200;

/** Enough to cover a PI's worth of sprints on a team board, closed ones included. */
const SPRINT_PAGE_SIZE = 100;

/** How Jira answers a direct read of an issue that is missing, or that this account may not see. */
const NOT_FOUND_STATUS = 404;
const NO_PERMISSION_STATUSES = [401, 403];

/** Fields every sweep needs to place, colour, filter and explain an issue. */
const BASE_ISSUE_FIELDS = [
  'summary',
  'status',
  'priority',
  'issuetype',
  'assignee',
  'created',
  'updated',
  'fixVersions',
  'issuelinks',
  'labels',
  'parent',
  // Jira's impediment flag, read through the shared impediment detection.
  'customfield_10021',
];

interface JiraSearchResponse {
  issues?: JiraIssue[];
}

/** Assembles the field list for one sweep, dropping any id this instance does not have. */
function buildFieldList(scope: RollupBoardScope, extraFieldIds: readonly string[] = []): string {
  const fieldIds = [
    ...BASE_ISSUE_FIELDS,
    scope.featureLinkFieldId,
    scope.subStatusFieldId,
    ...scope.storyPointsFieldIds,
    ...extraFieldIds,
  ].filter((fieldId) => Boolean(fieldId && fieldId.trim()));
  return Array.from(new Set(fieldIds)).join(',');
}

/** Splits a list into fixed-size chunks so one request never carries an unbounded key set. */
function chunkList<TItem>(items: readonly TItem[], chunkSize: number): TItem[][] {
  const chunks: TItem[][] = [];
  for (let startIndex = 0; startIndex < items.length; startIndex += chunkSize) {
    chunks.push(items.slice(startIndex, startIndex + chunkSize));
  }
  return chunks;
}

/** Builds a JQL search path with an explicit field list. */
function buildSearchPath(jql: string, fieldList: string): string {
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}`
    + `&fields=${encodeURIComponent(fieldList)}&maxResults=${SEARCH_MAX_RESULTS}`;
}

/**
 * Re-reads the issues the Team Dashboard has already scoped, with the fields this board needs.
 *
 * The SCOPE comes from the dashboard — whatever its Sprint / Fix Version / PI selector currently
 * holds — so the Roll-Up Board shows the same work as every other tab by construction and cannot
 * drift from them. An earlier version swept `/board/{id}/issue` instead, which returns everything
 * matching the board's saved filter including the whole backlog, so it ignored the sprint and the
 * PI entirely and pulled far more than the team had asked to see.
 *
 * The re-read exists because the dashboard's own fetch does not request the Feature Link field, the
 * native parent, or the sub-status — and widening that shared fetch would touch every other tab.
 * Reading by key keeps the scope exact while leaving the dashboard alone.
 */
async function fetchScopedIssueDetail(
  scopedIssueKeys: readonly string[],
  scope: RollupBoardScope,
): Promise<JiraIssue[]> {
  if (scopedIssueKeys.length === 0) return [];

  const fieldList = buildFieldList(scope);
  const chunkResults = await Promise.all(
    chunkList(scopedIssueKeys, FEATURE_KEY_CHUNK_SIZE).map((keyChunk) =>
      jiraGet<JiraSearchResponse>(buildSearchPath(`key in (${keyChunk.join(',')})`, fieldList)),
    ),
  );

  return chunkResults.flatMap((chunkResult) => chunkResult.issues ?? []);
}

/**
 * Reads the sub-tasks of the board's issues, chunked over their parent keys.
 *
 * A failed chunk is recorded in `failures` rather than thrown, so the rest of the board still loads —
 * but it is NEVER discarded silently, because a quietly shorter board reads as "there is less work
 * here" instead of "some work could not be read".
 */
async function fetchSubtasksForParents(
  parentKeys: readonly string[],
  scope: RollupBoardScope,
  failures: LoadFailure[],
): Promise<JiraIssue[]> {
  if (parentKeys.length === 0) return [];

  const fieldList = buildFieldList(scope);
  const chunkResults = await Promise.all(
    chunkList(parentKeys, SUBTASK_PARENT_CHUNK_SIZE).map((parentKeyChunk) =>
      jiraGet<JiraSearchResponse>(buildSearchPath(`parent in (${parentKeyChunk.join(',')})`, fieldList))
        .catch((error: unknown) => {
          failures.push({
            stage: 'subtasks',
            detail: `Sub-tasks of ${parentKeyChunk.length} issues could not be read: ${String(error)}`,
          });
          return { issues: [] as JiraIssue[] };
        }),
    ),
  );

  return chunkResults.flatMap((chunkResult) => chunkResult.issues ?? []);
}

/** Reads the Features the board's work rolls up to, by key, because they live in other projects. */
async function fetchFeaturesByKeys(
  featureKeys: readonly string[],
  scope: RollupBoardScope,
  failures: LoadFailure[],
): Promise<Map<string, JiraIssue>> {
  if (featureKeys.length === 0) return new Map<string, JiraIssue>();

  const fieldList = buildFieldList(scope, ['duedate']);
  const chunkResults = await Promise.all(
    chunkList(featureKeys, FEATURE_KEY_CHUNK_SIZE).map((featureKeyChunk) =>
      jiraGet<JiraSearchResponse>(
        buildSearchPath(`key in (${featureKeyChunk.join(',')}) ORDER BY key ASC`, fieldList),
      ).catch((error: unknown) => {
        failures.push({
          stage: 'features',
          detail: `${featureKeyChunk.length} Features could not be read: ${String(error)}`,
        });
        return { issues: [] as JiraIssue[] };
      }),
    ),
  );

  return new Map(
    chunkResults
      .flatMap((chunkResult) => chunkResult.issues ?? [])
      .map((featureIssue) => [featureIssue.key, featureIssue]),
  );
}

/**
 * Asks Jira about each Feature the bulk read did not return, so the board can name the cause.
 *
 * A Feature that silently fails to come back is the least actionable thing the board can show: "could
 * not be read" leaves a person with nowhere to go. Only the MISSING keys are probed — normally none,
 * occasionally one or two — so this costs nothing on a healthy board.
 *
 * The interesting outcome is a key that reads perfectly well on its own after being absent from the
 * bulk search. Jira keeps ARCHIVED issues out of search results while still serving them by key, so
 * that combination is a positive signal rather than a mystery.
 */
async function probeUnreadableFeatures(
  missingFeatureKeys: readonly string[],
  scope: RollupBoardScope,
): Promise<FeatureReadFailure[]> {
  const probedKeys = missingFeatureKeys.slice(0, MAX_FEATURE_READ_PROBES);

  return Promise.all(probedKeys.map(async (featureKey): Promise<FeatureReadFailure> => {
    try {
      await jiraGet<JiraIssue>(
        `/rest/api/2/issue/${encodeURIComponent(featureKey)}?fields=${buildFieldList(scope)}`,
      );
      return {
        featureKey,
        reason: 'archived-or-unsearchable',
        detail: `${featureKey} can be opened directly but does not come back from a search. `
          + 'That is what an archived issue looks like — unarchive it in Jira to restore its details here.',
      };
    } catch (error: unknown) {
      const httpStatus = extractHttpStatus(error);
      if (httpStatus === NOT_FOUND_STATUS) {
        return {
          featureKey,
          reason: 'not-found',
          detail: `${featureKey} does not exist. Something still points a Feature Link at it — worth correcting in Jira.`,
        };
      }
      if (httpStatus !== null && NO_PERMISSION_STATUSES.includes(httpStatus)) {
        return {
          featureKey,
          reason: 'no-permission',
          detail: `${featureKey} exists but this account cannot see it — a project permission or an issue security level.`,
        };
      }
      return { featureKey, reason: 'error', detail: `${featureKey} could not be read: ${String(error)}` };
    }
  }));
}

/** Issue type names this instance uses for defects — the only type whose roll-up walks issue links. */
const DEFECT_ISSUE_TYPE_NAMES = new Set(['defect', 'bug']);

/** The keys a defect points at through its issue links. */
function readLinkedIssueKeys(issue: JiraIssue): string[] {
  const issueLinks = (issue.fields as { issuelinks?: unknown[] }).issuelinks ?? [];
  return issueLinks
    .map((rawLink) => {
      const issueLink = rawLink as { inwardIssue?: { key?: string }; outwardIssue?: { key?: string } };
      return issueLink.outwardIssue?.key ?? issueLink.inwardIssue?.key ?? '';
    })
    .filter(Boolean);
}

/**
 * Collects the keys that must be read for roll-up to work.
 *
 * Two sources, not one. The Feature Link field is the obvious source. The second is a defect's issue
 * links: a defect can be wired straight to a Feature by "relates to", and a Feature is never itself
 * on a team board — so unless those targets are fetched too, that whole route resolves to nothing
 * and the defect looks unattributed. Only DEFECT links are followed, because they are the only type
 * whose roll-up walks links at all, which keeps the extra reads small.
 */
function collectReferencedFeatureKeys(
  issues: readonly JiraIssue[],
  featureLinkFieldId: string,
  boardIssueKeys: ReadonlySet<string>,
): string[] {
  const referencedKeys = new Set<string>();

  for (const issue of issues) {
    const featureKey = extractFeatureKeyFromIssueFields(
      issue.fields as unknown as Record<string, unknown>,
      featureLinkFieldId,
    );
    if (featureKey) referencedKeys.add(featureKey);

    const issueTypeName = ((issue.fields as { issuetype?: { name?: string } }).issuetype?.name ?? '')
      .trim().toLowerCase();
    if (!DEFECT_ISSUE_TYPE_NAMES.has(issueTypeName)) continue;

    for (const linkedKey of readLinkedIssueKeys(issue)) {
      // Anything already on the board is readable without another request.
      if (!boardIssueKeys.has(linkedKey)) referencedKeys.add(linkedKey);
    }
  }

  return [...referencedKeys];
}

/**
 * Finds work sitting in this PI's sprints that carries no PI value at all.
 *
 * Every PI-scoped tab asks Jira for `<PI field> = "PI 26.4"`, so an issue whose PI field was never
 * filled in is missing from all of them at once — and missing silently, which reads as "there is less
 * work here" rather than "this board is wrong". Sprint membership is the independent second opinion:
 * a sprint sits inside the PI's dates whether or not anyone filled the field in.
 *
 * Closed sprints are included deliberately. A PI spans several sprints and the earlier ones are usually
 * already closed, so excluding them would blind the check to most of the PI.
 *
 * Any failure here returns an empty result rather than throwing: this is a supplementary hygiene check,
 * and it must never be able to take down a board that is otherwise loading fine.
 */
export async function fetchSprintPiReconciliation(
  boardId: number,
  piName: string,
  piFieldReference: string,
): Promise<SprintPiReconciliation> {
  const emptyResult: SprintPiReconciliation = {
    mismatches: [], searchedSprintNames: [], undatedSprintNames: [],
  };

  try {
    const sprintResponse = await jiraGet<{ values?: BoardSprint[] }>(
      `/rest/agile/1.0/board/${boardId}/sprint?state=active,future,closed&maxResults=${SPRINT_PAGE_SIZE}`,
    );
    const { sprintsInPi, undatedSprintNames } = selectSprintsInPiWindow(sprintResponse.values ?? [], piName);

    const reconciliationJql = buildMistaggedSprintIssueJql(
      sprintsInPi.map((sprint) => sprint.id), piFieldReference,
    );
    if (!reconciliationJql) return { ...emptyResult, undatedSprintNames };

    const searchResult = await jiraGet<JiraSearchResponse>(
      buildSearchPath(reconciliationJql, 'summary,status'),
    );

    return {
      mismatches: (searchResult.issues ?? []).map(toMismatch),
      searchedSprintNames: sprintsInPi.map((sprint) => sprint.name),
      undatedSprintNames,
    };
  } catch {
    return emptyResult;
  }
}

/**
 * Loads the board, its sub-tasks and its Features, reporting exactly how complete the result is.
 *
 * The returned `load` block is the board's honesty contract: it states what Jira said the board holds
 * and what was actually retrieved, so the UI can say "some of this is missing" instead of quietly
 * looking smaller than reality.
 */
export async function fetchRollupBoardIssues(
  scope: RollupBoardScope,
  scopedIssueKeys: readonly string[],
): Promise<RollupBoardIssueSet> {
  const failures: LoadFailure[] = [];
  const expectedBoardIssueCount = scopedIssueKeys.length;
  const boardIssues = await fetchScopedIssueDetail(scopedIssueKeys, scope);

  const boardIssueKeys = boardIssues.map((boardIssue) => boardIssue.key);
  const subtaskIssues = await fetchSubtasksForParents(boardIssueKeys, scope, failures);

  const allLoadedIssues = [...boardIssues, ...subtaskIssues];
  const referencedFeatureKeys = collectReferencedFeatureKeys(
    allLoadedIssues,
    scope.featureLinkFieldId,
    new Set(allLoadedIssues.map((issue) => issue.key)),
  );
  const featureIssues = await fetchFeaturesByKeys(referencedFeatureKeys, scope, failures);

  // ── One more hop ──
  //
  // A defect raised in testing points at the QA issue, and the QA issue points at the Feature. The
  // first sweep collects the QA issue but never re-reads it, so the Feature at the end of that chain
  // was requested by nobody: its lane appeared (the ROUTE knew the key) while its details never
  // arrived, which is what "this Feature could not be read" was really reporting all along.
  //
  // Exactly one further hop, matching the one-hop cap the defect precedence chain already applies —
  // enough for defect → QA issue → Feature, and bounded so a tangle of links cannot walk the instance.
  const secondHopKeys = collectReferencedFeatureKeys(
    [...featureIssues.values()],
    scope.featureLinkFieldId,
    new Set([...allLoadedIssues.map((issue) => issue.key), ...featureIssues.keys()]),
  ).filter((featureKey) => !featureIssues.has(featureKey));

  if (secondHopKeys.length > 0) {
    const secondHopIssues = await fetchFeaturesByKeys(secondHopKeys, scope, failures);
    for (const [featureKey, featureIssue] of secondHopIssues) featureIssues.set(featureKey, featureIssue);
  }

  // A key that was asked for but did not come back is worth one direct question each, so the board
  // reports WHY a Feature is missing instead of only that it is.
  const missingFeatureKeys = [...referencedFeatureKeys, ...secondHopKeys]
    .filter((featureKey) => !featureIssues.has(featureKey));
  const featureReadFailures = await probeUnreadableFeatures(missingFeatureKeys, scope);

  return {
    boardIssues,
    subtaskIssues,
    featureIssues,
    featureReadFailures,
    load: {
      isComplete: failures.length === 0 && boardIssues.length >= expectedBoardIssueCount,
      expectedBoardIssueCount,
      loadedBoardIssueCount: boardIssues.length,
      isOversized: boardIssues.length > EXPECTED_BOARD_ISSUE_CEILING,
      failures,
    },
  };
}

/**
 * Reads every Feature this team owns in the PI, so the board can name the ones with nothing under them.
 *
 * This is the one query that runs top-down instead of bottom-up. Everything else on the board starts
 * from work and finds its Feature; a Feature nobody has broken down has no work to be found from, so it
 * can only be discovered by asking about Features directly.
 *
 * Like the sprint reconciliation, a failure returns nothing rather than throwing — the board's job is
 * to show the team's work, and an extra insight must never be able to prevent that.
 */
export async function fetchFeaturesInPi(
  featureProjectKeys: readonly string[],
  piName: string,
  piFieldReference: string,
  scope: RollupBoardScope,
  teamFeatureLabel = '',
): Promise<JiraIssue[]> {
  const featuresInPiJql = buildFeaturesInPiJql(featureProjectKeys, piName, piFieldReference, teamFeatureLabel);
  if (featuresInPiJql === null) return [];

  try {
    const searchResult = await jiraGet<JiraSearchResponse>(
      buildSearchPath(featuresInPiJql, buildFieldList(scope)),
    );
    return searchResult.issues ?? [];
  } catch {
    return [];
  }
}

/**
 * Finds which of these Features already have an issue in the team's own project.
 *
 * This is the ownership test that does not depend on anyone having filled a field in correctly: if the
 * team has raised work against a Feature, it is the team's Feature, whatever its assignee says.
 */
export async function fetchTeamIssuesForFeatures(
  teamProjectKey: string,
  featureKeys: readonly string[],
  featureLinkFieldId: string,
): Promise<JiraIssue[]> {
  if (!teamProjectKey || featureKeys.length === 0 || !featureLinkFieldId) return [];

  try {
    const chunkResults = await Promise.all(
      chunkList(featureKeys, FEATURE_KEY_CHUNK_SIZE).map((featureKeyChunk) =>
        jiraGet<JiraSearchResponse>(buildSearchPath(
          `project = "${teamProjectKey}" AND "${featureLinkFieldId}" in (${featureKeyChunk.join(', ')})`,
          featureLinkFieldId,
        )).catch(() => ({ issues: [] as JiraIssue[] })),
      ),
    );
    return chunkResults.flatMap((chunkResult) => chunkResult.issues ?? []);
  } catch {
    return [];
  }
}

/**
 * Finds last PI's unfinished Features and the work sitting under them.
 *
 * Two questions, because a carried-over Feature and its children can hold different PIs: which Features
 * from the earlier PI never finished, and what is linked to them regardless of the PI those children
 * carry. Filtering the children by PI would reintroduce the blindness this exists to remove.
 *
 * Any failure yields an empty scope rather than throwing — the board's job is to show this PI's work,
 * and an extra sweep must never be able to prevent that.
 */
export async function fetchCarryOverScope(
  featureProjectKeys: readonly string[],
  carryOverPiValue: string,
  piFieldReference: string,
  featureLinkFieldReference: string,
  scope: RollupBoardScope,
  teamFeatureLabel = '',
): Promise<CarryOverScope> {
  const featureJql = buildCarryOverFeatureJql(
    featureProjectKeys, carryOverPiValue, piFieldReference, teamFeatureLabel,
  );
  if (featureJql === null) return EMPTY_CARRY_OVER_SCOPE;

  try {
    const featureResult = await jiraGet<JiraSearchResponse>(
      buildSearchPath(featureJql, buildFieldList(scope)),
    );
    const featureKeys = (featureResult.issues ?? []).map((featureIssue) => featureIssue.key);

    const workJql = buildCarryOverWorkJql(featureKeys, featureLinkFieldReference);
    if (workJql === null) return { featureKeys, issueKeys: [], fromPiValue: carryOverPiValue };

    const workResult = await jiraGet<JiraSearchResponse>(buildSearchPath(workJql, 'summary'));
    return {
      featureKeys,
      issueKeys: (workResult.issues ?? []).map((workIssue) => workIssue.key),
      fromPiValue: carryOverPiValue,
    };
  } catch {
    return EMPTY_CARRY_OVER_SCOPE;
  }
}

/**
 * Reads the Features TICKED as carry-over on this PI's PI Review page, and their work.
 *
 * Preferred over deriving carry-over from status, because the tick is a decision somebody made rather
 * than a heuristic: deriving also drags in Features that were abandoned or merely never closed, and a
 * list containing work nobody is doing stops being read.
 *
 * A page that cannot be reached yields an empty scope rather than silently falling back to the derived
 * behaviour — quietly showing a different, larger set than the one asked for is worse than showing none.
 */
export async function fetchCarryOverScopeFromPiReview(
  pageReference: string,
  piName: string,
  featureLinkFieldReference: string,
): Promise<CarryOverScope> {
  if (pageReference.trim() === '') return EMPTY_CARRY_OVER_SCOPE;

  try {
    const page = await fetchConfluencePageByReference(pageReference);
    const parsedTable = parsePiReviewTable(page.body.storage.value);
    const featureKeys = readCarryOverFeatureKeys(parsedTable?.rows ?? []);

    const workJql = buildCarryOverWorkJql(featureKeys, featureLinkFieldReference);
    if (workJql === null) return { featureKeys, issueKeys: [], fromPiValue: piName };

    const workResult = await jiraGet<JiraSearchResponse>(buildSearchPath(workJql, 'summary'));
    return {
      featureKeys,
      issueKeys: (workResult.issues ?? []).map((workIssue) => workIssue.key),
      fromPiValue: piName,
    };
  } catch {
    return EMPTY_CARRY_OVER_SCOPE;
  }
}

/**
 * Reads the extra context a focused column's cards show — description, attachments, last comment.
 *
 * Kept out of the board's normal sweep on purpose: a description and a whole comment thread for every
 * issue is a large payload for information nobody is looking at while twelve columns are on screen.
 * Focusing a column is the moment it becomes worth reading, and only for that column's issues.
 *
 * A failure yields no detail rather than throwing — the cards fall back to their terse form, which is
 * exactly what they showed a moment earlier.
 */
export async function fetchCardDetails(issueKeys: readonly string[]): Promise<JiraIssue[]> {
  if (issueKeys.length === 0) return [];

  try {
    const chunkResults = await Promise.all(
      chunkList(issueKeys, FEATURE_KEY_CHUNK_SIZE).map((keyChunk) =>
        jiraGet<JiraSearchResponse>(
          buildSearchPath(`key in (${keyChunk.join(',')})`, CARD_DETAIL_FIELDS.join(',')),
        ).catch(() => ({ issues: [] as JiraIssue[] })),
      ),
    );
    return chunkResults.flatMap((chunkResult) => chunkResult.issues ?? []);
  } catch {
    return [];
  }
}
