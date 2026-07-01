// useCreateFromSubmission.ts — Orchestrates turning a queue entry into a Jira issue and guarantees
// no duplicates. Every created issue is stamped with a label `intake-<id>` (via buildIntakeFields);
// before creating, Toolbox asks Jira whether a stamped issue already exists (per-row guard) and, on
// import, runs one batched pre-scan for all not-locally-known rows. Jira is the source of truth for
// dedup; the local ledger stays a fast cache. See spec 006 (FR-1..8) and research R3/R5/R6.

import { useCallback } from 'react';

import { createIssue, searchIssuesByLabels, searchUsers } from '../../../services/jiraApi.ts';
import { buildIntakeFields } from '../lib/buildIntakeFields.ts';
import { describeSubmitter } from '../lib/describeSubmitter.ts';
import { buildIntakeLabel, isStampableId } from '../lib/intakeLabel.ts';
import { buildFoundExisting, reconcileExisting as applyExisting } from '../lib/reconcileExisting.ts';
import { resolveProjectKey } from '../lib/resolveProjectKey.ts';
import { resolveReporter } from '../lib/resolveReporter.ts';
import type { ProcessedEntry, QueueEntry } from '../lib/intakeTypes.ts';
import type { IntakeConfig } from '../lib/intakeTypes.ts';

/** The standard Jira field that receives the submitter origin note on the fallback path. */
const DESCRIPTION_FIELD_ID = 'description';
/** Message shown when the Jira existence check cannot be completed (fail-safe: never blind-create). */
const CHECK_FAILED_REASON = 'Could not check Jira for an existing issue — try again.';
/** Reporter outcome recorded when reconciling to a pre-existing issue (U1: attribution not re-derived). */
const RECONCILED_REPORTER_OUTCOME = 'fallback' as const;

export interface UseCreateFromSubmissionParams {
  config: IntakeConfig | null;
  /** Records a created/reconciled submission id in the local dedup ledger (fast cache). */
  recordProcessed: (entry: ProcessedEntry) => Promise<void>;
}

export interface UseCreateFromSubmissionResult {
  createFromSubmission: (entry: QueueEntry) => Promise<QueueEntry>;
  createAllNew: (entries: QueueEntry[]) => Promise<QueueEntry[]>;
  /** Batched pre-scan: marks already-created rows Imported (and records them) before any create. */
  reconcileExisting: (entries: QueueEntry[]) => Promise<QueueEntry[]>;
}

/** The result of asking Jira whether a submission's stamped issue already exists. */
type ExistenceOutcome =
  | { kind: 'not-found' }
  | { kind: 'found'; key: string }
  | { kind: 'ambiguous' }
  | { kind: 'check-failed' };

/** Returns the reasons a submission cannot be created yet, or [] when it is ready. */
function findBlockingReasons(entry: QueueEntry): string[] {
  if (entry.submission.parseErrors.length > 0) {
    return entry.submission.parseErrors;
  }
  const reasons: string[] = [];
  if (entry.submission.fields.issueType.trim() === '') {
    reasons.push('Missing issue type');
  }
  return reasons;
}

/** Prepends the submitter origin note to the description on the fallback path (Story D). */
function prependOriginNote(fields: Record<string, unknown>, entry: QueueEntry): void {
  const originNote = describeSubmitter(entry.submission);
  const existingDescription = typeof fields[DESCRIPTION_FIELD_ID] === 'string' ? fields[DESCRIPTION_FIELD_ID] as string : '';
  fields[DESCRIPTION_FIELD_ID] = existingDescription ? `${originNote}\n\n${existingDescription}` : originNote;
}

/** Asks Jira whether a single submission's stamped issue already exists. Never throws. */
async function checkExisting(submissionId: string): Promise<ExistenceOutcome> {
  const label = buildIntakeLabel(submissionId);
  if (!label) {
    return { kind: 'not-found' };
  }
  try {
    const found = buildFoundExisting(await searchIssuesByLabels([label]));
    if (found.ambiguousIds.has(submissionId)) {
      return { kind: 'ambiguous' };
    }
    const existingKey = found.idToKey.get(submissionId);
    return existingKey ? { kind: 'found', key: existingKey } : { kind: 'not-found' };
  } catch {
    return { kind: 'check-failed' };
  }
}

/** Hook exposing create + batched dedup pre-scan; every create path stamps and is guarded. */
export function useCreateFromSubmission({
  config,
  recordProcessed,
}: UseCreateFromSubmissionParams): UseCreateFromSubmissionResult {
  const createFromSubmission = useCallback(async (entry: QueueEntry): Promise<QueueEntry> => {
    if (!config) {
      return { ...entry, state: 'failed', blockingReasons: ['No intake configuration is set.'] };
    }

    const blockingReasons = findBlockingReasons(entry);
    if (blockingReasons.length > 0) {
      return { ...entry, state: 'invalid', blockingReasons };
    }

    const projectResolution = resolveProjectKey(entry.submission, config);
    if (!projectResolution.ok) {
      const nextState = projectResolution.kind === 'unmapped-project' ? 'invalid' : 'failed';
      return { ...entry, state: nextState, blockingReasons: [projectResolution.reason] };
    }

    // Dedup guard: if Jira already has a stamped issue for this submission, reconcile instead of
    // creating a duplicate. A failed check never falls through to a blind create (FR-2/4/7/8).
    const existence = await checkExisting(entry.submission.id);
    if (existence.kind === 'found') {
      const processedEntry: ProcessedEntry = {
        id: entry.submission.id,
        jiraKey: existence.key,
        createdAt: new Date().toISOString(),
        reporterOutcome: RECONCILED_REPORTER_OUTCOME,
      };
      await recordProcessed(processedEntry); // self-heal the local cache (US2)
      return { ...entry, state: 'imported', jiraKey: existence.key, reporterOutcome: RECONCILED_REPORTER_OUTCOME, blockingReasons: [] };
    }
    if (existence.kind === 'ambiguous') {
      return { ...entry, state: 'invalid', blockingReasons: [`Multiple Jira issues already carry this submission's stamp (intake-${entry.submission.id}).`] };
    }
    if (existence.kind === 'check-failed') {
      return { ...entry, state: 'failed', blockingReasons: [CHECK_FAILED_REASON] };
    }

    const fields = buildIntakeFields(entry.submission, config, projectResolution.projectKey);

    // Reporter resolution never blocks creation: a non-match falls back to the integration account
    // (reporter omitted) with the submitter's origin recorded in the description so it is not lost.
    const reporter = await resolveReporter(entry.submission.submitter.email, { searchUsers });
    if (reporter.outcome === 'matched') {
      fields.reporter = reporter.reporter;
    } else {
      prependOriginNote(fields, entry);
    }

    try {
      const created = await createIssue({ fields });
      const processedEntry: ProcessedEntry = {
        id: entry.submission.id,
        jiraKey: created.key,
        createdAt: new Date().toISOString(),
        reporterOutcome: reporter.outcome,
      };
      // Record BEFORE returning success so a crash/re-import can never create a second issue.
      await recordProcessed(processedEntry);
      return { ...entry, state: 'imported', jiraKey: created.key, reporterOutcome: reporter.outcome, blockingReasons: [] };
    } catch (caught) {
      const reason = caught instanceof Error ? caught.message : String(caught);
      return { ...entry, state: 'failed', reporterOutcome: reporter.outcome, blockingReasons: [reason] };
    }
  }, [config, recordProcessed]);

  const createAllNew = useCallback(async (entries: QueueEntry[]): Promise<QueueEntry[]> => {
    const results: QueueEntry[] = [];
    // Sequential so each create's ledger write is visible to the next (guards against duplicates).
    for (const entry of entries) {
      if (entry.state !== 'new') {
        results.push(entry);
        continue;
      }
      results.push(await createFromSubmission(entry));
    }
    return results;
  }, [createFromSubmission]);

  const reconcileExisting = useCallback(async (entries: QueueEntry[]): Promise<QueueEntry[]> => {
    // Only rows not already resolved by the local ledger cache (state 'new') need a Jira lookup,
    // and only when their id is stampable — so known rows incur no Jira call (FR-5/US3).
    const targets = entries.filter((entry) => entry.state === 'new' && isStampableId(entry.submission.id));
    if (targets.length === 0) {
      return entries;
    }
    const labels = targets
      .map((entry) => buildIntakeLabel(entry.submission.id))
      .filter((label): label is string => label !== null);

    let results;
    try {
      results = await searchIssuesByLabels(labels); // one batched (chunked) query (FR-6)
    } catch {
      return entries; // fail-safe: leave rows as-is; the per-row guard catches at create time (FR-7)
    }

    const { entries: reconciled, newLedgerEntries } = applyExisting(entries, buildFoundExisting(results), new Date().toISOString());
    for (const ledgerEntry of newLedgerEntries) {
      await recordProcessed(ledgerEntry); // self-heal the cache for reconciled rows
    }
    return reconciled;
  }, [recordProcessed]);

  return { createFromSubmission, createAllNew, reconcileExisting };
}
