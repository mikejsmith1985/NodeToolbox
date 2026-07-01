// resolveReporter.ts — Resolves a submitter's email to a Jira reporter, or falls back to the
// integration account. Pure over an injected user-search function so it is fully unit-testable.
// See contracts/intake-contracts.md §C and research.md R4.
//
// A "matched" outcome sets reporter by username (Data Center uses `name`, not accountId). A
// "fallback" outcome (no unique match, or a lookup error) means the create hook omits `reporter`,
// so Jira attributes the issue to the /jira-proxy account (the integration account) and the
// submitter's origin is recorded in the description (US2).

import type { JiraUser } from '../../../types/jira.ts';

export type ReporterResolution =
  | { outcome: 'matched'; reporter: { name: string } }
  | { outcome: 'fallback'; reporter: null };

/** Dependencies injected so the resolver stays pure and mockable. */
export interface ResolveReporterDeps {
  searchUsers: (query: string) => Promise<JiraUser[]>;
}

const FALLBACK: ReporterResolution = { outcome: 'fallback', reporter: null };

/**
 * Returns a matched reporter only when exactly one searched user's email matches (case-insensitive)
 * and that user has a usable Data Center username/key. Every other case is a safe fallback.
 */
export async function resolveReporter(email: string, deps: ResolveReporterDeps): Promise<ReporterResolution> {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail === '') {
    return FALLBACK;
  }

  let candidates: JiraUser[];
  try {
    candidates = await deps.searchUsers(email.trim());
  } catch {
    return FALLBACK;
  }

  const emailMatches = (candidates ?? []).filter(
    (candidate) => candidate.emailAddress?.trim().toLowerCase() === normalizedEmail,
  );
  if (emailMatches.length !== 1) {
    return FALLBACK;
  }

  const reporterUsername = emailMatches[0].name ?? emailMatches[0].key;
  if (!reporterUsername) {
    return FALLBACK;
  }
  return { outcome: 'matched', reporter: { name: reporterUsername } };
}
