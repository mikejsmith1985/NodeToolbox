// rewriteBatchModel.test.ts — Compile-time shape guard for the batch contracts (spec 030). These are
// type-only declarations; the value is that the sample literals must satisfy the interfaces (a type
// regression fails the build), with light runtime assertions on the samples.

import { describe, expect, it } from 'vitest';

import type { CapturedOriginal, RewriteBatch, RewriteItem } from './rewriteBatchModel';

describe('rewriteBatchModel shapes', () => {
  it('accepts a well-formed RewriteItem and RewriteBatch', () => {
    const original: CapturedOriginal = { summary: 'S', description: 'd', acceptanceCriteria: 'ac', capturedAtIso: '2026-07-26T00:00:00Z' };
    const item: RewriteItem = {
      jiraKey: 'ABC-1',
      original,
      proposed: { description: 'Description:\nx', acceptanceCriteria: 'ac2', isEdited: false },
      state: 'approved',
      captureError: null,
      submitResult: null,
    };
    const batch: RewriteBatch = {
      id: 'b1', name: 'Batch', teamProfileId: 't', createdAtIso: 'x', updatedAtIso: 'x', items: [item],
    };
    expect(batch.items[0].state).toBe('approved');
    expect(batch.items[0].proposed?.isEdited).toBe(false);
  });
});
