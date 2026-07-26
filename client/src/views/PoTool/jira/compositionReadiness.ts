// compositionReadiness.ts — Builds the inputs the Feature Composition readiness checklist needs so it
// grades an existing Feature against its REAL Jira field values (bug GH #220: PI and Product Owner were
// flagged "Missing" although they were set, because the load fetched only summary/description/AC and the
// evaluated issue never overlaid the issue's own field values). Pure and unit-tested.

import type { JiraIssue as HygieneIssue } from '../../Hygiene/checks/hygieneChecks';

/** The subset of the hygiene field config the readiness load needs — every governed field family, by id. */
export interface ReadinessFieldConfig {
  programIncrementFieldIds: string[];
  productOwnerFieldIds: string[];
  parentLinkFieldIds: string[];
  featureLinkFieldIds: string[];
  initiativeTypeFieldIds: string[];
  applicationFieldIds: string[];
  targetStartFieldIds: string[];
  targetEndFieldIds: string[];
  acceptanceCriteriaFieldIds: string[];
  estimateFieldIds?: string[];
  pcodeFieldIds?: string[];
}

/** Native Jira fields the readiness checks read regardless of instance configuration. */
const NATIVE_READINESS_FIELDS = ['summary', 'description', 'issuetype', 'status', 'labels', 'priority', 'duedate', 'fixVersions', 'parent'];

/**
 * The field list to request when loading an existing Feature to enrich — the native readiness fields plus
 * every configured governed-field id — so the checklist can see whether each governed field is actually
 * set. De-duplicated; the AC field id (which may be configured separately) is always included.
 */
export function buildReadinessFieldList(
  fieldConfig: ReadinessFieldConfig,
  acceptanceCriteriaFieldId: string | null,
): string[] {
  const configured = [
    ...fieldConfig.programIncrementFieldIds,
    ...fieldConfig.productOwnerFieldIds,
    ...fieldConfig.parentLinkFieldIds,
    ...fieldConfig.featureLinkFieldIds,
    ...fieldConfig.initiativeTypeFieldIds,
    ...fieldConfig.applicationFieldIds,
    ...fieldConfig.targetStartFieldIds,
    ...fieldConfig.targetEndFieldIds,
    ...fieldConfig.acceptanceCriteriaFieldIds,
    ...(fieldConfig.estimateFieldIds ?? []),
    ...(fieldConfig.pcodeFieldIds ?? []),
  ];
  const all = [
    ...NATIVE_READINESS_FIELDS,
    ...configured,
    ...(acceptanceCriteriaFieldId ? [acceptanceCriteriaFieldId] : []),
  ];
  return Array.from(new Set(all.filter((fieldId) => typeof fieldId === 'string' && fieldId.trim() !== '')));
}

/** The draft fields the readiness evaluation compares against the loaded issue. */
export interface DraftReadinessInputs {
  existingIssueKey: string | null;
  summary: string;
  description: string;
  acceptanceCriteria: string;
  fields: Record<string, unknown>;
}

/**
 * Builds the issue the readiness checklist grades: the loaded issue's real field values as the base
 * (so a field set in Jira is never flagged missing), with the PO's draft edits layered on top (so an
 * edit is reflected immediately). For a brand-new composition `existingFieldValues` is empty, so this is
 * identical to grading the draft alone.
 */
export function buildDraftHygieneIssue(
  inputs: DraftReadinessInputs,
  existingFieldValues: Record<string, unknown>,
  acceptanceCriteriaFieldId: string | null,
): HygieneIssue {
  return {
    key: inputs.existingIssueKey ?? 'DRAFT',
    fields: {
      ...existingFieldValues,
      summary: inputs.summary,
      description: inputs.description,
      issuetype: { name: 'Feature' },
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      ...(acceptanceCriteriaFieldId ? { [acceptanceCriteriaFieldId]: inputs.acceptanceCriteria } : {}),
      ...inputs.fields,
    },
  } as HygieneIssue;
}
