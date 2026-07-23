// issueFlow.test.ts — Unit tests for the issue-centric flow analysis.
//
// The question this answers is the one the Personal Workflow report structurally cannot: for ONE
// delivered issue, where did its time go, and who was holding it at the time?
//
// Two groups of tests carry the weight:
//
//   1. "a holder change mid-status produces two stages" — the existing engine cannot represent this
//      at all, because it collapses assignee identity to a boolean before the timeline is built.
//   2. The reconciliation group. Every total is SUMMED from the stages, never computed alongside
//      them, so a stage list that disagrees with its own totals should be unrepresentable. These
//      tests exist to catch anyone who later "optimises" a total onto a second code path.

import { describe, expect, it } from 'vitest';

import { buildIssueFlow } from './issueFlow.ts';
import type { StatusFlowClass } from './issueFlowStatusClass.ts';
import { UNASSIGNED_HOLDER } from './issueFlowHistory.ts';
import { computePersonalFlow } from './personalFlow.ts';
import type { PersonalFlowIssue } from './personalFlow.ts';

// ── Fixture vocabulary ───────────────────────────────────────────────────────

const BACKLOG = '1';
const IN_PROGRESS = '2';
const READY_FOR_QA = '3';
const DONE = '4';

const STATUS_CATEGORIES: Record<string, string> = {
  [BACKLOG]: 'new',
  [IN_PROGRESS]: 'indeterminate',
  [READY_FOR_QA]: 'indeterminate',
  [DONE]: 'done',
};

const STATUS_NAMES: Record<string, string> = {
  [BACKLOG]: 'Backlog',
  [IN_PROGRESS]: 'In Progress',
  [READY_FOR_QA]: 'Ready for QA',
  [DONE]: 'Done',
};

/** A stub classifier, so these tests exercise stage construction rather than the classification rules. */
function classifyForTest(statusId: string): StatusFlowClass {
  if (statusId === BACKLOG) return 'not-started';
  if (statusId === DONE) return 'completed';
  if (statusId === READY_FOR_QA) return 'waiting';
  return 'active';
}

const JANE = { holderId: 'jane', holderName: 'Dev, Jane (CTR)' };
const MARK = { holderId: 'mark', holderName: 'Owner, Mark (CTR)' };
const SAM = { holderId: 'sam', holderName: 'Tester, Sam (CTR)' };

/** Builds flow input with sensible defaults so each test states only what it is about. */
function buildInput(overrides: Partial<Parameters<typeof buildIssueFlow>[0]> = {}) {
  return {
    issueKey: 'FLOW-1',
    issueSummary: 'A delivered issue',
    storyPoints: 5,
    createdIso: '2026-07-01T00:00:00.000Z', // Wednesday
    initialStatusId: BACKLOG,
    initialHolder: JANE,
    statusTransitions: [
      { toStatusId: IN_PROGRESS, atIso: '2026-07-02T00:00:00.000Z' },
      { toStatusId: DONE, atIso: '2026-07-08T00:00:00.000Z' },
    ],
    holderTransitions: [],
    statusCategoryByStatusId: STATUS_CATEGORIES,
    statusNamesById: STATUS_NAMES,
    statusClassifier: classifyForTest,
    todayIso: '2026-07-15T00:00:00.000Z',
    ...overrides,
  };
}

// ── Stage construction ───────────────────────────────────────────────────────

describe('buildIssueFlow — stage construction', () => {
  it('splits a stage when the status changes under one holder', () => {
    const flow = buildIssueFlow(buildInput());

    expect(flow).not.toBeNull();
    expect(flow!.stages.map((stage) => [stage.statusId, stage.holder.holderId])).toEqual([
      [BACKLOG, 'jane'],
      [IN_PROGRESS, 'jane'],
    ]);
  });

  it('splits a stage when the HOLDER changes mid-status — what the person-centric engine cannot show', () => {
    // One status, two people. The existing engine reduces assignee to "was it Jane?", so it can say
    // how long Jane held it and nothing at all about Mark. This is the whole reason for the feature.
    const flow = buildIssueFlow(buildInput({
      statusTransitions: [
        { toStatusId: IN_PROGRESS, atIso: '2026-07-01T00:00:00.000Z' },
        { toStatusId: DONE, atIso: '2026-07-08T00:00:00.000Z' },
      ],
      holderTransitions: [{ holder: MARK, atIso: '2026-07-03T00:00:00.000Z' }],
    }));

    const inProgressStages = flow!.stages.filter((stage) => stage.statusId === IN_PROGRESS);
    expect(inProgressStages).toHaveLength(2);
    expect(inProgressStages.map((stage) => stage.holder.holderId)).toEqual(['jane', 'mark']);
  });

  it('orders the stages of an issue held by three people in turn', () => {
    const flow = buildIssueFlow(buildInput({
      holderTransitions: [
        { holder: MARK, atIso: '2026-07-03T00:00:00.000Z' },
        { holder: SAM, atIso: '2026-07-06T00:00:00.000Z' },
      ],
    }));

    expect(flow!.stages.map((stage) => stage.holder.holderId)).toEqual(['jane', 'jane', 'mark', 'sam']);
  });

  it('produces contiguous, non-overlapping stages in chronological order', () => {
    const flow = buildIssueFlow(buildInput({
      holderTransitions: [{ holder: MARK, atIso: '2026-07-03T00:00:00.000Z' }],
    }));

    flow!.stages.forEach((stage, index) => {
      expect(new Date(stage.toIso).getTime()).toBeGreaterThan(new Date(stage.fromIso).getTime());
      if (index > 0) expect(stage.fromIso).toBe(flow!.stages[index - 1].toIso);
    });
  });

  it('names each stage\'s status so a reader can match it against Jira history', () => {
    const flow = buildIssueFlow(buildInput());

    expect(flow!.stages.map((stage) => stage.statusName)).toEqual(['Backlog', 'In Progress']);
  });
});

// ── The Unassigned holder (S5) ───────────────────────────────────────────────

describe('buildIssueFlow — unowned time is its own stage', () => {
  it('shows an unassigned period as the Unassigned holder rather than a gap', () => {
    const flow = buildIssueFlow(buildInput({
      holderTransitions: [
        { holder: UNASSIGNED_HOLDER, atIso: '2026-07-03T00:00:00.000Z' },
        { holder: MARK, atIso: '2026-07-06T00:00:00.000Z' },
      ],
    }));

    const holderNames = flow!.stages.map((stage) => stage.holder.holderName);
    expect(holderNames).toContain('Unassigned');
  });

  it('never charges queue time to the person who picked the issue up next', () => {
    const flow = buildIssueFlow(buildInput({
      holderTransitions: [
        { holder: UNASSIGNED_HOLDER, atIso: '2026-07-03T00:00:00.000Z' },
        { holder: MARK, atIso: '2026-07-06T00:00:00.000Z' },
      ],
    }));

    // Billing a named person for a queue they did not control is worse than reporting no owner.
    const unassignedDays = sumDaysFor(flow!, null);
    const markDays = sumDaysFor(flow!, 'mark');
    expect(unassignedDays).toBeGreaterThan(0);
    expect(markDays).toBeLessThan(unassignedDays + markDays);
  });
});

describe('buildIssueFlow — a queue between two people is its own stage', () => {
  it('produces person → Unassigned → person, with the queue duration on the middle stage alone', () => {
    const flow = buildIssueFlow(buildInput({
      statusTransitions: [
        { toStatusId: IN_PROGRESS, atIso: '2026-07-01T00:00:00.000Z' },
        { toStatusId: DONE, atIso: '2026-07-09T00:00:00.000Z' },
      ],
      holderTransitions: [
        { holder: UNASSIGNED_HOLDER, atIso: '2026-07-02T00:00:00.000Z' },
        { holder: MARK, atIso: '2026-07-07T00:00:00.000Z' },
      ],
    }))!;

    expect(flow.stages.map((stage) => stage.holder.holderName))
      .toEqual(['Dev, Jane (CTR)', 'Unassigned', 'Owner, Mark (CTR)']);

    // The queue's days belong to the queue. Adding them to either neighbour would make a person look
    // slow for time nobody was working — the single most misleading thing this report could do.
    const [jane, queue, mark] = flow.stages;
    expect(queue.workingDays).toBeGreaterThan(0);
    expect(jane.workingDays + queue.workingDays + mark.workingDays)
      .toBeCloseTo(flow.leadTimeWorkingDays, 10);
  });

  it('still analyses an issue that was never assigned to anyone', () => {
    const flow = buildIssueFlow(buildInput({ initialHolder: UNASSIGNED_HOLDER }))!;

    expect(flow.stages.every((stage) => stage.holder.holderId === null)).toBe(true);
    expect(flow.leadTimeWorkingDays).toBeGreaterThan(0);
  });
});

/** Sums the working days a given holder id (null = Unassigned) accounts for. */
function sumDaysFor(flow: NonNullable<ReturnType<typeof buildIssueFlow>>, holderId: string | null): number {
  return flow.stages
    .filter((stage) => stage.holder.holderId === holderId)
    .reduce((total, stage) => total + stage.workingDays, 0);
}

// ── Reconciliation: the checkable property (S3, S4) ──────────────────────────

describe('buildIssueFlow — the parts add up', () => {
  const complexFlow = buildIssueFlow(buildInput({
    statusTransitions: [
      { toStatusId: IN_PROGRESS, atIso: '2026-07-02T00:00:00.000Z' },
      { toStatusId: READY_FOR_QA, atIso: '2026-07-06T00:00:00.000Z' },
      { toStatusId: DONE, atIso: '2026-07-09T00:00:00.000Z' },
    ],
    holderTransitions: [
      { holder: MARK, atIso: '2026-07-03T00:00:00.000Z' },
      { holder: SAM, atIso: '2026-07-07T00:00:00.000Z' },
    ],
  }))!;

  it('sums every stage exactly to lead time', () => {
    const summed = complexFlow.stages.reduce((total, stage) => total + stage.workingDays, 0);

    expect(summed).toBeCloseTo(complexFlow.leadTimeWorkingDays, 10);
  });

  it('sums the stages from the first started stage exactly to cycle time', () => {
    const firstStartedIndex = complexFlow.stages.findIndex((stage) => stage.flowClass !== 'not-started');
    const summed = complexFlow.stages
      .slice(firstStartedIndex)
      .reduce((total, stage) => total + stage.workingDays, 0);

    expect(summed).toBeCloseTo(complexFlow.cycleTimeWorkingDays, 10);
  });

  it('makes the pre-work wait exactly the difference between the two clocks', () => {
    expect(complexFlow.preWorkWaitWorkingDays)
      .toBeCloseTo(complexFlow.leadTimeWorkingDays - complexFlow.cycleTimeWorkingDays, 10);
  });

  it('reports a never-started issue as all wait and no cycle, without erroring', () => {
    const flow = buildIssueFlow(buildInput({
      statusTransitions: [{ toStatusId: DONE, atIso: '2026-07-08T00:00:00.000Z' }],
    }))!;

    // Backlog straight to Done. Saying "cycle time 0" is honest; it must not be read as instant delivery,
    // which is why the whole duration is reported as pre-work wait instead of disappearing.
    expect(flow.cycleTimeWorkingDays).toBe(0);
    expect(flow.preWorkWaitWorkingDays).toBeCloseTo(flow.leadTimeWorkingDays, 10);
    expect(flow.leadTimeWorkingDays).toBeGreaterThan(0);
  });

  it('counts unclassified time toward the totals rather than discarding it', () => {
    const flow = buildIssueFlow(buildInput({
      statusClassifier: (statusId: string) => (statusId === IN_PROGRESS ? 'unclassified' : classifyForTest(statusId)),
    }))!;

    const summed = flow.stages.reduce((total, stage) => total + stage.workingDays, 0);
    expect(summed).toBeCloseTo(flow.leadTimeWorkingDays, 10);
    expect(flow.cycleTimeWorkingDays).toBeGreaterThan(0);
  });

  it('changes a stage\'s class but never its duration when the classifier changes', () => {
    const asActive = buildIssueFlow(buildInput())!;
    const asWaiting = buildIssueFlow(buildInput({
      statusClassifier: (statusId: string) => (statusId === IN_PROGRESS ? 'waiting' : classifyForTest(statusId)),
    }))!;

    expect(asWaiting.stages.map((stage) => stage.workingDays))
      .toEqual(asActive.stages.map((stage) => stage.workingDays));
    expect(asWaiting.leadTimeWorkingDays).toBe(asActive.leadTimeWorkingDays);
    expect(asWaiting.stages[1].flowClass).toBe('waiting');
    expect(asActive.stages[1].flowClass).toBe('active');
  });
});

// ── Completion and scope ─────────────────────────────────────────────────────

describe('buildIssueFlow — completion defines the horizon', () => {
  it('returns null for an issue that never reached a done status', () => {
    const flow = buildIssueFlow(buildInput({
      statusTransitions: [{ toStatusId: IN_PROGRESS, atIso: '2026-07-02T00:00:00.000Z' }],
    }));

    expect(flow).toBeNull();
  });

  it('dates a reopened issue by its LAST completion and includes the rework', () => {
    const flow = buildIssueFlow(buildInput({
      statusTransitions: [
        { toStatusId: IN_PROGRESS, atIso: '2026-07-02T00:00:00.000Z' },
        { toStatusId: DONE, atIso: '2026-07-03T00:00:00.000Z' },
        { toStatusId: IN_PROGRESS, atIso: '2026-07-06T00:00:00.000Z' }, // reopened
        { toStatusId: DONE, atIso: '2026-07-09T00:00:00.000Z' },
      ],
    }))!;

    expect(flow.completedIso).toBe('2026-07-09T00:00:00.000Z');
    // The rework is part of how long the issue really took; excluding it would flatter the figure.
    const reworkStage = flow.stages.find((stage) => stage.fromIso === '2026-07-06T00:00:00.000Z');
    expect(reworkStage?.workingDays).toBeGreaterThan(0);
  });

  it('excludes everything after completion from both clocks', () => {
    const flow = buildIssueFlow(buildInput())!;

    const lastStageEnd = flow.stages[flow.stages.length - 1].toIso;
    expect(lastStageEnd).toBe(flow.completedIso);
    // Today is a week after completion; none of that week may appear in the figures.
    expect(flow.leadTimeWorkingDays).toBeLessThan(6);
  });
});

// ── Purity ───────────────────────────────────────────────────────────────────

describe('buildIssueFlow — purity', () => {
  it('returns deeply equal results for identical input', () => {
    expect(buildIssueFlow(buildInput())).toEqual(buildIssueFlow(buildInput()));
  });

  it('does not vary with the wall clock — only with the injected today', () => {
    const early = buildIssueFlow(buildInput({ todayIso: '2026-07-10T00:00:00.000Z' }));
    const late = buildIssueFlow(buildInput({ todayIso: '2027-01-01T00:00:00.000Z' }));

    // Both are complete, so the horizon is completion in each case and nothing moves.
    expect(early).toEqual(late);
  });
});

// ── The agreement property (T011a / SC-007 / NFR-001) ────────────────────────

describe('the two analyses agree about the same person on the same issue', () => {
  it('matches a person\'s active stage time against their cycle time from the person-centric engine', () => {
    // This is the assertion that justifies sharing `issueTimeline.ts` instead of writing a second
    // engine. Nothing else in the suite checks that the two reports actually agree — and if they ever
    // stopped agreeing, both numbers would become untrustworthy with nothing to show which was wrong.
    const createdIso = '2026-07-01T00:00:00.000Z';
    const startedIso = '2026-07-02T00:00:00.000Z';
    const handedOverIso = '2026-07-06T00:00:00.000Z';
    const doneIso = '2026-07-08T00:00:00.000Z';

    const issueFlow = buildIssueFlow(buildInput({
      createdIso,
      statusTransitions: [
        { toStatusId: IN_PROGRESS, atIso: startedIso },
        { toStatusId: DONE, atIso: doneIso },
      ],
      holderTransitions: [{ holder: MARK, atIso: handedOverIso }],
    }))!;

    const personalIssue: PersonalFlowIssue = {
      key: 'FLOW-1',
      summary: 'A delivered issue',
      storyPoints: 5,
      createdIso,
      initialStatusId: BACKLOG,
      statusTransitions: [
        { toStatusId: IN_PROGRESS, atIso: startedIso },
        { toStatusId: DONE, atIso: doneIso },
      ],
      initiallyAssignedToTarget: true, // the target IS Jane
      ownershipTransitions: [{ assignedToTarget: false, atIso: handedOverIso }],
    };
    const personalFlow = computePersonalFlow({
      issues: [personalIssue],
      statusCategoryByStatusId: STATUS_CATEGORIES,
      windowDays: 90,
      todayIso: '2026-07-15T00:00:00.000Z',
    });

    const janesActiveDays = issueFlow.stages
      .filter((stage) => stage.holder.holderId === 'jane' && stage.flowClass === 'active')
      .reduce((total, stage) => total + stage.workingDays, 0);

    expect(personalFlow.perIssue[0]?.cycleTimeDays).not.toBeNull();
    expect(janesActiveDays).toBeCloseTo(personalFlow.perIssue[0].cycleTimeDays!, 10);
  });
});
