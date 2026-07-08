// PersonalFlowTab.tsx — Per-person throughput + cycle-time report for the Reports Hub.
//
// Given one Jira assignee and a lookback window, this fetches their closed issues (with changelog)
// and the instance's status→category map, then feeds the pure `computePersonalFlow` core to show how
// much they complete per day / week / two weeks (issues AND story points) and how long work takes from
// the first In-Progress status category to Done. It is read-only — it never writes to Jira.

import { useState } from 'react';

import { jiraGet } from '../../services/jiraApi.ts';
import {
  computePersonalFlow,
  type PersonalFlowIssue,
  type PersonalFlowResult,
  type PersonalFlowTransition,
} from './personalFlow.ts';

// Story-points custom fields this instance uses (same ids the rest of the app reads); the first numeric wins.
const STORY_POINTS_FIELD_IDS: readonly string[] = ['customfield_10016', 'customfield_10028'];
// One page of up to this many closed issues — plenty for a personal report; flagged when it caps out.
const MAX_ISSUES = 100;
const DEFAULT_WINDOW_DAYS = 90;
// The "All history" option maps to ~10 years so the window effectively stops filtering.
const ALL_HISTORY_WINDOW_DAYS = 3650;

/** The lookback windows offered in the picker; label shown to the user, value used in the JQL. */
const WINDOW_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 30, label: 'Last 30 days' },
  { value: 60, label: 'Last 60 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 180, label: 'Last 180 days' },
  { value: ALL_HISTORY_WINDOW_DAYS, label: 'All history' },
];

// ── Jira response shapes (only the fields this report reads) ──

interface RawStatus { id?: string; statusCategory?: { key?: string } }
interface RawChangeItem { field?: string; to?: string | number | null }
interface RawHistory { created?: string; items?: RawChangeItem[] }
interface RawIssue {
  key?: string;
  fields?: Record<string, unknown> & { summary?: string; resolutiondate?: string | null };
  changelog?: { histories?: RawHistory[] };
}

/** Builds the statusId → category-key map from the instance's status list (unknown ids read as 'new'). */
function buildStatusCategoryMap(statuses: readonly RawStatus[]): Record<string, string> {
  const statusCategoryByStatusId: Record<string, string> = {};
  for (const status of statuses) {
    if (typeof status.id === 'string') {
      statusCategoryByStatusId[status.id] = status.statusCategory?.key ?? 'new';
    }
  }
  return statusCategoryByStatusId;
}

/** Reads the first numeric story-points value across the known custom fields, or null when none is set. */
function readStoryPoints(fields: Record<string, unknown>): number | null {
  for (const fieldId of STORY_POINTS_FIELD_IDS) {
    const value = fields[fieldId];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

/** Extracts the status transitions (field === 'status') from an issue's changelog, as {toStatusId, atIso}. */
function readTransitions(issue: RawIssue): PersonalFlowTransition[] {
  const transitions: PersonalFlowTransition[] = [];
  for (const history of issue.changelog?.histories ?? []) {
    if (typeof history.created !== 'string') {
      continue;
    }
    for (const item of history.items ?? []) {
      if (item.field === 'status' && item.to != null) {
        transitions.push({ toStatusId: String(item.to), atIso: history.created });
      }
    }
  }
  return transitions;
}

/** Maps a raw Jira issue to the compute core's issue shape. */
function toPersonalFlowIssue(issue: RawIssue): PersonalFlowIssue {
  const fields = issue.fields ?? {};
  return {
    key: issue.key ?? '',
    summary: fields.summary ?? issue.key ?? '',
    storyPoints: readStoryPoints(fields),
    resolvedIso: fields.resolutiondate ?? null,
    transitions: readTransitions(issue),
  };
}

/** Builds the closed-issue search path for one person over a window, expanding the changelog. */
function buildSearchPath(person: string, windowDays: number): string {
  const jql = `assignee = "${person}" AND statusCategory = Done AND resolved >= -${windowDays}d ORDER BY resolved DESC`;
  const fields = ['summary', 'resolutiondate', 'status', 'assignee', ...STORY_POINTS_FIELD_IDS].join(',');
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&expand=changelog&fields=${fields}&maxResults=${MAX_ISSUES}`;
}

/** Formats a rate/number for display with up to two decimals (integers stay whole). */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** One labelled statistic; label and value are siblings so the value reads independently of the label. */
function StatCard({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 12px', minWidth: 130 }}>
      <div style={{ fontSize: 11, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

/** Renders the throughput, cycle-time, and volume cards plus the per-issue breakdown table. */
function PersonalFlowResultView({ result }: { result: PersonalFlowResult }): React.JSX.Element {
  const { throughput, cycleTime } = result;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <StatCard label="Issues / Day" value={formatNumber(throughput.issuesPerDay)} />
        <StatCard label="Issues / Week" value={formatNumber(throughput.issuesPerWeek)} />
        <StatCard label="Issues / 2 Weeks" value={formatNumber(throughput.issuesPerTwoWeeks)} />
        <StatCard label="Points / Day" value={formatNumber(throughput.pointsPerDay)} />
        <StatCard label="Points / Week" value={formatNumber(throughput.pointsPerWeek)} />
        <StatCard label="Points / 2 Weeks" value={formatNumber(throughput.pointsPerTwoWeeks)} />
        <StatCard label="Avg Cycle Time (days)" value={cycleTime.averageDays === null ? '—' : formatNumber(cycleTime.averageDays)} />
        <StatCard label="Median Cycle Time (days)" value={cycleTime.medianDays === null ? '—' : formatNumber(cycleTime.medianDays)} />
        <StatCard label="Issues Closed" value={String(result.issueCount)} />
        <StatCard label="Story Points Closed" value={formatNumber(result.totalStoryPoints)} />
        <StatCard label="Issues With Cycle Time" value={`${cycleTime.countWithCycleTime} of ${result.issueCount}`} />
      </div>

      {result.perIssue.length === 0 ? (
        <p style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>No closed issues for this person in the selected window.</p>
      ) : (
        <table style={{ marginTop: 12, width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.7 }}>
              <th>Issue</th><th>Summary</th><th>Resolved</th><th>Cycle (days)</th><th>Points</th>
            </tr>
          </thead>
          <tbody>
            {result.perIssue.map((issue) => (
              <tr key={issue.key} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td>{issue.key}</td>
                <td>{issue.summary}</td>
                <td>{issue.resolvedIso === null ? '—' : issue.resolvedIso.slice(0, 10)}</td>
                <td>{issue.cycleTimeDays === null ? '—' : formatNumber(issue.cycleTimeDays)}</td>
                <td>{issue.storyPoints === null ? '—' : formatNumber(issue.storyPoints)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** The Personal Flow report tab: pick a person + window, run, and read their throughput + cycle time. */
export function PersonalFlowTab(): React.JSX.Element {
  const [person, setPerson] = useState('');
  const [windowDays, setWindowDays] = useState(DEFAULT_WINDOW_DAYS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PersonalFlowResult | null>(null);

  const runReport = async (): Promise<void> => {
    const trimmedPerson = person.trim();
    if (trimmedPerson === '') {
      return;
    }
    setIsLoading(true);
    setError(null);
    setResult(null);
    try {
      const statuses = await jiraGet<RawStatus[]>('/rest/api/2/status');
      const statusCategoryByStatusId = buildStatusCategoryMap(Array.isArray(statuses) ? statuses : []);
      const searchResponse = await jiraGet<{ issues?: RawIssue[] }>(buildSearchPath(trimmedPerson, windowDays));
      const issues = (searchResponse.issues ?? []).map(toPersonalFlowIssue);
      // The clock read is fine here (the pure engine takes today as an argument, staying deterministic).
      const todayIso = new Date().toISOString().slice(0, 10);
      setResult(computePersonalFlow({ issues, statusCategoryByStatusId, windowDays, todayIso }));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to build the personal flow report.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ padding: '8px 4px' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, gap: 4 }}>
          Person (Jira assignee)
          <input
            value={person}
            onChange={(event) => setPerson(event.target.value)}
            placeholder="e.g. Rajaram, Rajasekar"
            style={{ minWidth: 220 }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, gap: 4 }}>
          Lookback window
          <select value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))}>
            {WINDOW_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void runReport()} disabled={person.trim() === '' || isLoading}>
          {isLoading ? 'Running…' : 'Run report'}
        </button>
      </div>

      {error !== null && (
        <p role="alert" style={{ marginTop: 10, fontSize: 12, color: 'var(--color-danger)' }}>{error}</p>
      )}

      {result !== null && result.issueCount === MAX_ISSUES && (
        <p style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>
          Showing the most recent {MAX_ISSUES} closed issues — narrow the window for a complete picture.
        </p>
      )}

      {result !== null && <PersonalFlowResultView result={result} />}
    </div>
  );
}
