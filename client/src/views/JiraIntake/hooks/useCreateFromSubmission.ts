// useCreateFromSubmission.ts — Orchestrates turning a queue entry into a Jira issue: validate
// required fields → resolve the reporter → build + POST the create payload → record the submission
// id locally (before surfacing success, so a re-import never double-creates). See FR-3 and R5/R6.

import { useCallback } from 'react';

import { createIssue, searchUsers } from '../../../services/jiraApi.ts';
import { findMissingRequiredFields } from '../../JiraTemplateMaker/lib/requiredFields.ts';
import type { FieldDescriptor } from '../../JiraTemplateMaker/lib/templateTypes.ts';
import { describeSubmitter } from '../lib/describeSubmitter.ts';
import { mapSubmissionToFields } from '../lib/mapToTemplateFields.ts';
import { resolveReporter } from '../lib/resolveReporter.ts';
import type { IntakeConfig, ProcessedEntry, QueueEntry } from '../lib/intakeTypes.ts';

/** The Jira field id the description core field maps to, or the standard `description` field. */
const DEFAULT_DESCRIPTION_FIELD_ID = 'description';

export interface UseCreateFromSubmissionParams {
  config: IntakeConfig | null;
  /** Createmeta field descriptors for the configured issue type (for required-field validation). */
  fieldDescriptors: FieldDescriptor[];
  /** Records a created submission id in the local dedup ledger. */
  recordProcessed: (entry: ProcessedEntry) => Promise<void>;
}

export interface UseCreateFromSubmissionResult {
  createFromSubmission: (entry: QueueEntry) => Promise<QueueEntry>;
  createAllNew: (entries: QueueEntry[]) => Promise<QueueEntry[]>;
}

/** Builds the full create payload fields, including project and issue type by id/key. */
function buildFullFields(entry: QueueEntry, config: IntakeConfig): Record<string, unknown> {
  return {
    project: { key: config.projectKey },
    issuetype: { id: config.issueTypeId },
    ...mapSubmissionToFields(entry.submission, config),
  };
}

/** Resolves which Jira field holds the description, so the origin note lands in the right place. */
function resolveDescriptionFieldId(config: IntakeConfig): string {
  const descriptionMapping = config.fieldMappings.find((mapping) => mapping.coreField === 'description');
  return descriptionMapping?.jiraFieldId ?? DEFAULT_DESCRIPTION_FIELD_ID;
}

/**
 * On the fallback path, prepends the submitter origin note to the description field so the request's
 * origin is never lost (Story D). Mutates the given fields object in place.
 */
function prependOriginNote(fields: Record<string, unknown>, entry: QueueEntry, config: IntakeConfig): void {
  const descriptionFieldId = resolveDescriptionFieldId(config);
  const originNote = describeSubmitter(entry.submission);
  const existingDescription = typeof fields[descriptionFieldId] === 'string' ? fields[descriptionFieldId] as string : '';
  fields[descriptionFieldId] = existingDescription ? `${originNote}\n\n${existingDescription}` : originNote;
}

/** Hook exposing single-submission and bulk create operations, each ledger-guarded and idempotent. */
export function useCreateFromSubmission({
  config,
  fieldDescriptors,
  recordProcessed,
}: UseCreateFromSubmissionParams): UseCreateFromSubmissionResult {
  const createFromSubmission = useCallback(async (entry: QueueEntry): Promise<QueueEntry> => {
    if (!config) {
      return { ...entry, state: 'failed', blockingReasons: ['No intake configuration is set.'] };
    }
    if (entry.submission.parseErrors.length > 0) {
      return { ...entry, state: 'invalid', blockingReasons: entry.submission.parseErrors };
    }

    const fields = buildFullFields(entry, config);
    const missingRequired = findMissingRequiredFields(fieldDescriptors, fields);
    if (missingRequired.length > 0) {
      return {
        ...entry,
        state: 'invalid',
        blockingReasons: missingRequired.map((fieldName) => `Missing required field: ${fieldName}`),
      };
    }

    // Reporter resolution never blocks creation: a non-match falls back to the integration account
    // (reporter omitted) with the submitter's origin recorded in the description so it is not lost.
    const reporter = await resolveReporter(entry.submission.submitter.email, { searchUsers });
    if (reporter.outcome === 'matched') {
      fields.reporter = reporter.reporter;
    } else {
      prependOriginNote(fields, entry, config);
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
  }, [config, fieldDescriptors, recordProcessed]);

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
