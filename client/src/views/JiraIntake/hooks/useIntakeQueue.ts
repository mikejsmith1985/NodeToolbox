// useIntakeQueue.ts — Turns a dropped file into the newest-first intake queue: parse → normalize →
// dedup against the local ledger. Owns the queue entries and exposes per-entry updates so the
// create flow can reflect results. See contracts/intake-contracts.md §E and FR-2.1/2.2.

import { useCallback, useMemo, useRef, useState } from 'react';

import { IntakeParseError, parseWorkbook } from '../lib/parseSubmissions.ts';
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
  updateEntry: (updated: QueueEntry) => void;
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
  // Keep the latest ledger available to ingestFile without re-creating the callback each render.
  const ledgerRef = useRef<ProcessedEntry[]>(ledger);
  ledgerRef.current = ledger;

  const ingestFile = useCallback(async (file: File): Promise<QueueEntry[]> => {
    try {
      const rows = await parseWorkbook(file);
      const submissions = rows.map((row, index) => normalizeSubmission(row, index));
      const ordered = [...submissions].sort(byNewestFirst);
      const nextEntries = ordered.map((submission) => toQueueEntry(submission, ledgerRef.current));
      setEntries(nextEntries);
      setErrorMessage(null);
      return nextEntries;
    } catch (caught) {
      // On any import failure the existing queue is left untouched and a clear message is shown.
      setErrorMessage(caught instanceof IntakeParseError ? caught.message : GENERIC_IMPORT_ERROR);
      return [];
    }
  }, []);

  const updateEntry = useCallback((updated: QueueEntry): void => {
    setEntries((current) => current.map((entry) => (entry.submission.id === updated.submission.id ? updated : entry)));
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

  return { entries, errorMessage, counts, ingestFile, updateEntry, reset };
}
