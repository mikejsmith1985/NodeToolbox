// piPlanMonitor.test.ts — Monitoring signals + replan triggers (spec 032, US5, contract monitoring-signals.md).

import { describe, expect, it } from 'vitest';

import { computeMonitor, type WrittenPlanSnapshot, type LiveJiraSnapshot } from './piPlanMonitor.ts';

const NOW = '2026-08-20';

function plan(): WrittenPlanSnapshot {
  return {
    sprints: [
      { name: 'S1', plannedPoints: 20, slCapacity: 8 },
      { name: 'S2', plannedPoints: 20, slCapacity: 8 },
    ],
    stories: [{ key: 'DENP-1', plannedSprint: 'S1' }],
  };
}

function live(overrides: Partial<LiveJiraSnapshot> = {}): LiveJiraSnapshot {
  return {
    sprints: [
      { name: 'S1', completedPoints: 20, slQueueDepth: 4, committedStories: 5, completedStories: 5 },
      { name: 'S2', completedPoints: 20, slQueueDepth: 4, committedStories: 5, completedStories: 5 },
    ],
    maxSubtaskAgingDays: 2,
    lastActivityByStory: { 'DENP-1': '2026-08-19' },
    actualSprintByStory: { 'DENP-1': 'S1' },
    ...overrides,
  };
}

describe('computeMonitor', () => {
  it('reports burn-up on-track when completed meets planned-to-date', () => {
    const result = computeMonitor(plan(), live(), NOW);
    expect(result.signals.filter((s) => s.kind === 'burnUp').every((s) => s.isOnTrack)).toBe(true);
  });

  it('flags burn-up off-track when completed lags planned-to-date', () => {
    const result = computeMonitor(plan(), live({ sprints: [
      { name: 'S1', completedPoints: 10, slQueueDepth: 4, committedStories: 5, completedStories: 3 },
      { name: 'S2', completedPoints: 10, slQueueDepth: 4, committedStories: 5, completedStories: 3 },
    ] }), NOW);
    expect(result.signals.find((s) => s.kind === 'burnUp' && s.sprintName === 'S1')?.isOnTrack).toBe(false);
  });

  it('flags SL-queue depth over capacity', () => {
    const result = computeMonitor(plan(), live({ sprints: [
      { name: 'S1', completedPoints: 20, slQueueDepth: 12, committedStories: 5, completedStories: 5 },
      { name: 'S2', completedPoints: 20, slQueueDepth: 4, committedStories: 5, completedStories: 5 },
    ] }), NOW);
    expect(result.signals.find((s) => s.kind === 'slQueueDepth' && s.sprintName === 'S1')?.isOnTrack).toBe(false);
  });

  it('raises the SL-queue replan trigger on two consecutive over-capacity sprints', () => {
    const result = computeMonitor(plan(), live({ sprints: [
      { name: 'S1', completedPoints: 20, slQueueDepth: 12, committedStories: 5, completedStories: 5 },
      { name: 'S2', completedPoints: 20, slQueueDepth: 12, committedStories: 5, completedStories: 5 },
    ] }), NOW);
    expect(result.triggers.some((t) => t.kind === 'slQueueOverTwoSprints')).toBe(true);
  });

  it('raises the story-slipped trigger when a Story lands in a later sprint than planned', () => {
    const result = computeMonitor(plan(), live({ actualSprintByStory: { 'DENP-1': 'S2' } }), NOW);
    expect(result.triggers.some((t) => t.kind === 'storySlipped' && t.subjectKey === 'DENP-1')).toBe(true);
  });

  it('computes freshness from the last activity timestamp and the injected clock', () => {
    const result = computeMonitor(plan(), live({ lastActivityByStory: { 'DENP-1': '2026-08-10' } }), NOW);
    const freshness = result.signals.find((s) => s.kind === 'freshness');
    expect(freshness?.value).toBe(10);   // 2026-08-10 → 2026-08-20
    expect(freshness?.isOnTrack).toBe(false);
  });
});
