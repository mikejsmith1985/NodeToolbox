// myIssuesRoleLens.ts — Pure persona logic for the My Issues "personas" feature (023 / US6).
//
// This module has NO side effects and performs NO Jira writes. It answers three questions:
//   1. Whose issues should the report show? (buildAssigneeJql, driven by a ReportSubject)
//   2. Which sections should a given role emphasise? (myIssuesRoleLens)
//   3. Which role should a roster member default to? (defaultRoleFromCapabilities)
// Keeping this logic pure lets the report surfaces "agree by construction" and stay fully testable.

import type { RosterRoleCapabilities } from '../SprintDashboard/hooks/useStandupRosterStore.ts';

// ── Types ──

/**
 * Who the My Issues report is currently showing.
 * - `viewer`  — the signed-in user (the byte-identical default, `assignee = currentUser()`)
 * - `user`    — a simulated Jira user picked from the user-search control
 * - `team`    — every roster member of one team (Scrum Master / Product Owner team view)
 */
export type ReportSubject =
  | { kind: 'viewer' }
  | { kind: 'user'; accountId: string; displayName: string }
  | { kind: 'team'; teamName: string };

/** The four role lenses a persona can view the report through. */
export type RoleLens = 'dev' | 'tester' | 'sm' | 'po';

/** The emphasis a role lens applies — a pinned, ordered list of section labels. */
export interface RoleLensEmphasis {
  emphasizedCriteria: string[];
}

// ── Named constants ──

// The trailing keyword used to quote-wrap an assignee identifier inside a JQL `in (...)` clause.
const JQL_QUOTE = '"';

// PINNED role-lens emphasis. These labels are contract-fixed (FR-021) so both the pure module and
// the rendered sections always agree on what each role cares about. Order is meaningful.
const ROLE_LENS_EMPHASIS: Record<RoleLens, string[]> = {
  dev: ['In progress', 'Blocked', 'Needs estimate'],
  tester: ['Ready for QA', 'In test'],
  sm: ['Team blockers', 'Hygiene flags', 'Flow (aging / WIP)'],
  po: ['Feature readiness', 'Backlog hygiene (ownership / estimate / fixVersion)'],
};

// ── Assignee JQL ──

/** Quotes a single assignee identifier for a JQL `in (...)` list, escaping any embedded quotes. */
function quoteAssigneeIdentifier(assigneeIdentifier: string): string {
  const escapedIdentifier = assigneeIdentifier.replace(/"/g, '\\"');
  return `${JQL_QUOTE}${escapedIdentifier}${JQL_QUOTE}`;
}

/**
 * Builds the assignee clause of the My Issues JQL for the given subject.
 *
 * The viewer clause is intentionally `assignee = currentUser()` so that, combined with the report's
 * fixed suffix, the "viewer" default stays byte-identical to the pre-persona behaviour. Team subjects
 * take their member identifiers as an argument so this module never reaches into the roster store.
 */
export function buildAssigneeJql(subject: ReportSubject, memberIdentifiers: string[] = []): string {
  if (subject.kind === 'viewer') {
    return 'assignee = currentUser()';
  }

  if (subject.kind === 'user') {
    return `assignee = ${quoteAssigneeIdentifier(subject.accountId)}`;
  }

  // Team subject: quote every roster member identifier the caller resolved for the team.
  const quotedIdentifiers = memberIdentifiers.map(quoteAssigneeIdentifier).join(', ');
  return `assignee in (${quotedIdentifiers})`;
}

// ── Role lens emphasis ──

/** Returns the pinned emphasis (section labels) for a role lens. */
export function myIssuesRoleLens(role: RoleLens): RoleLensEmphasis {
  return { emphasizedCriteria: ROLE_LENS_EMPHASIS[role] };
}

// ── Default role from roster capabilities ──

/**
 * Chooses the most fitting default role lens for a roster member from their capabilities.
 * Coordination roles win first (a Scrum Master or Product Owner leads regardless of other flags),
 * then testing, then development as the catch-all. Absent capabilities default to Dev.
 */
export function defaultRoleFromCapabilities(
  roleCapabilities: RosterRoleCapabilities | undefined,
): RoleLens {
  if (!roleCapabilities) {
    return 'dev';
  }

  if (roleCapabilities.canScrumMaster) {
    return 'sm';
  }

  if (roleCapabilities.canProductOwner) {
    return 'po';
  }

  if (roleCapabilities.canInternalTest || roleCapabilities.canExternalTest) {
    return 'tester';
  }

  return 'dev';
}
