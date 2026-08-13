// boardOrderSync.test.ts — Proves the team's priority order can be published and pulled, and that a
// pull says what it would change before it changes it.
//
// The rule that matters most here is the one about collapsed lanes: accepting the team's priorities
// must never refold somebody's board. That is a view of their own, not a decision the team took.

import { describe, expect, it } from 'vitest';

import {
  applyBoardOrder,
  compareBoardOrders,
  describeOrderDifference,
} from './boardOrderSync.ts';
import type { BoardOrderRecord } from '../../../services/confluenceApi.ts';
import type { BoardPreferences } from './rollupBoardTypes.ts';

function buildPreferences(overrides: Partial<BoardPreferences> = {}): BoardPreferences {
  return {
    teamProfileId: 'team-a',
    boardId: 42,
    laneOrder: [],
    collapsedByFeatureKey: {},
    cardOrderByCell: {},
    ...overrides,
  };
}

function buildRecord(overrides: Partial<BoardOrderRecord> = {}): BoardOrderRecord {
  return {
    teamProfileId: 'team-a',
    laneOrder: [],
    cardOrderByCell: {},
    updatedAt: '2026-08-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('compareBoardOrders', () => {
  it('finds nothing to report when the two orders already agree', () => {
    const preferences = buildPreferences({ laneOrder: ['DENP-1', 'DENP-2'] });

    expect(compareBoardOrders(preferences, buildRecord({ laneOrder: ['DENP-1', 'DENP-2'] }))).toEqual([]);
  });

  it('names each Feature that moves, and where it moves to', () => {
    // Per Feature, not "the order is different" — somebody replacing their board's sequence deserves
    // to see which Features move, which is the whole reason this is preview-and-accept.
    const differences = compareBoardOrders(
      buildPreferences({ laneOrder: ['DENP-1', 'DENP-2'] }),
      buildRecord({ laneOrder: ['DENP-2', 'DENP-1'] }),
    );

    expect(differences).toContainEqual({ kind: 'lane-moved', featureKey: 'DENP-2', fromRank: 2, toRank: 1 });
    expect(differences).toContainEqual({ kind: 'lane-moved', featureKey: 'DENP-1', fromRank: 1, toRank: 2 });
  });

  it('reports a Feature the team ranks that this board does not', () => {
    const differences = compareBoardOrders(
      buildPreferences({ laneOrder: [] }),
      buildRecord({ laneOrder: ['DENP-9'] }),
    );

    expect(differences).toEqual([{ kind: 'lane-moved', featureKey: 'DENP-9', fromRank: null, toRank: 1 }]);
  });

  it('reports a locally-ranked Feature the team does not rank, since accepting drops it', () => {
    const differences = compareBoardOrders(
      buildPreferences({ laneOrder: ['DENP-7'] }),
      buildRecord({ laneOrder: [] }),
    );

    expect(differences).toEqual([{ kind: 'lane-unranked', featureKey: 'DENP-7' }]);
  });

  it('reports a cell whose cards are in a different sequence', () => {
    const differences = compareBoardOrders(
      buildPreferences({ cardOrderByCell: { 'DENP-1::col-working': ['A-1', 'A-2'] } }),
      buildRecord({ cardOrderByCell: { 'DENP-1::col-working': ['A-2', 'A-1'] } }),
    );

    expect(differences).toEqual([{ kind: 'cards-reordered', cellKey: 'DENP-1::col-working' }]);
  });

  it('treats an identical cell as identical, so republishing is not seen as a change', () => {
    const cardOrderByCell = { 'DENP-1::col-working': ['A-1', 'A-2'] };

    expect(compareBoardOrders(buildPreferences({ cardOrderByCell }), buildRecord({ cardOrderByCell }))).toEqual([]);
  });
});

describe('describeOrderDifference', () => {
  it('says where a Feature moves from and to', () => {
    expect(describeOrderDifference({ kind: 'lane-moved', featureKey: 'DENP-2', fromRank: 2, toRank: 1 }))
      .toBe('DENP-2 moves from position 2 to 1.');
  });

  it('says plainly when a Feature is not ranked here yet', () => {
    expect(describeOrderDifference({ kind: 'lane-moved', featureKey: 'DENP-9', fromRank: null, toRank: 3 }))
      .toContain('unranked here');
  });

  it('says what happens to a Feature the team does not rank', () => {
    expect(describeOrderDifference({ kind: 'lane-unranked', featureKey: 'DENP-7' }))
      .toContain('returns to its default position');
  });

  it('names the Feature and column behind a cell key, never the raw key', () => {
    const sentence = describeOrderDifference({ kind: 'cards-reordered', cellKey: 'DENP-1::col-working' });

    expect(sentence).toContain('DENP-1');
    expect(sentence).toContain('col-working');
    expect(sentence).not.toContain('::');
  });
});

describe('applyBoardOrder', () => {
  it('takes the team\'s lane and card order', () => {
    const applied = applyBoardOrder(
      buildPreferences({ laneOrder: ['DENP-1'] }),
      buildRecord({ laneOrder: ['DENP-2', 'DENP-1'], cardOrderByCell: { 'DENP-2::col-a': ['X-1'] } }),
    );

    expect(applied.laneOrder).toEqual(['DENP-2', 'DENP-1']);
    expect(applied.cardOrderByCell).toEqual({ 'DENP-2::col-a': ['X-1'] });
  });

  it('leaves collapsed lanes exactly as they were — that is a view, not a decision', () => {
    // Accepting the team's priorities must not refold somebody's board.
    const applied = applyBoardOrder(
      buildPreferences({ collapsedByFeatureKey: { 'DENP-1': true } }),
      buildRecord({ laneOrder: ['DENP-1'] }),
    );

    expect(applied.collapsedByFeatureKey).toEqual({ 'DENP-1': true });
  });

  it('keeps the board it belongs to, so a pulled order cannot re-point at another board', () => {
    const applied = applyBoardOrder(buildPreferences({ boardId: 42 }), buildRecord({ laneOrder: [] }));

    expect(applied.boardId).toBe(42);
    expect(applied.teamProfileId).toBe('team-a');
  });
});
