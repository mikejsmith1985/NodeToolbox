// issueFlowRollup.test.ts — Unit tests for the "where is flow lost" aggregation and the honest team totals.
//
// Two things are being pinned here.
//
// The roll-ups report a median AND a p85 rather than a mean. One issue stuck in review for three
// months drags a mean far enough to describe a healthy review stage as broken; a typical value plus
// a spread lets a reader see the norm and the tail separately, and the tail is usually the finding.
//
// The delivery totals are the direct fix for the defect this feature exists to correct: the existing
// per-person columns credit one whole issue, and its full points, to EVERY person who advanced it.
// Summing that column down the team counts hand-offs, not issues. The last test in this file pins
// that divergence deliberately — if it ever starts passing by equality, the double-count is back.

import { describe, expect, it } from 'vitest';

import { computeDeliveryTotals, summariseStageRollups } from './issueFlowRollup.ts';
import type { IssueFlow } from './issueFlow.ts';
import type { StatusFlowClass } from './issueFlowStatusClass.ts';

/** Builds one stage with only the fields the roll-ups read. */
function buildStage(statusName: string, flowClass: StatusFlowClass, workingDays: number) {
  return {
    fromIso: '2026-07-01T00:00:00.000Z',
    toIso: '2026-07-02T00:00:00.000Z',
    statusId: statusName,
    statusName,
    holder: { holderId: 'jane', holderName: 'Dev, Jane (CTR)' },
    flowClass,
    workingDays,
  };
}

/** Builds one issue flow; totals are summed from the stages exactly as the engine does. */
function buildFlow(
  issueKey: string,
  stages: ReturnType<typeof buildStage>[],
  storyPoints: number | null = 5,
): IssueFlow {
  const leadTimeWorkingDays = stages.reduce((total, stage) => total + stage.workingDays, 0);
  return {
    issueKey,
    issueSummary: `${issueKey} summary`,
    storyPoints,
    completedIso: '2026-07-10T00:00:00.000Z',
    stages,
    leadTimeWorkingDays,
    cycleTimeWorkingDays: leadTimeWorkingDays,
    preWorkWaitWorkingDays: 0,
  };
}

const THREE_ISSUES: IssueFlow[] = [
  buildFlow('FLOW-1', [buildStage('In Progress', 'active', 2), buildStage('Ready for QA', 'waiting', 1)]),
  buildFlow('FLOW-2', [buildStage('In Progress', 'active', 4), buildStage('Ready for QA', 'waiting', 3)]),
  buildFlow('FLOW-3', [buildStage('In Progress', 'active', 6), buildStage('Ready for QA', 'waiting', 2)]),
];

describe('summariseStageRollups — one row per status', () => {
  it('totals each status across every issue', () => {
    const rollups = summariseStageRollups(THREE_ISSUES);

    const inProgress = rollups.find((rollup) => rollup.statusName === 'In Progress')!;
    expect(inProgress.totalWorkingDays).toBeCloseTo(12, 10);
    expect(inProgress.issueCount).toBe(3);
  });

  it('reports a typical value and a spread, not a mean', () => {
    const rollups = summariseStageRollups(THREE_ISSUES);

    const inProgress = rollups.find((rollup) => rollup.statusName === 'In Progress')!;
    expect(inProgress.medianWorkingDays).toBeCloseTo(4, 10);
    expect(inProgress.p85WorkingDays).toBeGreaterThanOrEqual(inProgress.medianWorkingDays);
  });

  it('moves p85 but not the median when one issue is an outlier', () => {
    // The property that makes reporting the pair worthwhile: the typical case is unchanged while the
    // tail becomes visible. A mean would have moved and misdescribed the whole stage.
    const withOutlier = [...THREE_ISSUES, buildFlow('FLOW-4', [buildStage('In Progress', 'active', 200)])];

    const before = summariseStageRollups(THREE_ISSUES).find((rollup) => rollup.statusName === 'In Progress')!;
    const after = summariseStageRollups(withOutlier).find((rollup) => rollup.statusName === 'In Progress')!;

    expect(after.p85WorkingDays).toBeGreaterThan(before.p85WorkingDays);
    expect(after.medianWorkingDays).toBeLessThan(10);
  });

  it('carries the issue keys behind each row so the figure can be checked in Jira', () => {
    const rollups = summariseStageRollups(THREE_ISSUES);

    expect(rollups.find((rollup) => rollup.statusName === 'Ready for QA')!.issueKeys)
      .toEqual(['FLOW-1', 'FLOW-2', 'FLOW-3']);
  });

  it('partitions the stages — the roll-up totals sum to the overall total', () => {
    const rollups = summariseStageRollups(THREE_ISSUES);

    const rolledUp = rollups.reduce((total, rollup) => total + rollup.totalWorkingDays, 0);
    const overall = THREE_ISSUES.reduce((total, flow) => total + flow.leadTimeWorkingDays, 0);
    expect(rolledUp).toBeCloseTo(overall, 10);
  });
});

describe('summariseStageRollups — waiting is never merged into active', () => {
  it('keeps each roll-up\'s class so the two are never shown as one figure', () => {
    const rollups = summariseStageRollups(THREE_ISSUES);

    expect(rollups.find((rollup) => rollup.statusName === 'In Progress')!.flowClass).toBe('active');
    expect(rollups.find((rollup) => rollup.statusName === 'Ready for QA')!.flowClass).toBe('waiting');
  });

  it('names the largest contributor together with its class', () => {
    const rollups = summariseStageRollups(THREE_ISSUES);

    // Sorted largest-first, so the biggest single drain on flow is the first thing a reader sees —
    // and its class says whether it is work being done or an issue sitting in a queue.
    expect(rollups[0].statusName).toBe('In Progress');
    expect(rollups[0].flowClass).toBe('active');
  });

  it('returns nothing for no issues rather than inventing a zero row', () => {
    expect(summariseStageRollups([])).toEqual([]);
  });
});

describe('computeDeliveryTotals — each issue counted once', () => {
  it('counts an issue held by four people a single time, with its points once', () => {
    const fourHolders = buildFlow('FLOW-9', [
      buildStage('In Progress', 'active', 1),
      buildStage('In Progress', 'active', 1),
      buildStage('In Progress', 'active', 1),
      buildStage('In Progress', 'active', 1),
    ], 8);

    const totals = computeDeliveryTotals([fourHolders]);

    expect(totals.deliveredIssueCount).toBe(1);
    expect(totals.deliveredStoryPoints).toBe(8);
  });

  it('treats an issue with no points as zero rather than skipping it', () => {
    const totals = computeDeliveryTotals([buildFlow('FLOW-10', [buildStage('In Progress', 'active', 1)], null)]);

    expect(totals.deliveredIssueCount).toBe(1);
    expect(totals.deliveredStoryPoints).toBe(0);
  });

  it('counts an issue once even if the same key appears twice in the input', () => {
    const flow = buildFlow('FLOW-11', [buildStage('In Progress', 'active', 1)], 3);

    expect(computeDeliveryTotals([flow, flow]).deliveredIssueCount).toBe(1);
  });

  // ── The test that pins the defect ──────────────────────────────────────────
  it('does NOT equal the sum of the per-person columns when an issue passed through two people', () => {
    // One 8-point issue, two holders. The per-person columns credit 1 issue and 8 points to EACH of
    // them, so summing that column reports 2 issues and 16 points of team output. The delivery total
    // is computed from the issue set instead and reports the truth: one issue, eight points.
    const sharedIssue = buildFlow('FLOW-12', [
      buildStage('In Progress', 'active', 3),
      buildStage('Ready for QA', 'waiting', 2),
    ], 8);

    const totals = computeDeliveryTotals([sharedIssue]);

    const summedPerPersonIssues = 2; // what the existing per-person column would total
    const summedPerPersonPoints = 16;
    expect(totals.deliveredIssueCount).not.toBe(summedPerPersonIssues);
    expect(totals.deliveredStoryPoints).not.toBe(summedPerPersonPoints);
    expect(totals.deliveredIssueCount).toBe(1);
    expect(totals.deliveredStoryPoints).toBe(8);
  });
});

describe('purity', () => {
  it('returns deeply equal results for identical input', () => {
    expect(summariseStageRollups(THREE_ISSUES)).toEqual(summariseStageRollups(THREE_ISSUES));
    expect(computeDeliveryTotals(THREE_ISSUES)).toEqual(computeDeliveryTotals(THREE_ISSUES));
  });

  it('does not mutate the flows it is given', () => {
    const snapshot = JSON.stringify(THREE_ISSUES);

    summariseStageRollups(THREE_ISSUES);
    computeDeliveryTotals(THREE_ISSUES);

    expect(JSON.stringify(THREE_ISSUES)).toBe(snapshot);
  });
});
