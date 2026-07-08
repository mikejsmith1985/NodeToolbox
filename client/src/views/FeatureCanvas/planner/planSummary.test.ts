// planSummary.test.ts — Verifies the pure copy-out renderer reproduces the whole projection (feature 013).

import { describe, expect, it } from 'vitest';

import type { PlanResult } from './capacityTypes.ts';
import { buildPlanEvaluationPrompt, formatPlanSummary } from './planSummary.ts';

const PI_NAME = 'PI 26.3';

/** Builds a representative PlanResult a test can assert against without restating every field each time. */
function buildResult(overrides: Partial<PlanResult> = {}): PlanResult {
  return {
    sprints: [
      {
        index: 1,
        startIso: '2026-05-21',
        endIso: '2026-06-03',
        isBeyondPiEnd: false,
        scheduledPoints: 12,
        loads: [
          { displayName: 'Dana Dev', devPoints: 8, internalTestPoints: 0, externalTestPoints: 0, itemKeys: ['DENP-2'] },
          { displayName: 'Tina Test', devPoints: 0, internalTestPoints: 4, externalTestPoints: 0, itemKeys: ['DENP-2'] },
        ],
      },
      {
        index: 2,
        startIso: '2026-06-04',
        endIso: '2026-06-17',
        isBeyondPiEnd: true,
        scheduledPoints: 5,
        loads: [
          { displayName: 'Dana Dev', devPoints: 5, internalTestPoints: 0, externalTestPoints: 0, itemKeys: ['DENP-3'] },
        ],
      },
    ],
    proposals: [
      { itemKey: 'DENP-3', role: 'internalTest', fromAssignee: null, toAssignee: 'Tina Test', reason: 'unassigned Must item' },
    ],
    bottleneck: {
      limitingRole: 'internalTest',
      additionalToMatchThroughput: 2,
      additionalToFinishByPiEnd: 1,
      statement: 'Internal testing is the bottleneck; add 2 internal testers to keep pace with development.',
    },
    completionSprintIndex: 2,
    completionDateIso: '2026-06-17',
    sprintsBeyondPiEnd: 1,
    unschedulableItemKeys: ['DENP-9'],
    ...overrides,
  };
}

describe('formatPlanSummary', () => {
  it('includes the PI name and the bottleneck statement with both staffing numbers', () => {
    const summary = formatPlanSummary(buildResult(), PI_NAME);
    expect(summary).toContain(PI_NAME);
    expect(summary).toContain('Internal testing is the bottleneck');
    expect(summary).toContain('match dev throughput: 2');
    expect(summary).toContain('finish by the PI end: 1');
  });

  it('reports the completion date and how far beyond the PI end it lands', () => {
    const summary = formatPlanSummary(buildResult(), PI_NAME);
    expect(summary).toContain('Completes in sprint 2 on 2026-06-17');
    expect(summary).toContain('1 sprint(s) beyond the PI end');
  });

  it('renders every sprint with its date range and each person load', () => {
    const summary = formatPlanSummary(buildResult(), PI_NAME);
    expect(summary).toContain('Sprint 1 (2026-05-21 → 2026-06-03)');
    expect(summary).toContain('Sprint 2 (2026-06-04 → 2026-06-17) (beyond PI end)');
    expect(summary).toContain('Dana Dev — 8 dev / 0 int / 0 ext');
    expect(summary).toContain('Tina Test — 0 dev / 4 int / 0 ext');
  });

  it('lists assignment proposals and unschedulable items when present', () => {
    const summary = formatPlanSummary(buildResult(), PI_NAME);
    expect(summary).toContain('Unassigned → Tina Test');
    expect(summary).toContain('DENP-9');
  });

  it('omits the staffing numbers when there is no limiting role', () => {
    const summary = formatPlanSummary(
      buildResult({
        bottleneck: { limitingRole: null, additionalToMatchThroughput: 0, additionalToFinishByPiEnd: 0, statement: 'No role is a bottleneck.' },
      }),
      PI_NAME,
    );
    expect(summary).toContain('No role is a bottleneck.');
    expect(summary).not.toContain('match dev throughput');
  });
});

describe('buildPlanEvaluationPrompt', () => {
  it('wraps the plan with today, the assumptions, and an evaluate-and-improve instruction', () => {
    const prompt = buildPlanEvaluationPrompt(buildResult(), PI_NAME, '2026-07-08');
    // Today's date and PI carried for PI-vs-carryover reasoning.
    expect(prompt).toContain('Today is 2026-07-08');
    expect(prompt).toContain(PI_NAME);
    // The generation assumptions (so the assistant reasons correctly).
    expect(prompt).toContain('8 story points per 2-week sprint');
    expect(prompt).toContain('anchored at TODAY');
    // The embedded plan.
    expect(prompt).toContain('Internal testing is the bottleneck');
    expect(prompt).toContain('Sprint 1 (2026-05-21');
    // The instruction to evaluate + improve + split PI vs carryover.
    expect(prompt.toLowerCase()).toContain('risks');
    expect(prompt.toLowerCase()).toContain('carries into the next pi');
    expect(prompt.toLowerCase()).toContain('role-legal');
  });

  it('injects operator constraints verbatim as a must-honor section', () => {
    const constraint = 'Internal test must work DENP-1353 exclusively until complete before any other feature.';
    const prompt = buildPlanEvaluationPrompt(buildResult(), PI_NAME, '2026-07-08', constraint);
    expect(prompt).toContain('OPERATOR CONSTRAINTS');
    expect(prompt).toContain(constraint);
  });

  it('omits the operator-constraints section when no details are given', () => {
    const prompt = buildPlanEvaluationPrompt(buildResult(), PI_NAME, '2026-07-08', '   ');
    expect(prompt).not.toContain('OPERATOR CONSTRAINTS');
  });
});
