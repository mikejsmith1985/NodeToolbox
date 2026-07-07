// plannerFetch.ts — Layer 3 planner data fetch: turns live Jira into the PlannerSourceIssue[] the classifier consumes.
//
// This module orchestrates the network calls that gather a team's planable work at task and sub-task
// granularity (stories, defects, sub-tasks) plus any linked external-test (DIP) issues, then maps every
// raw Jira issue through one PURE transform (`toPlannerSourceIssue`). The transform is deliberately free
// of I/O so it can be unit-tested exhaustively; the orchestration reuses the shared `jiraGet` helper and
// the same story-points field the rest of the app reads. Bucket/rank are intentionally left undefined
// here — the UI/overlay supplies priority for primaries and the mapping layer inherits it for secondaries.

import { jiraGet } from '../../../services/jiraApi.ts';
import type { PlannerSourceIssue } from './planItemMapping.ts';

// ── Named constants (no magic numbers/strings) ───────────────────────────────

/** External-testing work lives in this Jira project by default; a linked issue here is external-test effort. */
const DEFAULT_EXTERNAL_TEST_PROJECT_KEY = 'DIP';
/** Prefix that marks a real Jira custom field id (as opposed to a symbolic name like 'story_points'). */
const CUSTOM_FIELD_PREFIX = 'customfield_';
/** Legacy story-points fields queried as a fallback, mirroring the Blueprint hierarchy's resolution order. */
const LEGACY_STORY_POINTS_FIELD_IDS = ['customfield_10016', 'customfield_10028'] as const;
/** Jira caps a single /search page; every query requests this many rows, matching the Feature Review fetch. */
const SEARCH_MAX_RESULTS = 200;
/** Team primary issues are fetched in key chunks of this size to stay within JQL query-length limits. */
const PRIMARY_KEY_CHUNK_SIZE = 100;
/** Parent keys for the sub-task sweep are chunked smaller, since one chunk can fan out to many sub-tasks. */
const SUBTASK_PARENT_CHUNK_SIZE = 50;
/** Linked external-test keys are fetched in chunks of this size. */
const EXTERNAL_TEST_KEY_CHUNK_SIZE = 100;
/** Issue-type name used only when Jira omits one (defensive; real issues always carry a type). */
const UNKNOWN_ISSUE_TYPE = 'Unknown';

// ── Raw Jira shapes this module reads (narrow, only the fields we consume) ─────

/** One issue link as Jira returns it; we only need the linked issue's key on either side. */
interface PlannerIssueLink {
  inwardIssue?: { key?: string };
  outwardIssue?: { key?: string };
}

/** The subset of a raw Jira issue's `fields` the planner reads; the index signature carries custom fields. */
interface PlannerRawIssueFields {
  summary?: string;
  issuetype?: { name?: string; subtask?: boolean };
  assignee?: { displayName?: string } | null;
  project?: { key?: string };
  parent?: { key?: string } | null;
  issuelinks?: PlannerIssueLink[];
  [fieldId: string]: unknown;
}

/** One raw Jira issue as consumed by the pure transform and the orchestration. */
export interface PlannerRawIssue {
  key: string;
  fields: PlannerRawIssueFields;
}

/** Shape of the Jira /search response we consume (only the issues array). */
interface PlannerSearchResponse {
  issues?: PlannerRawIssue[];
}

// ── Public input contract ─────────────────────────────────────────────────────

/** Everything `fetchPlannerSourceIssues` needs; caller supplies either explicit keys OR a scope JQL. */
export interface FetchPlannerSourceIssuesInput {
  /** The team's planable primary issue keys (stories/defects/features). Used when `scopeJql` is absent. */
  teamIssueKeys?: readonly string[];
  /** An alternative scope: a JQL selecting the team's primary issues. Wins over `teamIssueKeys` when set. */
  scopeJql?: string;
  /** The active team's project key (kept for scope symmetry with the rest of the canvas; not required for fetch). */
  projectKey: string;
  /** The active PI name (kept for scope symmetry; carried through for callers that key on it). */
  piName: string;
  /** The story-points field id the rest of the app uses; a non-custom value falls back to legacy fields. */
  storyPointsFieldId: string;
  /** Project holding external-test work; defaults to 'DIP'. */
  externalTestProjectKey?: string;
}

/** Options for the pure transform: the SP field, plus optional overrides used for linked external issues. */
export interface ToPlannerSourceIssueOptions {
  storyPointsFieldId: string;
  /** Forces the emitted `projectKey` (e.g. 'DIP' for an external-test issue). */
  projectKeyOverride?: string;
  /** Forces the emitted `parentKey` (e.g. the team issue a DIP issue is linked from). */
  parentKeyOverride?: string | null;
}

// ── Pure value readers ────────────────────────────────────────────────────────

/** Reads a Jira field value into a plain number (handles number, numeric string, and {value} shapes). */
function readNumericFieldValue(fieldValue: unknown): number | null {
  if (typeof fieldValue === 'number') {
    return Number.isFinite(fieldValue) ? fieldValue : null;
  }
  if (typeof fieldValue === 'string') {
    const parsed = Number(fieldValue);
    return Number.isFinite(parsed) && fieldValue.trim() !== '' ? parsed : null;
  }
  if (fieldValue !== null && typeof fieldValue === 'object') {
    return readNumericFieldValue((fieldValue as { value?: unknown }).value);
  }
  return null;
}

/**
 * Resolves an issue's story points using the configured field first, then the legacy fields. A team that
 * points on a custom field reads that; a team on the default symbolic name still resolves via the legacy
 * fields, so nothing looks unpointed just because the configured id is not a real Jira custom field.
 */
function readStoryPoints(fields: PlannerRawIssueFields, storyPointsFieldId: string): number | null {
  if (storyPointsFieldId.startsWith(CUSTOM_FIELD_PREFIX)) {
    const configuredPoints = readNumericFieldValue(fields[storyPointsFieldId]);
    if (configuredPoints !== null) {
      return configuredPoints;
    }
  }
  for (const legacyFieldId of LEGACY_STORY_POINTS_FIELD_IDS) {
    const legacyPoints = readNumericFieldValue(fields[legacyFieldId]);
    if (legacyPoints !== null) {
      return legacyPoints;
    }
  }
  return null;
}

/** Derives a project key from an issue key's prefix (e.g. 'DENP-42' → 'DENP'), the last-resort source. */
function readProjectKeyFromIssueKey(issueKey: string): string {
  return issueKey.split('-')[0]?.toUpperCase() ?? '';
}

// ── The pure transform (no I/O — exhaustively unit-tested) ─────────────────────

/**
 * Maps one raw Jira issue to a PlannerSourceIssue. A sub-task is detected structurally — either Jira's
 * `issuetype.subtask` flag is true, or the issue carries a `parent` (in this instance's classic scheme
 * only sub-tasks populate `parent`). Overrides let a linked external-test issue be emitted with a forced
 * project key ('DIP') and its linking team issue as the parent. Bucket/rank are never set here.
 */
export function toPlannerSourceIssue(
  rawJiraIssue: PlannerRawIssue,
  options: ToPlannerSourceIssueOptions,
): PlannerSourceIssue {
  const fields = rawJiraIssue.fields ?? {};
  const hasParent = typeof fields.parent?.key === 'string' && fields.parent.key.length > 0;
  const isSubtask = fields.issuetype?.subtask === true || hasParent;
  // An explicit override (even to null) wins; otherwise the raw parent key is used, null when absent.
  const parentKey = options.parentKeyOverride !== undefined
    ? options.parentKeyOverride
    : (fields.parent?.key ?? null);

  return {
    key: rawJiraIssue.key,
    summary: fields.summary ?? rawJiraIssue.key,
    issueType: fields.issuetype?.name ?? UNKNOWN_ISSUE_TYPE,
    isSubtask,
    projectKey: options.projectKeyOverride ?? fields.project?.key ?? readProjectKeyFromIssueKey(rawJiraIssue.key),
    storyPoints: readStoryPoints(fields, options.storyPointsFieldId),
    assignee: fields.assignee?.displayName ?? null,
    parentKey,
  };
}

// ── Query construction + chunking helpers ──────────────────────────────────────

/** Builds the comma-separated field list every planner query requests (SP fields resolved per team). */
function buildPlannerIssueFields(storyPointsFieldId: string): string {
  const fieldIds = ['summary', 'issuetype', 'assignee', 'project', 'parent', 'issuelinks', ...LEGACY_STORY_POINTS_FIELD_IDS];
  if (storyPointsFieldId.startsWith(CUSTOM_FIELD_PREFIX)) {
    fieldIds.push(storyPointsFieldId);
  }
  return Array.from(new Set(fieldIds)).join(',');
}

/** Builds a /rest/api/2/search path with the given JQL, fields, and row cap (matches the app's other fetches). */
function buildSearchPath(jql: string, fields: string, maxResults: number): string {
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fields)}&maxResults=${maxResults}`;
}

/** Splits a list into fixed-size chunks so a large key set becomes several length-bounded JQL queries. */
function chunkList<Item>(items: readonly Item[], chunkSize: number): Item[][] {
  const chunks: Item[][] = [];
  for (let startIndex = 0; startIndex < items.length; startIndex += chunkSize) {
    chunks.push(items.slice(startIndex, startIndex + chunkSize));
  }
  return chunks;
}

/** Removes blanks and duplicates from a key list so queries stay minimal and stable. */
function dedupeKeys(keys: readonly string[]): string[] {
  return Array.from(new Set(keys.filter((key) => Boolean(key && key.trim()))));
}

/**
 * Fetches issues for a key set via `key in (...)`, chunked. Secondary sweeps (sub-tasks, external issues)
 * swallow per-chunk failures so enrichment never fails the whole run; the primary sweep lets errors throw
 * so an invalid scope surfaces to the caller.
 */
async function fetchIssuesByKeyChunks(
  keys: readonly string[],
  fields: string,
  chunkSize: number,
  shouldSwallowErrors: boolean,
): Promise<PlannerRawIssue[]> {
  const uniqueKeys = dedupeKeys(keys);
  if (uniqueKeys.length === 0) {
    return [];
  }
  const chunkResults = await Promise.all(
    chunkList(uniqueKeys, chunkSize).map((keyChunk) => {
      const request = jiraGet<PlannerSearchResponse>(
        buildSearchPath(`key in (${keyChunk.join(',')})`, fields, SEARCH_MAX_RESULTS),
      );
      return shouldSwallowErrors
        ? request.catch((error) => {
          console.warn('Planner key-chunk query failed.', error);
          return { issues: [] as PlannerRawIssue[] };
        })
        : request;
    }),
  );
  return chunkResults.flatMap((chunkResult) => chunkResult.issues ?? []);
}

// ── Fetch stages ────────────────────────────────────────────────────────────

/** Fetches the team's primary planable issues, from an explicit scope JQL when given, else from keys. */
async function fetchPrimaryTeamIssues(
  input: FetchPlannerSourceIssuesInput,
  issueFields: string,
): Promise<PlannerRawIssue[]> {
  const scopeJql = input.scopeJql?.trim();
  if (scopeJql) {
    const response = await jiraGet<PlannerSearchResponse>(buildSearchPath(scopeJql, issueFields, SEARCH_MAX_RESULTS));
    return response.issues ?? [];
  }
  return fetchIssuesByKeyChunks(input.teamIssueKeys ?? [], issueFields, PRIMARY_KEY_CHUNK_SIZE, false);
}

/** Fetches every sub-task whose parent is one of the primary issues, chunked over the parent keys. */
async function fetchSubtasksForParents(parentKeys: readonly string[], issueFields: string): Promise<PlannerRawIssue[]> {
  const uniqueParentKeys = dedupeKeys(parentKeys);
  if (uniqueParentKeys.length === 0) {
    return [];
  }
  const chunkResults = await Promise.all(
    chunkList(uniqueParentKeys, SUBTASK_PARENT_CHUNK_SIZE).map((parentChunk) =>
      jiraGet<PlannerSearchResponse>(
        buildSearchPath(`parent in (${parentChunk.join(',')})`, issueFields, SEARCH_MAX_RESULTS),
      ).catch((error) => {
        console.warn('Planner sub-task query failed.', error);
        return { issues: [] as PlannerRawIssue[] };
      })),
  );
  return chunkResults.flatMap((chunkResult) => chunkResult.issues ?? []);
}

/**
 * Scans the primary issues' issue links for issues in the external-test project, returning a map of each
 * external issue key to the team issue it is linked from (its planning parent). The first link wins when
 * an external issue is linked from several team issues, so its parent is stable.
 */
function collectExternalTestLinks(
  primaryIssues: readonly PlannerRawIssue[],
  externalTestProjectKey: string,
): Map<string, string> {
  const externalParentByKey = new Map<string, string>();
  for (const issue of primaryIssues) {
    for (const link of issue.fields.issuelinks ?? []) {
      const linkedKey = link.inwardIssue?.key ?? link.outwardIssue?.key;
      if (!linkedKey) {
        continue;
      }
      const linkedProjectKey = linkedKey.split('-')[0]?.toUpperCase() ?? '';
      if (linkedProjectKey === externalTestProjectKey && !externalParentByKey.has(linkedKey)) {
        externalParentByKey.set(linkedKey, issue.key);
      }
    }
  }
  return externalParentByKey;
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Fetches a team's planable work as PlannerSourceIssue[] for the classifier. It gathers primary issues
 * (stories/defects/features) at task granularity, their sub-tasks, and any linked external-test (DIP)
 * issues, then maps each raw issue through the pure transform. Every issue is de-duplicated by key
 * (primary/sub-task first, external last) so nothing is emitted twice. Bucket/rank stay undefined.
 */
export async function fetchPlannerSourceIssues(
  input: FetchPlannerSourceIssuesInput,
): Promise<PlannerSourceIssue[]> {
  const externalTestProjectKey = (input.externalTestProjectKey ?? DEFAULT_EXTERNAL_TEST_PROJECT_KEY).toUpperCase();
  const issueFields = buildPlannerIssueFields(input.storyPointsFieldId);

  const primaryIssues = await fetchPrimaryTeamIssues(input, issueFields);
  const subtaskIssues = await fetchSubtasksForParents(primaryIssues.map((issue) => issue.key), issueFields);
  const externalParentByKey = collectExternalTestLinks(primaryIssues, externalTestProjectKey);
  const externalIssues = await fetchIssuesByKeyChunks(
    Array.from(externalParentByKey.keys()),
    issueFields,
    EXTERNAL_TEST_KEY_CHUNK_SIZE,
    true,
  );

  const sourceByKey = new Map<string, PlannerSourceIssue>();
  const teamOptions: ToPlannerSourceIssueOptions = { storyPointsFieldId: input.storyPointsFieldId };
  for (const rawIssue of [...primaryIssues, ...subtaskIssues]) {
    if (!sourceByKey.has(rawIssue.key)) {
      sourceByKey.set(rawIssue.key, toPlannerSourceIssue(rawIssue, teamOptions));
    }
  }
  for (const rawIssue of externalIssues) {
    if (sourceByKey.has(rawIssue.key)) {
      continue;
    }
    sourceByKey.set(rawIssue.key, toPlannerSourceIssue(rawIssue, {
      storyPointsFieldId: input.storyPointsFieldId,
      projectKeyOverride: externalTestProjectKey,
      parentKeyOverride: externalParentByKey.get(rawIssue.key) ?? null,
    }));
  }
  return Array.from(sourceByKey.values());
}
