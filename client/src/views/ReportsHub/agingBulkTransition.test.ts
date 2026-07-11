// agingBulkTransition.test.ts — Verifies target-status summarisation and the per-issue batch transition run.

import { describe, expect, it, vi } from 'vitest';

import type { JiraTransition } from '../../types/jira.ts';
import {
  findTransitionToStatus,
  runBulkTransition,
  summarizeTargetStatuses,
} from './agingBulkTransition.ts';

/** Builds a transition to a destination status (statusCategory is irrelevant to these tests). */
function transition(id: string, toStatus: string): JiraTransition {
  return { id, name: `Go ${toStatus}`, to: { name: toStatus, statusCategory: { name: 'Done' } } };
}

describe('findTransitionToStatus', () => {
  it('matches the destination status case-insensitively', () => {
    const transitions = [transition('11', 'Cancelled'), transition('21', 'In Progress')];
    expect(findTransitionToStatus(transitions, 'cancelled')?.id).toBe('11');
    expect(findTransitionToStatus(transitions, 'Closed')).toBeNull();
  });
});

describe('summarizeTargetStatuses', () => {
  it('lists every reachable status with a count of issues that can reach it, most-available first', () => {
    const byKey = new Map<string, JiraTransition[]>([
      ['A-1', [transition('11', 'Cancelled'), transition('12', 'Done')]],
      ['A-2', [transition('11', 'Cancelled')]],
      ['A-3', [transition('31', 'Done')]],
    ]);
    const options = summarizeTargetStatuses(byKey);
    // Cancelled reachable by 2, Done reachable by 2 → tie broken alphabetically (Cancelled first).
    expect(options).toEqual([
      { statusName: 'Cancelled', availableCount: 2 },
      { statusName: 'Done', availableCount: 2 },
    ]);
  });
});

describe('runBulkTransition', () => {
  it('applies the matching transition per issue and reports each as done', async () => {
    const byKey = new Map<string, JiraTransition[]>([
      ['A-1', [transition('11', 'Cancelled')]],
      ['A-2', [transition('21', 'Cancelled')]],
    ]);
    const apply = vi.fn().mockResolvedValue(undefined);
    const results = await runBulkTransition(['A-1', 'A-2'], 'Cancelled', byKey, apply);

    expect(apply).toHaveBeenCalledWith('A-1', '11');
    expect(apply).toHaveBeenCalledWith('A-2', '21');
    expect(results.every((result) => result.outcome === 'done')).toBe(true);
  });

  it('skips an issue with no transition to the target and still processes the rest', async () => {
    const byKey = new Map<string, JiraTransition[]>([
      ['A-1', [transition('11', 'In Progress')]], // cannot reach Cancelled
      ['A-2', [transition('21', 'Cancelled')]],
    ]);
    const apply = vi.fn().mockResolvedValue(undefined);
    const results = await runBulkTransition(['A-1', 'A-2'], 'Cancelled', byKey, apply);

    expect(results[0]).toMatchObject({ issueKey: 'A-1', outcome: 'skipped' });
    expect(results[1]).toMatchObject({ issueKey: 'A-2', outcome: 'done' });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('records a failure when the apply call throws, without aborting the batch', async () => {
    const byKey = new Map<string, JiraTransition[]>([
      ['A-1', [transition('11', 'Cancelled')]],
      ['A-2', [transition('21', 'Cancelled')]],
    ]);
    const apply = vi.fn()
      .mockRejectedValueOnce(new Error('Jira rejected the transition: 400'))
      .mockResolvedValueOnce(undefined);
    const results = await runBulkTransition(['A-1', 'A-2'], 'Cancelled', byKey, apply);

    expect(results[0]).toMatchObject({ issueKey: 'A-1', outcome: 'failed', message: expect.stringContaining('400') });
    expect(results[1]).toMatchObject({ issueKey: 'A-2', outcome: 'done' });
  });
});
