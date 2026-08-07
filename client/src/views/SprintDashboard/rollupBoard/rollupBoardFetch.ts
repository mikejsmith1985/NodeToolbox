// rollupBoardFetch.ts — Retrieves everything the Roll-Up Board needs, in three sweeps.
//
// Sweep 1 reads the team's board. Sweep 2 exists because a Jira agile board does NOT return
// sub-tasks, yet sub-tasks are one of the ways this team breaks work down — without it, a large part
// of the delivery detail would simply be missing. Sweep 3 reads the Features, which live in a
// different Jira project from the work.
//
// The board promises that nothing is hidden, so this module never trims a result set. A board page
// that fails is fatal, because half a board that looks whole is worse than an error. A failed
// enrichment chunk is reported rather than swallowed, so the gap is visible.

import { jiraGet } from '../../../services/jiraApi.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import { extractFeatureKeyFromIssueFields } from '../../../utils/featureLink.ts';
import {
  EXPECTED_BOARD_ISSUE_CEILING,
  FEATURE_KEY_CHUNK_SIZE,
  SUBTASK_PARENT_CHUNK_SIZE,
  type LoadFailure,
  type RollupBoardIssueSet,
  type RollupBoardScope,
} from './rollupBoardTypes.ts';

// ── Named constants ──

const BOARD_ISSUE_PAGE_SIZE = 100;
const SEARCH_MAX_RESULTS = 200;
/** A runaway guard on paging, far above any real board; reaching it would mean Jira contradicted itself. */
const MAX_BOARD_PAGES = 50;

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

interface JiraBoardIssuePage {
  total?: number;
  startAt?: number;
  maxResults?: number;
  issues?: JiraIssue[];
}

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
 * Reads every page of the team's board.
 *
 * A rejected page throws. That is deliberate: the caller must not render a board that silently
 * stops partway, because the resulting count would look like the truth.
 */
async function fetchAllBoardIssues(
  scope: RollupBoardScope,
): Promise<{ boardIssues: JiraIssue[]; expectedBoardIssueCount: number }> {
  const fieldList = buildFieldList(scope);
  const boardIssues: JiraIssue[] = [];
  let expectedBoardIssueCount = 0;
  let startAt = 0;

  for (let pageIndex = 0; pageIndex < MAX_BOARD_PAGES; pageIndex += 1) {
    const page = await jiraGet<JiraBoardIssuePage>(
      `/rest/agile/1.0/board/${scope.boardId}/issue`
      + `?startAt=${startAt}&maxResults=${BOARD_ISSUE_PAGE_SIZE}&fields=${encodeURIComponent(fieldList)}`,
    );
    expectedBoardIssueCount = page.total ?? boardIssues.length;
    boardIssues.push(...(page.issues ?? []));
    startAt += page.issues?.length ?? 0;
    if (boardIssues.length >= expectedBoardIssueCount || (page.issues?.length ?? 0) === 0) {
      break;
    }
  }

  return { boardIssues, expectedBoardIssueCount };
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
 * Loads the board, its sub-tasks and its Features, reporting exactly how complete the result is.
 *
 * The returned `load` block is the board's honesty contract: it states what Jira said the board holds
 * and what was actually retrieved, so the UI can say "some of this is missing" instead of quietly
 * looking smaller than reality.
 */
export async function fetchRollupBoardIssues(scope: RollupBoardScope): Promise<RollupBoardIssueSet> {
  const failures: LoadFailure[] = [];
  const { boardIssues, expectedBoardIssueCount } = await fetchAllBoardIssues(scope);

  const boardIssueKeys = boardIssues.map((boardIssue) => boardIssue.key);
  const subtaskIssues = await fetchSubtasksForParents(boardIssueKeys, scope, failures);

  const allLoadedIssues = [...boardIssues, ...subtaskIssues];
  const referencedFeatureKeys = collectReferencedFeatureKeys(
    allLoadedIssues,
    scope.featureLinkFieldId,
    new Set(allLoadedIssues.map((issue) => issue.key)),
  );
  const featureIssues = await fetchFeaturesByKeys(referencedFeatureKeys, scope, failures);

  return {
    boardIssues,
    subtaskIssues,
    featureIssues,
    load: {
      isComplete: failures.length === 0 && boardIssues.length >= expectedBoardIssueCount,
      expectedBoardIssueCount,
      loadedBoardIssueCount: boardIssues.length,
      isOversized: boardIssues.length > EXPECTED_BOARD_ISSUE_CEILING,
      failures,
    },
  };
}
