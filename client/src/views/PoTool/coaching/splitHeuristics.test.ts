// splitHeuristics.test.ts — Proves the split coaching is deterministic, always available, and advisory.
//
// The coaching is the reason a PO can split well without an AI. It must therefore never depend on the AI
// gate, never touch the network, and never block a PO from splitting the way they judge best
// (FR-010, FR-011, SC-013, INV-6).

import { describe, expect, it, vi } from 'vitest';

import { SPLIT_HEURISTICS, findSplitHeuristic } from './splitHeuristics';

describe('SPLIT_HEURISTICS', () => {
  it('offers several distinct ways to cut a Feature, because no single one fits every Feature', () => {
    expect(SPLIT_HEURISTICS.length).toBeGreaterThanOrEqual(5);
  });

  it('gives every heuristic a stable id, so a PO Tool draft can reference one', () => {
    const heuristicIds = SPLIT_HEURISTICS.map((heuristic) => heuristic.id);

    expect(new Set(heuristicIds).size).toBe(heuristicIds.length);
    heuristicIds.forEach((heuristicId) => expect(heuristicId).toMatch(/^[a-z-]+$/));
  });

  it('gives every heuristic a name, an explanation, and a worked example', () => {
    // A bare label ("split by workflow step") teaches nothing. The example is the part that lands.
    SPLIT_HEURISTICS.forEach((heuristic) => {
      expect(heuristic.name.length).toBeGreaterThan(0);
      expect(heuristic.description.length).toBeGreaterThan(20);
      expect(heuristic.example.length).toBeGreaterThan(20);
    });
  });

  it('includes the heuristics a PO reaches for most often', () => {
    const heuristicIds = SPLIT_HEURISTICS.map((heuristic) => heuristic.id);

    expect(heuristicIds).toContain('workflow-step');
    expect(heuristicIds).toContain('business-rule');
    expect(heuristicIds).toContain('happy-path-first');
    expect(heuristicIds).toContain('data-variation');
  });

  it('leads with happy-path-first, the split that most often unblocks a stuck PO', () => {
    expect(SPLIT_HEURISTICS[0].id).toBe('happy-path-first');
  });

  it('states what a good increment looks like, so the coaching has a target', () => {
    SPLIT_HEURISTICS.forEach((heuristic) => {
      expect(heuristic.prompt.length).toBeGreaterThan(10);
    });
  });
});

describe('findSplitHeuristic', () => {
  it('finds a heuristic by id', () => {
    expect(findSplitHeuristic('workflow-step')?.name).toBeTruthy();
  });

  it('returns nothing for an unknown id rather than throwing', () => {
    expect(findSplitHeuristic('does-not-exist')).toBeNull();
  });
});

describe('determinism (INV-6)', () => {
  it('resolves with no network call at all', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    findSplitHeuristic('workflow-step');
    expect(SPLIT_HEURISTICS.length).toBeGreaterThan(0);

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('returns the same content every time, because it is authored, not generated', () => {
    expect(findSplitHeuristic('workflow-step')).toEqual(findSplitHeuristic('workflow-step'));
  });

  it('never mentions the AI assist, so the coaching reads the same locked or unlocked', () => {
    // If the coaching pointed at AI, a locked PO would be told about a control they cannot see.
    const allCoachingText = SPLIT_HEURISTICS.map(
      (heuristic) => `${heuristic.name} ${heuristic.description} ${heuristic.example} ${heuristic.prompt}`,
    ).join(' ');

    expect(allCoachingText).not.toMatch(/\bAI\b|assistant|unlock/i);
  });
});
