// reconcileExisting.test.ts — Covers building the id→key map (incl. ambiguity) and applying it to
// queue entries (reconcile matched → imported, ambiguous → invalid, others unchanged).

import { describe, expect, it } from 'vitest';

import { buildFoundExisting, reconcileExisting } from './reconcileExisting.ts';
import type { JiraLabelSearchIssue } from '../../../services/jiraApi.ts';
import type { QueueEntry } from './intakeTypes.ts';

function entry(id: string): QueueEntry {
  return {
    submission: {
      id, submittedAt: '', status: 'New',
      submitter: { displayName: '', email: '' },
      fields: { summary: 's', description: '', acceptanceCriteria: '', issueType: 'Story', priority: '', project: '' },
      extras: {}, rowIndex: 0, parseErrors: [],
    },
    state: 'new', jiraKey: null, blockingReasons: [], reporterOutcome: null,
  };
}

const CREATED_AT = '2026-07-01T00:00:00.000Z';

describe('buildFoundExisting', () => {
  it('maps each intake label to its issue key', () => {
    const results: JiraLabelSearchIssue[] = [
      { key: 'ENCUC-1', labels: ['intake-a', 'x'] },
      { key: 'ENCUC-2', labels: ['intake-b'] },
    ];
    const found = buildFoundExisting(results);
    expect(found.idToKey.get('a')).toBe('ENCUC-1');
    expect(found.idToKey.get('b')).toBe('ENCUC-2');
    expect(found.ambiguousIds.size).toBe(0);
  });

  it('flags an id carried by more than one issue as ambiguous', () => {
    const results: JiraLabelSearchIssue[] = [
      { key: 'ENCUC-1', labels: ['intake-a'] },
      { key: 'ENCUC-9', labels: ['intake-a'] },
    ];
    const found = buildFoundExisting(results);
    expect(found.ambiguousIds.has('a')).toBe(true);
  });

  it('ignores issues without an intake label', () => {
    const found = buildFoundExisting([{ key: 'ENCUC-3', labels: ['backlog'] }]);
    expect(found.idToKey.size).toBe(0);
  });
});

describe('reconcileExisting', () => {
  it('reconciles a matched row to imported with the found key and yields a ledger entry (fallback)', () => {
    const found = buildFoundExisting([{ key: 'ENCUC-5', labels: ['intake-a'] }]);
    const { entries, newLedgerEntries } = reconcileExisting([entry('a'), entry('b')], found, CREATED_AT);

    const reconciled = entries.find((candidate) => candidate.submission.id === 'a');
    expect(reconciled?.state).toBe('imported');
    expect(reconciled?.jiraKey).toBe('ENCUC-5');
    expect(reconciled?.reporterOutcome).toBe('fallback');
    expect(entries.find((candidate) => candidate.submission.id === 'b')?.state).toBe('new');
    expect(newLedgerEntries).toEqual([{ id: 'a', jiraKey: 'ENCUC-5', createdAt: CREATED_AT, reporterOutcome: 'fallback' }]);
  });

  it('flags an ambiguous row invalid and records no ledger entry for it', () => {
    const found = buildFoundExisting([
      { key: 'ENCUC-1', labels: ['intake-a'] },
      { key: 'ENCUC-9', labels: ['intake-a'] },
    ]);
    const { entries, newLedgerEntries } = reconcileExisting([entry('a')], found, CREATED_AT);
    expect(entries[0].state).toBe('invalid');
    expect(entries[0].blockingReasons[0]).toContain('Multiple Jira issues');
    expect(newLedgerEntries).toHaveLength(0);
  });

  it('leaves rows with no match unchanged', () => {
    const found = buildFoundExisting([]);
    const { entries, newLedgerEntries } = reconcileExisting([entry('a')], found, CREATED_AT);
    expect(entries[0].state).toBe('new');
    expect(newLedgerEntries).toHaveLength(0);
  });
});
