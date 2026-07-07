// planItemMapping.ts — Pure role-classification + PlanItem mapping (feature 013, Layer 2).
//
// This module turns two upstream inputs — the normalized Jira issues the future fetch layer produces,
// and the team roster's role capabilities — into the pure data the deterministic capacity engine
// consumes (PersonCapacity[] and PlanItem[]). It implements the assignee-role-first classification
// (FR-7), the structure-first labelling (FR-8), and the synthesized internal-test cost (FR-8a, Option A).
// Everything here is pure: no clock, no fetch, no storage — identical input always yields identical output.

import type {
  RosterRoleCapabilities,
  StandupRosterMember,
} from '../../SprintDashboard/hooks/useStandupRosterStore.ts';
import type { DeliveryRole, PersonCapacity, PlanItem } from './capacityTypes.ts';

// ── Named constants (no magic numbers) ───────────────────────────────────────

/** External-testing work lives in this Jira project; a linked DIP issue is external-test effort (FR-7). */
const EXTERNAL_TEST_PROJECT_KEY = 'DIP';
/** A person's flat pool of points per 2-week sprint, unless the caller overrides it. */
const DEFAULT_POINTS_PER_SPRINT = 8;
/** Internal-test cost synthesized for a testless dev item, as this fraction of its dev points (FR-8a). */
const DEFAULT_SYNTHETIC_TEST_FRACTION = 0.5;
/** Bucket a secondary item falls back to when its parent cannot be found (scheduled with the rest of Could). */
const ORPHAN_FALLBACK_BUCKET: PlanItem['bucket'] = 'Could';
/** Rank a parentless secondary item falls back to — last, so it never jumps ahead of ranked work. */
const ORPHAN_FALLBACK_RANK = Number.MAX_SAFE_INTEGER;

/** The normalized Jira issue the fetch layer produces upstream; the sole input to this mapping module. */
export interface PlannerSourceIssue {
  key: string;
  summary: string;
  issueType: string; // 'Story' | 'Defect' | 'Sub-task' | 'QA' | ...
  isSubtask: boolean;
  projectKey: string; // e.g. 'DENP', 'DIP'
  storyPoints: number | null;
  assignee: string | null; // display name
  /** For a PRIMARY board item (story/defect/feature): its MoSCoW bucket + intra-bucket rank. */
  bucket?: 'Must' | 'Should' | 'Could' | 'Wont';
  rankInBucket?: number;
  /** For a SECONDARY item (sub-task or DIP external issue): the primary team issue it belongs to,
   *  used to inherit bucket/rank. Sub-task → its parent; DIP external → the linked team issue. */
  parentKey?: string | null;
}

// ── Roster → capacity ─────────────────────────────────────────────────────────

/** Derives the delivery roles a person can perform from their roster capabilities (SM/PO/SA add none). */
function deriveDeliveryRoles(capabilities: RosterRoleCapabilities | undefined): DeliveryRole[] {
  if (capabilities === undefined) {
    return [];
  }
  const roles: DeliveryRole[] = [];
  // Dev Lead is development capacity too (FR-5, D6), so either flag grants the dev role.
  if (capabilities.canDevelop || capabilities.canDevLead) {
    roles.push('dev');
  }
  if (capabilities.canInternalTest) {
    roles.push('internalTest');
  }
  if (capabilities.canExternalTest) {
    roles.push('externalTest');
  }
  return roles;
}

/**
 * Maps roster members to the capacity engine's PersonCapacity list, keeping only people who hold at
 * least one delivery role. Each person is a single flat pool of `pointsPerSprint` (default 8) spendable
 * across every delivery role they hold; SM/PO/SA-only members are dropped because they add no capacity.
 */
export function mapRosterToCapacity(
  rosterMembers: readonly StandupRosterMember[],
  pointsPerSprint: number = DEFAULT_POINTS_PER_SPRINT,
): PersonCapacity[] {
  const capacities: PersonCapacity[] = [];
  for (const member of rosterMembers) {
    const roles = deriveDeliveryRoles(member.roleCapabilities);
    if (roles.length === 0) {
      continue;
    }
    capacities.push({ displayName: member.displayName, roles, pointsPerSprint });
  }
  return capacities;
}

// ── Assignee → roster matching ────────────────────────────────────────────────

/** Normalizes a name for matching: collapse internal whitespace, trim, lowercase (mirrors the roster store). */
function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Finds the roster member an issue's assignee refers to (case-insensitive on displayName or query value). */
function findRosterMember(
  assignee: string | null,
  rosterMembers: readonly StandupRosterMember[],
): StandupRosterMember | null {
  if (assignee === null) {
    return null;
  }
  const normalizedAssignee = normalizeName(assignee);
  if (!normalizedAssignee) {
    return null;
  }
  return (
    rosterMembers.find(
      (member) =>
        normalizeName(member.displayName) === normalizedAssignee ||
        normalizeName(member.assigneeQueryValue) === normalizedAssignee,
    ) ?? null
  );
}

/** True when the issue carries a non-empty parent link (a sub-task's parent or a DIP external link). */
function hasParentLink(issue: PlannerSourceIssue): boolean {
  return typeof issue.parentKey === 'string' && issue.parentKey.length > 0;
}

// ── Role classification (FR-7 precedence) ─────────────────────────────────────

/**
 * Classifies one issue's delivery role using the assignee-role-first precedence (FR-7):
 *   1. externalTest — a DIP issue linked to a team issue, OR an assignee who can external-test.
 *   2. internalTest — an assignee who can internal-test, OR (no delivery-capable assignee AND a sub-task).
 *   3. dev — everything else.
 * Structural signals and the assignee's roster role decide the label; no summary/description reading (FR-8).
 */
export function classifyIssueRole(
  issue: PlannerSourceIssue,
  rosterMembers: readonly StandupRosterMember[],
): DeliveryRole {
  const member = findRosterMember(issue.assignee, rosterMembers);
  const capabilities = member?.roleCapabilities;

  // 1. External test: a linked DIP issue, or an assignee who holds the external-tester role.
  const isDipLinked = issue.projectKey === EXTERNAL_TEST_PROJECT_KEY && hasParentLink(issue);
  if (isDipLinked || capabilities?.canExternalTest === true) {
    return 'externalTest';
  }

  // 2. Internal test: an internal-tester assignee, or a sub-task with no delivery-capable owner.
  const hasDeliveryCapableAssignee = member !== null && deriveDeliveryRoles(capabilities).length > 0;
  if (capabilities?.canInternalTest === true || (!hasDeliveryCapableAssignee && issue.isSubtask)) {
    return 'internalTest';
  }

  // 3. Development: assigned developers/dev-leads, and unassigned non-sub-tasks.
  return 'dev';
}

// ── Bucket / rank inheritance ─────────────────────────────────────────────────

/** The resolved priority position a plan item occupies. */
interface BucketRank {
  bucket: PlanItem['bucket'];
  rankInBucket: number;
}

/** True when the issue is a SECONDARY item (a sub-task, or a DIP external issue linked to a parent). */
function isSecondaryItem(issue: PlannerSourceIssue): boolean {
  return issue.isSubtask || (issue.projectKey === EXTERNAL_TEST_PROJECT_KEY && hasParentLink(issue));
}

/** Indexes every PRIMARY issue's bucket + rank by key, so secondary items can inherit from their parent. */
function buildPrimaryBucketRankIndex(issues: readonly PlannerSourceIssue[]): Map<string, BucketRank> {
  const primaryByKey = new Map<string, BucketRank>();
  for (const issue of issues) {
    if (isSecondaryItem(issue) || issue.bucket === undefined) {
      continue;
    }
    primaryByKey.set(issue.key, { bucket: issue.bucket, rankInBucket: issue.rankInBucket ?? ORPHAN_FALLBACK_RANK });
  }
  return primaryByKey;
}

/** Resolves an issue's bucket + rank: primary items carry their own; secondary items inherit their parent's. */
function resolveBucketRank(issue: PlannerSourceIssue, primaryByKey: Map<string, BucketRank>): BucketRank {
  if (isSecondaryItem(issue)) {
    const parent = issue.parentKey ? primaryByKey.get(issue.parentKey) : undefined;
    // A secondary item whose parent is absent is never dropped — it schedules last, with the rest of Could.
    return parent ?? { bucket: ORPHAN_FALLBACK_BUCKET, rankInBucket: ORPHAN_FALLBACK_RANK };
  }
  return { bucket: issue.bucket ?? ORPHAN_FALLBACK_BUCKET, rankInBucket: issue.rankInBucket ?? ORPHAN_FALLBACK_RANK };
}

// ── Synthesis bookkeeping (Option A) ──────────────────────────────────────────

/** Collects the keys of primary issues that already have a real internal-test child (so we never synthesize twice). */
function buildKeysWithInternalTestChild(
  classifiedIssues: readonly { issue: PlannerSourceIssue; role: DeliveryRole }[],
): Set<string> {
  const keysWithInternalTestChild = new Set<string>();
  for (const { issue, role } of classifiedIssues) {
    if (role === 'internalTest' && hasParentLink(issue)) {
      keysWithInternalTestChild.add(issue.parentKey as string);
    }
  }
  return keysWithInternalTestChild;
}

// ── Public entry point: buildPlanItems ────────────────────────────────────────

/**
 * Maps classified source issues into engine-ready PlanItems. Each issue becomes exactly one PlanItem
 * whose classified role carries its story points (the other two point fields are null); secondary items
 * inherit their parent's bucket + rank. For a dev item with NO real internal-test child, an estimated
 * internal-test cost is synthesized at `syntheticTestFraction` of its dev points (Option A, FR-8a) so
 * testing effort is neither dropped nor double-counted. Pure and reproducible.
 */
export function buildPlanItems(
  issues: readonly PlannerSourceIssue[],
  rosterMembers: readonly StandupRosterMember[],
  syntheticTestFraction: number = DEFAULT_SYNTHETIC_TEST_FRACTION,
): PlanItem[] {
  const primaryByKey = buildPrimaryBucketRankIndex(issues);
  const classifiedIssues = issues.map((issue) => ({ issue, role: classifyIssueRole(issue, rosterMembers) }));
  const keysWithInternalTestChild = buildKeysWithInternalTestChild(classifiedIssues);

  return classifiedIssues.map(({ issue, role }): PlanItem => {
    const { bucket, rankInBucket } = resolveBucketRank(issue, primaryByKey);
    // A null story point count is treated as 0: the item is still created (visible/ordered), just weightless.
    const rolePoints = issue.storyPoints ?? 0;

    let devPoints: number | null = role === 'dev' ? rolePoints : null;
    let internalTestPoints: number | null = role === 'internalTest' ? rolePoints : null;
    const externalTestPoints: number | null = role === 'externalTest' ? rolePoints : null;
    let isTestEstimated = false;

    // Option A synthesis: only a dev item with real dev work and no real internal-test child gets an estimate.
    const shouldSynthesizeTest =
      role === 'dev' && devPoints !== null && devPoints > 0 && !keysWithInternalTestChild.has(issue.key);
    if (shouldSynthesizeTest) {
      internalTestPoints = Math.round((devPoints ?? 0) * syntheticTestFraction);
      isTestEstimated = true;
    }

    return {
      key: issue.key,
      summary: issue.summary,
      bucket,
      rankInBucket,
      devPoints,
      internalTestPoints,
      externalTestPoints,
      isTestEstimated,
      assignee: issue.assignee,
    };
  });
}
