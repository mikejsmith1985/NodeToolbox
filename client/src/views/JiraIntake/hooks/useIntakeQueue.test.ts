// useIntakeQueue.test.ts — Covers ingest ordering (newest-first), dedup vs the ledger, invalid-row
// flagging, counts, the parse-error path (queue untouched), and per-entry updates.

import { renderHook, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useIntakeQueue } from './useIntakeQueue.ts';
import type { ProcessedEntry, QueueEntry } from '../lib/intakeTypes.ts';

vi.mock('../lib/parseSubmissions.ts', async () => {
  const actual = await vi.importActual<typeof import('../lib/parseSubmissions.ts')>('../lib/parseSubmissions.ts');
  return { ...actual, parseWorkbook: vi.fn() };
});

const { parseWorkbook, IntakeParseError } = await import('../lib/parseSubmissions.ts');
const parseWorkbookMock = vi.mocked(parseWorkbook);

const FILE = new File(['x'], 'Jira-Intake.xlsx');

afterEach(() => { vi.clearAllMocks(); });

describe('useIntakeQueue', () => {
  it('parses, normalizes, and orders submissions newest-first', async () => {
    parseWorkbookMock.mockResolvedValue([
      { id: 'older', submittedAt: '2026-07-01T10:00:00Z', summary: 'Older' },
      { id: 'newer', submittedAt: '2026-07-01T12:00:00Z', summary: 'Newer' },
    ]);
    const { result } = renderHook(() => useIntakeQueue([]));

    await act(async () => { await result.current.ingestFile(FILE); });

    expect(result.current.entries.map((entry) => entry.submission.id)).toEqual(['newer', 'older']);
    expect(result.current.entries.every((entry) => entry.state === 'new')).toBe(true);
    expect(result.current.counts).toEqual({ total: 2, newCount: 2, imported: 0, invalid: 0 });
  });

  it('marks already-processed submissions as imported with their Jira key', async () => {
    parseWorkbookMock.mockResolvedValue([{ id: 'done', submittedAt: '2026-07-01T10:00:00Z', summary: 'S' }]);
    const ledger: ProcessedEntry[] = [{ id: 'done', jiraKey: 'ENFCT-42', createdAt: '', reporterOutcome: 'matched' }];
    const { result } = renderHook(() => useIntakeQueue(ledger));

    await act(async () => { await result.current.ingestFile(FILE); });

    expect(result.current.entries[0].state).toBe('imported');
    expect(result.current.entries[0].jiraKey).toBe('ENFCT-42');
    expect(result.current.counts.imported).toBe(1);
  });

  it('flags malformed rows as invalid without blocking valid ones', async () => {
    parseWorkbookMock.mockResolvedValue([
      { id: '', submittedAt: '2026-07-01T09:00:00Z' },
      { id: 'ok', submittedAt: '2026-07-01T10:00:00Z', summary: 'Fine' },
    ]);
    const { result } = renderHook(() => useIntakeQueue([]));

    await act(async () => { await result.current.ingestFile(FILE); });

    const invalidEntry = result.current.entries.find((entry) => entry.state === 'invalid');
    expect(invalidEntry?.blockingReasons).toContain('Missing submission id');
    expect(result.current.counts).toMatchObject({ invalid: 1, newCount: 1 });
  });

  it('shows the parse error message and leaves the queue untouched on failure', async () => {
    parseWorkbookMock.mockResolvedValueOnce([{ id: 'a', submittedAt: '', summary: 'S' }]);
    const { result } = renderHook(() => useIntakeQueue([]));
    await act(async () => { await result.current.ingestFile(FILE); });
    expect(result.current.entries).toHaveLength(1);

    parseWorkbookMock.mockRejectedValueOnce(new IntakeParseError('Bad file.'));
    await act(async () => { await result.current.ingestFile(FILE); });

    expect(result.current.errorMessage).toBe('Bad file.');
    expect(result.current.entries).toHaveLength(1); // unchanged
  });

  it('updates a single entry in place', async () => {
    parseWorkbookMock.mockResolvedValue([{ id: 'a', submittedAt: '', summary: 'S' }]);
    const { result } = renderHook(() => useIntakeQueue([]));
    await act(async () => { await result.current.ingestFile(FILE); });

    const updated: QueueEntry = { ...result.current.entries[0], state: 'imported', jiraKey: 'ENFCT-1' };
    act(() => { result.current.updateEntry(updated); });

    expect(result.current.entries[0].state).toBe('imported');
    expect(result.current.entries[0].jiraKey).toBe('ENFCT-1');
  });
});
