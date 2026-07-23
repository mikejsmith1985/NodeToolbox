// rosterIdentity.ts — Translating a roster member into something Jira's `assignee` field will accept.
//
// Jira rejects a DISPLAY NAME in an `assignee WAS "…"` clause outright — it wants a Server username or
// a Cloud accountId. A roster stores display names ("Sokol, Mark (CTR)"), so every report that queries
// by roster member must first resolve each one to a real machine id. This module is that resolution,
// shared so both the Personal Workflow and Flow Analysis reports do it identically. When only one of
// them did it, the other sent display names straight to Jira and every query failed with 400.
//
// The identity keeps BOTH the machine id to query by AND the set of every form a person might appear as
// in a changelog (username, user key, display name, accountId), because Jira Server puts a user key on
// a changelog's machine side and the display name on its text side — so matching only one would miss.

import { jiraGet } from '../../services/jiraApi.ts';
import type { StandupRosterMember } from '../SprintDashboard/hooks/useStandupRosterStore.ts';

/** Most user-search results to consider when resolving a single name. */
const MAX_USER_SEARCH_RESULTS = 20;

/** A person's queryable machine id, plus every identifier a changelog might record them under. */
export interface PersonIdentity {
  /** The machine id (username or accountId) the JQL `assignee WAS "…"` clause uses. */
  queryValue: string;
  /** Normalized username, user key, display name and accountId — any may appear in a changelog. */
  identifiers: Set<string>;
}

/** The user shape Jira's user-search returns. */
export interface RawJiraUser {
  displayName?: string;
  name?: string;
  key?: string;
  accountId?: string;
}

/** Collapses internal whitespace runs to a single space and lowercases, for tolerant name comparison. */
export function normalizeForComparison(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Adds a normalized, non-empty identifier to the set; ignores non-strings and blanks so it stays clean. */
export function addIdentifier(identifiers: Set<string>, rawIdentifier: unknown): void {
  if (typeof rawIdentifier !== 'string') return;
  const normalized = normalizeForComparison(rawIdentifier);
  if (normalized !== '') identifiers.add(normalized);
}

/**
 * Searches Jira for users matching the typed text. Jira Server expects `username=` while Jira Cloud
 * expects `query=`, so this tries `username=` first and falls back to `query=` when it yields nothing.
 * Any error is swallowed to an empty list so the search never blocks the caller.
 */
export async function searchJiraUsers(query: string): Promise<RawJiraUser[]> {
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

/**
 * Builds a full identity from a Jira user object. The JQL query value prefers the Server username, then
 * the Cloud accountId, then the display name as a last resort; the identifier set collects every non-empty
 * form so ownership matching succeeds whichever one a changelog stored.
 */
export function buildIdentityFromJiraUser(user: RawJiraUser): PersonIdentity {
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
 * stored Jira accountId (a real machine id) and falls back to the roster's assignee value.
 */
export function buildRosterIdentity(member: StandupRosterMember): PersonIdentity {
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
 * Searches Jira for the person, prefers the candidate whose username or display name matches exactly
 * (whitespace-collapsed, case-insensitive), and otherwise takes the first result. Returns null when no
 * user matches at all, so the caller can report it without firing a query Jira will reject.
 */
export async function resolvePersonIdentity(person: string): Promise<PersonIdentity | null> {
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
export async function resolveRosterIdentity(member: StandupRosterMember): Promise<PersonIdentity | null> {
  if (member.jiraAccountId !== undefined && member.jiraAccountId.trim() !== '') {
    return buildRosterIdentity(member);
  }
  const resolved = await resolvePersonIdentity(member.assigneeQueryValue);
  const identity = resolved ?? buildRosterIdentity(member);
  // A member with no accountId, no Jira match, and a blank assignee value has nothing to query by.
  return identity.queryValue.trim() === '' ? null : identity;
}

/** A roster member's resolved machine id, or null when Jira could not resolve them. */
export interface ResolvedRosterMember {
  member: StandupRosterMember;
  queryValue: string | null;
}

/**
 * Resolves a whole roster to the machine ids a single `assignee WAS in (…)` clause can query by.
 *
 * This is what the Flow Analysis report needs: it queries the roster as one clause rather than one
 * person at a time, so it must translate every display name to a machine id BEFORE building the clause.
 * Members Jira cannot resolve are returned with a null query value rather than dropped, so the caller
 * can report who was left out instead of silently narrowing the roster.
 */
export async function resolveRosterMachineIds(
  rosterMembers: readonly StandupRosterMember[],
): Promise<ResolvedRosterMember[]> {
  return Promise.all(
    rosterMembers.map(async (member) => ({
      member,
      queryValue: (await resolveRosterIdentity(member))?.queryValue ?? null,
    })),
  );
}
