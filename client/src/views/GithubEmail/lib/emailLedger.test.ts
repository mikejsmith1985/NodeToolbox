// emailLedger.test.ts — Dedup lookup and idempotent append for the processed-email ledger.

import { describe, expect, it } from 'vitest';

import { appendProcessed, findProcessed, isProcessed, type EmailLedgerEntry } from './emailLedger.ts';

function entry(key: string, outcome: EmailLedgerEntry['outcome'] = 'posted'): EmailLedgerEntry {
  return { key, processedAtIso: '2026-07-24T00:00:00.000Z', eventType: 'pr_merged', jiraKey: 'DENP-1', outcome };
}

describe('emailLedger', () => {
  it('detects a processed key and finds its record', () => {
    const ledger = [entry('<a@github.com>')];
    expect(isProcessed(ledger, '<a@github.com>')).toBe(true);
    expect(isProcessed(ledger, '<b@github.com>')).toBe(false);
    expect(findProcessed(ledger, '<a@github.com>')?.jiraKey).toBe('DENP-1');
  });

  it('appends a new key', () => {
    const next = appendProcessed([entry('<a@github.com>')], entry('<b@github.com>'));
    expect(next.map((row) => row.key)).toEqual(['<a@github.com>', '<b@github.com>']);
  });

  it('replaces rather than duplicates when the same key is appended again', () => {
    const next = appendProcessed([entry('<a@github.com>', 'posted')], entry('<a@github.com>', 'error'));
    expect(next).toHaveLength(1);
    expect(next[0].outcome).toBe('error');
  });
});
