// PersonalFlowTab.tsx — Per-person throughput + hands-on cycle-time report for the Reports Hub.
//
// Given one Jira person and a lookback window, this fetches every issue she was ever the assignee of
// within the window (with changelog) plus the instance's status→category map, then feeds the pure
// `computePersonalFlow` core. Cycle time credits her HANDS-ON in-progress working time per issue —
// reassignment-aware, in Mon–Fri days — and throughput credits every issue she moved forward, not just
// tickets she personally closed. It is read-only — it never writes to Jira.

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
  type PersonalFlowExclusionReason,
  type PersonalFlowIssue,
  type PersonalFlowOwnershipTransition,
  type PersonalFlowResult,
  type PersonalFlowStatusTransition,
} from './personalFlow.ts';

// Story-points custom fields this instance uses; 10236 is primary, the rest are fallbacks. First numeric wins.
const STORY_POINTS_FIELD_IDS: readonly string[] = ['customfield_10236', 'customfield_10016', 'customfield_10028'];
// One page of up to this many issues — plenty for a personal report; flagged when it caps out.
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
interface RawAssignee { displayName?: string; name?: string; key?: string; accountId?: string }
// A changelog item's `from`/`to` carry the account id (Cloud) or username (Server); the *String variants
// carry the display name. `toString`/`fromString` may be absent, so they are read defensively as unknown.
interface RawChangeItem { field?: string; from?: string | number | null; to?: string | number | null }
interface RawHistory { created?: string; items?: RawChangeItem[] }
interface RawIssue {
  key?: string;
  fields?: Record<string, unknown> & {
    summary?: string;
    created?: string | null;
    resolutiondate?: string | null;
    status?: { id?: string };
    assignee?: RawAssignee | null;
  };
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

/**
 * A person's full identity: the machine id used to build the JQL query, plus the normalized set of
 * every identifier Jira might store for them (username, user key, display name, accountId). Ownership
 * matching tests changelog values against this WHOLE set — critical on Jira Server, where a changelog's
 * `to`/`from` is a user KEY (e.g. JIRAUSER10100) while `toString`/`fromString` is the DISPLAY NAME, so
 * the username alone matches neither side and the person would be wrongly judged to never own the issue.
 */
interface PersonIdentity {
  queryValue: string; // the machine id (username or accountId) the JQL `assignee WAS "…"` clause uses
  identifiers: Set<string>; // normalized username, user key, display name, accountId — any may appear in a changelog
}

/**
 * Reports whether a changelog/assignee value pair matches the target identity. The machine side
 * (`to`/`from`, or an assignee's name/key/accountId) and the human side (`toString`/`fromString`, or an
 * assignee's display name) are each normalized and tested against the identity's identifier set. This is
 * what fixes the mis-attribution: a KEY on the machine side or a DISPLAY NAME on the human side both count.
 */
function identityMatches(identity: PersonIdentity, machineValue: unknown, displayValue: unknown): boolean {
  return matchesIdentity(identity, machineValue) || matchesIdentity(identity, displayValue);
}

/** Normalizes a single candidate value and reports whether it is one of the identity's known identifiers. */
function matchesIdentity(identity: PersonIdentity, candidate: unknown): boolean {
  if (typeof candidate !== 'string') return false;
  const normalized = normalizeForComparison(candidate);
  return normalized !== '' && identity.identifiers.has(normalized);
}

/** Adds a normalized, non-empty identifier to the set; ignores non-strings and blanks so the set stays clean. */
function addIdentifier(identifiers: Set<string>, rawIdentifier: unknown): void {
  if (typeof rawIdentifier !== 'string') return;
  const normalized = normalizeForComparison(rawIdentifier);
  if (normalized !== '') identifiers.add(normalized);
}

/** Reads a possibly-absent string property (e.g. `toString`) from a changelog item without hitting the prototype. */
function readChangeItemText(item: RawChangeItem, propertyName: 'fromString' | 'toString'): string | undefined {
  const value = (item as Record<string, unknown>)[propertyName];
  return typeof value === 'string' ? value : undefined;
}

/** Returns the changelog histories with a valid timestamp, sorted oldest → newest by their `created` time. */
function readSortedHistories(issue: RawIssue): RawHistory[] {
  return (issue.changelog?.histories ?? [])
    .filter((history): history is RawHistory & { created: string } => typeof history.created === 'string')
    .sort((first, second) => Date.parse(first.created) - Date.parse(second.created));
}

/** Reconstructs the status-category inputs: each status change and the issue's status at creation. */
function readStatusHistory(
  histories: readonly RawHistory[],
  fields: RawIssue['fields'],
): Pick<PersonalFlowIssue, 'initialStatusId' | 'statusTransitions'> {
  const statusTransitions: PersonalFlowStatusTransition[] = [];
  let initialStatusId: string | null = null;
  let hasStatusChange = false;
  for (const history of histories) {
    for (const item of history.items ?? []) {
      if (item.field !== 'status') continue;
      if (!hasStatusChange) {
        initialStatusId = item.from != null ? String(item.from) : null; // status the issue was created in
        hasStatusChange = true;
      }
      if (item.to != null) statusTransitions.push({ toStatusId: String(item.to), atIso: history.created ?? '' });
    }
  }
  if (!hasStatusChange) initialStatusId = fields?.status?.id ?? null; // no changes -> still in its current status
  return { initialStatusId, statusTransitions };
}

/** Reconstructs the ownership inputs relative to the target: each assignee change and who held it at creation. */
function readOwnershipHistory(
  histories: readonly RawHistory[],
  fields: RawIssue['fields'],
  identity: PersonIdentity,
): Pick<PersonalFlowIssue, 'initiallyAssignedToTarget' | 'ownershipTransitions'> {
  const ownershipTransitions: PersonalFlowOwnershipTransition[] = [];
  let firstAssigneeItem: RawChangeItem | null = null;
  for (const history of histories) {
    for (const item of history.items ?? []) {
      if (item.field !== 'assignee') continue;
      if (firstAssigneeItem === null) firstAssigneeItem = item;
      // The machine side (`to`) may be a user KEY; the human side (`toString`) the display name — match either.
      const assignedToTarget = identityMatches(identity, item.to, readChangeItemText(item, 'toString'));
      ownershipTransitions.push({ assignedToTarget, atIso: history.created ?? '' });
    }
  }
  return {
    initiallyAssignedToTarget: readInitialAssignment(firstAssigneeItem, fields?.assignee ?? null, identity),
    ownershipTransitions,
  };
}

/**
 * Decides whether the target held the issue at creation: from the FIRST assignee change's `from` side
 * when any change exists, otherwise from the CURRENT assignee (the issue was never reassigned).
 */
function readInitialAssignment(
  firstAssigneeItem: RawChangeItem | null,
  currentAssignee: RawAssignee | null,
  identity: PersonIdentity,
): boolean {
  if (firstAssigneeItem !== null) {
    return identityMatches(identity, firstAssigneeItem.from, readChangeItemText(firstAssigneeItem, 'fromString'));
  }
  if (currentAssignee === null) return false;
  const currentMachineId = currentAssignee.name ?? currentAssignee.key ?? currentAssignee.accountId;
  return identityMatches(identity, currentMachineId, currentAssignee.displayName);
}

/** Maps a raw Jira issue to the compute core's issue shape, resolving ownership relative to `identity`. */
function toPersonalFlowIssue(issue: RawIssue, identity: PersonIdentity): PersonalFlowIssue {
  const fields = issue.fields ?? {};
  const histories = readSortedHistories(issue);
  return {
    key: issue.key ?? '',
    summary: fields.summary ?? issue.key ?? '',
    storyPoints: readStoryPoints(fields),
    createdIso: fields.created ?? null,
    ...readStatusHistory(histories, fields),
    ...readOwnershipHistory(histories, fields, identity),
  };
}

/**
 * Builds the search path for every issue the person was ever assigned to within the window.
 * `assignee WAS` (not `=`) captures work she has since handed off; `updated >= -Nd` is a cheap superset —
 * the engine does the exact windowing by each completed stint's end, so an over-broad fetch is harmless.
 */
function buildSearchPath(person: string, windowDays: number): string {
  const jql = `assignee WAS "${person}" AND updated >= -${windowDays}d ORDER BY updated DESC`;
  const fields = ['summary', 'created', 'assignee', 'status', 'resolutiondate', ...STORY_POINTS_FIELD_IDS].join(',');
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&expand=changelog&fields=${fields}&maxResults=${MAX_ISSUES}`;
}

/** Formats a rate/number for display with up to two decimals (integers stay whole). */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

// ── Person search (roster + Jira) ────────────────────────────────────────────

/** The minimal Jira user fields the assignee search returns and this tab reads (Server includes `key`). */
interface RawJiraUser { displayName?: string; name?: string; key?: string; accountId?: string }

/** A single person the picker can offer, carrying the full identity to use when chosen. */
interface PersonSuggestion {
  key: string;
  label: string; // human name shown in the dropdown (always the friendly display name)
  identity: PersonIdentity; // the built identity (query value + identifier set) this suggestion resolves to
  isResolved: boolean; // true when `identity.queryValue` is a real machine id ready to query without a further lookup
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

/** Collapses internal whitespace runs to a single space and lowercases, for tolerant name comparison. */
function normalizeForComparison(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Builds a full identity from a Jira user object. The JQL query value prefers the Server username, then
 * the Cloud accountId, then the display name as a last resort; the identifier set collects every non-empty
 * form (username, user key, display name, accountId) so ownership matching succeeds whichever one a
 * changelog stored.
 */
function buildIdentityFromJiraUser(user: RawJiraUser): PersonIdentity {
  const queryValue = user.name ?? user.accountId ?? user.displayName ?? '';
  const identifiers = new Set<string>();
  addIdentifier(identifiers, user.name);
  addIdentifier(identifiers, user.key);
  addIdentifier(identifiers, user.displayName);
  addIdentifier(identifiers, user.accountId);
  return { queryValue, identifiers };
}

/**
 * Builds an identity straight from a roster member, without touching Jira. The query value prefers the
 * stored Jira accountId (a real machine id) and falls back to the roster's assignee query value; the
 * identifier set collects the accountId, the assignee query value, and the display name.
 */
function buildRosterIdentity(member: StandupRosterMember): PersonIdentity {
  const queryValue = member.jiraAccountId ?? member.assigneeQueryValue;
  const identifiers = new Set<string>();
  addIdentifier(identifiers, member.jiraAccountId);
  addIdentifier(identifiers, member.assigneeQueryValue);
  addIdentifier(identifiers, member.displayName);
  return { queryValue, identifiers };
}

/**
 * Resolves a person's DISPLAY NAME (or username) to a full Jira identity the assignee field can match.
 *
 * Jira rejects a display name in an `assignee WAS "…"` clause (it wants a Server username or a Cloud
 * accountId), so a free-typed or roster display string must be translated before it is queried. It
 * searches Jira for the person, prefers the candidate whose username or display name matches exactly
 * (whitespace-collapsed, case-insensitive), and otherwise takes the first result. Returns null when no
 * user matches at all so the caller can show a friendly message without firing a search.
 */
async function resolvePersonIdentity(person: string): Promise<PersonIdentity | null> {
  const candidates = await searchJiraUsers(person);
  if (candidates.length === 0) {
    return null;
  }
  const needle = normalizeForComparison(person);
  const exactMatch = candidates.find(
    (candidate) =>
      normalizeForComparison(candidate.name ?? '') === needle
      || normalizeForComparison(candidate.displayName ?? '') === needle,
  );
  return buildIdentityFromJiraUser(exactMatch ?? candidates[0]);
}

/**
 * Resolves the identity to query a roster member by. When the member carries a real Jira accountId that
 * machine id is trusted directly; otherwise the member's assignee value is resolved against Jira so the
 * JQL gets a real machine id, falling back to the roster identity only when Jira finds no match.
 */
async function resolveRosterIdentity(member: StandupRosterMember): Promise<PersonIdentity | null> {
  if (member.jiraAccountId !== undefined && member.jiraAccountId.trim() !== '') {
    return buildRosterIdentity(member);
  }
  const resolved = await resolvePersonIdentity(member.assigneeQueryValue);
  const identity = resolved ?? buildRosterIdentity(member);
  // A member with no accountId, no Jira match, and a blank assignee value has nothing to query by.
  return identity.queryValue.trim() === '' ? null : identity;
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
      identity: buildRosterIdentity(rosterMember),
      // Ready to query directly only when the roster stored a real Jira machine id; else resolve at run.
      isResolved: Boolean(rosterMember.jiraAccountId),
      sourceLabel: 'Roster',
    }));
}

/** Maps raw Jira user-search results to picker suggestions, carrying each user's machine id for querying. */
function mapJiraUsersToSuggestions(jiraUsers: readonly RawJiraUser[]): PersonSuggestion[] {
  const suggestions: PersonSuggestion[] = [];
  for (const jiraUser of jiraUsers) {
    const displayName = (jiraUser.displayName ?? jiraUser.name ?? '').trim();
    if (displayName === '') {
      continue;
    }
    // A Server username or Cloud accountId means the identity is ready to query without a further lookup.
    const hasMachineId = Boolean(jiraUser.name ?? jiraUser.accountId);
    suggestions.push({
      key: `jira:${jiraUser.accountId ?? jiraUser.name ?? displayName}`,
      label: displayName,
      identity: buildIdentityFromJiraUser(jiraUser),
      isResolved: hasMachineId,
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
  const seenQueryValues = new Set<string>();
  for (const suggestion of [...rosterMatches, ...jiraMatches]) {
    const dedupeKey = suggestion.identity.queryValue.trim().toLowerCase();
    if (dedupeKey === '' || seenQueryValues.has(dedupeKey)) {
      continue;
    }
    seenQueryValues.add(dedupeKey);
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
    // Resolve the member to a full identity: trust a stored accountId, else look the name up in Jira.
    const identity = await resolveRosterIdentity(rosterMember);
    if (identity === null) {
      return { personDisplayName: rosterMember.displayName, result: null, errorMessage: 'No matching Jira user' };
    }
    const searchResponse = await jiraGet<{ issues?: RawIssue[] }>(buildSearchPath(identity.queryValue, windowDays));
    const issues = (searchResponse.issues ?? []).map((issue) => toPersonalFlowIssue(issue, identity));
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

/** Human-friendly, non-technical label for each exclusion reason, shown in the issue-audit table. */
const EXCLUSION_REASON_LABELS: Record<PersonalFlowExclusionReason, string> = {
  'not-owned': 'Not matched to this person',
  'wip-open': 'In progress, still assigned (WIP)',
  'no-in-progress-time': 'No in-progress time recorded',
  'completed-out-of-window': 'Completed before the window',
};

/**
 * A transparency section under the single-person result: it names how many fetched issues were
 * credited versus excluded, then lists each excluded issue with the plain-English reason it was
 * dropped — so a reviewer can confirm no genuine contribution was silently lost.
 */
function IssueAuditSection({ result }: { result: PersonalFlowResult }): React.JSX.Element {
  return (
    <section style={{ marginTop: 16 }}>
      <h4 style={{ fontSize: 12, opacity: 0.7, fontWeight: 600, margin: '0 0 6px' }}>Issue audit</h4>
      <p style={{ fontSize: 12, opacity: 0.7, margin: '0 0 8px' }}>
        Credited {result.issueCount} · Excluded {result.excludedIssues.length}
      </p>
      {result.excludedIssues.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.6 }}>
              <th>Issue</th><th>Summary</th><th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {result.excludedIssues.map((excludedIssue) => (
              <tr key={excludedIssue.key} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td>{excludedIssue.key}</td>
                <td>{excludedIssue.summary}</td>
                <td>{EXCLUSION_REASON_LABELS[excludedIssue.reason]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
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
        <StatCard label="Issues Advanced" value={String(result.issueCount)} />
        <StatCard label="Story Points" value={formatNumber(result.totalStoryPoints)} />
        <StatCard label="Issues With Cycle Time" value={`${cycleTime.countWithCycleTime} of ${result.issueCount}`} />
      </div>

      {result.perIssue.length === 0 ? (
        <p style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>No issues this person advanced in the selected window.</p>
      ) : (
        <table style={{ marginTop: 12, width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.7 }}>
              <th>Issue</th><th>Summary</th><th>Last active</th><th>Hands-on (days)</th><th>Points</th>
            </tr>
          </thead>
          <tbody>
            {result.perIssue.map((issue) => (
              <tr key={issue.key} style={{ borderTop: '1px solid var(--color-border)' }}>
                <td>{issue.key}</td>
                <td>{issue.summary}</td>
                <td>{issue.lastActiveIso === null ? '—' : issue.lastActiveIso.slice(0, 10)}</td>
                <td>{issue.cycleTimeDays === null ? '—' : formatNumber(issue.cycleTimeDays)}</td>
                <td>{issue.storyPoints === null ? '—' : formatNumber(issue.storyPoints)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <IssueAuditSection result={result} />
    </div>
  );
}

/** A dropdown of person suggestions (roster + Jira) rendered under the person field; each is selectable. */
function PersonSuggestionsDropdown({
  suggestions,
  onSelect,
}: {
  suggestions: readonly PersonSuggestion[];
  onSelect: (suggestion: PersonSuggestion) => void;
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
          onClick={() => onSelect(suggestion)}
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

/** The Personal Flow report tab: pick a person + window, run, and read their throughput + hands-on cycle time. */
export function PersonalFlowTab(): React.JSX.Element {
  const [person, setPerson] = useState('');
  const [windowDays, setWindowDays] = useState(DEFAULT_WINDOW_DAYS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PersonalFlowResult | null>(null);
  const [areSuggestionsOpen, setAreSuggestionsOpen] = useState(false);
  const [jiraUserSuggestions, setJiraUserSuggestions] = useState<RawJiraUser[]>([]);
  // The full identity resolved from a picked suggestion. Null means "resolve at run time" — free-typed
  // text is always a display name that must be looked up before it can be queried.
  const [selectedIdentity, setSelectedIdentity] = useState<PersonIdentity | null>(null);
  // A transparency line for the last single-person run: which machine id was queried and how many issues
  // were fetched, so the user can see resolution + fetch vs credited at a glance. Null hides the line.
  const [diagnostic, setDiagnostic] = useState<{ queryValue: string; rawIssueCount: number } | null>(null);
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
    // Free-typed text is a display name; drop any picked identity so Run looks the person up fresh.
    setSelectedIdentity(null);
    setAreSuggestionsOpen(true);
  };

  const handleSelectSuggestion = (suggestion: PersonSuggestion): void => {
    setPerson(suggestion.label); // show the friendly name in the field
    // Keep the identity only when it already carries a real machine id; otherwise resolve it at run time.
    setSelectedIdentity(suggestion.isResolved ? suggestion.identity : null);
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
    setDiagnostic(null);
    setTeamRows([]); // a fresh single-person run clears the team comparison so the two views never collide
    setTeamError(null);
    try {
      // Resolve the person to a full identity BEFORE querying — Jira rejects a display name for the
      // assignee field. A picked suggestion may already carry one; free-typed text is looked up here.
      const identity = selectedIdentity ?? await resolvePersonIdentity(trimmedPerson);
      if (identity === null) {
        setError(`No Jira user matches "${trimmedPerson}". Pick a name from the suggestions.`);
        return;
      }
      const statuses = await jiraGet<RawStatus[]>('/rest/api/2/status');
      const statusCategoryByStatusId = buildStatusCategoryMap(Array.isArray(statuses) ? statuses : []);
      const searchResponse = await jiraGet<{ issues?: RawIssue[] }>(buildSearchPath(identity.queryValue, windowDays));
      const rawIssues = searchResponse.issues ?? [];
      const issues = rawIssues.map((issue) => toPersonalFlowIssue(issue, identity));
      // The clock read is fine here (the pure engine takes today as an argument, staying deterministic).
      const todayIso = new Date().toISOString().slice(0, 10);
      setResult(computePersonalFlow({ issues, statusCategoryByStatusId, windowDays, todayIso }));
      setDiagnostic({ queryValue: identity.queryValue, rawIssueCount: rawIssues.length });
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
    setDiagnostic(null);
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
          Showing at most {MAX_ISSUES} issues — narrow the window for a complete picture.
        </p>
      )}

      {result !== null && diagnostic !== null && (
        <p style={{ marginTop: 8, fontSize: 11, opacity: 0.6 }}>
          Queried Jira as "{diagnostic.queryValue}" · fetched {diagnostic.rawIssueCount} issues · {result.issueCount} credited
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
