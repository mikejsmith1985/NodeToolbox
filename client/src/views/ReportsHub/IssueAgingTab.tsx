// IssueAgingTab.tsx — Open-item Aging report for the Reports Hub.
//
// Given a user-supplied scope JQL (a project, a board's project, or an `assignee in (...)` roster clause),
// this fetches every NOT-Done issue in that scope — paginated so the numbers cover the whole backlog — then
// feeds the pure `computeIssueAging` core to show, per issue type, how many open items there are and how old
// they are (average / median / oldest calendar days since creation), plus an overall count and average age.
// It is read-only — it never writes to Jira. The actionable AI cleanup triage now lives on the Team Dashboard's
// Backlog Remediation panel; this tab is the metrics report only.

import { useState } from 'react';

import { copyToClipboard } from '../FeatureCanvas/ai/clipboard.ts';
import { AGING_BACKLOG_MAX_ISSUES, fetchAgingMetrics } from './agingBacklogFetch.ts';
import {
  computeIssueAging,
  type IssueAgingResult,
  type IssueTypeAging,
} from './issueAging.ts';
import {
  DistributionBar,
  EmptyNote,
  MeterList,
  ReportPanel,
  StatCards,
  type MeterRowData,
} from './visuals/ReportVisuals.tsx';
import styles from './ReportsHubView.module.css';

// ── Named constants ──────────────────────────────────────────────────────────

// localStorage key the scope JQL is persisted under, so a user's input survives a reload. Read at RUN
// time so an edit is picked up on the next run without a reload.
const SCOPE_STORAGE_KEY = 'tbxIssueAgingScope';

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

/** An age past this reads as stale rather than as a backlog doing its job. */
const STALE_AGE_DAY_THRESHOLD = 90;

/**
 * The aging headline.
 *
 * The oldest item and the over-90-day count join the totals, because an average hides exactly the
 * thing a backlog review is for: an average of 40 days says nothing about the item sitting at 400.
 */
function AgingHeadline({ result }: { result: IssueAgingResult }): React.JSX.Element {
  const staleCount = result.overall.buckets.ageOverNinety;

  return (
    <StatCards
      stats={[
        { label: 'Open issues', value: String(result.totalCount) },
        {
          label: 'Average age',
          value: formatNullableDays(result.overallAverageAgeDays),
          context: `median ${formatNullableDays(result.overall.medianAgeDays)} days`,
        },
        {
          label: 'Oldest',
          value: formatNullableDays(result.overall.oldestAgeDays),
          context: result.overall.oldestIssueKey === null
            ? 'No issue could be aged.'
            : `${result.overall.oldestIssueKey}, in days`,
          tone: (result.overall.oldestAgeDays ?? 0) > STALE_AGE_DAY_THRESHOLD ? 'bad' : 'neutral',
        },
        {
          label: `Older than ${STALE_AGE_DAY_THRESHOLD} days`,
          value: String(staleCount),
          context: result.totalCount === 0
            ? 'Nothing open.'
            : `${Math.round((staleCount / result.totalCount) * 100)}% of the open backlog`,
          tone: staleCount > 0 ? 'warn' : 'good',
        },
      ]}
    />
  );
}

/** Turns the per-type rows into bars, coloured by how old the typical issue in each is. */
function buildAgingRows(result: IssueAgingResult): MeterRowData[] {
  return result.byType.map((typeRow): MeterRowData => ({
    name: typeRow.issueType,
    // Ranked by AVERAGE rather than count: ten fresh bugs are not an aging problem and one
    // year-old story is, and a count cannot tell those apart.
    value: typeRow.averageAgeDays ?? 0,
    valueLabel: `${typeRow.count} open · avg ${formatNullableDays(typeRow.averageAgeDays)}d · `
      + `oldest ${formatNullableDays(typeRow.oldestAgeDays)}d`,
    tone: (typeRow.averageAgeDays ?? 0) > STALE_AGE_DAY_THRESHOLD ? 'bad' : 'neutral',
  }));
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
    <>
      <ReportPanel
        title="How old the backlog is"
        caption={'Every open issue by how long it has existed. The four bands are the shape of a backlog: '
          + 'a healthy one is heavy on the left, and a stalled one grows a tail on the right.'}
      >
        <DistributionBar
          slices={[
            { name: '0–7 days', count: result.overall.buckets.ageZeroToSeven },
            { name: '8–30 days', count: result.overall.buckets.ageEightToThirty },
            { name: '31–90 days', count: result.overall.buckets.ageThirtyOneToNinety },
            { name: 'Over 90 days', count: result.overall.buckets.ageOverNinety },
          ]}
        />
      </ReportPanel>

      <ReportPanel
        title="Which kinds of work age"
        caption={'Ranked by AVERAGE age, not by count: ten fresh bugs are not an aging problem and one '
          + 'year-old story is, and a count cannot tell those apart.'}
      >
        {result.byType.length === 0
          ? <EmptyNote>No open issues were found, so nothing is ageing.</EmptyNote>
          : (
            <MeterList
              markerLabel={`${STALE_AGE_DAY_THRESHOLD} days`}
              markerValue={STALE_AGE_DAY_THRESHOLD}
              rows={buildAgingRows(result)}
            />
          )}
      </ReportPanel>

      {/* The table stays. The bars answer "where should I look"; the exact medians and bucket counts
          answer "what do I say about it", and a review needs both. */}
      <div className={styles.tableWrapper}>
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
    </>
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
      // The clock read is fine here — the pure engine takes today as an argument, staying deterministic.
      const todayIso = new Date().toISOString().slice(0, 10);
      const backlog = await fetchAgingMetrics(trimmedScope);
      setResult(computeIssueAging({ issues: backlog.agingInputs, todayIso }));
      setQueriedJql(backlog.jql);
      setWasCapped(backlog.wasCapped);
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
          Results were capped at {AGING_BACKLOG_MAX_ISSUES} issues — narrow the scope for a complete picture.
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
    </div>
  );
}
