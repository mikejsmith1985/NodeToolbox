// IssueAgingTab.tsx — Open-item Aging report for the Reports Hub.
//
// Given a user-supplied scope JQL (a project, a board's project, or an `assignee in (...)` roster clause),
// this fetches every NOT-Done issue in that scope — paginated so the numbers cover the whole backlog — then
// feeds the pure `computeIssueAging` core to show, per issue type, how many open items there are and how old
// they are (average / median / oldest calendar days since creation), plus an overall count and average age.
// It is read-only — it never writes to Jira.

import { useState } from 'react';

import { jiraGet } from '../../services/jiraApi.ts';
import { copyToClipboard } from '../FeatureCanvas/ai/clipboard.ts';
import {
  computeIssueAging,
  type IssueAgingIssueInput,
  type IssueAgingResult,
  type IssueTypeAging,
} from './issueAging.ts';

// ── Named constants ──────────────────────────────────────────────────────────

// localStorage key the scope JQL is persisted under, so a user's input survives a reload. Read at RUN
// time so an edit is picked up on the next run without a reload.
const SCOPE_STORAGE_KEY = 'tbxIssueAgingScope';
// One Jira search page — the report pages through the whole backlog in chunks of this size.
const PAGE_SIZE = 100;
// Hard safety cap on how many issues the report will fetch, so a huge scope cannot page forever; when it is
// hit the report shows a clear "capped" note rather than silently reporting a partial picture.
const MAX_TOTAL_ISSUES = 2000;

// ── Jira response shapes (only the fields this report reads) ──

interface RawAgingIssue {
  key?: string;
  fields?: {
    issuetype?: { name?: string } | null;
    created?: string | null;
  };
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
function buildAgingSearchPath(jql: string, startAt: number): string {
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=issuetype,created,status&startAt=${startAt}&maxResults=${PAGE_SIZE}`;
}

/**
 * Pages through the whole NOT-Done backlog for the given JQL so the age statistics cover every open issue,
 * not just the first page. It keeps requesting the next page until Jira reports it has returned everything
 * (`startAt + returned >= total`) or the MAX_TOTAL_ISSUES safety cap is reached, in which case it flags the
 * result as capped. Any fetch error propagates to the caller so the run can surface it and stop.
 */
async function fetchOpenBacklog(jql: string): Promise<FetchedBacklog> {
  const rawIssues: RawAgingIssue[] = [];
  let startAt = 0;
  while (true) {
    const response = await jiraGet<RawAgingSearchResponse>(buildAgingSearchPath(jql, startAt));
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

/** Maps a raw Jira issue to the aging engine's input shape (issue key, type name, and creation date). */
function toAgingIssueInput(issue: RawAgingIssue): IssueAgingIssueInput {
  return {
    key: issue.key ?? '',
    issueType: issue.fields?.issuetype?.name ?? '',
    createdIso: issue.fields?.created ?? null,
  };
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
    <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11, opacity: 0.6 }}>
      <span style={{ fontWeight: 600, flex: '0 0 auto' }}>JQL</span>
      <code
        style={{
          flex: '1 1 auto', minWidth: 0, fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere', userSelect: 'all',
        }}
      >
        {jql}
      </code>
      <button
        type="button"
        aria-label="Copy JQL"
        onClick={() => copyToClipboard(jql)}
        style={{ flex: '0 0 auto', fontSize: 11, padding: '1px 6px', cursor: 'pointer' }}
      >
        Copy
      </button>
    </div>
  );
}

/** The aging headline: the total open-issue count plus the overall average age in days. */
function AgingHeadline({ result }: { result: IssueAgingResult }): React.JSX.Element {
  return (
    <p style={{ marginTop: 12, fontSize: 14, fontWeight: 600 }}>
      {result.totalCount} open issues · overall avg age {formatNullableDays(result.overallAverageAgeDays)}d
    </p>
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
    <div style={{ overflowX: 'auto', marginTop: 12 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left', opacity: 0.6 }}>
            <th>Issue Type</th><th>Count</th><th>Avg Age (days)</th><th>Median</th><th>Oldest</th>
            <th>0–7d</th><th>8–30d</th><th>31–90d</th><th>90+d</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ borderTop: '2px solid var(--color-border)', fontWeight: 700, opacity: 0.85 }}>
            <AgingRowCells row={result.overall} />
          </tr>
          {result.byType.map((typeRow) => (
            <tr key={typeRow.issueType} style={{ borderTop: '1px solid var(--color-border)' }}>
              <AgingRowCells row={typeRow} />
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 6, fontSize: 11, opacity: 0.6 }}>
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

  const handleScopeChange = (nextScope: string): void => {
    setScopeJql(nextScope);
    writePersistedScope(nextScope);
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
    try {
      const jql = buildAgingJql(trimmedScope);
      const { rawIssues, wasCapped: capped } = await fetchOpenBacklog(jql);
      const issues = rawIssues.map(toAgingIssueInput);
      // The clock read is fine here — the pure engine takes today as an argument, staying deterministic.
      const todayIso = new Date().toISOString().slice(0, 10);
      setResult(computeIssueAging({ issues, todayIso }));
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
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, gap: 4 }}>
          Scope JQL
          <input
            value={scopeJql}
            onChange={(event) => handleScopeChange(event.target.value)}
            placeholder="project = ENCUC"
            style={{ minWidth: 260 }}
          />
        </label>
        <button type="button" onClick={() => void runReport()} disabled={scopeJql.trim() === '' || isLoading}>
          {isLoading ? 'Running…' : 'Run report'}
        </button>
      </div>
      <p style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
        Scope can be a project, a board's project, or an <code>assignee in (...)</code> roster clause. Only
        NOT-Done issues are aged, measured in calendar days since each issue was created.
      </p>

      {error !== null && (
        <p role="alert" style={{ marginTop: 10, fontSize: 12, color: 'var(--color-danger)' }}>{error}</p>
      )}

      {wasCapped && result !== null && (
        <p style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>
          Results were capped at {MAX_TOTAL_ISSUES} issues — narrow the scope for a complete picture.
        </p>
      )}

      {result !== null && (
        <>
          <AgingHeadline result={result} />
          {result.totalCount === 0 ? (
            <p style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
              No NOT-Done issues matched this scope.
            </p>
          ) : (
            <AgingByTypeTable result={result} />
          )}
        </>
      )}

      {queriedJql !== null && <QueriedJqlBlock jql={queriedJql} />}
    </div>
  );
}
