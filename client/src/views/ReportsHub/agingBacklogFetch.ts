// agingBacklogFetch.ts — Fetches and enriches a team's NOT-Done backlog for both the Aging metrics and the triage.
//
// This was lifted out of IssueAgingTab so the same enriched fetch can feed BOTH the Reports Hub metrics report and
// the Team Dashboard's Backlog Remediation panel. In one paged Jira search it pulls every open issue in a scope,
// then resolves each issue's parent feature (and that feature's status), its Acceptance-Criteria presence, and its
// configured story points — producing the `AgingTriageIssue[]` the triage prompt is built from, plus the lighter
// inputs the pure aging engine needs. Read-only; it never writes to Jira.

import { jiraGet } from '../../services/jiraApi.ts';
import type { JiraIssue } from '../../types/jira.ts';
import { readAcceptanceCriteriaText, resolveAcceptanceCriteriaFieldIds } from '../../utils/acceptanceCriteria.ts';
import { normalizeRichTextToPlainText } from '../../utils/richTextPlainText.ts';
import {
  extractFeatureKeyFromIssueFields,
  featureLinkCandidateFieldIds,
  loadConfiguredFeatureLinkFieldId,
  type FeatureLinkFields,
} from '../../utils/featureLink.ts';
import type { AgingTriageIssue } from './agingTriage.ts';
import type { IssueAgingIssueInput } from './issueAging.ts';
import { readConfiguredStoryPointsFieldId, readStoryPoints } from './storyPointsField.ts';

// ── Named constants ──────────────────────────────────────────────────────────

// One Jira search page — the report pages through the whole backlog in chunks of this size.
const PAGE_SIZE = 100;
// Hard safety cap on how many issues the report will fetch, so a huge scope cannot page forever; when it is
// hit the result flags `wasCapped` so the caller can surface a clear "capped" note. Exported so the UI can name
// the exact cap in that note without duplicating the number.
export const AGING_BACKLOG_MAX_ISSUES = 2000;
// Milliseconds in one calendar day, used to convert an epoch difference into a whole-day age.
const MILLISECONDS_PER_DAY = 86_400_000;
// How many feature keys to resolve per follow-up request when reading their summaries and statuses.
const FEATURE_INFO_BATCH_SIZE = 50;

// ── Jira response shapes (only the fields this fetch reads) ──

interface RawAgingIssue {
  key?: string;
  fields?: {
    issuetype?: { name?: string } | null;
    created?: string | null;
    status?: { name?: string } | null;
    updated?: string | null;
    // When the issue's status category last changed — the basis for "days in current status", a sharper
    // staleness measure than `updated` (which any minor edit bumps).
    statuscategorychangedate?: string | null;
    summary?: string | null;
    priority?: { name?: string } | null;
    // Ownership + definition signals; story points and AC fields are read via the index signature (ids vary).
    assignee?: { displayName?: string } | null;
    description?: unknown;
    parent?: { key?: string } | null;
    [fieldId: string]: unknown;
  };
}

/** A linked feature's own summary and status, resolved by a follow-up fetch keyed on the feature's key. */
interface FeatureInfo {
  summary: string;
  status: string;
}

interface RawAgingSearchResponse {
  issues?: RawAgingIssue[];
  total?: number;
}

/** The outcome of paging the backlog: every fetched issue, plus whether the safety cap stopped the paging. */
interface FetchedBacklog {
  rawIssues: RawAgingIssue[];
  wasCapped: boolean;
}

/** Everything a caller needs from one enriched backlog fetch: metrics inputs, triage candidates, and detail. */
export interface AgingBacklogFetchResult {
  /** Lightweight inputs for the pure `computeIssueAging` engine (key, type, created). */
  agingInputs: IssueAgingIssueInput[];
  /** The enriched triage candidates the triage prompt is built from. */
  triageIssues: AgingTriageIssue[];
  /** The full fetched issue objects, keyed by issue key, for inline detail without re-fetching. */
  issuesByKey: Map<string, JiraIssue>;
  /** The resolved Acceptance-Criteria field ids, for the actionable table's inline detail. */
  acceptanceCriteriaFieldIds: string[];
  /** The exact JQL that ran, for display / copy. */
  jql: string;
  /** True when the MAX_TOTAL_ISSUES safety cap stopped the paging (partial picture). */
  wasCapped: boolean;
}

// ── JQL + fetch helpers ───────────────────────────────────────────────────────

/**
 * Builds the exact JQL the report queries: the user's scope wrapped in parentheses, ANDed with a
 * `statusCategory != Done` clause so only open work is aged, oldest-created first. Factored out so the same
 * string is BOTH queried and shown to the user, guaranteeing the displayed JQL never drifts from what ran.
 */
export function buildAgingJql(scopeJql: string): string {
  return `(${scopeJql}) AND statusCategory != Done ORDER BY created ASC`;
}

/** Wraps the aging JQL with the requested fields and the page window into a single search request path. */
function buildAgingSearchPath(jql: string, startAt: number, fields: string): string {
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fields)}&startAt=${startAt}&maxResults=${PAGE_SIZE}`;
}

/**
 * Pages through the whole NOT-Done backlog for the given JQL so the statistics cover every open issue, not just
 * the first page. Keeps requesting the next page until Jira reports it returned everything or the
 * MAX_TOTAL_ISSUES safety cap is reached (then flags `wasCapped`). Any fetch error propagates to the caller.
 */
async function fetchOpenBacklog(jql: string, fields: string): Promise<FetchedBacklog> {
  const rawIssues: RawAgingIssue[] = [];
  let startAt = 0;
  while (true) {
    const response = await jiraGet<RawAgingSearchResponse>(buildAgingSearchPath(jql, startAt, fields));
    const pageIssues = response.issues ?? [];
    rawIssues.push(...pageIssues);
    startAt += pageIssues.length;

    const total = typeof response.total === 'number' ? response.total : startAt;
    if (pageIssues.length === 0 || startAt >= total) {
      return { rawIssues, wasCapped: false };
    }
    if (rawIssues.length >= AGING_BACKLOG_MAX_ISSUES) {
      return { rawIssues, wasCapped: true };
    }
  }
}

/**
 * Follow-up fetch that resolves each linked feature's own summary and status by key — the same second-hop the
 * blueprint does, since a feature-link field only yields a key. Batched, and fully error-tolerant: a failed
 * batch simply leaves those features unresolved rather than failing the whole run.
 */
async function fetchFeatureInfoByKey(featureKeys: readonly string[]): Promise<Map<string, FeatureInfo>> {
  const featureInfoByKey = new Map<string, FeatureInfo>();
  for (let batchStart = 0; batchStart < featureKeys.length; batchStart += FEATURE_INFO_BATCH_SIZE) {
    const batch = featureKeys.slice(batchStart, batchStart + FEATURE_INFO_BATCH_SIZE);
    const jql = `key in (${batch.join(',')})`;
    const path = `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=summary,status&maxResults=${FEATURE_INFO_BATCH_SIZE}`;
    const response = await jiraGet<RawAgingSearchResponse>(path).catch(() => ({ issues: [] as RawAgingIssue[] }));
    for (const featureIssue of response.issues ?? []) {
      if (featureIssue.key) {
        featureInfoByKey.set(featureIssue.key, {
          summary: featureIssue.fields?.summary ?? '',
          status: featureIssue.fields?.status?.name ?? '',
        });
      }
    }
  }
  return featureInfoByKey;
}

// ── Projection helpers ─────────────────────────────────────────────────────────

/** Maps a raw Jira issue to the aging engine's input shape (issue key, type name, and creation date). */
function toAgingIssueInput(issue: RawAgingIssue): IssueAgingIssueInput {
  return {
    key: issue.key ?? '',
    issueType: issue.fields?.issuetype?.name ?? '',
    createdIso: issue.fields?.created ?? null,
  };
}

/** Whole calendar-day age between an ISO date and today, or null when the date is missing/unparseable. */
function calendarDaysBetween(iso: string | null | undefined, todayMs: number): number | null {
  if (!iso) {
    return null;
  }
  const thenMs = Date.parse(iso);
  if (Number.isNaN(thenMs)) {
    return null;
  }
  return Math.max(0, Math.round((todayMs - thenMs) / MILLISECONDS_PER_DAY));
}

/** Reads the issue's assignee display name, or null when it is unassigned or the name is blank. */
function readAssigneeName(issue: RawAgingIssue): string | null {
  const displayName = issue.fields?.assignee?.displayName;
  return typeof displayName === 'string' && displayName.trim() !== '' ? displayName.trim() : null;
}

/**
 * Projects a raw Jira issue into the triage's data-rich shape: age, time in current status, days since any
 * activity, ownership, size (story points), importance, definition (description / acceptance criteria), and the
 * linked feature plus its status. An unparseable created date reads as age 0 so the issue still appears.
 */
function toTriageIssue(
  issue: RawAgingIssue,
  todayMs: number,
  featureKey: string | null,
  featureInfoByKey: ReadonlyMap<string, FeatureInfo>,
  acFieldIds: readonly string[],
  storyPointsFieldId: string,
): AgingTriageIssue {
  const featureInfo = featureKey !== null ? featureInfoByKey.get(featureKey) ?? null : null;
  return {
    issueKey: issue.key ?? '',
    issueType: issue.fields?.issuetype?.name ?? 'Unknown',
    summary: issue.fields?.summary ?? '',
    status: issue.fields?.status?.name ?? 'Unknown',
    ageDays: calendarDaysBetween(issue.fields?.created, todayMs) ?? 0,
    daysInStatus: calendarDaysBetween(issue.fields?.statuscategorychangedate, todayMs),
    daysSinceUpdate: calendarDaysBetween(issue.fields?.updated, todayMs),
    assignee: readAssigneeName(issue),
    storyPoints: readStoryPoints((issue.fields ?? {}) as Record<string, unknown>, storyPointsFieldId),
    hasDescription: normalizeRichTextToPlainText(issue.fields?.description).trim() !== '',
    hasAcceptanceCriteria: readAcceptanceCriteriaText(issue as unknown as JiraIssue, acFieldIds) !== null,
    priority: issue.fields?.priority?.name ?? null,
    featureKey,
    featureSummary: featureInfo?.summary ?? null,
    featureStatus: featureInfo?.status ?? null,
  };
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Runs the whole enriched backlog fetch for a scope: builds the JQL, pages the NOT-Done backlog, resolves each
 * issue's parent feature (and that feature's status), and projects every issue into an `AgingTriageIssue`, while
 * also returning the lighter inputs the aging metrics engine needs. `todayIso` is injected so the age math is
 * deterministic and testable.
 */
export async function fetchAgingBacklog(scopeJql: string, todayIso: string): Promise<AgingBacklogFetchResult> {
  const jql = buildAgingJql(scopeJql);
  const todayMs = Date.parse(todayIso);

  // Resolve the feature-link field (ART setting → default), the instance's Acceptance-Criteria field(s) by name,
  // and the configured story-points field — then request the aging/triage signals plus detail in one search.
  const featureLinkField = loadConfiguredFeatureLinkFieldId();
  const acceptanceCriteriaFieldIds = await resolveAcceptanceCriteriaFieldIds();
  const storyPointsFieldId = readConfiguredStoryPointsFieldId();
  const fields = Array.from(new Set([
    'issuetype', 'created', 'status', 'statuscategorychangedate', 'updated', 'summary', 'priority', 'parent',
    'assignee', 'description', storyPointsFieldId,
    ...acceptanceCriteriaFieldIds, ...featureLinkCandidateFieldIds(featureLinkField),
  ])).join(',');

  const { rawIssues, wasCapped } = await fetchOpenBacklog(jql, fields);

  // Resolve each issue's parent feature via the feature-link field, then a single follow-up fetch reads those
  // features' own statuses/summaries (a link field yields only a key) so the triage can weigh them.
  const featureKeyByIssue = rawIssues.map((issue) =>
    extractFeatureKeyFromIssueFields((issue.fields ?? {}) as unknown as FeatureLinkFields, featureLinkField));
  const uniqueFeatureKeys = Array.from(new Set(featureKeyByIssue.filter((key): key is string => key !== null)));
  const featureInfoByKey = await fetchFeatureInfoByKey(uniqueFeatureKeys);

  return {
    agingInputs: rawIssues.map(toAgingIssueInput),
    triageIssues: rawIssues.map((issue, index) =>
      toTriageIssue(issue, todayMs, featureKeyByIssue[index], featureInfoByKey, acceptanceCriteriaFieldIds, storyPointsFieldId)),
    issuesByKey: new Map(rawIssues.filter((issue) => Boolean(issue.key)).map((issue) => [issue.key as string, issue as unknown as JiraIssue])),
    acceptanceCriteriaFieldIds,
    jql,
    wasCapped,
  };
}
