// piReviewEngine.entry.test.ts — Guards the server bundle's public API. The entry barrel is what
// esbuild bundles to CJS for the Node scheduler; if a re-export is accidentally dropped or renamed,
// the server refresh would break at runtime. This test fails fast on any such drift.

import { describe, expect, it } from 'vitest';

import * as engine from './piReviewEngine.entry.ts';

describe('piReviewEngine.entry (server bundle barrel)', () => {
  it('re-exports every pure engine function the server-side refresh needs', () => {
    const requiredExports = [
      'setPiReviewDomParser',
      'parsePiReviewTable',
      'writePiReviewTable',
      'parsePiReviewCapacitySummary',
      'writePiReviewCapacitySummary',
      'parseConfidenceVoteTable',
      'writeConfidenceVoteTable',
      'createEmptyPiReviewRow',
      'reconcilePiReviewRowsWithJira',
      'extractPiReviewFeatureKey',
      'buildDirectFeatureJql',
    ];

    for (const exportName of requiredExports) {
      expect(typeof (engine as Record<string, unknown>)[exportName]).toBe('function');
    }
  });
});
