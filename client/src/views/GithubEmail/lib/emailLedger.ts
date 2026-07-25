// emailLedger.ts — Pure dedup helpers over the processed-email ledger, mirroring JiraIntake's
// processedLedger.ts. The ledger is the single source of truth for "this email file was already
// handled", keyed by Message-ID (falling back to a content hash when the export stripped it), so the
// same notification saved twice never drives Jira twice.

/** One processed-email record. `key` is the Message-ID or content hash; the rest is audit detail. */
export interface EmailLedgerEntry {
  key: string;
  processedAtIso: string;
  eventType: string;
  jiraKey: string | null;
  outcome: 'posted' | 'skipped' | 'dry-run' | 'error';
}

/** True when an email key has already been processed. */
export function isProcessed(ledger: EmailLedgerEntry[], key: string): boolean {
  return ledger.some((entry) => entry.key === key);
}

/** Returns the ledger record for a key, or undefined when it has not been processed. */
export function findProcessed(ledger: EmailLedgerEntry[], key: string): EmailLedgerEntry | undefined {
  return ledger.find((entry) => entry.key === key);
}

/**
 * Returns a new ledger with the entry added. If the key already exists it is replaced (idempotent),
 * so recording the same email twice never produces a duplicate ledger row.
 */
export function appendProcessed(ledger: EmailLedgerEntry[], entry: EmailLedgerEntry): EmailLedgerEntry[] {
  return [...ledger.filter((existing) => existing.key !== entry.key), entry];
}
