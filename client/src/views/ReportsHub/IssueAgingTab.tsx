// IssueAgingTab.tsx — Open-item Aging report for the Reports Hub.
//
// Given a user-supplied scope JQL (a project, a board's project, or an `assignee in (...)` roster clause),
// this fetches every NOT-Done issue in that scope — paginated so the numbers cover the whole backlog — then
// feeds the pure `computeIssueAging` core to show, per issue type, how many open items there are and how old
// they are (average / median / oldest calendar days since creation), plus an overall count and average age.
// It is read-only — it never writes to Jira. When AI Assist is unlocked (Ctrl+Alt+Z), an advisory cleanup
// triage panel assembles a copy-paste prompt over the same backlog and ingests cancel/review/keep verdicts.

import { useMemo, useState } from 'react';

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
import { copyToClipboard } from '../FeatureCanvas/ai/clipboard.ts';
import { AgingTriageActionTable } from './AgingTriageActionTable.tsx';
import { ReportAiPanel } from './ReportAiPanel.tsx';
import {
  buildAgingTriagePrompt,
  parseAgingTriageResponse,
  type AgingTriageIssue,
  type AgingTriageSuggestion,
} from './agingTriage.ts';
import { buildTriageActionModel } from './agingTriageActionModel.ts';
import {
  computeIssueAging,
  type IssueAgingIssueInput,
  type IssueAgingResult,
  type IssueTypeAging,
} from './issueAging.ts';
import styles from './ReportsHubView.module.css';

// ── Named constants ──────────────────────────────────────────────────────────

// localStorage key the scope JQL is persisted under, so a user's input survives a reload. Read at RUN
// time so an edit is picked up on the next run without a reload.
const SCOPE_STORAGE_KEY = 'tbxIssueAgingScope';
// One Jira search page — the report pages through the whole backlog in chunks of this size.
const PAGE_SIZE = 100;
// Hard safety cap on how many issues the report will fetch, so a huge scope cannot page forever; when it is
// hit the report shows a clear "capped" note rather than silently reporting a partial picture.
const MAX_TOTAL_ISSUES = 2000;
// Milliseconds in one calendar day, used to convert an epoch difference into a whole-day age.
const MILLISECONDS_PER_DAY = 86_400_000;
// The Jira custom field that carries a Story's point estimate on this instance's boards — read as the
// triage "size/effort" signal, and requested in the same search so it costs no extra round-trip.
const STORY_POINTS_FIELD_ID = 'customfield_10016';

// ── Jira response shapes (only the fields this report reads) ──

interface RawAgingIssue {
  key?: string;
  fields?: {
    issuetype?: { name?: string } | null;
    created?: string | null;
    // The extra signals the AI triage leans on beyond aging: current status, recent activity, and
    // importance. All optional — a plain aging run needs none of them. The feature-link custom fields are
    // read dynamically by id (they vary per instance), hence the index signature.
    status?: { name?: string } | null;
    updated?: string | null;
    // When the issue's status category last changed — the basis for "days in current status", a sharper
    // staleness measure than `updated` (which any minor edit bumps).
    statuscategorychangedate?: string | null;
    summary?: string | null;
    priority?: { name?: string } | null;
    // Who owns the issue; absent/null means unassigned, itself a cancel signal. Description drives the
    // "is this even defined" signal. Story points and acceptance-criteria fields are read via the index
    // signature below (their ids vary per instance).
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

// ── JQL + fetch helpers ───────────────────────────────────────────────────────

/**
 * Builds the exact JQL the report queries: the user's scope wrapped in parentheses, ANDed with a
 * `statusCategory != Done` clause so only open work is aged, oldest-created first. Factored out so the same
 * string is BOTH queried and shown to the user, guaranteeing the displayed JQL never drifts from what ran.
 */
function buildAgingJql(scopeJql: string): string {
  return `(${scopeJql}) AND statusCategory != Done ORDER BY created ASC`;
}

/** Wraps the aging JQL with the requested fields and the page window into a single search request path. */
function buildAgingSearchPath(jql: string, startAt: number, fields: string): string {
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fields)}&startAt=${startAt}&maxResults=${PAGE_SIZE}`;
}

/**
 * Pages through the whole NOT-Done backlog for the given JQL so the age statistics cover every open issue,
 * not just the first page. It keeps requesting the next page until Jira reports it has returned everything
 * (`startAt + returned >= total`) or the MAX_TOTAL_ISSUES safety cap is reached, in which case it flags the
 * result as capped. Any fetch error propagates to the caller so the run can surface it and stop.
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
    if (rawIssues.length >= MAX_TOTAL_ISSUES) {
      return { rawIssues, wasCapped: true };
    }
  }
}

// How many feature keys to resolve per follow-up request when reading their summaries and statuses.
const FEATURE_INFO_BATCH_SIZE = 50;

/**
 * Follow-up fetch that resolves each linked feature's own summary and status by key — the same second-hop
 * the blueprint does, since a feature-link field only yields a key. Batched, and fully error-tolerant: a
 * failed batch simply leaves those features unresolved (their status shows as unknown in the triage) rather
 * than failing the whole aging run.
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

/**
 * Projects a raw Jira issue into the AI triage's data-rich shape: its age, time in its current status,
 * days since any activity, ownership, size (story points), importance (priority), whether it is even
 * defined (description / acceptance criteria), and the linked feature (resolved via the blueprint's
 * feature-link field) plus that feature's status. Issues with an unparseable created date get an age of 0
 * so they still appear (their staleness simply cannot be judged), and an unresolved feature leaves the
 * feature fields null. `acFieldIds` are the instance's acceptance-criteria field ids resolved once per run.
 */
function toTriageIssue(
  issue: RawAgingIssue,
  todayMs: number,
  featureKey: string | null,
  featureInfoByKey: ReadonlyMap<string, FeatureInfo>,
  acFieldIds: readonly string[],
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
    storyPoints: readStoryPoints(issue),
    hasDescription: normalizeRichTextToPlainText(issue.fields?.description).trim() !== '',
    // Reuse Hygiene's AC reader so "has acceptance criteria" means exactly what the detail panel shows.
    hasAcceptanceCriteria: readAcceptanceCriteriaText(issue as unknown as JiraIssue, acFieldIds) !== null,
    priority: issue.fields?.priority?.name ?? null,
    featureKey,
    featureSummary: featureInfo?.summary ?? null,
    featureStatus: featureInfo?.status ?? null,
  };
}

/** Reads the issue's assignee display name, or null when it is unassigned or the name is blank. */
function readAssigneeName(issue: RawAgingIssue): string | null {
  const displayName = issue.fields?.assignee?.displayName;
  return typeof displayName === 'string' && displayName.trim() !== '' ? displayName.trim() : null;
}

/** Reads the issue's story-point estimate as a number, or null when it is unset or non-numeric. */
function readStoryPoints(issue: RawAgingIssue): number | null {
  const rawPoints = issue.fields?.[STORY_POINTS_FIELD_ID];
  return typeof rawPoints === 'number' && Number.isFinite(rawPoints) ? rawPoints : null;
}

/** Reads the persisted scope JQL, tolerating a missing or corrupt store by falling back to an empty string. */
function readPersistedScope(): string {
  try {
    const stored = JSON.parse(localStorage.getItem(SCOPE_STORAGE_KEY) || '{}') as { scopeJql?: string };
    return stored.scopeJql ?? '';
  } catch {
    return '';
  }
}

/** Persists the scope JQL so it survives a reload; failures are swallowed (storage is a convenience). */
function writePersistedScope(scopeJql: string): void {
  try {
    localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify({ scopeJql }));
  } catch {
    // Ignore storage errors (private mode, quota) — the report still works without persistence.
  }
}

// ── Formatting helpers ─────────────────────────────────────────────────────────

/** Formats a rate/number for display with up to two decimals (integers stay whole). */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** Formats a nullable age statistic, showing an em-dash when there is no measurable age. */
function formatNullableDays(value: number | null): string {
  return value === null ? '—' : formatNumber(value);
}

// ── Presentational sub-components ──────────────────────────────────────────────

/**
 * Shows the exact JQL the report ran, in selectable monospace, with a Copy button — so a reviewer can paste
 * it straight into Jira's issue search and cross-check the numbers. The JQL wraps rather than forcing
 * horizontal page overflow.
 */
function QueriedJqlBlock({ jql }: { jql: string }): React.JSX.Element {
  return (
    <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 8 }} className={styles.captionText}>
      <span style={{ fontWeight: 600, flex: '0 0 auto' }}>JQL</span>
      <code
        style={{
          flex: '1 1 auto', minWidth: 0, fontFamily: 'monospace', whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere', userSelect: 'all',
        }}
      >
        {jql}
      </code>
      <button type="button" aria-label="Copy JQL" onClick={() => copyToClipboard(jql)} className={styles.actionButton}>
        Copy
      </button>
    </div>
  );
}

/** The aging headline as two KPI cards: the total open-issue count and the overall average age in days. */
function AgingHeadline({ result }: { result: IssueAgingResult }): React.JSX.Element {
  return (
    <div className={styles.kpiGrid} style={{ marginTop: 12 }}>
      <div className={styles.kpiCard}>
        <span className={styles.kpiLabel}>Open issues</span>
        <span className={styles.kpiValue}>{result.totalCount}</span>
      </div>
      <div className={styles.kpiCard}>
        <span className={styles.kpiLabel}>Overall avg age (days)</span>
        <span className={styles.kpiValue}>{formatNullableDays(result.overallAverageAgeDays)}</span>
      </div>
    </div>
  );
}

/**
 * Formats the "Oldest" cell: the oldest age in days followed by the key of that oldest issue (e.g.
 * "180d · ENCUC-1234"), or an em-dash when the group has no issue with a measurable age.
 */
function formatOldestCell(row: IssueTypeAging): string {
  if (row.oldestAgeDays === null) {
    return '—';
  }
  const agePart = `${formatNumber(row.oldestAgeDays)}d`;
  return row.oldestIssueKey ? `${agePart} · ${row.oldestIssueKey}` : agePart;
}

/** Renders one aging table row's cells; shared by the per-type rows and the emphasised overall "All" row. */
function AgingRowCells({ row }: { row: IssueTypeAging }): React.JSX.Element {
  return (
    <>
      <td>{row.issueType}</td>
      <td>{String(row.count)}</td>
      <td>{formatNullableDays(row.averageAgeDays)}</td>
      <td>{formatNullableDays(row.medianAgeDays)}</td>
      <td>{formatOldestCell(row)}</td>
      <td>{String(row.buckets.ageZeroToSeven)}</td>
      <td>{String(row.buckets.ageEightToThirty)}</td>
      <td>{String(row.buckets.ageThirtyOneToNinety)}</td>
      <td>{String(row.buckets.ageOverNinety)}</td>
    </>
  );
}

/**
 * The per-issue-type aging table, led by an emphasised overall "All" summary row and wrapped so the wide
 * bucket columns can scroll without pushing the page sideways. The four bucket columns spread each group's
 * ages by day range; `90+d` counts issues older than 90 days.
 */
function AgingByTypeTable({ result }: { result: IssueAgingResult }): React.JSX.Element {
  return (
    <div className={styles.tableWrapper} style={{ marginTop: 12 }}>
      <table className={styles.reportTable}>
        <thead>
          <tr>
            <th>Issue Type</th><th>Count</th><th>Avg Age (days)</th><th>Median</th><th>Oldest</th>
            <th>0–7d</th><th>8–30d</th><th>31–90d</th><th>90+d</th>
          </tr>
        </thead>
        <tbody>
          <tr className={styles.emphasisRow}>
            <AgingRowCells row={result.overall} />
          </tr>
          {result.byType.map((typeRow) => (
            <tr key={typeRow.issueType}>
              <AgingRowCells row={typeRow} />
            </tr>
          ))}
        </tbody>
      </table>
      <p className={styles.captionText}>
        <code>90+d</code> counts issues older than 90 days. The bold <strong>All</strong> row aggregates
        every issue type. Ages are calendar days since each issue was created.
      </p>
    </div>
  );
}

// ── Tab ────────────────────────────────────────────────────────────────────────

/** The Aging report tab: enter a scope JQL, run, and read the NOT-Done backlog's age by issue type. */
export function IssueAgingTab(): React.JSX.Element {
  const [scopeJql, setScopeJql] = useState(readPersistedScope);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IssueAgingResult | null>(null);
  const [queriedJql, setQueriedJql] = useState<string | null>(null);
  const [wasCapped, setWasCapped] = useState(false);
  // The enriched triage candidates from the last run, and the ingested verdicts / parse error. These only
  // feed the passphrase-gated AI panel; a normal aging run ignores them.
  const [triageIssues, setTriageIssues] = useState<AgingTriageIssue[]>([]);
  const [triageSuggestions, setTriageSuggestions] = useState<AgingTriageSuggestion[]>([]);
  const [triageError, setTriageError] = useState<string | null>(null);
  // The full fetched issue objects (keyed by issue key) and the resolved Acceptance Criteria field ids —
  // both feed the actionable table's inline detail after verdicts are ingested.
  const [issuesByKey, setIssuesByKey] = useState<Map<string, JiraIssue>>(new Map());
  const [acceptanceCriteriaFieldIds, setAcceptanceCriteriaFieldIds] = useState<string[]>([]);

  const handleScopeChange = (nextScope: string): void => {
    setScopeJql(nextScope);
    writePersistedScope(nextScope);
  };

  const triagePrompt = useMemo(() => buildAgingTriagePrompt(triageIssues), [triageIssues]);
  // The ingested verdicts rolled up into the recommendation → feature → issue table (empty until ingest).
  const triageActionModel = useMemo(() => buildTriageActionModel(triageSuggestions, triageIssues), [triageSuggestions, triageIssues]);

  /** Parses a pasted assistant reply into verdicts, keeping only issues that were actually shown. */
  const ingestTriage = (responseText: string): void => {
    try {
      const shownKeys = new Set(triageIssues.map((issue) => issue.issueKey));
      const parsed = parseAgingTriageResponse(responseText).filter((item) => shownKeys.has(item.issueKey));
      setTriageSuggestions(parsed);
      setTriageError(null);
    } catch (caughtError) {
      setTriageSuggestions([]);
      setTriageError(caughtError instanceof Error ? caughtError.message : 'Could not read the response.');
    }
  };

  const runReport = async (): Promise<void> => {
    // Read the scope fresh at run time so the latest edit is used; guard the blank case defensively.
    const trimmedScope = scopeJql.trim();
    if (trimmedScope === '') {
      return;
    }
    setIsLoading(true);
    setError(null);
    setResult(null);
    setQueriedJql(null);
    setWasCapped(false);
    setTriageIssues([]);
    setTriageSuggestions([]);
    setTriageError(null);
    setIssuesByKey(new Map());
    try {
      const jql = buildAgingJql(trimmedScope);
      // Resolve the feature-link field the same way the blueprint does (ART setting → default) and the
      // instance's Acceptance Criteria field (by name) so both the triage and the inline detail work. Request
      // the aging/triage signals plus the detail fields (assignee/description/points/AC) in one search.
      const featureLinkField = loadConfiguredFeatureLinkFieldId();
      const acFieldIds = await resolveAcceptanceCriteriaFieldIds();
      setAcceptanceCriteriaFieldIds(acFieldIds);
      const fields = Array.from(new Set([
        'issuetype', 'created', 'status', 'statuscategorychangedate', 'updated', 'summary', 'priority', 'parent',
        'assignee', 'description', STORY_POINTS_FIELD_ID,
        ...acFieldIds, ...featureLinkCandidateFieldIds(featureLinkField),
      ])).join(',');
      const { rawIssues, wasCapped: capped } = await fetchOpenBacklog(jql, fields);
      const issues = rawIssues.map(toAgingIssueInput);
      // The clock read is fine here — the pure engine takes today as an argument, staying deterministic.
      const todayIso = new Date().toISOString().slice(0, 10);
      const todayMs = Date.parse(todayIso);
      setResult(computeIssueAging({ issues, todayIso }));

      // Keep the full issue objects so the actionable table can show inline detail without re-fetching.
      setIssuesByKey(new Map(rawIssues.filter((issue) => Boolean(issue.key)).map((issue) => [issue.key as string, issue as unknown as JiraIssue])));

      // Resolve each issue's parent feature via the feature-link field, then a single follow-up fetch reads
      // those features' own statuses/summaries (a link field yields only a key) so the triage can weigh them.
      const featureKeyByIssue = rawIssues.map((issue) =>
        extractFeatureKeyFromIssueFields((issue.fields ?? {}) as unknown as FeatureLinkFields, featureLinkField));
      const uniqueFeatureKeys = Array.from(new Set(featureKeyByIssue.filter((key): key is string => key !== null)));
      const featureInfoByKey = await fetchFeatureInfoByKey(uniqueFeatureKeys);
      setTriageIssues(rawIssues.map((issue, index) => toTriageIssue(issue, todayMs, featureKeyByIssue[index], featureInfoByKey, acFieldIds)));

      setQueriedJql(jql);
      setWasCapped(capped);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to build the aging report.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ padding: '8px 4px' }}>
      <div className={styles.controlRow}>
        <label className={styles.controlLabel}>
          Scope JQL
          <input
            value={scopeJql}
            onChange={(event) => handleScopeChange(event.target.value)}
            placeholder="project = ENCUC"
            className={styles.textInput}
            style={{ minWidth: 260 }}
          />
        </label>
        <button
          type="button"
          onClick={() => void runReport()}
          disabled={scopeJql.trim() === '' || isLoading}
          className={`${styles.actionButton} ${styles.primaryButton}`}
        >
          {isLoading ? 'Running…' : 'Run report'}
        </button>
      </div>
      <p className={styles.captionText}>
        Scope can be a project, a board's project, or an <code>assignee in (...)</code> roster clause. Only
        NOT-Done issues are aged, measured in calendar days since each issue was created.
      </p>

      {error !== null && (
        <p role="alert" className={styles.warningText} style={{ marginTop: 10 }}>{error}</p>
      )}

      {wasCapped && result !== null && (
        <p className={styles.captionText}>
          Results were capped at {MAX_TOTAL_ISSUES} issues — narrow the scope for a complete picture.
        </p>
      )}

      {result !== null && (
        <>
          <AgingHeadline result={result} />
          {result.totalCount === 0 ? (
            <p className={styles.captionText}>No NOT-Done issues matched this scope.</p>
          ) : (
            <AgingByTypeTable result={result} />
          )}
        </>
      )}

      {queriedJql !== null && <QueriedJqlBlock jql={queriedJql} />}

      {triageIssues.length > 0 && (
        <ReportAiPanel
          title="AI cleanup triage"
          prompt={triagePrompt}
          ingestLabel="Ingest verdicts"
          onIngest={ingestTriage}
          error={triageError}
        >
          {triageSuggestions.length > 0 && (
            <AgingTriageActionTable
              model={triageActionModel}
              issuesByKey={issuesByKey}
              acceptanceCriteriaFieldIds={acceptanceCriteriaFieldIds}
            />
          )}
        </ReportAiPanel>
      )}
    </div>
  );
}
