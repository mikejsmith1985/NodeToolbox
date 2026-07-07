// bottleneck.test.ts — Verifies the limiting-role detection and additional-headcount math (both targets).

import { describe, expect, it } from 'vitest';

import { computeBottleneck } from './bottleneck.ts';

const POOL = 8;

describe('computeBottleneck', () => {
  it('flags internal testing as the limiting role for the SC-4 scenario', () => {
    // 3 devs → 24 dev pts/sprint over 48 pts = 2 sprints. 1 internal tester → 8 pts/sprint over 24 pts
    // = 3 sprints. Testing stretches the schedule longer than development, so it is the bottleneck.
    const report = computeBottleneck(
      { dev: 48, internalTest: 24, externalTest: 0 },
      { dev: 3, internalTest: 1, externalTest: 0 },
      POOL,
      2,
    );
    expect(report.limitingRole).toBe('internalTest');
  });

  it('computes additionalToMatchThroughput to raise the limiting role to dev throughput', () => {
    // dev capacity 24/sprint, internal capacity 8/sprint. Gap 16 ÷ pool 8 = 2 more testers.
    const report = computeBottleneck(
      { dev: 48, internalTest: 24, externalTest: 0 },
      { dev: 3, internalTest: 1, externalTest: 0 },
      POOL,
      2,
    );
    expect(report.additionalToMatchThroughput).toBe(2);
  });

  it('computes additionalToFinishByPiEnd from the sprints-to-PI-end budget', () => {
    // sprintsToPiEnd = 2 → requiredPerSprint = ceil(24/2) = 12. Gap (12-8) ÷ 8 = ceil(0.5) = 1 tester.
    const report = computeBottleneck(
      { dev: 48, internalTest: 24, externalTest: 0 },
      { dev: 3, internalTest: 1, externalTest: 0 },
      POOL,
      2,
    );
    expect(report.additionalToFinishByPiEnd).toBe(1);
  });

  it('produces a human-readable statement naming the limiting role', () => {
    const report = computeBottleneck(
      { dev: 48, internalTest: 24, externalTest: 0 },
      { dev: 3, internalTest: 1, externalTest: 0 },
      POOL,
      2,
    );
    expect(report.statement).toContain('internal testing');
  });

  it('reports no bottleneck when every role keeps pace with development', () => {
    // Equal capacity and demand: internal testing finishes within the dev-driven span → no bottleneck.
    const report = computeBottleneck(
      { dev: 16, internalTest: 8, externalTest: 0 },
      { dev: 2, internalTest: 2, externalTest: 0 },
      POOL,
      4,
    );
    expect(report.limitingRole).toBeNull();
    expect(report.additionalToMatchThroughput).toBe(0);
    expect(report.additionalToFinishByPiEnd).toBe(0);
  });

  it('detects external testing as the bottleneck when it stretches longest', () => {
    // dev 16/2 people = 1 sprint; external 24 pts / 8 (1 person) = 3 sprints > dev span.
    const report = computeBottleneck(
      { dev: 16, internalTest: 0, externalTest: 24 },
      { dev: 2, internalTest: 0, externalTest: 1 },
      POOL,
      2,
    );
    expect(report.limitingRole).toBe('externalTest');
    expect(report.additionalToMatchThroughput).toBe(1); // (16 - 8) / 8 = 1
  });

  it('never returns a negative headcount when the limiting role already matches throughput', () => {
    // internalTest capacity already equals dev capacity but demand still stretches it longer.
    const report = computeBottleneck(
      { dev: 8, internalTest: 32, externalTest: 0 },
      { dev: 1, internalTest: 1, externalTest: 0 },
      POOL,
      4,
    );
    expect(report.limitingRole).toBe('internalTest');
    expect(report.additionalToMatchThroughput).toBe(0); // (8 - 8) / 8 = 0, clamped at 0
  });

  it('is deterministic — identical inputs yield a deeply-equal report', () => {
    const first = computeBottleneck(
      { dev: 48, internalTest: 24, externalTest: 0 },
      { dev: 3, internalTest: 1, externalTest: 0 },
      POOL,
      2,
    );
    const second = computeBottleneck(
      { dev: 48, internalTest: 24, externalTest: 0 },
      { dev: 3, internalTest: 1, externalTest: 0 },
      POOL,
      2,
    );
    expect(first).toEqual(second);
  });
});
