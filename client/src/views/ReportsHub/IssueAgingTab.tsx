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
import { copyToClipboard } from '../FeatureCanvas/ai/clipboard.ts';
import { ReportAiPanel } from './ReportAiPanel.tsx';
import {
  buildAgingTriagePrompt,
  parseAgingTriageResponse,
  type AgingTriageIssue,
  type AgingTriageSuggestion,
  type AgingTriageVerdict,
} from './agingTriage.ts';
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

// ── Jira response shapes (only the fields this report reads) ──

interface RawAgingIssue {
  key?: string;
  fields?: {
    issuetype?: { name?: string } | null;
    created?: string | null;
    // The extra signals the AI triage leans on beyond aging: current status, recent activity, importance,
    // and the parent feature (with its own status). All optional — a plain aging run needs none of them.
    status?: { name?: string } | null;
    updated?: string | null;
    summary?: string | null;
    priority?: { name?: string } | null;
    parent?: { key?: string; fields?: { summary?: string | null; status?: { name?: string } | null } | null } | null;
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
  // `parent` carries the feature link and its status; `updated`/`priority`/`summary` feed the AI triage.
  const fields = 'issuetype,created,status,updated,summary,priority,parent';
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${fields}&startAt=${startAt}&maxResults=${PAGE_SIZE}`;
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
 * Projects a raw Jira issue into the AI triage's data-rich shape: its age, days since last activity,
 * importance (priority), and the parent feature plus that feature's status. Issues with an unparseable
 * created date get an age of 0 so they still appear (their staleness simply cannot be judged).
 */
function toTriageIssue(issue: RawAgingIssue, todayMs: number): AgingTriageIssue {
  const parent = issue.fields?.parent ?? null;
  return {
    issueKey: issue.key ?? '',
    issueType: issue.fields?.issuetype?.name ?? 'Unknown',
    summary: issue.fields?.summary ?? '',
    status: issue.fields?.status?.name ?? 'Unknown',
    ageDays: calendarDaysBetween(issue.fields?.created, todayMs) ?? 0,
    daysSinceUpdate: calendarDaysBetween(issue.fields?.updated, todayMs),
    priority: issue.fields?.priority?.name ?? null,
    featureKey: parent?.key ?? null,
    featureSummary: parent?.fields?.summary ?? null,
    featureStatus: parent?.fields?.status?.name ?? null,
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

// ── AI triage results ──────────────────────────────────────────────────────────

/** Human label and badge class for each verdict, so the results read clearly and are colour-coded. */
const VERDICT_META: Record<AgingTriageVerdict, { label: string; badgeClass: string }> = {
  'cancel-safe': { label: 'Cancel-safe', badgeClass: styles.verdictCancelSafe },
  review: { label: 'Review', badgeClass: styles.verdictReview },
  'must-remain': { label: 'Must remain', badgeClass: styles.verdictMustRemain },
};

/** One-line tally of how many issues fell into each verdict, shown above the detail rows. */
function summariseVerdicts(suggestions: readonly AgingTriageSuggestion[]): string {
  const cancelSafe = suggestions.filter((item) => item.verdict === 'cancel-safe').length;
  const review = suggestions.filter((item) => item.verdict === 'review').length;
  const mustRemain = suggestions.filter((item) => item.verdict === 'must-remain').length;
  return `${cancelSafe} cancel-safe · ${review} to review · ${mustRemain} must remain`;
}

/** Renders the ingested triage verdicts as colour-coded rows with the assistant's rationale. */
function AgingTriageResults({ suggestions }: { suggestions: readonly AgingTriageSuggestion[] }): React.JSX.Element | null {
  if (suggestions.length === 0) {
    return null;
  }
  return (
    <div style={{ marginTop: 8 }}>
      <p className={styles.captionText}>{summariseVerdicts(suggestions)}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {suggestions.map((suggestion) => {
          const meta = VERDICT_META[suggestion.verdict];
          return (
            <li key={suggestion.issueKey} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span className={`${styles.verdictBadge} ${meta.badgeClass}`}>{meta.label}</span>
              <span>
                <strong>{suggestion.issueKey}</strong>
                {suggestion.rationale !== '' && <span className={styles.captionText} style={{ marginLeft: 6 }}>{suggestion.rationale}</span>}
              </span>
            </li>
          );
        })}
      </ul>
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

  const handleScopeChange = (nextScope: string): void => {
    setScopeJql(nextScope);
    writePersistedScope(nextScope);
  };

  const triagePrompt = useMemo(() => buildAgingTriagePrompt(triageIssues), [triageIssues]);

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
    try {
      const jql = buildAgingJql(trimmedScope);
      const { rawIssues, wasCapped: capped } = await fetchOpenBacklog(jql);
      const issues = rawIssues.map(toAgingIssueInput);
      // The clock read is fine here — the pure engine takes today as an argument, staying deterministic.
      const todayIso = new Date().toISOString().slice(0, 10);
      const todayMs = Date.parse(todayIso);
      setResult(computeIssueAging({ issues, todayIso }));
      setTriageIssues(rawIssues.map((issue) => toTriageIssue(issue, todayMs)));
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
          <AgingTriageResults suggestions={triageSuggestions} />
        </ReportAiPanel>
      )}
    </div>
  );
}
