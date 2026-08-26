// cabFactSheet.test.ts — Gathering the facts, and naming every gap in them.

import { describe, expect, it } from 'vitest';

import { buildCabFactSheet, formatCabFactSheet, type CabChangeFacts, type CabScopedIssue } from './cabFactSheet.ts';

function changeFacts(overrides: Partial<CabChangeFacts> = {}): CabChangeFacts {
  return {
    changeNumber: 'CHG0041298',
    shortDescription: 'Enrollment - Cleanup Crew - SF integration uplift',
    description: 'Moves the enrolment feed onto the new transformer.',
    justification: 'The current feed breaches its SLA twice a month.',
    riskImpactAnalysis: 'Medium: touches the member enrolment path.',
    implementationPlan: 'Deploy, run the smoke pack, verify the queue drains.',
    backoutPlan: 'Redeploy the previous artefact.',
    testPlan: 'Regression pack in INT, plus a manual enrolment.',
    assessment: { Impact: '2 - Medium', 'Can be backed out': 'Yes' },
    environments: [{ name: 'PRD', plannedStart: '2026-09-10 22:00', plannedEnd: '2026-09-11 02:00' }],
    changeTaskNames: ['Deploy transformer', 'Verify queue'],
    ...overrides,
  };
}

function issue(overrides: Partial<CabScopedIssue> = {}): CabScopedIssue {
  return {
    key: 'ENCUC-2213',
    summary: '[DEV] COB/MSP ingestion',
    issueType: 'Story',
    status: 'Done',
    assignee: 'Ramirez, Dana',
    storyPoints: 3,
    isComplete: true,
    ...overrides,
  };
}

describe('buildCabFactSheet', () => {
  it('reports no gaps when the change is fully written and the scope is done', () => {
    const factSheet = buildCabFactSheet(changeFacts(), [issue()]);

    expect(factSheet.missingChangeFields).toEqual([]);
    expect(factSheet.unfinishedIssueKeys).toEqual([]);
    expect(factSheet.unestimatedIssueKeys).toEqual([]);
  });

  it('names an empty change field rather than letting it pass', () => {
    // A board asks "how do we back this out" whether or not anyone wrote a plan. A pack that answers
    // smoothly from an empty field has invented the reassurance.
    const factSheet = buildCabFactSheet(changeFacts({ backoutPlan: '   ' }), [issue()]);

    expect(factSheet.missingChangeFields).toEqual(['Backout plan']);
  });

  it('names every empty field, in the order a board reads them', () => {
    const factSheet = buildCabFactSheet(
      changeFacts({ justification: '', backoutPlan: '', testPlan: '' }),
      [issue()],
    );

    expect(factSheet.missingChangeFields).toEqual(['Justification', 'Backout plan', 'Test plan']);
  });

  it('names scoped work that is NOT complete', () => {
    // "Everything is done" is the claim a board most often catches out.
    const factSheet = buildCabFactSheet(changeFacts(), [
      issue({ key: 'ENCUC-1', isComplete: true }),
      issue({ key: 'ENCUC-2', isComplete: false, status: 'Working' }),
    ]);

    expect(factSheet.unfinishedIssueKeys).toEqual(['ENCUC-2']);
  });

  it('names unestimated work, which weakens any duration claim', () => {
    const factSheet = buildCabFactSheet(changeFacts(), [issue({ key: 'ENCUC-9', storyPoints: null })]);

    expect(factSheet.unestimatedIssueKeys).toEqual(['ENCUC-9']);
  });

  it('handles a change with no scope at all without failing', () => {
    const factSheet = buildCabFactSheet(changeFacts(), []);

    expect(factSheet.scopedIssues).toEqual([]);
    expect(factSheet.unfinishedIssueKeys).toEqual([]);
  });
});

describe('formatCabFactSheet', () => {
  it('writes an empty field out as EMPTY, so the prompt can forbid answering from it', () => {
    const text = formatCabFactSheet(buildCabFactSheet(changeFacts({ backoutPlan: '' }), [issue()]));

    expect(text).toContain('BACKOUT PLAN: (EMPTY — nothing was written in this field)');
    expect(text).toContain('Empty change fields: Backout plan');
  });

  it('carries every scoped issue verbatim, with its status, owner and points', () => {
    // Anything condensed here is a fact the model would have to reconstruct, and reconstruction is
    // where a plausible invention gets in.
    const text = formatCabFactSheet(buildCabFactSheet(changeFacts(), [issue()]));

    expect(text).toContain('ENCUC-2213 [Story] [DEV] COB/MSP ingestion');
    expect(text).toContain('owner: Ramirez, Dana');
    expect(text).toContain('points: 3');
  });

  it('marks incomplete work inline as well as in the gap list', () => {
    const text = formatCabFactSheet(buildCabFactSheet(changeFacts(), [issue({ isComplete: false })]));

    expect(text).toContain('(NOT COMPLETE)');
    expect(text).toContain('NOT COMPLETE: ENCUC-2213');
  });

  it('says an unassigned issue is unassigned rather than leaving a blank', () => {
    const text = formatCabFactSheet(buildCabFactSheet(changeFacts(), [issue({ assignee: null })]));

    expect(text).toContain('owner: unassigned');
  });

  it('says there are no windows rather than printing an empty heading', () => {
    const text = formatCabFactSheet(buildCabFactSheet(changeFacts({ environments: [] }), [issue()]));

    expect(text).toContain('(no environment windows are configured)');
  });

  it('states plainly when nothing is missing', () => {
    const text = formatCabFactSheet(buildCabFactSheet(changeFacts(), [issue()]));

    expect(text).toContain('(every change field carries content)');
    expect(text).toContain('Every scoped issue is complete.');
  });
});
