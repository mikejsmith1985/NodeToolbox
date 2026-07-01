// processedLedger.ts — Pure helpers over the local dedup ledger (list of created submissions by
// id). This is the single source of truth for "already created", since v1 never writes back to
// the dropped file. See data-model.md §4 and research.md R5.

import type { ProcessedEntry } from './intakeTypes.ts';

/** True when a submission id has already been turned into a Jira issue. */
export function isProcessed(ledger: ProcessedEntry[], submissionId: string): boolean {
  return ledger.some((entry) => entry.id === submissionId);
}

/** Returns the ledger record for a submission id, or undefined when it has not been processed. */
export function findProcessed(ledger: ProcessedEntry[], submissionId: string): ProcessedEntry | undefined {
  return ledger.find((entry) => entry.id === submissionId);
}

/**
 * Returns a new ledger with the entry added. If the id already exists it is replaced (idempotent),
 * so recording the same successful create twice never produces a duplicate ledger row.
 */
export function appendProcessed(ledger: ProcessedEntry[], entry: ProcessedEntry): ProcessedEntry[] {
  return [...ledger.filter((existing) => existing.id !== entry.id), entry];
}
