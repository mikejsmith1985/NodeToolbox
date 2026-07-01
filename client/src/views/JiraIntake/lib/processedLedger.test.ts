// processedLedger.test.ts — Covers dedup lookup and idempotent append.

import { describe, expect, it } from 'vitest';

import { appendProcessed, findProcessed, isProcessed } from './processedLedger.ts';
import type { ProcessedEntry } from './intakeTypes.ts';

const entryA: ProcessedEntry = { id: 'a', jiraKey: 'ENFCT-1', createdAt: '2026-07-01T00:00:00Z', reporterOutcome: 'matched' };

describe('processedLedger', () => {
  it('detects a processed id', () => {
    expect(isProcessed([entryA], 'a')).toBe(true);
    expect(isProcessed([entryA], 'b')).toBe(false);
  });

  it('finds the ledger record with its Jira key', () => {
    expect(findProcessed([entryA], 'a')?.jiraKey).toBe('ENFCT-1');
    expect(findProcessed([entryA], 'z')).toBeUndefined();
  });

  it('appends a new entry', () => {
    const next = appendProcessed([entryA], { id: 'b', jiraKey: 'ENFCT-2', createdAt: '', reporterOutcome: 'fallback' });
    expect(next).toHaveLength(2);
    expect(next.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('replaces (does not duplicate) when the same id is appended twice', () => {
    const next = appendProcessed([entryA], { id: 'a', jiraKey: 'ENFCT-9', createdAt: '', reporterOutcome: 'fallback' });
    expect(next).toHaveLength(1);
    expect(next[0].jiraKey).toBe('ENFCT-9');
  });
});
