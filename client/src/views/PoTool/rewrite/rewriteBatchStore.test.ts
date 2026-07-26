// rewriteBatchStore.test.ts — Local persistence + portable export/import (spec 030, contract batch-store.md).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ canPersistDrafts: vi.fn(() => true) }));
vi.mock('../drafts/splitDraftStorage', () => ({ canPersistDrafts: mocks.canPersistDrafts }));

import {
  deleteBatch,
  exportBatchFile,
  importBatchFile,
  listBatches,
  loadBatch,
  saveBatch,
} from './rewriteBatchStore.ts';
import type { RewriteBatch, RewriteItem } from './rewriteBatchModel';

function item(jiraKey: string, state: RewriteItem['state']): RewriteItem {
  return {
    jiraKey,
    original: { summary: `${jiraKey} sum`, description: 'orig', acceptanceCriteria: 'ac', capturedAtIso: '2026-07-26T00:00:00.000Z' },
    proposed: { description: 'Description:\nnew', acceptanceCriteria: 'ac2', isEdited: false },
    state,
    captureError: null,
    submitResult: null,
  };
}

function batch(overrides: Partial<RewriteBatch> = {}): RewriteBatch {
  return {
    id: 'b1', name: 'Batch One', teamProfileId: 'team-a', createdAtIso: '2026-07-26T00:00:00.000Z',
    updatedAtIso: '2026-07-26T00:00:00.000Z', items: [item('ABC-1', 'approved'), item('ABC-2', 'rejected')], ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  mocks.canPersistDrafts.mockReturnValue(true);
});

describe('save / load', () => {
  it('round-trips a batch (content preserved, updatedAtIso re-stamped)', () => {
    expect(saveBatch(batch())).toBe(true);
    const loaded = loadBatch('team-a', 'b1')!;
    expect(loaded.id).toBe('b1');
    expect(loaded.items.map((each) => each.jiraKey)).toEqual(['ABC-1', 'ABC-2']);
    expect(typeof loaded.updatedAtIso).toBe('string');
  });

  it('returns null for an absent batch', () => {
    expect(loadBatch('team-a', 'nope')).toBeNull();
  });
});

describe('listBatches', () => {
  it('summarises this team’s batches with per-state counts', () => {
    saveBatch(batch({ id: 'b1' }));
    saveBatch(batch({ id: 'b2', name: 'Batch Two' }));
    saveBatch(batch({ id: 'x1', teamProfileId: 'team-b' })); // other team — excluded
    const summaries = listBatches('team-a');
    expect(summaries.map((summary) => summary.id).sort()).toEqual(['b1', 'b2']);
    expect(summaries[0].countsByState).toEqual({ approved: 1, rejected: 1 });
    expect(summaries[0].itemCount).toBe(2);
  });
});

describe('deleteBatch', () => {
  it('removes only the named batch', () => {
    saveBatch(batch({ id: 'b1' }));
    saveBatch(batch({ id: 'b2' }));
    deleteBatch('team-a', 'b1');
    expect(loadBatch('team-a', 'b1')).toBeNull();
    expect(loadBatch('team-a', 'b2')).not.toBeNull();
  });
});

describe('export / import portability', () => {
  it('export→import round-trips deep-equal', () => {
    const original = batch();
    const { json, fileName } = exportBatchFile(original);
    expect(fileName).toContain('b1');
    expect(importBatchFile(json)).toEqual(original);
  });

  it('importBatchFile throws on non-JSON and on a malformed batch', () => {
    expect(() => importBatchFile('not json')).toThrow(/valid JSON/i);
    expect(() => importBatchFile(JSON.stringify({ id: 'x' }))).toThrow(/not a valid re-write batch/i);
  });
});

describe('storage unavailable (private mode)', () => {
  it('save returns false, load null, list empty — no throw', () => {
    mocks.canPersistDrafts.mockReturnValue(false);
    expect(saveBatch(batch())).toBe(false);
    expect(loadBatch('team-a', 'b1')).toBeNull();
    expect(listBatches('team-a')).toEqual([]);
  });
});
