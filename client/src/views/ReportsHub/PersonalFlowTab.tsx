// PersonalFlowTab.tsx — Per-person throughput + hands-on cycle-time report for the Reports Hub.
//
// Given one Jira person and a lookback window, this fetches every issue she was ever the assignee of
// within the window (with changelog) plus the instance's status→category map, then feeds the pure
// `computePersonalFlow` core. Cycle time credits her HANDS-ON in-progress working time per issue —
// reassignment-aware, in Mon–Fri days — and throughput credits every issue she moved forward, not just
// tickets she personally closed. It is read-only — it never writes to Jira.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { jiraGet } from '../../services/jiraApi.ts';
import { copyToClipboard } from '../FeatureCanvas/ai/clipboard.ts';
// The audit report uses the RESULT-RETURNING copier: a silently failed copy of a long report means
// the user pastes stale clipboard content into Confluence and never finds out. The short JQL copies
// above keep the fire-and-forget helper.
import { copyToClipboard as copyToClipboardWithResult } from '../JiraTemplateMaker/lib/copyToClipboard.ts';
import { useSettingsStore } from '../../store/settingsStore.ts';
import { useConnectionStore } from '../../store/connectionStore.ts';
import { ReportAiPanel } from './ReportAiPanel.tsx';
import {
  buildPersonalFlowCoachingPrompt,
  parsePersonalFlowCoachingResponse,
  type PersonalFlowCoaching,
  type PersonalFlowCoachingInput,
} from './personalFlowCoaching.ts';
import styles from './ReportsHubView.module.css';
import {
  readStoredStandupRosterMembers,
  type RosterRoleCapabilities,
  type StandupRosterMember,
} from '../SprintDashboard/hooks/useStandupRosterStore.ts';
import { resolveReportRosterScope } from './rosterScope.ts';
import {
  computePersonalFlow,
  type PersonalFlowExclusionReason,
  type PersonalFlowIssue,
  type PersonalFlowOwnershipTransition,
  type PersonalFlowResult,
  type PersonalFlowStatusTransition,
} from './personalFlow.ts';
import { buildCreditedIssuesLink } from './flowAuditLinks.ts';
import { classifyIssueScope } from './issueScope.ts';
import { readBottleneckSettings, writeBottleneckSettings } from './internalTestingStatuses.ts';
import { readToolVersion } from './readToolVersion.ts';
import { computeDeliveryTotals } from './issueFlowRollup.ts';
import { buildFlowAuditDocument } from './flowAuditDocument.ts';
import {
  ISSUE_PAGE_SIZE,
  RUN_ISSUE_BUDGET,
  fetchAllUnitIssues,
  type FlowFetchCeiling,
} from './flowAuditFetch.ts';
import {
  rollUpThroughputByRole,
  TEAM_ROLE_DEFINITIONS,
  type RoleThroughput,
} from './personalFlowRoleRollup.ts';
import {
  computeInternalTestingBottleneck,
  type BottleneckIssueInput,
  type BottleneckStatusTransition,
  type InternalTestingBottleneckResult,
} from './internalTestingBottleneck.ts';
import {
  readConfiguredStoryPointsFieldId,
  readStoryPoints,
} from './storyPointsField.ts';

// One page of up to this many issues — plenty for a personal report; flagged when it caps out.
const MAX_ISSUES = 100;
// Most rows the bottleneck "oldest issues" table renders before truncating, so a huge backlog stays readable.
const MAX_BOTTLENECK_ROWS = 25;
const DEFAULT_WINDOW_DAYS = 90;
// The "All history" option maps to ~10 years so the window effectively stops filtering.
const ALL_HISTORY_WINDOW_DAYS = 3650;

// Smallest typed query that triggers a Jira user search — one or two letters match too much to be useful.
const MIN_USER_SEARCH_LENGTH = 2;

/** Shared empty list so a too-short query keeps a stable identity for the suggestion memo that reads it. */
const NO_JIRA_USERS: RawJiraUser[] = [];
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

interface RawStatus { id?: string; name?: string; statusCategory?: { key?: string } }
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
    issuetype?: { subtask?: boolean; name?: string } | null;
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

/** Builds the statusId → human status name map, so the per-status hands-on breakdown reads as names, not ids. */
function buildStatusNameMap(statuses: readonly RawStatus[]): Record<string, string> {
  const statusNameByStatusId: Record<string, string> = {};
  for (const status of statuses) {
    if (typeof status.id === 'string' && typeof status.name === 'string') {
      statusNameByStatusId[status.id] = status.name;
    }
  }
  return statusNameByStatusId;
}

// Story-points reading (configured field id + dropdown-object unwrapping) is shared with the Aging triage
// in ./storyPointsField.ts so the two Reports Hub siblings can never drift.

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
function toPersonalFlowIssue(
  issue: RawIssue,
  identity: PersonIdentity,
  storyPointsFieldId: string,
  shouldCountSubTasks: boolean,
): PersonalFlowIssue {
  const fields = issue.fields ?? {};
  const histories = readSortedHistories(issue);
  return {
    key: issue.key ?? '',
    summary: fields.summary ?? issue.key ?? '',
    storyPoints: readStoryPoints(fields, storyPointsFieldId),
    createdIso: fields.created ?? null,
    // When a team genuinely delivers at sub-task level they can opt back in; the verdict is simply
    // not supplied, so the engine counts the issue as it always did.
    scopeVerdict: shouldCountSubTasks ? undefined : classifyIssueScope(fields.issuetype),
    ...readStatusHistory(histories, fields),
    ...readOwnershipHistory(histories, fields, identity),
  };
}

/**
 * Builds the exact JQL the report queries for a person + window. Factored out so the same string can be
 * BOTH queried (by `buildSearchPath`) and shown to the user for cross-checking in Jira — guaranteeing the
 * displayed JQL never drifts from what actually ran. `assignee WAS` (not `=`) captures work she has since
 * handed off; `updated >= -Nd` is a cheap superset — the engine does the exact windowing by each completed
 * stint's end, so an over-broad fetch is harmless.
 */
export function buildSearchJql(person: string, windowDays: number): string {
  return `assignee WAS "${person}" AND updated >= -${windowDays}d ORDER BY updated DESC`;
}

/**
 * Builds the search path for every issue the person was ever assigned to within the window, wrapping the
 * shared `buildSearchJql` clause with the changelog expand, the requested fields, and the page cap.
 */
function buildSearchPath(
  person: string,
  windowDays: number,
  storyPointsFieldId: string,
  startAt = 0,
): string {
  const jql = buildSearchJql(person, windowDays);
  // `issuetype` carries the `subtask` boolean the scope rule reads — without it the engine cannot tell
  // a sub-task from a story at all.
  const fields = ['summary', 'created', 'assignee', 'status', 'resolutiondate', 'issuetype', storyPointsFieldId]
    .join(',');
  // Paged: one request per ISSUE_PAGE_SIZE issues. The report previously took a single page and
  // silently reported on whatever fitted, so a busy person's figures described a subset while a Jira
  // link beside them would have returned everything.
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&expand=changelog&fields=${fields}`
    + `&startAt=${startAt}&maxResults=${ISSUE_PAGE_SIZE}`;
}

/** Formats a rate/number for display with up to two decimals (integers stay whole). */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

// Shown in the "Role(s)" cell when a member has no role capabilities set, so the column never reads blank.
const NO_ROLES_PLACEHOLDER = '—';

/**
 * Formats a member's role capabilities into a comma-joined list of human role labels, in the canonical
 * TEAM_ROLE_DEFINITIONS order, or a placeholder dash when the member can perform none. Kept in one place so
 * the comparison table's "Role(s)" column always names roles the same way the rollup section does.
 */
function formatRoleLabels(roleCapabilities: RosterRoleCapabilities | undefined): string {
  if (roleCapabilities === undefined) {
    return NO_ROLES_PLACEHOLDER;
  }
  const enabledLabels = TEAM_ROLE_DEFINITIONS
    .filter((definition) => roleCapabilities[definition.key] === true)
    .map((definition) => definition.label);
  return enabledLabels.length === 0 ? NO_ROLES_PLACEHOLDER : enabledLabels.join(', ');
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
  // The member's role capabilities, carried through so the comparison table can show a "Role(s)" column
  // and the "Throughput by role" rollup can regroup people by the roles they can perform.
  roleCapabilities?: RosterRoleCapabilities;
  // The resolved machine id the JQL `assignee WAS "…"` clause used for this member, shown so a reviewer can
  // see WHO each row was queried as. Null when the member never resolved to a queryable id (unmatched/error).
  queryValue: string | null;
  // How many issues were actually fetched for this person — the top line of the audit report's
  // `fetched = credited + excluded` reconciliation.
  fetchedIssueCount: number;
  // Set when a ceiling stopped this person's analysis, so their figures describe a subset. Reported
  // prominently rather than left to look complete.
  ceilingReached: FlowFetchCeiling | null;
  // True when the user cancelled during this person's fetch. A cancelled run produces no document.
  wasCancelled: boolean;
  // The exact JQL this member's search ran, built from the SAME id + window as `buildSearchPath`, so a
  // reviewer can copy it and paste it straight into Jira to validate the team numbers. Null when unresolved.
  jql: string | null;
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
  storyPointsFieldId: string,
  remainingRunBudget: number,
  isCancelled: () => boolean,
  shouldCountSubTasks: boolean,
): Promise<TeamFlowRow> {
  const roleCapabilities = rosterMember.roleCapabilities;
  try {
    // Resolve the member to a full identity: trust a stored accountId, else look the name up in Jira.
    const identity = await resolveRosterIdentity(rosterMember);
    if (identity === null) {
      return {
        personDisplayName: rosterMember.displayName, roleCapabilities,
        queryValue: null, jql: null, result: null, errorMessage: 'No matching Jira user',
        fetchedIssueCount: 0, ceilingReached: null, wasCancelled: false,
      };
    }
    const fetchOutcome = await fetchAllUnitIssues<RawIssue>(
      async (startAt) => {
        const searchResponse = await jiraGet<{ issues?: RawIssue[] }>(
          buildSearchPath(identity.queryValue, windowDays, storyPointsFieldId, startAt),
        );
        return searchResponse.issues ?? [];
      },
      { remainingRunBudget, isCancelled },
    );
    if (fetchOutcome.wasCancelled) {
      return {
        personDisplayName: rosterMember.displayName, roleCapabilities,
        queryValue: null, jql: null, result: null, errorMessage: 'Cancelled',
        fetchedIssueCount: 0, ceilingReached: null, wasCancelled: true,
      };
    }
    const issues = fetchOutcome.issues
      .map((issue) => toPersonalFlowIssue(issue, identity, storyPointsFieldId, shouldCountSubTasks));
    const result = computePersonalFlow({ issues, statusCategoryByStatusId, windowDays, todayIso });
    // Record the exact id + JQL that ran — buildSearchJql takes the SAME id + window buildSearchPath queried,
    // so the JQL the row shows is guaranteed to be the one that produced these numbers.
    return {
      personDisplayName: rosterMember.displayName, roleCapabilities,
      queryValue: identity.queryValue, jql: buildSearchJql(identity.queryValue, windowDays),
      result, errorMessage: null,
      fetchedIssueCount: fetchOutcome.issues.length,
      ceilingReached: fetchOutcome.ceilingReached,
      wasCancelled: false,
    };
  } catch (caughtError) {
    return {
      personDisplayName: rosterMember.displayName,
      roleCapabilities,
      queryValue: null,
      jql: null,
      result: null,
      errorMessage: caughtError instanceof Error ? caughtError.message : 'Failed to build this person’s flow.',
      fetchedIssueCount: 0, ceilingReached: null, wasCancelled: false,
    };
  }
}

/**
 * Shows the exact JQL the report ran, in selectable monospace, with a Copy button — so a reviewer can
 * paste it straight into Jira's issue search and cross-check a run. Read-only: it only reflects the query
 * that already executed. Styled to match the muted diagnostic line above it, and the JQL wraps rather than
 * forcing horizontal page overflow.
 */
function QueriedJqlBlock({ jql }: { jql: string }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }} className={styles.captionText}>
      <span style={{ fontWeight: 600, flex: '0 0 auto' }}>JQL</span>
      <code
        style={{
          flex: '1 1 auto', minWidth: 0, fontFamily: 'monospace', whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere', userSelect: 'all',
        }}
      >
        {jql}
      </code>
      <button type="button" aria-label="Copy JQL" onClick={() => copyToClipboard(jql)} className={styles.actionButton} style={{ flex: '0 0 auto' }}>
        Copy
      </button>
    </div>
  );
}

/** One labelled statistic; label and value are siblings so the value reads independently of the label. */
function StatCard({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className={styles.kpiCard}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue}>{value}</span>
    </div>
  );
}

/** How many of a person's fetched issues were dropped for being sub-tasks of another issue. */
function countSubTaskExclusions(result: PersonalFlowResult): number {
  return result.excludedIssues.filter((excluded) => excluded.reason === 'sub-task').length;
}

/** Human-friendly, non-technical label for each exclusion reason, shown in the issue-audit table. */
const EXCLUSION_REASON_LABELS: Record<PersonalFlowExclusionReason, string> = {
  'not-owned': 'Not matched to this person',
  'sub-task': 'Sub-task — counted under its parent issue',
  'wip-open': 'In progress, still assigned (WIP)',
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
      <h4 className={styles.tabSectionHeading}>Issue audit</h4>
      <p className={styles.captionText} style={{ marginTop: 0 }}>
        Credited {result.issueCount} · Excluded {result.excludedIssues.length}
      </p>
      {result.excludedIssues.length > 0 && (
        <div className={styles.tableWrapper}>
          <table className={styles.reportTable}>
            <thead>
              <tr>
                <th>Issue</th><th>Summary</th><th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {result.excludedIssues.map((excludedIssue) => (
                <tr key={excludedIssue.key}>
                  <td>{excludedIssue.key}</td>
                  <td>{excludedIssue.summary}</td>
                  <td>{EXCLUSION_REASON_LABELS[excludedIssue.reason]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** One row of the hands-on-by-status breakdown: the human status name (or a fallback) and its day total. */
interface HandsOnStatusRow {
  statusId: string;
  statusLabel: string;
  days: number;
}

/**
 * Turns the engine's statusId → hands-on-days map into display rows: drops zero-day statuses, resolves each
 * id to its human status name (falling back to the raw id when the instance did not report a name), and
 * sorts the biggest bucket first so the dominant status reads at the top.
 */
function buildHandsOnStatusRows(
  handsOnDaysByStatusId: Readonly<Record<string, number>>,
  statusNameById: Readonly<Record<string, string>>,
): HandsOnStatusRow[] {
  return Object.entries(handsOnDaysByStatusId)
    .filter(([, days]) => days > 0)
    .map(([statusId, days]) => ({ statusId, statusLabel: statusNameById[statusId] ?? statusId, days }))
    .sort((first, second) => second.days - first.days);
}

/**
 * A diagnostic section under the single-person result: it partitions the SAME credited hands-on days by the
 * individual status each day was spent in. It reveals WHERE the hands-on time concentrated — a large queue-y
 * "Ready to Work" bucket flags time that inflates cycle time without being real working time. It reports the
 * exact same total as the credited cycle time, so it explains that number rather than changing it.
 */
function HandsOnByStatusSection({
  result,
  statusNameById,
}: {
  result: PersonalFlowResult;
  statusNameById: Readonly<Record<string, string>>;
}): React.JSX.Element | null {
  const statusRows = buildHandsOnStatusRows(result.handsOnDaysByStatusId, statusNameById);
  if (statusRows.length === 0) {
    return null;
  }
  return (
    <section style={{ marginTop: 16 }}>
      <h4 className={styles.tabSectionHeading}>Hands-on time by status</h4>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Status</th><th>Hands-on (days)</th>
            </tr>
          </thead>
          <tbody>
            {statusRows.map((statusRow) => (
              <tr key={statusRow.statusId}>
                <td>{statusRow.statusLabel}</td>
                <td>{formatNumber(statusRow.days)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Renders the throughput, cycle-time, and volume cards plus the per-issue breakdown table. */
function PersonalFlowResultView({
  result,
  statusNameById,
}: {
  result: PersonalFlowResult;
  statusNameById: Readonly<Record<string, string>>;
}): React.JSX.Element {
  const { throughput, cycleTime } = result;
  return (
    <div style={{ marginTop: 12 }}>
      <div className={styles.kpiGrid}>
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
        <p className={styles.captionText}>No issues this person advanced in the selected window.</p>
      ) : (
        <div className={styles.tableWrapper} style={{ marginTop: 12 }}>
          <table className={styles.reportTable}>
            <thead>
              <tr>
                <th>Issue</th><th>Summary</th><th>Last active</th><th>Hands-on (days)</th><th>Points</th>
              </tr>
            </thead>
            <tbody>
              {result.perIssue.map((issue) => (
                <tr key={issue.key}>
                  <td>{issue.key}</td>
                  <td>{issue.summary}</td>
                  <td>{issue.lastActiveIso === null ? '—' : issue.lastActiveIso.slice(0, 10)}</td>
                  <td>{issue.cycleTimeDays === null ? '—' : formatNumber(issue.cycleTimeDays)}</td>
                  <td>{issue.storyPoints === null ? '—' : formatNumber(issue.storyPoints)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <HandsOnByStatusSection result={result} statusNameById={statusNameById} />

      <IssueAuditSection result={result} />
    </div>
  );
}

// ── AI coaching summary (passphrase-gated) ──────────────────────────────────────

/** Rounds a rate to two decimals so the coaching prompt reads cleanly instead of trailing many digits. */
function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Projects the computed result plus who/how-long into the coaching prompt's flat input shape. */
function toCoachingInput(
  result: PersonalFlowResult,
  personName: string,
  windowDays: number,
  statusNameById: Readonly<Record<string, string>>,
): PersonalFlowCoachingInput {
  const statusRows = buildHandsOnStatusRows(result.handsOnDaysByStatusId, statusNameById);
  return {
    personName,
    windowDays,
    issuesAdvanced: result.issueCount,
    totalStoryPoints: roundToTwo(result.totalStoryPoints),
    issuesPerWeek: roundToTwo(result.throughput.issuesPerWeek),
    pointsPerWeek: roundToTwo(result.throughput.pointsPerWeek),
    averageCycleTimeDays: result.cycleTime.averageDays === null ? null : roundToTwo(result.cycleTime.averageDays),
    medianCycleTimeDays: result.cycleTime.medianDays === null ? null : roundToTwo(result.cycleTime.medianDays),
    // The status that absorbed the most hands-on time — a big queue-like bucket is a coaching signal.
    topStatusByHandsOnDays: statusRows.length > 0 ? statusRows[0].statusLabel : null,
  };
}

/** Renders one labelled bullet list in the coaching narrative, or nothing when the list is empty. */
function CoachingList({ title, items }: { title: string; items: readonly string[] }): React.JSX.Element | null {
  if (items.length === 0) {
    return null;
  }
  return (
    <>
      <h5 className={styles.coachingSectionTitle}>{title}</h5>
      <ul className={styles.coachingList}>
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </>
  );
}

/** Renders the ingested coaching read: a headline summary plus strengths, concerns, and recommendations. */
function CoachingNarrative({ coaching }: { coaching: PersonalFlowCoaching }): React.JSX.Element {
  return (
    <div style={{ marginTop: 8 }}>
      <p className={styles.coachingSummary}>{coaching.summary}</p>
      <CoachingList title="Strengths" items={coaching.strengths} />
      <CoachingList title="Concerns" items={coaching.concerns} />
      <CoachingList title="Recommendations" items={coaching.recommendations} />
    </div>
  );
}

/**
 * The passphrase-gated AI coaching accelerator for a single-person result. It assembles a copy-paste
 * prompt from the already-computed flow figures and ingests a strict JSON coaching read. Advisory only —
 * it neither calls an AI service nor writes to Jira, and stays hidden until AI Assist is unlocked.
 */
function PersonalFlowCoachingSection({
  result,
  personName,
  windowDays,
  statusNameById,
}: {
  result: PersonalFlowResult;
  personName: string;
  windowDays: number;
  statusNameById: Readonly<Record<string, string>>;
}): React.JSX.Element {
  const [coaching, setCoaching] = useState<PersonalFlowCoaching | null>(null);
  const [error, setError] = useState<string | null>(null);

  const prompt = useMemo(
    () => buildPersonalFlowCoachingPrompt(toCoachingInput(result, personName, windowDays, statusNameById)),
    [result, personName, windowDays, statusNameById],
  );

  const ingestCoaching = (responseText: string): void => {
    try {
      setCoaching(parsePersonalFlowCoachingResponse(responseText));
      setError(null);
    } catch (caughtError) {
      setCoaching(null);
      setError(caughtError instanceof Error ? caughtError.message : 'Could not read the response.');
    }
  };

  return (
    <ReportAiPanel
      title="AI coaching summary"
      prompt={prompt}
      ingestLabel="Ingest coaching"
      onIngest={ingestCoaching}
      error={error}
    >
      {coaching !== null && <CoachingNarrative coaching={coaching} />}
    </ReportAiPanel>
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

/**
 * The comparison-table "Query" cell: the resolved machine id in muted monospace plus a compact Copy button
 * that copies THIS person's exact JQL — so a reviewer can paste one individual's query into Jira and confirm
 * the team numbers. Shows a muted dash and no button when the member never resolved to a queryable id.
 */
/**
 * Assembles the audit document from the rows already displayed.
 *
 * It renders the run that is on screen rather than recomputing anything, so the page a team reads and
 * the table they are looking at can never disagree.
 */
/** Reads the running app version, so the published document says which build produced it. */
function buildAuditDocumentFromRows(
  teamRows: TeamFlowRow[],
  rosterLabel: string,
  windowDays: number,
  statusNameById: Readonly<Record<string, string>>,
  jiraBaseUrl: string | null,
  generatedAtIso: string,
  toolVersion: string,
  countsSubTasks: boolean,
): string {
  const windowEndMs = Date.parse(generatedAtIso);
  const affectedPeople = teamRows.filter((row) => row.ceilingReached !== null).map((row) => row.personDisplayName);
  return buildFlowAuditDocument({
    envelope: {
      rosterLabel,
      windowDays,
      windowStartIso: new Date(windowEndMs - windowDays * 86_400_000).toISOString(),
      windowEndIso: new Date(windowEndMs).toISOString(),
      generatedAtIso,
      toolVersion,
      countsSubTasks,
      ceilingReached: affectedPeople.length === 0
        ? null
        : { kind: teamRows.find((row) => row.ceilingReached)?.ceilingReached ?? 'per-unit', affectedPeople },
      jiraBaseUrl,
    },
    rows: teamRows.map((row) => ({
      personDisplayName: row.personDisplayName,
      // The machine id the search ran as — Jira rejects a display name in the assignee field, so the
      // document must build its fetch link from this and not from the person's name.
      personQueryValue: row.queryValue,
      roleLabels: formatRoleLabels(row.roleCapabilities),
      figures: row.result,
      errorMessage: row.errorMessage,
      fetchedIssueCount: row.fetchedIssueCount,
      ceilingReached: row.ceilingReached,
    })),
    statusNamesById: statusNameById,
  });
}

function TeamFlowQueryCell({ row }: { row: TeamFlowRow }): React.JSX.Element {
  // Both fields are set together in buildTeamFlowRow, so a null jql means there is nothing to copy.
  if (row.jql === null || row.queryValue === null) {
    return <td style={{ opacity: 0.6 }}>—</td>;
  }
  const jqlToCopy = row.jql;
  const jiraBaseUrl = useConnectionStore((state) => state.proxyStatus?.jira?.baseUrl ?? null);
  // The link opens the issues this person's figures were actually COMPUTED from, not the fetch query —
  // the fetch is a deliberate superset, so linking it here would return more issues than the row claims.
  const creditedLink = buildCreditedIssuesLink(
    (row.result?.perIssue ?? []).map((issue) => issue.key),
    jiraBaseUrl,
  );
  return (
    <td style={{ whiteSpace: 'nowrap' }}>
      <span style={{ fontFamily: 'monospace', opacity: 0.6, userSelect: 'all' }}>{row.queryValue}</span>
      {creditedLink.isClickable && (
        <a
          href={creditedLink.href}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${row.personDisplayName}'s counted issues in Jira`}
          className={styles.actionButton}
          style={{ marginLeft: 6 }}
        >
          Open ↗
        </a>
      )}
      <button
        type="button"
        aria-label={`Copy JQL for ${row.personDisplayName}`}
        onClick={() => copyToClipboard(jqlToCopy)}
        className={styles.actionButton}
        style={{ marginLeft: 6 }}
      >
        Copy
      </button>
    </td>
  );
}

/** Renders one comparison-table row: a full metrics row, or the person's name plus an inline error. */
function TeamFlowComparisonRow({ row }: { row: TeamFlowRow }): React.JSX.Element {
  const roleLabels = formatRoleLabels(row.roleCapabilities);
  if (row.result === null) {
    return (
      <tr>
        <td>{row.personDisplayName}</td>
        <td>{roleLabels}</td>
        <td colSpan={6} className={styles.warningText}>{row.errorMessage ?? 'No result.'}</td>
        <TeamFlowQueryCell row={row} />
      </tr>
    );
  }

  const { throughput, cycleTime } = row.result;
  const subTaskCount = countSubTaskExclusions(row.result);
  return (
    <tr>
      <td>
        {row.personDisplayName}
        {/* Shown against the person, not buried in the audit document: someone reading the table must
            be able to see that work was removed from their figures without copying the report. And a
            person whose ONLY credited work was sub-tasks would otherwise read as idle — the same
            "real work scores nothing" failure this report family already fixed once. */}
        {subTaskCount > 0 && (
          <span className={styles.captionText} style={{ display: 'block' }}>
            {row.result.issueCount === 0
              ? `all ${subTaskCount} of their issues here were sub-tasks — counted under their parents, not lost`
              : `${subTaskCount} sub-task${subTaskCount === 1 ? '' : 's'} excluded`}
          </span>
        )}
      </td>
      <td>{roleLabels}</td>
      <td>{String(row.result.issueCount)}</td>
      <td>{formatNumber(row.result.totalStoryPoints)}</td>
      <td>{formatNumber(throughput.issuesPerWeek)}</td>
      <td>{formatNumber(throughput.pointsPerWeek)}</td>
      <td>{cycleTime.averageDays === null ? '—' : formatNumber(cycleTime.averageDays)}</td>
      <td>{cycleTime.medianDays === null ? '—' : formatNumber(cycleTime.medianDays)}</td>
      <TeamFlowQueryCell row={row} />
    </tr>
  );
}

/**
 * The side-by-side team comparison table: one row per roster member, distinct from the single-person view.
 * Wrapped in a horizontal-scroll container so the extra "Query" column can never force page-level overflow.
 */
function TeamFlowComparisonView({ rows }: { rows: readonly TeamFlowRow[] }): React.JSX.Element {
  return (
    <div className={styles.tableWrapper} style={{ marginTop: 12 }}>
      <table className={styles.reportTable}>
        <thead>
          <tr>
            <th>Person</th><th>Role(s)</th><th>Issues †</th><th>Points †</th><th>Issues/Wk</th>
            <th>Points/Wk</th><th>Avg Cycle (days)</th><th>Median Cycle (days)</th><th>Query</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => <TeamFlowComparisonRow key={row.personDisplayName} row={row} />)}
        </tbody>
      </table>
      <TeamDeliveryTotalsNote rows={rows} />
    </div>
  );
}

/**
 * States the team's real delivery beside the per-person columns, and why the columns cannot be added up.
 *
 * The Issues and Points columns credit a whole issue, and its full points, to EVERY person who
 * advanced it — correct for measuring a person, wrong for measuring a team. A warning label alone
 * does not survive being copied into a document and totalled there, so the number the reader was
 * reaching for is supplied here instead, counted once per issue.
 */
function TeamDeliveryTotalsNote({ rows }: { rows: readonly TeamFlowRow[] }): React.JSX.Element | null {
  const creditedIssues = rows.flatMap((row) => (row.result?.perIssue ?? []).map((issue) => ({
    issueKey: issue.key,
    storyPoints: issue.storyPoints,
  })));
  if (creditedIssues.length === 0) {
    return null;
  }

  const totals = computeDeliveryTotals(creditedIssues);
  return (
    <p style={{ marginTop: 8, fontSize: '0.9em' }}>
      † <strong>Issues and Points cannot be summed down this table.</strong> The same issue is credited
      to everyone who advanced it, so a total would count hand-offs rather than issues. Counting each
      issue once, this team delivered <strong>{totals.deliveredIssueCount}</strong> issues
      and <strong>{formatNumber(totals.deliveredStoryPoints)}</strong> story points.
    </p>
  );
}

/** Renders one "Throughput by role" row: the role plus its summed volume, rates, and pooled cycle stats. */
function RoleThroughputRow({ roleThroughput }: { roleThroughput: RoleThroughput }): React.JSX.Element {
  return (
    <tr>
      <td>{roleThroughput.roleLabel}</td>
      <td>{String(roleThroughput.peopleCount)}</td>
      <td>{String(roleThroughput.issueCount)}</td>
      <td>{formatNumber(roleThroughput.totalStoryPoints)}</td>
      <td>{formatNumber(roleThroughput.issuesPerWeek)}</td>
      <td>{formatNumber(roleThroughput.pointsPerWeek)}</td>
      <td>{roleThroughput.averageCycleDays === null ? '—' : formatNumber(roleThroughput.averageCycleDays)}</td>
      <td>{roleThroughput.medianCycleDays === null ? '—' : formatNumber(roleThroughput.medianCycleDays)}</td>
    </tr>
  );
}

/**
 * The "Throughput by role" rollup under the per-person comparison: it regroups the team's flow results by
 * the roles each member can perform and sums the throughput per role. This is the view that surfaces a
 * staffing bottleneck — e.g. many developers feeding a single internal tester makes the Developer role's
 * throughput visibly dwarf the Internal Tester role's. Renders nothing until there is at least one row.
 */
function RoleThroughputSection({ rows }: { rows: readonly TeamFlowRow[] }): React.JSX.Element | null {
  const roleThroughputs = rollUpThroughputByRole(rows);
  if (roleThroughputs.length === 0) {
    return null;
  }
  return (
    <section style={{ marginTop: 16 }}>
      <h4 className={styles.tabSectionHeading}>Throughput by role</h4>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Role</th><th>People</th><th>Issues</th><th>Story Points</th><th>Issues/Wk</th>
              <th>Points/Wk</th><th>Avg Cycle (days)</th><th>Median Cycle (days)</th>
            </tr>
          </thead>
          <tbody>
            {roleThroughputs.map((roleThroughput) => (
              <RoleThroughputRow key={roleThroughput.roleKey} roleThroughput={roleThroughput} />
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.captionText}>
        People with multiple roles are counted under each of their roles.
      </p>
    </section>
  );
}

// ── Internal Testing Bottleneck panel ────────────────────────────────────────

/** Longest a status-picker scroll box grows before it scrolls internally, so a long status list stays compact. */
const STATUS_PICKER_MAX_HEIGHT_PX = 160;
// Soft hints shown under an empty status picker — never an error, since the panel still works when statuses
// fail to load (the user can retry with the Reload button).
const STATUS_LOAD_FAILED_NOTE = 'Could not load statuses — click Reload statuses to try again.';
const STATUS_LOAD_EMPTY_NOTE = 'Statuses not loaded — click Reload statuses.';

/** The scope JQL + the chosen internal-testing status names the bottleneck panel persists between runs. */
/** One offerable status in the multi-select picker: its exact Jira name plus its category key (shown as a tag). */
interface StatusPickerOption {
  name: string;
  categoryKey: string;
}

/**
 * Builds the picker's options from the instance's raw status list: keeps each named status once (first
 * category wins on a duplicate name), drops blanks, and sorts alphabetically so the checkbox list is stable
 * and de-duplicated. Names come straight from Jira, so the user can only ever pick a real, correctly-spelled
 * status — the whole point of replacing the free-text input.
 */
function buildStatusPickerOptions(statuses: readonly RawStatus[]): StatusPickerOption[] {
  const optionByName = new Map<string, StatusPickerOption>();
  for (const status of statuses) {
    if (typeof status.name !== 'string' || status.name.trim() === '' || optionByName.has(status.name)) {
      continue;
    }
    optionByName.set(status.name, { name: status.name, categoryKey: status.statusCategory?.key ?? 'new' });
  }
  return Array.from(optionByName.values()).sort((first, second) => first.name.localeCompare(second.name));
}

/** Toggles a status name in the selected set, returning a new alphabetically-sorted array (stable JQL order). */
function toggleStatusName(selectedStatusNames: readonly string[], statusName: string): string[] {
  const nextSelected = selectedStatusNames.includes(statusName)
    ? selectedStatusNames.filter((existing) => existing !== statusName)
    : [...selectedStatusNames, statusName];
  return [...nextSelected].sort((first, second) => first.localeCompare(second));
}

/**
 * Builds the exact JQL the bottleneck panel queries: the user's scope wrapped in parentheses, ANDed with a
 * `status in (...)` clause naming every internal-testing status (each quoted), oldest-created first. Factored
 * out so the same string is BOTH queried and shown to the user, guaranteeing the displayed JQL never drifts.
 */
function buildBottleneckJql(scopeJql: string, statusNames: readonly string[]): string {
  const quotedStatuses = statusNames.map((name) => `"${name}"`).join(',');
  return `(${scopeJql}) AND status in (${quotedStatuses}) ORDER BY created ASC`;
}

/** Wraps the bottleneck JQL with the changelog expand, requested fields, and the page cap into a search path. */
function buildBottleneckSearchPath(scopeJql: string, statusNames: readonly string[]): string {
  const jql = buildBottleneckJql(scopeJql, statusNames);
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&expand=changelog&fields=summary,status,assignee,created&maxResults=${MAX_ISSUES}`;
}

/** Reads a raw issue's current status NAME from its status field, defaulting to an empty string when absent. */
function readCurrentStatusName(fields: RawIssue['fields']): string {
  const statusName = (fields?.status as { name?: string } | undefined)?.name;
  return typeof statusName === 'string' ? statusName : '';
}

/** Reconstructs an issue's status-name transitions from its changelog, oldest first, for the bottleneck engine. */
function readBottleneckStatusTransitions(issue: RawIssue): BottleneckStatusTransition[] {
  const transitions: BottleneckStatusTransition[] = [];
  for (const history of readSortedHistories(issue)) {
    for (const item of history.items ?? []) {
      if (item.field !== 'status') continue;
      const toStatusName = readChangeItemText(item, 'toString');
      if (toStatusName === undefined) continue; // a status change with no name string can't seed the timeline
      transitions.push({ toStatusName, atIso: history.created ?? '' });
    }
  }
  return transitions;
}

/** Maps a raw Jira issue to the bottleneck engine's issue shape (current status, assignee, created, timeline). */
function toBottleneckIssue(issue: RawIssue): BottleneckIssueInput {
  const fields = issue.fields ?? {};
  return {
    key: issue.key ?? '',
    summary: fields.summary ?? issue.key ?? '',
    currentStatusName: readCurrentStatusName(fields),
    assigneeDisplayName: fields.assignee?.displayName ?? null,
    createdIso: fields.created ?? null,
    statusTransitions: readBottleneckStatusTransitions(issue),
  };
}

/** One row of a count rollup (status or assignee): the label and how many issues fall under it. */
interface BottleneckCountRow {
  label: string;
  count: number;
}

/** Turns a label → count map into rows sorted by count descending (ties broken by label) for display. */
function buildCountRows(countByLabel: Readonly<Record<string, number>>): BottleneckCountRow[] {
  return Object.entries(countByLabel)
    .map(([label, count]) => ({ label, count }))
    .sort((first, second) => (second.count - first.count) || (first.label < second.label ? -1 : 1));
}

/** A labelled mini-table of counts, reused for the by-status and by-assignee bottleneck rollups. */
function BottleneckCountTable({
  heading,
  labelColumn,
  rows,
}: {
  heading: string;
  labelColumn: string;
  rows: readonly BottleneckCountRow[];
}): React.JSX.Element {
  return (
    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
      <h5 className={styles.tabSectionHeading}>{heading}</h5>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>{labelColumn}</th><th>Count</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{String(row.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Formats a nullable statistic for the headline, showing an em-dash when there is no value. */
function formatNullableDays(value: number | null): string {
  return value === null ? '—' : formatNumber(value);
}

/** The bottleneck headline: backlog size plus average, median, and oldest wait in days. */
function BottleneckHeadline({ result }: { result: InternalTestingBottleneckResult }): React.JSX.Element {
  return (
    <p style={{ marginTop: 12, fontSize: 14, fontWeight: 600 }}>
      {result.backlogCount} issues in Internal Testing · avg {formatNullableDays(result.averageWaitingDays)}d
      · median {formatNullableDays(result.medianWaitingDays)}d · oldest {formatNullableDays(result.oldestWaitingDays)}d waiting
    </p>
  );
}

/** The "oldest issues" table: the longest-waiting issues, capped so a large backlog stays readable. */
function BottleneckOldestIssues({ result }: { result: InternalTestingBottleneckResult }): React.JSX.Element {
  const visibleIssues = result.issues.slice(0, MAX_BOTTLENECK_ROWS);
  const hiddenCount = result.issues.length - visibleIssues.length;
  return (
    <section style={{ marginTop: 16 }}>
      <h5 className={styles.tabSectionHeading}>Oldest issues</h5>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Issue</th><th>Summary</th><th>Current status</th><th>Assignee</th><th>Waiting (days)</th>
            </tr>
          </thead>
          <tbody>
            {visibleIssues.map((issue) => (
              <tr key={issue.key}>
                <td>{issue.key}</td>
                <td>{issue.summary}</td>
                <td>{issue.currentStatusName}</td>
                <td>{issue.assigneeDisplayName ?? 'Unassigned'}</td>
                <td>{formatNumber(issue.waitingDays)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hiddenCount > 0 && (
        <p className={styles.captionText}>
          Showing the {MAX_BOTTLENECK_ROWS} longest-waiting of {result.issues.length} issues.
        </p>
      )}
    </section>
  );
}

/** The full bottleneck result view: headline, by-status + by-assignee rollups, and the oldest-issues table. */
function BottleneckResultView({ result }: { result: InternalTestingBottleneckResult }): React.JSX.Element {
  return (
    <div>
      <BottleneckHeadline result={result} />
      {result.backlogCount === 0 ? (
        <p style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
          No issues are currently sitting in the named internal-testing statuses.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 12 }}>
            <BottleneckCountTable heading="By status" labelColumn="Status" rows={buildCountRows(result.countByStatus)} />
            <BottleneckCountTable heading="By assignee" labelColumn="Assignee" rows={buildCountRows(result.countByAssignee)} />
          </div>
          <BottleneckOldestIssues result={result} />
        </>
      )}
    </div>
  );
}

/** One selectable status: a checkbox labelled with the exact status name plus a muted category-key tag. */
function StatusCheckboxRow({
  option,
  isChecked,
  onToggle,
}: {
  option: StatusPickerOption;
  isChecked: boolean;
  onToggle: (statusName: string) => void;
}): React.JSX.Element {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', cursor: 'pointer' }}>
      <input type="checkbox" aria-label={option.name} checked={isChecked} onChange={() => onToggle(option.name)} />
      <span>{option.name}</span>
      <span
        style={{
          fontSize: 10, opacity: 0.55, border: '1px solid var(--color-border)', borderRadius: 4, padding: '0 4px',
        }}
      >
        {option.categoryKey}
      </span>
    </label>
  );
}

/**
 * The scrollable multi-select of internal-testing statuses, populated from the instance's real Jira
 * statuses so only valid names can be picked (no typos). Shows a "{n} selected" indicator and a Reload
 * button so a failed or late status load can be retried; when nothing is loaded it shows a soft hint.
 */
function StatusMultiSelect({
  options,
  selectedStatusNames,
  onToggle,
  loadNote,
  onReload,
}: {
  options: readonly StatusPickerOption[];
  selectedStatusNames: readonly string[];
  onToggle: (statusName: string) => void;
  loadNote: string | null;
  onReload: () => void;
}): React.JSX.Element {
  const selectedSet = new Set(selectedStatusNames);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', fontSize: 12, gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>Internal-testing statuses</span>
        <span style={{ opacity: 0.6 }}>{selectedStatusNames.length} selected</span>
        <button type="button" onClick={onReload} style={{ fontSize: 11, padding: '1px 6px', cursor: 'pointer' }}>
          Reload statuses
        </button>
      </div>
      {options.length === 0 ? (
        <p style={{ fontSize: 12, opacity: 0.6, margin: 0, minWidth: 260 }}>{loadNote ?? STATUS_LOAD_EMPTY_NOTE}</p>
      ) : (
        <div
          style={{
            maxHeight: STATUS_PICKER_MAX_HEIGHT_PX, overflowY: 'auto', minWidth: 260,
            border: '1px solid var(--color-border)', borderRadius: 6, padding: '4px 8px',
          }}
        >
          {options.map((option) => (
            <StatusCheckboxRow
              key={option.name}
              option={option}
              isChecked={selectedSet.has(option.name)}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The Internal Testing Bottleneck panel: an independent scope JQL + status multi-select form with its own Run
 * button, state, and error handling. It queries every issue currently in the chosen internal-testing statuses
 * and shows how many are stuck and how long they have waited — hard evidence a single tester is a bottleneck.
 * Read-only: it only reads Jira. Kept self-contained so it never touches the person/team runs above it.
 */
function InternalTestingBottleneckPanel(): React.JSX.Element {
  const persistedSettings = useMemo(() => readBottleneckSettings(), []);
  const [scopeJql, setScopeJql] = useState(persistedSettings.scopeJql);
  const [selectedStatusNames, setSelectedStatusNames] = useState<string[]>(persistedSettings.statusNames);
  // The instance's real statuses offered in the picker, loaded on mount and re-loadable via the Reload button.
  const [statusOptions, setStatusOptions] = useState<StatusPickerOption[]>([]);
  const [statusLoadNote, setStatusLoadNote] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InternalTestingBottleneckResult | null>(null);
  const [queriedJql, setQueriedJql] = useState<string | null>(null);
  const [wasCapped, setWasCapped] = useState(false);

  // Bumping this token re-runs the status load; the Reload button is the only thing that bumps it.
  const [statusReloadToken, setStatusReloadToken] = useState(0);

  // Load the instance's statuses for the picker, on mount and on every Reload. Fully error-tolerant: a
  // failure leaves an empty list plus a soft note, never throws, so the rest of the tab (and its tests)
  // are unaffected by a status-load hiccup. A reload or unmount abandons any answer still in flight.
  useEffect(() => {
    let isActive = true;
    void (async () => {
      try {
        const statuses = await jiraGet<RawStatus[]>('/rest/api/2/status');
        if (!isActive) return;
        const options = buildStatusPickerOptions(Array.isArray(statuses) ? statuses : []);
        setStatusOptions(options);
        setStatusLoadNote(options.length === 0 ? STATUS_LOAD_EMPTY_NOTE : null);
      } catch {
        if (!isActive) return;
        setStatusOptions([]);
        setStatusLoadNote(STATUS_LOAD_FAILED_NOTE);
      }
    })();
    return () => {
      isActive = false;
    };
  }, [statusReloadToken]);

  const reloadStatuses = useCallback((): void => {
    setStatusReloadToken((currentToken) => currentToken + 1);
  }, []);

  const canRun = scopeJql.trim() !== '' && selectedStatusNames.length > 0;

  const handleScopeChange = (nextScopeJql: string): void => {
    setScopeJql(nextScopeJql);
    writeBottleneckSettings({ scopeJql: nextScopeJql, statusNames: selectedStatusNames });
  };

  const handleToggleStatus = (statusName: string): void => {
    const nextSelected = toggleStatusName(selectedStatusNames, statusName);
    setSelectedStatusNames(nextSelected);
    writeBottleneckSettings({ scopeJql, statusNames: nextSelected });
  };

  const runBottleneck = async (): Promise<void> => {
    // Read the inputs fresh at run time so the latest edits are used; sort for a stable, deterministic JQL.
    const trimmedScopeJql = scopeJql.trim();
    const statusNames = [...selectedStatusNames].sort((first, second) => first.localeCompare(second));
    if (trimmedScopeJql === '' || statusNames.length === 0) {
      return;
    }
    setIsLoading(true);
    setError(null);
    setResult(null);
    setQueriedJql(null);
    try {
      const searchResponse = await jiraGet<{ issues?: RawIssue[] }>(
        buildBottleneckSearchPath(trimmedScopeJql, statusNames),
      );
      const rawIssues = searchResponse.issues ?? [];
      const issues = rawIssues.map(toBottleneckIssue);
      const todayIso = new Date().toISOString().slice(0, 10);
      setResult(computeInternalTestingBottleneck({ issues, internalTestingStatusNames: statusNames, todayIso }));
      setQueriedJql(buildBottleneckJql(trimmedScopeJql, statusNames));
      setWasCapped(rawIssues.length === MAX_ISSUES);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Failed to build the internal testing bottleneck.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section style={{ marginTop: 28, paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
      <h3 className={styles.tabSectionHeading}>Internal Testing Bottleneck</h3>
      <p className={styles.captionText} style={{ marginTop: 0, marginBottom: 10 }}>
        How many issues are stuck in the team's internal-testing statuses right now, how long they have been
        waiting, and who holds them.
      </p>
      <div className={styles.controlRow}>
        <label className={styles.controlLabel}>
          Scope JQL
          <input
            value={scopeJql}
            onChange={(event) => handleScopeChange(event.target.value)}
            placeholder="project = ENCUC"
            className={styles.textInput}
            style={{ minWidth: 220 }}
          />
        </label>
        <StatusMultiSelect
          options={statusOptions}
          selectedStatusNames={selectedStatusNames}
          onToggle={handleToggleStatus}
          loadNote={statusLoadNote}
          onReload={reloadStatuses}
        />
        <button
          type="button"
          onClick={() => void runBottleneck()}
          disabled={!canRun || isLoading}
          className={`${styles.actionButton} ${styles.primaryButton}`}
        >
          {isLoading ? 'Running…' : 'Run bottleneck'}
        </button>
      </div>

      {error !== null && (
        <p role="alert" className={styles.warningText} style={{ marginTop: 10 }}>{error}</p>
      )}

      {wasCapped && result !== null && (
        <p className={styles.captionText}>
          Showing at most {MAX_ISSUES} issues — narrow the scope for a complete picture.
        </p>
      )}

      {result !== null && <BottleneckResultView result={result} />}

      {queriedJql !== null && <QueriedJqlBlock jql={queriedJql} />}
    </section>
  );
}

/** The Personal Flow report tab: pick a person + window, run, and read their throughput + hands-on cycle time. */
export interface PersonalFlowTabProps {
  /**
   * The team chosen in the Reports Hub filter bar, scoping the roster this tab runs for.
   *
   * Empty means "All Teams", which falls back to the team selected in Agile Hub. The filter is
   * populated from Jira/ART team names, which need not match the roster's own team names — so a
   * value that is not a roster team is reported rather than silently resolved to a different one.
   */
  teamFilter?: string;
}

export function PersonalFlowTab({ teamFilter = '' }: PersonalFlowTabProps = {}) {
  const [person, setPerson] = useState('');
  const [windowDays, setWindowDays] = useState(DEFAULT_WINDOW_DAYS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PersonalFlowResult | null>(null);
  // statusId → human status name, built alongside the category map from /rest/api/2/status, so the
  // hands-on-by-status breakdown can show friendly names instead of raw numeric status ids.
  const [statusNameById, setStatusNameById] = useState<Record<string, string>>({});
  const [areSuggestionsOpen, setAreSuggestionsOpen] = useState(false);
  const [fetchedJiraUsers, setFetchedJiraUsers] = useState<RawJiraUser[]>([]);
  // The full identity resolved from a picked suggestion. Null means "resolve at run time" — free-typed
  // text is always a display name that must be looked up before it can be queried.
  const [selectedIdentity, setSelectedIdentity] = useState<PersonIdentity | null>(null);
  // A transparency line for the last single-person run: which machine id was queried and how many issues
  // were fetched, so the user can see resolution + fetch vs credited at a glance. Null hides the line.
  const [diagnostic, setDiagnostic] = useState<{ queryValue: string; rawIssueCount: number; jql: string } | null>(null);
  const [teamRows, setTeamRows] = useState<TeamFlowRow[]>([]);
  // Set when a ceiling truncated the single-person run, so the view can say the figures are partial
  // instead of presenting a subset as the whole window.
  const [singlePersonCeiling, setSinglePersonCeiling] = useState<FlowFetchCeiling | null>(null);
  const [isTeamLoading, setIsTeamLoading] = useState(false);
  // Copy feedback is explicit: a silently failed copy of a long report means the user pastes stale
  // clipboard content into Confluence and never finds out.
  const [auditCopyState, setAuditCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const teamJiraBaseUrl = useConnectionStore((state) => state.proxyStatus?.jira?.baseUrl ?? null);
  // How far through the roster the run is, so a long analysis is something the user can judge rather
  // than a spinner they have to trust.
  const [teamProgress, setTeamProgress] = useState<
    { personDisplayName: string; completedCount: number; totalCount: number } | null
  >(null);
  // A ref, not state: the running loop reads it between people, and a state update would not be
  // visible to the closure already in flight.
  const teamCancelRef = useRef(false);
  const [teamError, setTeamError] = useState<string | null>(null);

  // Teams here are saved Dashboard Team PROFILES, and each profile owns its own roster under a
  // profile-scoped storage key. A roster member carries no team name, which is why every earlier
  // attempt to scope this report by `teamName` matched nothing and silently ran whichever profile
  // Agile Hub had selected — the Reports Hub dropdown appeared to do nothing at all.
  const teamProfiles = useSettingsStore((state) => state.sprintDashboardTeamProfiles);
  const activeTeamProfileId = useSettingsStore((state) => state.sprintDashboardActiveTeamProfileId);
  // Shared with the Flow Analysis tab, so the two reports can never disagree about what counts.
  const shouldCountSubTasks = useSettingsStore((state) => state.countSubTasksInFlowReports);
  const setShouldCountSubTasks = useSettingsStore((state) => state.setCountSubTasksInFlowReports);
  const uiRequestedTeamName = teamFilter.trim();
  // Reads another profile's roster WITHOUT selecting it: switching the active profile from here would
  // silently re-point the user's Agile Hub just because they opened a report (017 isolation rule).
  const rosterScope = useMemo(
    () => resolveReportRosterScope({
      requestedTeamName: uiRequestedTeamName,
      teamProfiles,
      activeTeamProfileId,
      readRosterForProfile: readStoredStandupRosterMembers,
    }),
    [uiRequestedTeamName, teamProfiles, activeTeamProfileId],
  );
  const effectiveTeamName = rosterScope.label;
  // True when a team was named that matches no saved dashboard team — the Team filter lists Jira/ART
  // teams, which need not match. Surfaced rather than acted on, so the change never LOOKS applied.
  const hasTeamNameMismatch = !rosterScope.isRequestedTeamMatched;
  const activeTeamRosterMembers = rosterScope.rosterMembers;

  // Too short a query offers no Jira users at all, which is worked out here rather than by clearing the
  // fetched list from the effect below — the last fetch's users simply stop being offered.
  const jiraUserSuggestions =
    person.trim().length < MIN_USER_SEARCH_LENGTH ? NO_JIRA_USERS : fetchedJiraUsers;

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
      return;
    }
    let isEffectActive = true;
    const debounceTimerId = setTimeout(() => {
      void searchJiraUsers(trimmedQuery).then((jiraUsers) => {
        if (isEffectActive) {
          setFetchedJiraUsers(jiraUsers);
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
      const safeStatuses = Array.isArray(statuses) ? statuses : [];
      const statusCategoryByStatusId = buildStatusCategoryMap(safeStatuses);
      setStatusNameById(buildStatusNameMap(safeStatuses));
      // Read the configured story-points field once per run so a settings change is picked up next run.
      const storyPointsFieldId = readConfiguredStoryPointsFieldId();
      const fetchOutcome = await fetchAllUnitIssues<RawIssue>(
        async (startAt) => {
          const searchResponse = await jiraGet<{ issues?: RawIssue[] }>(
            buildSearchPath(identity.queryValue, windowDays, storyPointsFieldId, startAt),
          );
          return searchResponse.issues ?? [];
        },
        { remainingRunBudget: RUN_ISSUE_BUDGET },
      );
      const rawIssues = fetchOutcome.issues;
      setSinglePersonCeiling(fetchOutcome.ceilingReached);
      const issues = rawIssues
        .map((issue) => toPersonalFlowIssue(issue, identity, storyPointsFieldId, shouldCountSubTasks));
      // The clock read is fine here (the pure engine takes today as an argument, staying deterministic).
      const todayIso = new Date().toISOString().slice(0, 10);
      setResult(computePersonalFlow({ issues, statusCategoryByStatusId, windowDays, todayIso }));
      // Capture the EXACT JQL that ran (same id + window passed to buildSearchPath) so the UI can show it.
      setDiagnostic({
        queryValue: identity.queryValue,
        rawIssueCount: rawIssues.length,
        jql: buildSearchJql(identity.queryValue, windowDays),
      });
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
    teamCancelRef.current = false;
    setTeamProgress(null);
    try {
      const statuses = await jiraGet<RawStatus[]>('/rest/api/2/status');
      const statusCategoryByStatusId = buildStatusCategoryMap(Array.isArray(statuses) ? statuses : []);
      const todayIso = new Date().toISOString().slice(0, 10);
      // Resolve the configured story-points field once and reuse it for every member of this team run.
      const storyPointsFieldId = readConfiguredStoryPointsFieldId();
      const nextTeamRows: TeamFlowRow[] = [];
      // Sequential per-person fetches keep the load gentle on Jira; each is independent and self-contained.
      // The run budget is spent down as people are processed, so one very busy person cannot consume the
      // whole roster's allowance without the rest being told their figures are partial.
      let remainingRunBudget = RUN_ISSUE_BUDGET;
      const isCancelled = () => teamCancelRef.current;
      for (const [memberIndex, rosterMember] of activeTeamRosterMembers.entries()) {
        if (isCancelled()) break;
        // Naming the person and the position turns a long wait into something the user can judge.
        setTeamProgress({
          personDisplayName: rosterMember.displayName,
          completedCount: memberIndex,
          totalCount: activeTeamRosterMembers.length,
        });
        const teamFlowRow = await buildTeamFlowRow(
          rosterMember, statusCategoryByStatusId, windowDays, todayIso, storyPointsFieldId,
          remainingRunBudget, isCancelled, shouldCountSubTasks,
        );
        if (teamFlowRow.wasCancelled) break;
        remainingRunBudget -= teamFlowRow.fetchedIssueCount;
        nextTeamRows.push(teamFlowRow);
      }
      // A cancelled run leaves the previous results on screen and produces nothing new — a
      // part-finished team report that reads as complete is the failure this report exists to prevent.
      if (!isCancelled()) {
        setTeamRows(nextTeamRows);
      }
    } catch (caughtError) {
      setTeamError(caughtError instanceof Error ? caughtError.message : 'Failed to build the team flow report.');
    } finally {
      setIsTeamLoading(false);
      setTeamProgress(null);
    }
  };

  /** Builds the audit document from the run on screen and puts it on the clipboard. */
  const handleCopyAuditReport = async (): Promise<void> => {
    setAuditCopyState('idle');
    const toolVersion = await readToolVersion();
    const auditDocument = buildAuditDocumentFromRows(
      teamRows,
      // NEVER falls back to the REQUESTED team: when the roster has no team metadata the member
      // filter returns everyone, and quoting the requested name back would label the whole roster's
      // figures as one team's.
      effectiveTeamName,
      windowDays,
      statusNameById,
      teamJiraBaseUrl,
      new Date().toISOString(),
      toolVersion,
      shouldCountSubTasks,
    );
    setAuditCopyState(await copyToClipboardWithResult(auditDocument) ? 'copied' : 'failed');
  };

  const isSuggestionsVisible = areSuggestionsOpen && person.trim() !== '' && personSuggestions.length > 0;

  return (
    <div style={{ padding: '8px 4px' }}>
      <div className={styles.controlRow}>
        <label className={styles.controlLabel} style={{ position: 'relative' }}>
          Person (Jira assignee)
          <input
            value={person}
            onChange={(event) => handlePersonChange(event.target.value)}
            onFocus={() => setAreSuggestionsOpen(true)}
            placeholder="e.g. Rajaram, Rajasekar"
            className={styles.textInput}
            style={{ minWidth: 220 }}
          />
          {isSuggestionsVisible && (
            <PersonSuggestionsDropdown suggestions={personSuggestions} onSelect={handleSelectSuggestion} />
          )}
        </label>
        <label className={styles.controlLabel}>
          Lookback window
          <select value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))} className={styles.filterSelect}>
            {WINDOW_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void runReport()}
          disabled={person.trim() === '' || isLoading || isTeamLoading}
          className={`${styles.actionButton} ${styles.primaryButton}`}
        >
          {isLoading ? 'Running…' : 'Run report'}
        </button>
        <button
          type="button"
          onClick={() => void runTeamReport()}
          disabled={activeTeamRosterMembers.length === 0 || isLoading || isTeamLoading}
          title={activeTeamRosterMembers.length === 0 ? 'Add roster members for the active team first' : undefined}
          className={styles.actionButton}
        >
          {isTeamLoading ? 'Running team…' : 'Run for team roster'}
        </button>
      </div>

      {/* One setting, read by BOTH flow reports, so they can never disagree about what counts as a
          deliverable. Off by default: sub-tasks credit one piece of work twice and, being short-lived,
          pull the cycle-time average down. */}
      <label style={{ display: 'block', marginTop: 8 }} className={styles.captionText}>
        <input
          type="checkbox"
          checked={shouldCountSubTasks}
          onChange={(event) => setShouldCountSubTasks(event.target.checked)}
        />{' '}
        Count sub-tasks as issues in their own right
      </label>

      {error !== null && (
        <p role="alert" className={styles.warningText} style={{ marginTop: 10 }}>{error}</p>
      )}

      {teamError !== null && (
        <p role="alert" className={styles.warningText} style={{ marginTop: 10 }}>{teamError}</p>
      )}

      {result !== null && singlePersonCeiling !== null && (
        <p role="alert" className={styles.warningText}>
          These figures are incomplete — the analysis stopped at the{' '}
          {singlePersonCeiling === 'per-unit' ? 'per-person issue ceiling' : 'overall run budget'}, so
          they describe a subset of this window. Narrow the window for a complete picture.
        </p>
      )}

      {result !== null && diagnostic !== null && (
        <p className={styles.captionText}>
          Queried Jira as "{diagnostic.queryValue}" · fetched {diagnostic.rawIssueCount} issues · {result.issueCount} credited
        </p>
      )}

      {result !== null && diagnostic !== null && <QueriedJqlBlock jql={diagnostic.jql} />}

      {result !== null && <PersonalFlowResultView result={result} statusNameById={statusNameById} />}

      {result !== null && (
        <PersonalFlowCoachingSection
          result={result}
          personName={person.trim()}
          windowDays={windowDays}
          statusNameById={statusNameById}
        />
      )}

      {hasTeamNameMismatch && (
        <p role="alert" className={styles.warningText} style={{ marginTop: 10 }}>
          “{uiRequestedTeamName}” is not a team on your roster, so this report is showing{' '}
          <strong>{effectiveTeamName}</strong> instead. The Team filter lists Jira/ART
          teams, which do not always match the names on your roster — pick a roster team here, or change the
          team in Agile Hub.
        </p>
      )}

      {teamRows.length > 0 && !isTeamLoading && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => { void handleCopyAuditReport(); }}
          >
            Copy audit report
          </button>
          <span className={styles.captionText}>
            {auditCopyState === 'copied' && 'Copied — paste into a Confluence page.'}
            {auditCopyState === 'failed' && 'Copy failed — nothing was placed on the clipboard.'}
            {auditCopyState === 'idle'
              && 'A full write-up: every metric explained, with links to the exact Jira issues behind it.'}
          </span>
        </div>
      )}

      {isTeamLoading && teamProgress !== null && (
        <div className={styles.captionText} style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>
            Analysing {teamProgress.personDisplayName} — {teamProgress.completedCount} of{' '}
            {teamProgress.totalCount} people done
          </span>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => { teamCancelRef.current = true; }}
          >
            Cancel
          </button>
        </div>
      )}

      {isTeamLoading && teamRows.length === 0 && (
        <p className={styles.captionText}>Building the team comparison…</p>
      )}

      {teamRows.length > 0 && <TeamFlowComparisonView rows={teamRows} />}

      {teamRows.length > 0 && <RoleThroughputSection rows={teamRows} />}

      <InternalTestingBottleneckPanel />
    </div>
  );
}
