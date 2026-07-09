// personalFlowRoleRollup.ts — Pure aggregation of Personal Flow results into a "throughput by role" table.
//
// The Personal Flow team report computes one flow result per roster member. This module regroups those
// per-person results by the roster ROLE each member can perform (Developer, Internal Tester, …) and sums
// the additive volume and rate metrics per role, pooling every credited issue's hands-on cycle time for
// an average and median. Its reason for existing is to expose a staffing bottleneck: when many developers
// feed a single internal tester, the Developer role's throughput visibly dwarfs the Internal Tester's.
//
// It takes no clock and reads no external state, so identical input always yields identical output.

import type { RosterRoleCapabilities } from '../SprintDashboard/hooks/useStandupRosterStore.ts';
import type { PersonalFlowResult } from './personalFlow.ts';

// ── Public types ─────────────────────────────────────────────────────────────

/** One rolled-up row: a role plus the summed throughput and pooled cycle-time statistics of its people. */
export interface RoleThroughput {
  roleKey: keyof RosterRoleCapabilities;
  roleLabel: string;
  peopleCount: number; // how many people with a computed result can perform this role
  issueCount: number; // summed issues advanced across those people
  totalStoryPoints: number; // summed story points across those people
  issuesPerWeek: number; // summed issues/week rate (rates are additive across people)
  pointsPerWeek: number; // summed points/week rate
  averageCycleDays: number | null; // mean of the pooled per-issue cycle times (null when the pool is empty)
  medianCycleDays: number | null; // median of the pooled per-issue cycle times (null when the pool is empty)
}

/**
 * The canonical role order and labels this rollup renders. It intentionally MIRRORS the roster's
 * ROSTER_ROLE_OPTIONS (in `SprintDashboard/RosterTab.tsx`) so the throughput table lists roles in the
 * same order a reader sees them on the roster. Keep the two lists in step if a role is ever added.
 */
export const TEAM_ROLE_DEFINITIONS: ReadonlyArray<{ key: keyof RosterRoleCapabilities; label: string }> = [
  { key: 'canDevelop', label: 'Developer' },
  { key: 'canInternalTest', label: 'Internal Tester' },
  { key: 'canExternalTest', label: 'External Tester' },
  { key: 'canScrumMaster', label: 'Scrum Master' },
  { key: 'canProductOwner', label: 'Product Owner' },
  { key: 'canSolutionArchitect', label: 'Solution Architect' },
  { key: 'canDevLead', label: 'Dev Lead' },
];

/** A person to fold into the rollup: their role capabilities plus their computed flow result (null = skip). */
export interface RoleRollupEntry {
  roleCapabilities?: RosterRoleCapabilities;
  result: PersonalFlowResult | null;
}

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Rolls up per-person flow results into one throughput row per role, in TEAM_ROLE_DEFINITIONS order.
 *
 * A role's row sums the issue count, story points, and per-week rates of every person who both has a
 * computed result AND can perform that role, and pools those people's per-issue cycle times for a mean
 * and median. Roles with no qualifying people are omitted entirely (never a zero row).
 *
 * The overlap is INTENTIONAL and not deduplicated: a person with several roles is counted under EACH of
 * them, so the summed totals across roles can exceed the team total. This is what lets the table contrast
 * a role many people share (e.g. Developer) against a role held by a single person (e.g. Internal Tester)
 * to surface a staffing bottleneck.
 */
export function rollUpThroughputByRole(entries: ReadonlyArray<RoleRollupEntry>): RoleThroughput[] {
  const rolledUpRows: RoleThroughput[] = [];
  for (const definition of TEAM_ROLE_DEFINITIONS) {
    const membersInRole = selectMembersForRole(entries, definition.key);
    if (membersInRole.length === 0) {
      continue; // omit empty roles rather than render a misleading all-zero row
    }
    rolledUpRows.push(buildRoleThroughput(definition, membersInRole));
  }
  return rolledUpRows;
}

// ── Aggregation helpers ──────────────────────────────────────────────────────

/** Selects the results of every entry that has a non-null result AND can perform the given role. */
function selectMembersForRole(
  entries: ReadonlyArray<RoleRollupEntry>,
  roleKey: keyof RosterRoleCapabilities,
): PersonalFlowResult[] {
  const selected: PersonalFlowResult[] = [];
  for (const entry of entries) {
    if (entry.result !== null && entry.roleCapabilities?.[roleKey] === true) {
      selected.push(entry.result);
    }
  }
  return selected;
}

/** Builds one role's rolled-up row by summing volume/rates and pooling cycle times across its members. */
function buildRoleThroughput(
  definition: { key: keyof RosterRoleCapabilities; label: string },
  membersInRole: readonly PersonalFlowResult[],
): RoleThroughput {
  const pooledCycleTimes = poolPositiveCycleTimes(membersInRole);
  return {
    roleKey: definition.key,
    roleLabel: definition.label,
    peopleCount: membersInRole.length,
    issueCount: sumBy(membersInRole, (result) => result.issueCount),
    totalStoryPoints: sumBy(membersInRole, (result) => result.totalStoryPoints),
    issuesPerWeek: sumBy(membersInRole, (result) => result.throughput.issuesPerWeek),
    pointsPerWeek: sumBy(membersInRole, (result) => result.throughput.pointsPerWeek),
    averageCycleDays: pooledCycleTimes.length === 0 ? null : computeMean(pooledCycleTimes),
    medianCycleDays: pooledCycleTimes.length === 0 ? null : computeMedianOfSorted(pooledCycleTimes),
  };
}

/**
 * Pools every credited issue's cycle time across the role's members into one ascending list, keeping only
 * real measured durations (non-null and strictly positive) so unmeasured completions never distort the mean.
 */
function poolPositiveCycleTimes(membersInRole: readonly PersonalFlowResult[]): number[] {
  const pooledCycleTimes: number[] = [];
  for (const result of membersInRole) {
    for (const issueMetric of result.perIssue) {
      if (issueMetric.cycleTimeDays !== null && issueMetric.cycleTimeDays > 0) {
        pooledCycleTimes.push(issueMetric.cycleTimeDays);
      }
    }
  }
  return pooledCycleTimes.sort((first, second) => first - second);
}

/** Sums a numeric field selected from each result. */
function sumBy(
  results: readonly PersonalFlowResult[],
  selectValue: (result: PersonalFlowResult) => number,
): number {
  return results.reduce((runningTotal, result) => runningTotal + selectValue(result), 0);
}

/** Returns the arithmetic mean of a non-empty list of numbers. */
function computeMean(values: readonly number[]): number {
  const total = values.reduce((runningTotal, value) => runningTotal + value, 0);
  return total / values.length;
}

/**
 * Returns the median of an already-ascending, non-empty list: the middle value for an odd count, or the
 * mean of the two middle values for an even count.
 */
function computeMedianOfSorted(sortedValues: readonly number[]): number {
  const middleIndex = Math.floor(sortedValues.length / 2);
  const hasOddCount = sortedValues.length % 2 === 1;
  if (hasOddCount) return sortedValues[middleIndex];
  return (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2;
}
