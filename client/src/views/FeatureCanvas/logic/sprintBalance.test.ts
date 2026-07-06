// sprintBalance.test.ts — Verifies capacity-respecting, priority-ordered story distribution.

import { describe, expect, it } from 'vitest';

import { balanceStoriesAcrossSprints, type BalanceStoryInput, type BalanceSprintInput } from './sprintBalance.ts';

const sprints: BalanceSprintInput[] = [
  { id: 's1', capacity: 10 },
  { id: 's2', capacity: 10 },
];

describe('balanceStoriesAcrossSprints', () => {
  it('fills sprints to capacity in priority order and overflows the rest to Over Capacity', () => {
    const stories: BalanceStoryInput[] = [
      { featureKey: 'F1', storyKey: 'A', points: 8, priority: 'Could' },
      { featureKey: 'F1', storyKey: 'B', points: 8, priority: 'Must' }, // Must first
      { featureKey: 'F1', storyKey: 'C', points: 8, priority: 'Should' },
    ];
    const result = balanceStoriesAcrossSprints(stories, sprints);
    const placed = new Map(result.assignments.map((assignment) => [assignment.storyKey, assignment.sprintId]));
    // Must (B) → s1, Should (C) → s2 (s1 only has 2 left), Could (A) → overflow (both sprints full).
    expect(placed.get('B')).toBe('s1');
    expect(placed.get('C')).toBe('s2');
    expect(placed.get('A')).toBeNull();
    expect(result.fitPoints).toBe(16);
    expect(result.overflowPoints).toBe(8);
    expect(result.overflowCount).toBe(1);
  });

  it('sends unestimated stories (null/0 points) to Over Capacity and counts them', () => {
    const stories: BalanceStoryInput[] = [
      { featureKey: 'F1', storyKey: 'U1', points: null, priority: 'Must' },
      { featureKey: 'F1', storyKey: 'U2', points: 0, priority: 'Must' },
      { featureKey: 'F1', storyKey: 'P', points: 5, priority: 'Must' },
    ];
    const result = balanceStoriesAcrossSprints(stories, sprints);
    const placed = new Map(result.assignments.map((assignment) => [assignment.storyKey, assignment.sprintId]));
    expect(placed.get('U1')).toBeNull();
    expect(placed.get('U2')).toBeNull();
    expect(placed.get('P')).toBe('s1');
    expect(result.unestimatedCount).toBe(2);
    expect(result.fitCount).toBe(1);
  });

  it('everything overflows when there are no sprints', () => {
    const result = balanceStoriesAcrossSprints([{ featureKey: 'F1', storyKey: 'A', points: 3, priority: 'Must' }], []);
    expect(result.assignments[0].sprintId).toBeNull();
    expect(result.overflowCount).toBe(1);
  });
});
