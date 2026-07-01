// useCreateFromSubmission.ts — Orchestrates turning a queue entry into a Jira issue: validate the
// always-required fields → resolve the reporter → build + POST the create payload → record the
// submission id locally (before surfacing success, so a re-import never double-creates). Mapping is
// by convention (buildIntakeFields); Jira validates anything instance-specific. See FR-3.

import { useCallback } from 'react';

import { createIssue, searchUsers } from '../../../services/jiraApi.ts';
import { buildIntakeFields } from '../lib/buildIntakeFields.ts';
import { describeSubmitter } from '../lib/describeSubmitter.ts';
import { resolveReporter } from '../lib/resolveReporter.ts';
import type { IntakeConfig, ProcessedEntry, QueueEntry } from '../lib/intakeTypes.ts';

/** The standard Jira field that receives the submitter origin note on the fallback path. */
const DESCRIPTION_FIELD_ID = 'description';

export interface UseCreateFromSubmissionParams {
  config: IntakeConfig | null;
  /** Records a created submission id in the local dedup ledger. */
  recordProcessed: (entry: ProcessedEntry) => Promise<void>;
}

export interface UseCreateFromSubmissionResult {
  createFromSubmission: (entry: QueueEntry) => Promise<QueueEntry>;
  createAllNew: (entries: QueueEntry[]) => Promise<QueueEntry[]>;
}

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

/** Hook exposing single-submission and bulk create operations, each ledger-guarded and idempotent. */
export function useCreateFromSubmission({
  config,
  recordProcessed,
}: UseCreateFromSubmissionParams): UseCreateFromSubmissionResult {
  const createFromSubmission = useCallback(async (entry: QueueEntry): Promise<QueueEntry> => {
    if (!config || config.projectKey.trim() === '') {
      return { ...entry, state: 'failed', blockingReasons: ['Set the target project before creating issues.'] };
    }

    const blockingReasons = findBlockingReasons(entry);
    if (blockingReasons.length > 0) {
      return { ...entry, state: 'invalid', blockingReasons };
    }

    const fields = buildIntakeFields(entry.submission, config);

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

  return { createFromSubmission, createAllNew };
}
