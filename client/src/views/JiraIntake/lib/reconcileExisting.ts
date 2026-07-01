// reconcileExisting.ts — Pure logic that turns label-search results into queue updates: which rows
// already have a Jira issue (reconcile to Imported), which are ambiguous (flag Invalid), and which
// ledger entries to persist so the local cache self-heals. No I/O. See spec 006 data-model §2–4.

import { extractSubmissionId } from './intakeLabel.ts';
import type { JiraLabelSearchIssue } from '../../../services/jiraApi.ts';
import type { ProcessedEntry, QueueEntry } from './intakeTypes.ts';

// A submission reconciled to a pre-existing issue records 'fallback': we did not set the reporter
// on this run and do not re-derive the original attribution (U1 decision). Display-only.
const RECONCILED_REPORTER_OUTCOME = 'fallback' as const;

export interface FoundExisting {
  /** submission id → the single existing issue key that carries its stamp. */
  idToKey: Map<string, string>;
  /** submission ids matched by more than one stamped issue (a data anomaly to flag, never create). */
  ambiguousIds: Set<string>;
}

/** Builds the id→key map (and ambiguous set) from label-search results. */
export function buildFoundExisting(results: JiraLabelSearchIssue[]): FoundExisting {
  const idToKey = new Map<string, string>();
  const ambiguousIds = new Set<string>();

  for (const issue of results) {
    const submissionId = extractSubmissionId(issue.labels);
    if (!submissionId) {
      continue;
    }
    const existingKey = idToKey.get(submissionId);
    if (existingKey && existingKey !== issue.key) {
      ambiguousIds.add(submissionId);
    } else {
      idToKey.set(submissionId, issue.key);
    }
  }
  return { idToKey, ambiguousIds };
}

export interface ReconcileResult {
  /** Entries with matched rows flipped to imported and ambiguous rows flagged invalid. */
  entries: QueueEntry[];
  /** Ledger entries to persist for newly-reconciled rows (so future imports hit the cache). */
  newLedgerEntries: ProcessedEntry[];
}

/**
 * Applies existence findings to the queue: a unique match becomes `imported` with the found key
 * (and yields a ledger entry); an ambiguous match becomes `invalid` with the conflicting keys; all
 * other rows are returned unchanged.
 */
export function reconcileExisting(
  entries: QueueEntry[],
  found: FoundExisting,
  createdAt: string,
): ReconcileResult {
  const newLedgerEntries: ProcessedEntry[] = [];

  const reconciledEntries = entries.map((entry): QueueEntry => {
    const submissionId = entry.submission.id;

    if (found.ambiguousIds.has(submissionId)) {
      return {
        ...entry,
        state: 'invalid',
        blockingReasons: [`Multiple Jira issues already carry this submission's stamp (intake-${submissionId}).`],
      };
    }

    const existingKey = found.idToKey.get(submissionId);
    if (existingKey) {
      newLedgerEntries.push({ id: submissionId, jiraKey: existingKey, createdAt, reporterOutcome: RECONCILED_REPORTER_OUTCOME });
      return { ...entry, state: 'imported', jiraKey: existingKey, reporterOutcome: RECONCILED_REPORTER_OUTCOME, blockingReasons: [] };
    }

    return entry;
  });

  return { entries: reconciledEntries, newLedgerEntries };
}
