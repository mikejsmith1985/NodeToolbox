// buildCompositionCommit.ts — Decides what committing a composed Feature would do to Jira.
//
// Two paths, and they are mutually exclusive by construction: a draft with a Jira key UPDATES that issue,
// and a draft without one CREATES a new Feature in a project the PO picks. Conflating them is how a tool
// ends up creating a duplicate of the Feature someone stubbed last week (FR-035, FR-036, SC-012).
//
// Pure, like the split diff: the review step must be able to promise exactly what will happen.

import type { CreateMetaFieldEntry } from '../../../types/jira.ts';
import type { CompositionDraft } from '../drafts/draftModel';
import type { CommitBlocker } from './buildSplitCommit';

/** The new Feature a commit would create. */
export interface PlannedFeatureCreate {
  projectKey: string;
  issueTypeId: string;
  fields: Record<string, unknown>;
}

/** One field a commit would change on an existing Feature. */
export interface PlannedFieldUpdate {
  fieldId: string;
  label: string;
  before: unknown;
  after: unknown;
}

/** The update a commit would apply. */
export interface PlannedFeatureUpdate {
  issueKey: string;
  changedFields: PlannedFieldUpdate[];
}

/** The reviewable picture of a composition commit. Exactly one of create/update is ever set. */
export interface CompositionCommitDiff {
  create: PlannedFeatureCreate | null;
  update: PlannedFeatureUpdate | null;
  /** Non-empty means commit is disabled — no partial issue is ever produced (FR-034). */
  blockers: CommitBlocker[];
}

export interface BuildCompositionCommitInput {
  draft: CompositionDraft;
  /** The target project/issue-type's fields, as the instance reports them. */
  requiredFieldDescriptors: readonly CreateMetaFieldEntry[];
  /** Which field this instance keeps acceptance criteria in, if any. */
  acceptanceCriteriaFieldId?: string | null;
  /** The existing issue's current field values, for the update diff. */
  existingFieldValues?: Record<string, unknown>;
}

/** Fields Jira always requires but that this flow supplies itself. */
const SELF_SUPPLIED_FIELD_IDS = new Set(['project', 'issuetype', 'summary']);

/** Assembles the draft's field payload, omitting empties so an unset optional is never sent. */
function buildDraftFields(
  draft: CompositionDraft,
  acceptanceCriteriaFieldId: string | null,
): Record<string, unknown> {
  const fields: Record<string, unknown> = { summary: draft.summary.trim() };

  if (draft.description.trim() !== '') {
    fields.description = draft.description.trim();
  }
  if (acceptanceCriteriaFieldId && draft.acceptanceCriteria.trim() !== '') {
    fields[acceptanceCriteriaFieldId] = draft.acceptanceCriteria.trim();
  }
  Object.entries(draft.fields).forEach(([fieldId, fieldValue]) => {
    if (fieldValue !== undefined && fieldValue !== null && fieldValue !== '') {
      fields[fieldId] = fieldValue;
    }
  });
  return fields;
}

/** Names the instance-required fields the draft has not satisfied (FR-034). */
function findMissingRequiredFieldNames(
  draftFields: Record<string, unknown>,
  requiredFieldDescriptors: readonly CreateMetaFieldEntry[],
): string[] {
  return requiredFieldDescriptors
    .filter((descriptor) => descriptor.required && !SELF_SUPPLIED_FIELD_IDS.has(descriptor.fieldId))
    .filter((descriptor) => {
      const suppliedValue = draftFields[descriptor.fieldId];
      return suppliedValue === undefined || suppliedValue === null || suppliedValue === '';
    })
    .map((descriptor) => descriptor.name);
}

/** A field is only "changed" if its value actually differs — an unchanged field is not a write. */
function buildChangedFields(
  draftFields: Record<string, unknown>,
  existingFieldValues: Record<string, unknown>,
  requiredFieldDescriptors: readonly CreateMetaFieldEntry[],
): PlannedFieldUpdate[] {
  const labelsByFieldId = new Map(
    requiredFieldDescriptors.map((descriptor) => [descriptor.fieldId, descriptor.name]),
  );

  return Object.entries(draftFields)
    .filter(([fieldId, draftValue]) => {
      const existingValue = existingFieldValues[fieldId];
      // Compared as text: Jira returns rich fields in shapes that are awkward to compare structurally,
      // and this diff exists to be READ by a human rather than to be exhaustive.
      return String(draftValue ?? '') !== String(existingValue ?? '');
    })
    .map(([fieldId, draftValue]) => ({
      fieldId,
      label: labelsByFieldId.get(fieldId) ?? fieldId,
      before: existingFieldValues[fieldId] ?? '',
      after: draftValue,
    }));
}

/**
 * Builds the reviewable diff for a composition.
 *
 * Whether this creates or updates is decided by ONE thing: does the draft carry a Jira key. Nothing else
 * influences it, which is what makes the duplicate case impossible.
 */
export function buildCompositionCommit(input: BuildCompositionCommitInput): CompositionCommitDiff {
  const { draft, requiredFieldDescriptors, acceptanceCriteriaFieldId = null, existingFieldValues = {} } = input;
  const blockers: CommitBlocker[] = [];

  if (draft.summary.trim() === '') {
    blockers.push({ scope: 'draft', reason: 'Give the Feature a summary.' });
  }

  const draftFields = buildDraftFields(draft, acceptanceCriteriaFieldId);

  // The one decision. A key means the Feature exists; enrich it. No key means create it.
  const isUpdatingExistingFeature = draft.existingIssueKey !== null && draft.existingIssueKey.trim() !== '';

  if (isUpdatingExistingFeature) {
    const changedFields = buildChangedFields(draftFields, existingFieldValues, requiredFieldDescriptors);
    if (changedFields.length === 0 && blockers.length === 0) {
      blockers.push({ scope: 'draft', reason: 'Nothing has changed, so there is nothing to save.' });
    }
    return {
      create: null,
      update: blockers.length > 0
        ? null
        : { issueKey: draft.existingIssueKey!.trim().toUpperCase(), changedFields },
      blockers,
    };
  }

  if (!draft.targetProjectKey || draft.targetProjectKey.trim() === '') {
    blockers.push({ scope: 'draft', reason: 'Choose the project to create this Feature in.' });
  }
  if (!draft.targetIssueTypeId || draft.targetIssueTypeId.trim() === '') {
    blockers.push({
      scope: 'draft',
      reason: 'Choose the issue type to create. Only the types this project offers are available.',
    });
  }

  const missingRequiredFieldNames = findMissingRequiredFieldNames(draftFields, requiredFieldDescriptors);
  if (missingRequiredFieldNames.length > 0) {
    blockers.push({
      scope: 'draft',
      reason: `Jira requires ${missingRequiredFieldNames.join(', ')} for this issue type.`,
    });
  }

  return {
    create: blockers.length > 0
      ? null
      : {
        projectKey: draft.targetProjectKey!.trim().toUpperCase(),
        issueTypeId: draft.targetIssueTypeId!,
        fields: draftFields,
      },
    update: null,
    blockers,
  };
}

/** Whether the commit may run. One blocker stops it — never a partial write. */
export function canCommitComposition(diff: CompositionCommitDiff): boolean {
  return diff.blockers.length === 0 && (diff.create !== null || diff.update !== null);
}
