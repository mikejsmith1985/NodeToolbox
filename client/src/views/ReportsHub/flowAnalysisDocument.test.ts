// flowAnalysisDocument.test.ts — Tests for the copyable Flow Analysis document.
//
// The reason this document exists: the internal-testing figure argues for headcount, and a figure on
// a screen cannot be pasted into a funding paper. The test that matters most is that the internal
// testing section is actually IN the document — the previous version wired those sections to an
// optional field nothing ever supplied, so they rendered only in tests and never for a real user.

import { describe, expect, it } from 'vitest';

import { buildFlowAnalysisDocument } from './flowAnalysisDocument.ts';
import type { FlowAnalysisDocumentInput } from './flowAnalysisDocument.ts';
import type { IssueFlow, FlowStage } from './issueFlow.ts';
import { computeDeliveryTotals, summariseStageRollups } from './issueFlowRollup.ts';
import { summariseInternalTestingCoverage } from './internalTestingCoverage.ts';
import type { StandupRosterMember } from '../SprintDashboard/hooks/useStandupRosterStore.ts';

function buildStage(statusName: string, holderId: string | null, holderName: string, workingDays = 2): FlowStage {
  return {
    fromIso: '2026-07-01T00:00:00.000Z',
    toIso: '2026-07-03T00:00:00.000Z',
    statusId: statusName,
    statusName,
    holder: { holderId, holderName },
    flowClass: statusName === 'Ready for QA' ? 'waiting' : 'active',
    workingDays,
  };
}

function buildFlow(issueKey: string, stages: FlowStage[]): IssueFlow {
  const leadTimeWorkingDays = stages.reduce((total, stage) => total + stage.workingDays, 0);
  return {
    issueKey,
    issueSummary: `${issueKey} | summary with a pipe`,
    storyPoints: 3,
    completedIso: '2026-07-10T00:00:00.000Z',
    stages,
    leadTimeWorkingDays,
    cycleTimeWorkingDays: leadTimeWorkingDays,
    preWorkWaitWorkingDays: 0,
  };
}

const ROSTER: StandupRosterMember[] = [
  {
    id: 'roster-member:sam',
    displayName: 'Tester, Sam (CTR)',
    assigneeQueryValue: 'sam.qa',
    roleCapabilities: { canDevelop: false, canInternalTest: true, canExternalTest: false },
  },
];

function makeInput(overrides: Partial<FlowAnalysisDocumentInput> = {}): FlowAnalysisDocumentInput {
  const issueFlows = [
    buildFlow('FLOW-1', [buildStage('In Progress', 'jane.dev', 'Dev, Jane (CTR)'), buildStage('Ready for QA', 'outsider', 'Outsider, Pat')]),
    buildFlow('FLOW-2', [buildStage('Ready for QA', 'sam.qa', 'Tester, Sam (CTR)')]),
  ];
  return {
    envelope: {
      rosterLabel: 'Cleanup Crew',
      windowDays: 90,
      generatedAtIso: '2026-07-08T12:00:00.000Z',
      toolVersion: '0.94.0',
      countsSubTasks: false,
    },
    issueFlows,
    rollups: summariseStageRollups(issueFlows),
    deliveryTotals: computeDeliveryTotals(issueFlows),
    statusClassByStatusName: { 'In Progress': 'active', 'Ready for QA': 'waiting' },
    internalTestingCoverage: summariseInternalTestingCoverage({
      issueFlows,
      rosterMembers: ROSTER,
      internalTestingStatusNames: ['Ready for QA'],
    }),
    ...overrides,
  };
}

describe('buildFlowAnalysisDocument — structure', () => {
  it('renders every section, in order', () => {
    const document = buildFlowAnalysisDocument(makeInput());

    const order = [
      '# Flow Analysis',
      'Flow summary',
      'Where the time goes',
      'Who did the internal testing',
      'How statuses were classified',
      'Per-issue flow',
    ];
    const positions = order.map((heading) => document.indexOf(heading));
    positions.forEach((position) => expect(position).toBeGreaterThan(-1));
    expect(positions).toEqual([...positions].sort((first, second) => first - second));
  });

  it('names the roster it actually ran', () => {
    expect(buildFlowAnalysisDocument(makeInput())).toContain('Cleanup Crew');
  });

  it('states the sub-task counting basis', () => {
    expect(buildFlowAnalysisDocument(makeInput())).toContain('sub-tasks excluded');
  });

  it('renders no raw HTML, so Confluence cannot print markup as text', () => {
    expect(buildFlowAnalysisDocument(makeInput())).not.toMatch(/<\/?[a-z]+>/);
  });

  it('escapes a pipe in an issue summary so it cannot create phantom columns', () => {
    const document = buildFlowAnalysisDocument(makeInput());
    const perIssueRow = document.split('\n').find((line) => line.startsWith('| FLOW-1 |')) ?? '';

    expect(perIssueRow).toContain('\\|');
  });
});

describe('buildFlowAnalysisDocument — the internal testing section is actually present', () => {
  it('states the off-roster share as a count of issues, and names the person', () => {
    // The whole point of this change: the metric that argues for headcount is now in the copyable
    // document, not only on screen.
    const document = buildFlowAnalysisDocument(makeInput());

    expect(document).toContain('Who did the internal testing');
    expect(document).toContain('had internal testing done by someone outside this roster');
    expect(document).toContain('Outsider, Pat');
  });

  it('carries the "elapsed is not effort" warning, so the number is not read as headcount', () => {
    expect(buildFlowAnalysisDocument(makeInput())).toContain('Elapsed working days is not effort');
  });

  it('tells the reader to check the names against the roster', () => {
    expect(buildFlowAnalysisDocument(makeInput())).toContain('Check this list');
  });

  it('says internal testing was not calculated when no statuses were configured', () => {
    const document = buildFlowAnalysisDocument(makeInput({
      internalTestingCoverage: summariseInternalTestingCoverage({
        issueFlows: [],
        rosterMembers: ROSTER,
        internalTestingStatusNames: [],
      }),
    }));

    expect(document).toContain('no internal-testing statuses were configured');
  });
});

describe('buildFlowAnalysisDocument — reconciliation and purity', () => {
  it('marks every duration as working days', () => {
    const document = buildFlowAnalysisDocument(makeInput());

    expect(document).toContain('Avg lead time');
    expect(document).toContain('working days');
  });

  it('is pure — identical input gives an identical document', () => {
    expect(buildFlowAnalysisDocument(makeInput())).toEqual(buildFlowAnalysisDocument(makeInput()));
  });
});
