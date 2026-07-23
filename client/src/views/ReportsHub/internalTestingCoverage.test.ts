// internalTestingCoverage.test.ts — Tests for "who is actually doing our internal testing?".
//
// This metric exists to support a staffing case, which means it will be read by people looking for a
// reason to dismiss it. Three of the tests below exist purely to keep it defensible:
//
//   • the headline is a COUNT OF ISSUES, not a day total. Elapsed holding time is not effort — a
//     tester holding fifteen issues accrues elapsed days on all fifteen at once — so days are
//     reported as elapsed only, and never summed into anything resembling an FTE.
//   • every off-roster person is NAMED. The roster is hand-maintained, so a new joiner nobody added
//     looks identical to an outsider. Naming them turns a wrong number into an obvious roster gap.
//   • an unassigned queue is never counted as an outsider doing the work.

import { describe, expect, it } from 'vitest';

import { summariseInternalTestingCoverage } from './internalTestingCoverage.ts';
import type { IssueFlow, FlowStage } from './issueFlow.ts';
import type { StandupRosterMember } from '../SprintDashboard/hooks/useStandupRosterStore.ts';

const INTERNAL_TESTING_STATUS_NAMES = ['Testing', 'Ready for Testing'];

const ROSTER: StandupRosterMember[] = [
  {
    id: 'roster-member:sam',
    displayName: 'Tester, Sam (CTR)',
    assigneeQueryValue: 'sam.qa',
    roleCapabilities: { canDevelop: false, canInternalTest: true, canExternalTest: false },
  },
  {
    id: 'roster-member:jane',
    displayName: 'Dev, Jane (CTR)',
    assigneeQueryValue: 'jane.dev',
    roleCapabilities: { canDevelop: true, canInternalTest: false, canExternalTest: false },
  },
];

/** Builds one stage; only the fields this summary reads are meaningful. */
function buildStage(
  statusName: string,
  holderId: string | null,
  holderName: string,
  workingDays = 2,
  fromIso = '2026-07-01T00:00:00.000Z',
): FlowStage {
  return {
    fromIso,
    toIso: '2026-07-03T00:00:00.000Z',
    statusId: statusName,
    statusName,
    holder: { holderId, holderName },
    flowClass: 'active',
    workingDays,
  };
}

function buildFlow(issueKey: string, stages: FlowStage[]): IssueFlow {
  const leadTimeWorkingDays = stages.reduce((total, stage) => total + stage.workingDays, 0);
  return {
    issueKey,
    issueSummary: `${issueKey} summary`,
    storyPoints: 3,
    completedIso: '2026-07-10T00:00:00.000Z',
    stages,
    leadTimeWorkingDays,
    cycleTimeWorkingDays: leadTimeWorkingDays,
    preWorkWaitWorkingDays: 0,
  };
}

function summarise(issueFlows: IssueFlow[]) {
  return summariseInternalTestingCoverage({
    issueFlows,
    rosterMembers: ROSTER,
    internalTestingStatusNames: INTERNAL_TESTING_STATUS_NAMES,
  });
}

describe('summariseInternalTestingCoverage — the coverage gap', () => {
  it('counts an issue whose internal testing was done by someone off the roster', () => {
    const summary = summarise([
      buildFlow('COV-1', [
        buildStage('In Progress', 'jane.dev', 'Dev, Jane (CTR)'),
        buildStage('Testing', 'outsider', 'Outsider, Pat'),
      ]),
    ]);

    expect(summary.issuesTestedOffRosterCount).toBe(1);
    expect(summary.issuesWithInternalTestingCount).toBe(1);
  });

  it('does not count an issue your own internal tester tested', () => {
    const summary = summarise([
      buildFlow('COV-2', [
        buildStage('In Progress', 'jane.dev', 'Dev, Jane (CTR)'),
        buildStage('Testing', 'sam.qa', 'Tester, Sam (CTR)'),
      ]),
    ]);

    expect(summary.issuesTestedOffRosterCount).toBe(0);
    expect(summary.issuesTestedByRosterTesterCount).toBe(1);
  });

  it('matches a roster member by display name when the changelog carried a user key', () => {
    // Jira Server puts a user KEY in the changelog's machine side and the DISPLAY NAME in the text
    // side. Matching only the machine id would mark your own tester as an outsider.
    const summary = summarise([
      buildFlow('COV-3', [buildStage('Testing', 'JIRAUSER22200', 'Tester, Sam (CTR)')]),
    ]);

    expect(summary.issuesTestedOffRosterCount).toBe(0);
  });

  it('reports the share of internally-tested issues that went off-roster', () => {
    const summary = summarise([
      buildFlow('COV-4', [buildStage('Testing', 'outsider', 'Outsider, Pat')]),
      buildFlow('COV-5', [buildStage('Testing', 'outsider', 'Outsider, Pat')]),
      buildFlow('COV-6', [buildStage('Testing', 'sam.qa', 'Tester, Sam (CTR)')]),
      buildFlow('COV-7', [buildStage('Testing', 'sam.qa', 'Tester, Sam (CTR)')]),
    ]);

    expect(summary.offRosterSharePercent).toBeCloseTo(50, 10);
  });

  it('ignores issues that never entered an internal-testing status', () => {
    const summary = summarise([
      buildFlow('COV-8', [buildStage('In Progress', 'jane.dev', 'Dev, Jane (CTR)')]),
    ]);

    expect(summary.issuesWithInternalTestingCount).toBe(0);
    expect(summary.offRosterSharePercent).toBeNull();
  });

  it('matches the configured status names case-insensitively', () => {
    const summary = summarise([
      buildFlow('COV-9', [buildStage('READY FOR TESTING', 'outsider', 'Outsider, Pat')]),
    ]);

    expect(summary.issuesTestedOffRosterCount).toBe(1);
  });
});

describe('summariseInternalTestingCoverage — handed away', () => {
  it('counts an issue your tester held and then an outsider finished testing', () => {
    // The sharper story: we start our own testing and cannot finish it.
    const summary = summarise([
      buildFlow('HAND-1', [
        buildStage('Testing', 'sam.qa', 'Tester, Sam (CTR)', 1, '2026-07-01T00:00:00.000Z'),
        buildStage('Testing', 'outsider', 'Outsider, Pat', 3, '2026-07-02T00:00:00.000Z'),
      ]),
    ]);

    expect(summary.issuesHandedOffRosterCount).toBe(1);
  });

  it('does not count it as handed away when the outsider tested it first', () => {
    // Order matters: an outsider who started and then handed BACK is a different story, and calling
    // it a hand-away would overstate the case the figure is meant to support.
    const summary = summarise([
      buildFlow('HAND-2', [
        buildStage('Testing', 'outsider', 'Outsider, Pat', 3, '2026-07-01T00:00:00.000Z'),
        buildStage('Testing', 'sam.qa', 'Tester, Sam (CTR)', 1, '2026-07-02T00:00:00.000Z'),
      ]),
    ]);

    expect(summary.issuesHandedOffRosterCount).toBe(0);
    // It is still a coverage gap — an outsider did do internal testing on it.
    expect(summary.issuesTestedOffRosterCount).toBe(1);
  });

  it('never exceeds the coverage count, since every hand-away is also a coverage gap', () => {
    const summary = summarise([
      buildFlow('HAND-3', [
        buildStage('Testing', 'sam.qa', 'Tester, Sam (CTR)', 1, '2026-07-01T00:00:00.000Z'),
        buildStage('Testing', 'outsider', 'Outsider, Pat', 3, '2026-07-02T00:00:00.000Z'),
      ]),
      buildFlow('HAND-4', [buildStage('Testing', 'outsider', 'Outsider, Pat')]),
    ]);

    expect(summary.issuesHandedOffRosterCount).toBeLessThanOrEqual(summary.issuesTestedOffRosterCount);
  });
});

describe('summariseInternalTestingCoverage — naming the people', () => {
  it('names every off-roster person with their issue count, so a roster gap is obvious', () => {
    // If one of these names is actually a team member nobody added to the roster, the reader will
    // spot it here — instead of the report publishing a wrong number as a finding.
    const summary = summarise([
      buildFlow('NAME-1', [buildStage('Testing', 'pat', 'Outsider, Pat')]),
      buildFlow('NAME-2', [buildStage('Testing', 'pat', 'Outsider, Pat')]),
      buildFlow('NAME-3', [buildStage('Testing', 'alex', 'Outsider, Alex')]),
    ]);

    expect(summary.offRosterTesters).toEqual([
      { holderName: 'Outsider, Pat', issueCount: 2, elapsedWorkingDays: 4, issueKeys: ['NAME-1', 'NAME-2'] },
      { holderName: 'Outsider, Alex', issueCount: 1, elapsedWorkingDays: 2, issueKeys: ['NAME-3'] },
    ]);
  });

  it('orders the people by issue count, busiest first', () => {
    const summary = summarise([
      buildFlow('ORD-1', [buildStage('Testing', 'alex', 'Outsider, Alex')]),
      buildFlow('ORD-2', [buildStage('Testing', 'pat', 'Outsider, Pat')]),
      buildFlow('ORD-3', [buildStage('Testing', 'pat', 'Outsider, Pat')]),
    ]);

    expect(summary.offRosterTesters[0].holderName).toBe('Outsider, Pat');
  });

  it('never counts an unassigned queue as an outsider doing the work', () => {
    // Nobody was holding it. Attributing that to an off-roster person would invent a finding.
    const summary = summarise([
      buildFlow('UNASSIGNED-1', [buildStage('Testing', null, 'Unassigned')]),
    ]);

    expect(summary.issuesTestedOffRosterCount).toBe(0);
    expect(summary.offRosterTesters).toEqual([]);
    expect(summary.issuesUnassignedInTestingCount).toBe(1);
  });
});

describe('summariseInternalTestingCoverage — it stays defensible', () => {
  it('reports days as elapsed holding time and offers no effort or FTE figure', () => {
    // A tester holding fifteen issues accrues elapsed days on all fifteen at once, so converting this
    // to person-days would be wrong — and one number that does not survive scrutiny discredits the rest.
    const summary = summarise([
      buildFlow('DEF-1', [buildStage('Testing', 'pat', 'Outsider, Pat', 5)]),
    ]);

    expect(summary.offRosterTesters[0].elapsedWorkingDays).toBe(5);
    expect(Object.keys(summary)).not.toContain('offRosterFte');
    expect(Object.keys(summary)).not.toContain('effortDays');
  });

  it('says nothing at all when no internal-testing statuses have been configured', () => {
    // Guessing which statuses mean "internal testing" would put a fabricated staffing claim in front
    // of a funding decision. The panel asks for them instead.
    const summary = summariseInternalTestingCoverage({
      issueFlows: [buildFlow('CFG-1', [buildStage('Testing', 'pat', 'Outsider, Pat')])],
      rosterMembers: ROSTER,
      internalTestingStatusNames: [],
    });

    expect(summary.isConfigured).toBe(false);
    expect(summary.issuesWithInternalTestingCount).toBe(0);
  });

  it('is pure — identical input gives an identical summary', () => {
    const issueFlows = [buildFlow('PURE-1', [buildStage('Testing', 'pat', 'Outsider, Pat')])];

    expect(summarise(issueFlows)).toEqual(summarise(issueFlows));
  });
});
