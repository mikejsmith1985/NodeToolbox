// epicIntakeModel.test.ts — The intake's factories start every decision open, which the engine relies on.

import { describe, expect, it } from 'vitest';

import {
  createEmptyItemDecisions,
  createIntakeItem,
  createOpenDecision,
  DECISION_SLOTS,
  INTAKE_STEP_ORDER,
  readItemDisplayTitle,
  readSettledValue,
} from './epicIntakeModel.ts';

describe('epicIntakeModel factories', () => {
  it('creates an open decision with no attempts, rejection or proposal', () => {
    expect(createOpenDecision()).toEqual({
      state: 'open',
      aiAttempts: 0,
      isAwaitingPo: false,
      lastRejection: null,
      aiProposal: null,
      aiReason: null,
    });
  });

  it('opens every decision slot on a fresh checklist', () => {
    const decisions = createEmptyItemDecisions();
    for (const slot of DECISION_SLOTS) {
      expect(decisions[slot].state).toBe('open');
    }
  });

  it('creates an item with a stable id, sorted lines and nothing looked up', () => {
    const item = createIntakeItem(3, 'Core Integration (denp-632)', [14, 12, 13]);
    expect(item.id).toBe('item-3');
    expect(item.lineNumbers).toEqual([12, 13, 14]);
    expect(item.searchStatus).toBe('notRun');
    expect(item.creation).toEqual({ state: 'notStarted' });
    expect(item.candidates).toEqual([]);
  });

  it('reads settled values only', () => {
    expect(readSettledValue(createOpenDecision<string>())).toBeNull();
    expect(readSettledValue({ state: 'settled', value: 'work', settledBy: 'rule', reason: 'x', aiAttempts: 0 })).toBe('work');
    expect(readSettledValue({ state: 'notApplicable', reason: 'x' })).toBeNull();
  });

  it('prefers the proposed title for display', () => {
    const item = createIntakeItem(1, 'Tech Debt/Performance Enhancements', [5]);
    expect(readItemDisplayTitle(item)).toBe('Tech Debt/Performance Enhancements');
    expect(readItemDisplayTitle({ ...item, proposedTitle: 'Tech debt and performance' })).toBe('Tech debt and performance');
  });

  it('orders the steps from sorting the notes to the summary', () => {
    expect(INTAKE_STEP_ORDER[0]).toBe('sortNotes');
    expect(INTAKE_STEP_ORDER[INTAKE_STEP_ORDER.length - 1]).toBe('summary');
  });
});
