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

  it('computes additionalToMatchThroughput from testing DEMAND rate, not raw dev capacity', () => {
    // dev 48 pts over 3 devs = 2 dev-sprints. To finish 24 internal-test pts within those 2 sprints needs
    // 12 pts/sprint; current internal capacity is 8, so (12-8)/8 = ceil(0.5) = 1 more tester (NOT 2, which
    // matching to raw dev capacity would have given).
    const report = computeBottleneck(
      { dev: 48, internalTest: 24, externalTest: 0 },
      { dev: 3, internalTest: 1, externalTest: 0 },
      POOL,
      2,
    );
    expect(report.additionalToMatchThroughput).toBe(1);
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
    // dev 16/2 = 1 dev-sprint; 24 ext pts in 1 sprint needs 24/sprint; (24-8)/8 = 2 more.
    expect(report.additionalToMatchThroughput).toBe(2);
  });

  it('does not over-provision the way matching to raw dev capacity would (the +9 over-count fix)', () => {
    // 10 devs (80 dev pts/sprint) + 1 tester; 160 dev pts = 2 dev-sprints; 80 internal-test pts.
    // Keep pace = finish 80 test pts in 2 sprints = 40/sprint → (40-8)/8 = 4 testers.
    // Matching to raw dev capacity (80/sprint) would have said (80-8)/8 = 9 — the bug we fixed.
    const report = computeBottleneck(
      { dev: 160, internalTest: 80, externalTest: 0 },
      { dev: 10, internalTest: 1, externalTest: 0 },
      POOL,
      2,
    );
    expect(report.limitingRole).toBe('internalTest');
    expect(report.additionalToMatchThroughput).toBe(4);
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
