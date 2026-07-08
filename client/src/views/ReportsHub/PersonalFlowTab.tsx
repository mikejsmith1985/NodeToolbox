// PersonalFlowTab.tsx — Per-person throughput + cycle-time report for the Reports Hub.
//
// Given one Jira assignee and a lookback window, this fetches their closed issues (with changelog)
// and the instance's status→category map, then feeds the pure `computePersonalFlow` core to show how
// much they complete per day / week / two weeks (issues AND story points) and how long work takes from
// the first In-Progress status category to Done. It is read-only — it never writes to Jira.

import { useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../services/jiraApi.ts';
import { useSettingsStore } from '../../store/settingsStore.ts';
import {
  filterRosterMembersByActiveTeam,
  type StandupRosterMember,
  useStandupRosterStore,
} from '../SprintDashboard/hooks/useStandupRosterStore.ts';
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

// Smallest typed query that triggers a Jira user search — one or two letters match too much to be useful.
const MIN_USER_SEARCH_LENGTH = 2;
// How long to wait after the last keystroke before firing the Jira user search, so typing is not blocked.
const USER_SEARCH_DEBOUNCE_MS = 300;
// Cap on Jira user-search suggestions requested per keystroke; the roster matches are shown alongside these.
const MAX_USER_SEARCH_RESULTS = 20;

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

// ── Person search (roster + Jira) ────────────────────────────────────────────

/** The minimal Jira user fields the assignee search returns and this tab reads. */
interface RawJiraUser { displayName?: string; name?: string; accountId?: string }

/** A single person the picker can offer, with the value to write into the assignee field when chosen. */
interface PersonSuggestion {
  key: string;
  label: string; // human name shown in the dropdown
  assigneeValue: string; // what the JQL `assignee = "…"` clause expects
  sourceLabel: string; // 'Roster' or 'Jira', so the user knows where a match came from
}

/**
 * A per-person row of the team comparison table: either a computed flow result or an inline error.
 * A single person's fetch failing produces an error row instead of aborting the whole team run.
 */
interface TeamFlowRow {
  personDisplayName: string;
  result: PersonalFlowResult | null;
  errorMessage: string | null;
}

/**
 * Searches Jira for users matching the typed text. Jira Server expects `username=` while Jira Cloud
 * expects `query=`, so this mirrors the roster search: try `username=` first and fall back to `query=`
 * when it yields nothing. The search is a convenience, so any error is swallowed to an empty list and
 * never blocks typing.
 */
async function searchJiraUsers(query: string): Promise<RawJiraUser[]> {
  const byUsername = await jiraGet<RawJiraUser[] | null>(
    `/rest/api/2/user/search?username=${encodeURIComponent(query)}&maxResults=${MAX_USER_SEARCH_RESULTS}`,
  ).catch(() => null);
  const usernameUsers = Array.isArray(byUsername) ? byUsername : [];
  if (usernameUsers.length > 0) {
    return usernameUsers;
  }

  const byQuery = await jiraGet<RawJiraUser[] | null>(
    `/rest/api/2/user/search?query=${encodeURIComponent(query)}&maxResults=${MAX_USER_SEARCH_RESULTS}`,
  ).catch(() => null);
  return Array.isArray(byQuery) ? byQuery : [];
}

/** Builds roster suggestions whose display name or assignee value contains the typed text (case-insensitive). */
function buildRosterSuggestionMatches(
  rosterMembers: readonly StandupRosterMember[],
  typedText: string,
): PersonSuggestion[] {
  const needle = typedText.trim().toLowerCase();
  if (needle === '') {
    return [];
  }
  return rosterMembers
    .filter((rosterMember) =>
      rosterMember.displayName.toLowerCase().includes(needle)
      || rosterMember.assigneeQueryValue.toLowerCase().includes(needle))
    .map((rosterMember) => ({
      key: `roster:${rosterMember.id}`,
      label: rosterMember.displayName,
      assigneeValue: rosterMember.assigneeQueryValue,
      sourceLabel: 'Roster',
    }));
}

/** Maps raw Jira user-search results to picker suggestions, using the display name as the assignee value. */
function mapJiraUsersToSuggestions(jiraUsers: readonly RawJiraUser[]): PersonSuggestion[] {
  const suggestions: PersonSuggestion[] = [];
  for (const jiraUser of jiraUsers) {
    const assigneeValue = (jiraUser.displayName ?? jiraUser.name ?? '').trim();
    if (assigneeValue === '') {
      continue;
    }
    suggestions.push({
      key: `jira:${jiraUser.accountId ?? jiraUser.name ?? assigneeValue}`,
      label: assigneeValue,
      assigneeValue,
      sourceLabel: 'Jira',
    });
  }
  return suggestions;
}

/** Merges roster and Jira suggestions, keeping the roster entry first and dropping duplicate assignee values. */
function buildPersonSuggestions(
  rosterMatches: readonly PersonSuggestion[],
  jiraMatches: readonly PersonSuggestion[],
): PersonSuggestion[] {
  const mergedSuggestions: PersonSuggestion[] = [];
  const seenAssigneeValues = new Set<string>();
  for (const suggestion of [...rosterMatches, ...jiraMatches]) {
    const dedupeKey = suggestion.assigneeValue.trim().toLowerCase();
    if (dedupeKey === '' || seenAssigneeValues.has(dedupeKey)) {
      continue;
    }
    seenAssigneeValues.add(dedupeKey);
    mergedSuggestions.push(suggestion);
  }
  return mergedSuggestions;
}

/**
 * Fetches and computes one roster member's flow for the team comparison. A fetch failure is captured
 * as an error row (never thrown) so one unreachable person cannot abort the whole team run.
 */
async function buildTeamFlowRow(
  rosterMember: StandupRosterMember,
  statusCategoryByStatusId: Record<string, string>,
  windowDays: number,
  todayIso: string,
): Promise<TeamFlowRow> {
  try {
    const searchResponse = await jiraGet<{ issues?: RawIssue[] }>(
      buildSearchPath(rosterMember.assigneeQueryValue, windowDays),
    );
    const issues = (searchResponse.issues ?? []).map(toPersonalFlowIssue);
    const result = computePersonalFlow({ issues, statusCategoryByStatusId, windowDays, todayIso });
    return { personDisplayName: rosterMember.displayName, result, errorMessage: null };
  } catch (caughtError) {
    return {
      personDisplayName: rosterMember.displayName,
      result: null,
      errorMessage: caughtError instanceof Error ? caughtError.message : 'Failed to build this person’s flow.',
    };
  }
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

/** A dropdown of person suggestions (roster + Jira) rendered under the person field; each is selectable. */
function PersonSuggestionsDropdown({
  suggestions,
  onSelect,
}: {
  suggestions: readonly PersonSuggestion[];
  onSelect: (assigneeValue: string) => void;
}): React.JSX.Element {
  return (
    <ul
      role="listbox"
      aria-label="Person suggestions"
      style={{
        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, margin: '2px 0 0', padding: 4,
        listStyle: 'none', maxHeight: 220, overflowY: 'auto', background: 'var(--color-surface, #fff)',
        border: '1px solid var(--color-border)', borderRadius: 6,
      }}
    >
      {suggestions.map((suggestion) => (
        <li
          key={suggestion.key}
          role="option"
          aria-selected={false}
          onClick={() => onSelect(suggestion.assigneeValue)}
          style={{ cursor: 'pointer', padding: '4px 8px', display: 'flex', justifyContent: 'space-between', gap: 8 }}
        >
          <span>{suggestion.label}</span>
          <span style={{ fontSize: 10, opacity: 0.6 }}>{suggestion.sourceLabel}</span>
        </li>
      ))}
    </ul>
  );
}

/** Renders one comparison-table row: a full metrics row, or the person's name plus an inline error. */
function TeamFlowComparisonRow({ row }: { row: TeamFlowRow }): React.JSX.Element {
  if (row.result === null) {
    return (
      <tr style={{ borderTop: '1px solid var(--color-border)' }}>
        <td>{row.personDisplayName}</td>
        <td colSpan={6} style={{ color: 'var(--color-danger)' }}>{row.errorMessage ?? 'No result.'}</td>
      </tr>
    );
  }

  const { throughput, cycleTime } = row.result;
  return (
    <tr style={{ borderTop: '1px solid var(--color-border)' }}>
      <td>{row.personDisplayName}</td>
      <td>{String(row.result.issueCount)}</td>
      <td>{formatNumber(row.result.totalStoryPoints)}</td>
      <td>{formatNumber(throughput.issuesPerWeek)}</td>
      <td>{formatNumber(throughput.pointsPerWeek)}</td>
      <td>{cycleTime.averageDays === null ? '—' : formatNumber(cycleTime.averageDays)}</td>
      <td>{cycleTime.medianDays === null ? '—' : formatNumber(cycleTime.medianDays)}</td>
    </tr>
  );
}

/** The side-by-side team comparison table: one row per roster member, distinct from the single-person view. */
function TeamFlowComparisonView({ rows }: { rows: readonly TeamFlowRow[] }): React.JSX.Element {
  return (
    <table style={{ marginTop: 12, width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ textAlign: 'left', opacity: 0.7 }}>
          <th>Person</th><th>Issues</th><th>Points</th><th>Issues/Wk</th>
          <th>Points/Wk</th><th>Avg Cycle (days)</th><th>Median Cycle (days)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => <TeamFlowComparisonRow key={row.personDisplayName} row={row} />)}
      </tbody>
    </table>
  );
}

/** The Personal Flow report tab: pick a person + window, run, and read their throughput + cycle time. */
export function PersonalFlowTab(): React.JSX.Element {
  const [person, setPerson] = useState('');
  const [windowDays, setWindowDays] = useState(DEFAULT_WINDOW_DAYS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PersonalFlowResult | null>(null);
  const [areSuggestionsOpen, setAreSuggestionsOpen] = useState(false);
  const [jiraUserSuggestions, setJiraUserSuggestions] = useState<RawJiraUser[]>([]);
  const [teamRows, setTeamRows] = useState<TeamFlowRow[]>([]);
  const [isTeamLoading, setIsTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);

  // The active-team roster drives both the suggestion list and the "Run for team roster" mode. It is read
  // the same way RosterTab does: the persisted active team name filters the shared standup roster store.
  const rosterMembers = useStandupRosterStore((state) => state.rosterMembers);
  const storedActiveTeamName = useSettingsStore((state) => state.sprintDashboardActiveTeam);
  const activeTeamRosterMembers = useMemo(
    () => filterRosterMembersByActiveTeam(rosterMembers, storedActiveTeamName, { includeTeamlessMembers: true }),
    [rosterMembers, storedActiveTeamName],
  );

  const personSuggestions = useMemo(
    () => buildPersonSuggestions(
      buildRosterSuggestionMatches(activeTeamRosterMembers, person),
      mapJiraUsersToSuggestions(jiraUserSuggestions),
    ),
    [activeTeamRosterMembers, person, jiraUserSuggestions],
  );

  // Debounce the Jira user search so every keystroke does not fire a request; the roster matches remain
  // instant. The effect self-cancels on the next keystroke or unmount so a stale response cannot land.
  useEffect(() => {
    const trimmedQuery = person.trim();
    if (trimmedQuery.length < MIN_USER_SEARCH_LENGTH) {
      setJiraUserSuggestions([]);
      return;
    }
    let isEffectActive = true;
    const debounceTimerId = setTimeout(() => {
      void searchJiraUsers(trimmedQuery).then((jiraUsers) => {
        if (isEffectActive) {
          setJiraUserSuggestions(jiraUsers);
        }
      });
    }, USER_SEARCH_DEBOUNCE_MS);
    return () => {
      isEffectActive = false;
      clearTimeout(debounceTimerId);
    };
  }, [person]);

  const handlePersonChange = (nextPerson: string): void => {
    setPerson(nextPerson);
    setAreSuggestionsOpen(true);
  };

  const handleSelectSuggestion = (assigneeValue: string): void => {
    setPerson(assigneeValue);
    setAreSuggestionsOpen(false);
  };

  const runReport = async (): Promise<void> => {
    const trimmedPerson = person.trim();
    if (trimmedPerson === '') {
      return;
    }
    setAreSuggestionsOpen(false);
    setIsLoading(true);
    setError(null);
    setResult(null);
    setTeamRows([]); // a fresh single-person run clears the team comparison so the two views never collide
    setTeamError(null);
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

  const runTeamReport = async (): Promise<void> => {
    if (activeTeamRosterMembers.length === 0) {
      return;
    }
    setAreSuggestionsOpen(false);
    setIsTeamLoading(true);
    setTeamError(null);
    setResult(null); // a fresh team run clears the single-person view so the two never show at once
    setError(null);
    setTeamRows([]);
    try {
      const statuses = await jiraGet<RawStatus[]>('/rest/api/2/status');
      const statusCategoryByStatusId = buildStatusCategoryMap(Array.isArray(statuses) ? statuses : []);
      const todayIso = new Date().toISOString().slice(0, 10);
      const nextTeamRows: TeamFlowRow[] = [];
      // Sequential per-person fetches keep the load gentle on Jira; each is independent and self-contained.
      for (const rosterMember of activeTeamRosterMembers) {
        nextTeamRows.push(await buildTeamFlowRow(rosterMember, statusCategoryByStatusId, windowDays, todayIso));
      }
      setTeamRows(nextTeamRows);
    } catch (caughtError) {
      setTeamError(caughtError instanceof Error ? caughtError.message : 'Failed to build the team flow report.');
    } finally {
      setIsTeamLoading(false);
    }
  };

  const isSuggestionsVisible = areSuggestionsOpen && person.trim() !== '' && personSuggestions.length > 0;

  return (
    <div style={{ padding: '8px 4px' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ position: 'relative', display: 'flex', flexDirection: 'column', fontSize: 12, gap: 4 }}>
          Person (Jira assignee)
          <input
            value={person}
            onChange={(event) => handlePersonChange(event.target.value)}
            onFocus={() => setAreSuggestionsOpen(true)}
            placeholder="e.g. Rajaram, Rajasekar"
            style={{ minWidth: 220 }}
          />
          {isSuggestionsVisible && (
            <PersonSuggestionsDropdown suggestions={personSuggestions} onSelect={handleSelectSuggestion} />
          )}
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, gap: 4 }}>
          Lookback window
          <select value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))}>
            {WINDOW_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void runReport()}
          disabled={person.trim() === '' || isLoading || isTeamLoading}
        >
          {isLoading ? 'Running…' : 'Run report'}
        </button>
        <button
          type="button"
          onClick={() => void runTeamReport()}
          disabled={activeTeamRosterMembers.length === 0 || isLoading || isTeamLoading}
          title={activeTeamRosterMembers.length === 0 ? 'Add roster members for the active team first' : undefined}
        >
          {isTeamLoading ? 'Running team…' : 'Run for team roster'}
        </button>
      </div>

      {error !== null && (
        <p role="alert" style={{ marginTop: 10, fontSize: 12, color: 'var(--color-danger)' }}>{error}</p>
      )}

      {teamError !== null && (
        <p role="alert" style={{ marginTop: 10, fontSize: 12, color: 'var(--color-danger)' }}>{teamError}</p>
      )}

      {result !== null && result.issueCount === MAX_ISSUES && (
        <p style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>
          Showing the most recent {MAX_ISSUES} closed issues — narrow the window for a complete picture.
        </p>
      )}

      {result !== null && <PersonalFlowResultView result={result} />}

      {isTeamLoading && teamRows.length === 0 && (
        <p style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>Building the team comparison…</p>
      )}

      {teamRows.length > 0 && <TeamFlowComparisonView rows={teamRows} />}
    </div>
  );
}
