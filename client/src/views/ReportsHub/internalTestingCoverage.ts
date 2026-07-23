// internalTestingCoverage.ts — Who is actually doing this team's internal testing?
//
// The question behind this: internal testing keeps being finished by people who are not on the team,
// and there is no number to show how often. This produces that number.
//
// It answers two related things from the same stage data:
//   • COVERAGE GAP — internal testing done by anyone off the roster. "How much of our internal
//     testing isn't ours?"
//   • HANDED AWAY — our own internal tester held it, then someone off-roster finished the testing.
//     "We start it and cannot finish it." Always a subset of the coverage gap.
//
// ── Why the headline is a count of issues, not a total of days ───────────────
//
// This figure will be read by people deciding whether to fund a role, so it has to survive someone
// trying to dismiss it. Elapsed holding time is NOT effort: a tester holding fifteen issues accrues
// elapsed days on all fifteen simultaneously. Presenting days as person-days would be wrong, and one
// number that collapses under scrutiny discredits every other number beside it. Days are therefore
// reported as elapsed holding time only, and this module deliberately exposes no FTE or effort field.
//
// ── Why every outsider is named ─────────────────────────────────────────────
//
// The roster is maintained by hand, so a new joiner nobody added looks exactly like an outsider.
// Naming each person turns a wrong number into an obvious roster gap the reader can fix, instead of
// publishing it as a finding.

import type { IssueFlow, FlowStage } from './issueFlow.ts';
import type { StandupRosterMember } from '../SprintDashboard/hooks/useStandupRosterStore.ts';

/** One person outside the roster who did internal testing, and how much of it. */
export interface OffRosterTester {
  holderName: string;
  issueCount: number;
  /** Elapsed working days they held issues in an internal-testing status. NOT effort — see above. */
  elapsedWorkingDays: number;
  issueKeys: string[];
}

/** The internal-testing coverage picture for one run. */
export interface InternalTestingCoverage {
  /** False when no internal-testing statuses are configured; every count is then zero. */
  isConfigured: boolean;
  /** Delivered issues that entered an internal-testing status at all — the denominator. */
  issuesWithInternalTestingCount: number;
  /** Of those, how many had internal testing done by someone off the roster. The headline. */
  issuesTestedOffRosterCount: number;
  /** Of those, how many a roster internal tester handled. */
  issuesTestedByRosterTesterCount: number;
  /** Our tester held it in testing, then an off-roster person did. A subset of the off-roster count. */
  issuesHandedOffRosterCount: number;
  /** Issues that sat in an internal-testing status with nobody assigned. Never blamed on an outsider. */
  issuesUnassignedInTestingCount: number;
  /** Percentage of internally-tested issues that went off-roster; null when there were none. */
  offRosterSharePercent: number | null;
  /** Every off-roster person by name, busiest first. */
  offRosterTesters: OffRosterTester[];
}

export interface InternalTestingCoverageInput {
  issueFlows: readonly IssueFlow[];
  rosterMembers: readonly StandupRosterMember[];
  /** The statuses that mean "internal testing", as configured by the user. Never guessed. */
  internalTestingStatusNames: readonly string[];
}

/** Lower-cases and trims a value for comparison, tolerating the many shapes Jira stores names in. */
function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Builds the set of every identifier the roster knows for its members.
 *
 * Jira Server stores a user KEY on a changelog's machine side and the DISPLAY NAME on its text side,
 * so matching only one side would mark the team's own tester as an outsider — and inflate the very
 * figure this report exists to state carefully.
 */
function buildRosterIdentifiers(rosterMembers: readonly StandupRosterMember[]): Set<string> {
  const identifiers = new Set<string>();
  rosterMembers.forEach((member) => {
    [member.assigneeQueryValue, member.displayName, member.jiraAccountId, member.lanId]
      .map(normalize)
      .filter((identifier) => identifier !== '')
      .forEach((identifier) => identifiers.add(identifier));
  });
  return identifiers;
}

/** The identifiers of roster members who are able to perform internal testing. */
function buildInternalTesterIdentifiers(rosterMembers: readonly StandupRosterMember[]): Set<string> {
  return buildRosterIdentifiers(
    rosterMembers.filter((member) => member.roleCapabilities?.canInternalTest === true),
  );
}

/** True when a stage's holder is one of the given people. */
function isHeldBy(stage: FlowStage, identifiers: ReadonlySet<string>): boolean {
  if (stage.holder.holderId === null) return false;
  return identifiers.has(normalize(stage.holder.holderId))
    || identifiers.has(normalize(stage.holder.holderName));
}

/**
 * Summarises who performed internal testing across a set of delivered issues.
 *
 * Returns an unconfigured, all-zero summary when no internal-testing statuses have been supplied.
 * Guessing which statuses count would put a fabricated staffing claim in front of a funding decision.
 */
export function summariseInternalTestingCoverage(
  input: InternalTestingCoverageInput,
): InternalTestingCoverage {
  const testingStatusNames = new Set(input.internalTestingStatusNames.map(normalize));
  if (testingStatusNames.size === 0) {
    return buildEmptyCoverage(false);
  }

  const rosterIdentifiers = buildRosterIdentifiers(input.rosterMembers);
  const internalTesterIdentifiers = buildInternalTesterIdentifiers(input.rosterMembers);
  const offRosterTestersByName = new Map<string, OffRosterTester>();

  let issuesWithInternalTestingCount = 0;
  let issuesTestedOffRosterCount = 0;
  let issuesTestedByRosterTesterCount = 0;
  let issuesHandedOffRosterCount = 0;
  let issuesUnassignedInTestingCount = 0;

  for (const issueFlow of input.issueFlows) {
    // Chronological order is what makes "handed away" distinguishable from "handed back".
    const testingStages = issueFlow.stages
      .filter((stage) => testingStatusNames.has(normalize(stage.statusName)))
      .sort((first, second) => Date.parse(first.fromIso) - Date.parse(second.fromIso));
    if (testingStages.length === 0) continue;

    issuesWithInternalTestingCount += 1;

    const offRosterStages = testingStages.filter((stage) =>
      stage.holder.holderId !== null && !isHeldBy(stage, rosterIdentifiers));
    if (offRosterStages.length > 0) issuesTestedOffRosterCount += 1;
    if (testingStages.some((stage) => isHeldBy(stage, internalTesterIdentifiers))) {
      issuesTestedByRosterTesterCount += 1;
    }
    if (testingStages.some((stage) => stage.holder.holderId === null)) {
      issuesUnassignedInTestingCount += 1;
    }
    if (wasHandedOffRoster(testingStages, rosterIdentifiers, internalTesterIdentifiers)) {
      issuesHandedOffRosterCount += 1;
    }

    recordOffRosterTesters(offRosterStages, issueFlow.issueKey, offRosterTestersByName);
  }

  return {
    isConfigured: true,
    issuesWithInternalTestingCount,
    issuesTestedOffRosterCount,
    issuesTestedByRosterTesterCount,
    issuesHandedOffRosterCount,
    issuesUnassignedInTestingCount,
    offRosterSharePercent: issuesWithInternalTestingCount === 0
      ? null
      : (issuesTestedOffRosterCount / issuesWithInternalTestingCount) * 100,
    offRosterTesters: [...offRosterTestersByName.values()]
      .sort((first, second) => second.issueCount - first.issueCount),
  };
}

/**
 * True when one of the team's own internal testers held the issue in testing BEFORE an off-roster
 * person did.
 *
 * Order is deliberate. An outsider who started the testing and handed it back to the team is a
 * different situation, and counting it here would overstate the case this figure is meant to support.
 */
function wasHandedOffRoster(
  testingStages: readonly FlowStage[],
  rosterIdentifiers: ReadonlySet<string>,
  internalTesterIdentifiers: ReadonlySet<string>,
): boolean {
  const firstRosterTesterIndex = testingStages
    .findIndex((stage) => isHeldBy(stage, internalTesterIdentifiers));
  if (firstRosterTesterIndex === -1) return false;

  return testingStages
    .slice(firstRosterTesterIndex + 1)
    .some((stage) => stage.holder.holderId !== null && !isHeldBy(stage, rosterIdentifiers));
}

/** Accumulates each off-roster person's issues and elapsed holding time. */
function recordOffRosterTesters(
  offRosterStages: readonly FlowStage[],
  issueKey: string,
  offRosterTestersByName: Map<string, OffRosterTester>,
): void {
  for (const stage of offRosterStages) {
    const existing = offRosterTestersByName.get(stage.holder.holderName) ?? {
      holderName: stage.holder.holderName,
      issueCount: 0,
      elapsedWorkingDays: 0,
      issueKeys: [],
    };
    // One issue counts once per person however many testing stints they had on it.
    if (!existing.issueKeys.includes(issueKey)) {
      existing.issueCount += 1;
      existing.issueKeys.push(issueKey);
    }
    existing.elapsedWorkingDays += stage.workingDays;
    offRosterTestersByName.set(stage.holder.holderName, existing);
  }
}

/** The all-zero summary used when internal-testing statuses have not been configured. */
function buildEmptyCoverage(isConfigured: boolean): InternalTestingCoverage {
  return {
    isConfigured,
    issuesWithInternalTestingCount: 0,
    issuesTestedOffRosterCount: 0,
    issuesTestedByRosterTesterCount: 0,
    issuesHandedOffRosterCount: 0,
    issuesUnassignedInTestingCount: 0,
    offRosterSharePercent: null,
    offRosterTesters: [],
  };
}
