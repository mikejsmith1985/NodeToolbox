// useIntakeQueue.ts — Turns a dropped file into the newest-first intake queue: parse → normalize →
// dedup against the local ledger. Owns the queue entries and exposes per-entry updates so the
// create flow can reflect results. See contracts/intake-contracts.md §E and FR-2.1/2.2.

import { useCallback, useMemo, useState } from 'react';

import { IntakeParseError, parseWorkbook, type RawRow } from '../lib/parseSubmissions.ts';
import { normalizeSubmission } from '../lib/normalizeSubmission.ts';
import { findProcessed } from '../lib/processedLedger.ts';
import type { IntakeSubmission, ProcessedEntry, QueueEntry } from '../lib/intakeTypes.ts';

const GENERIC_IMPORT_ERROR = 'Could not import this file. Make sure it is the exported Excel or CSV of submissions.';

export interface IntakeQueueCounts {
  total: number;
  newCount: number;
  imported: number;
  invalid: number;
}

export interface UseIntakeQueueResult {
  entries: QueueEntry[];
  errorMessage: string | null;
  counts: IntakeQueueCounts;
  /** Parses + loads the file into the queue and returns the resulting entries ([] on failure). */
  ingestFile: (file: File) => Promise<QueueEntry[]>;
  /** Loads already-parsed rows (e.g. from the SharePoint relay pull) into the queue. */
  ingestRows: (rows: RawRow[]) => QueueEntry[];
  updateEntry: (updated: QueueEntry) => void;
  /** Marks a submission as skipped (review-and-pick dismiss), leaving others untouched. */
  dismissEntry: (submissionId: string) => void;
  reset: () => void;
}

/** Sorts submissions newest-first by submittedAt; unparseable timestamps sort last. */
function byNewestFirst(left: IntakeSubmission, right: IntakeSubmission): number {
  const leftTime = Date.parse(left.submittedAt) || 0;
  const rightTime = Date.parse(right.submittedAt) || 0;
  return rightTime - leftTime;
}

/** Classifies one submission into its initial queue state given the local dedup ledger. */
function toQueueEntry(submission: IntakeSubmission, ledger: ProcessedEntry[]): QueueEntry {
  if (submission.parseErrors.length > 0) {
    return { submission, state: 'invalid', jiraKey: null, blockingReasons: submission.parseErrors, reporterOutcome: null };
  }
  const processed = findProcessed(ledger, submission.id);
  if (processed) {
    return { submission, state: 'imported', jiraKey: processed.jiraKey, blockingReasons: [], reporterOutcome: processed.reporterOutcome };
  }
  return { submission, state: 'new', jiraKey: null, blockingReasons: [], reporterOutcome: null };
}

/** Owns the queue derived from a dropped file, deduped against the given ledger. */
export function useIntakeQueue(ledger: ProcessedEntry[]): UseIntakeQueueResult {
  const [entries, setEntries] = useState<QueueEntry[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Shared: normalize rows → newest-first → classify against the ledger as it stands right now.
  // Reading `ledger` directly is safe because ingestFile/ingestRows are only ever called from the
  // drop and pull handlers — no effect depends on their identity, so there is nothing to keep stable.
  const buildEntries = useCallback((rows: RawRow[]): QueueEntry[] => {
    const submissions = rows.map((row, index) => normalizeSubmission(row, index));
    const ordered = [...submissions].sort(byNewestFirst);
    return ordered.map((submission) => toQueueEntry(submission, ledger));
  }, [ledger]);

  const ingestFile = useCallback(async (file: File): Promise<QueueEntry[]> => {
    try {
      const rows = await parseWorkbook(file);
      const nextEntries = buildEntries(rows);
      setEntries(nextEntries);
      setErrorMessage(null);
      return nextEntries;
    } catch (caught) {
      // On any import failure the existing queue is left untouched and a clear message is shown.
      setErrorMessage(caught instanceof IntakeParseError ? caught.message : GENERIC_IMPORT_ERROR);
      return [];
    }
  }, [buildEntries]);

  const ingestRows = useCallback((rows: RawRow[]): QueueEntry[] => {
    const nextEntries = buildEntries(rows);
    setEntries(nextEntries);
    setErrorMessage(null);
    return nextEntries;
  }, [buildEntries]);

  const updateEntry = useCallback((updated: QueueEntry): void => {
    setEntries((current) => current.map((entry) => (entry.submission.id === updated.submission.id ? updated : entry)));
  }, []);

  const dismissEntry = useCallback((submissionId: string): void => {
    setEntries((current) => current.map((entry) => (
      entry.submission.id === submissionId ? { ...entry, state: 'skipped', blockingReasons: [] } : entry
    )));
  }, []);

  const reset = useCallback((): void => {
    setEntries([]);
    setErrorMessage(null);
  }, []);

  const counts = useMemo<IntakeQueueCounts>(() => ({
    total: entries.length,
    newCount: entries.filter((entry) => entry.state === 'new').length,
    imported: entries.filter((entry) => entry.state === 'imported').length,
    invalid: entries.filter((entry) => entry.state === 'invalid').length,
  }), [entries]);

  return { entries, errorMessage, counts, ingestFile, ingestRows, updateEntry, dismissEntry, reset };
}
