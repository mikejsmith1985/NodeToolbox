// loadSourceFeature.ts — Loads the Feature a PO wants to split.
//
// One request fetches BOTH the issue type id and the project key, because the increments must be created
// as the original's own type (several types are Feature-like, and instances differ — never hard-code
// "Feature"), and Jira keys required-field discovery by project key. Fetching both together avoids a
// second round-trip before the PO can do anything.
//
// It also draws the line this codebase has learned to draw: an empty or failed read may mean the VPN is
// down, and must never be presented as "this Feature has no content".

import { jiraGet } from '../../../services/jiraApi.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';
import type { HygieneFieldConfig } from '../../Hygiene/checks/hygieneChecks';
import type { SourceFeatureSnapshot } from '../drafts/draftModel';

/** Everything the Splitter needs about the original, in one request. */
const SOURCE_FEATURE_BASE_FIELDS = [
  'project',
  'issuetype',
  'summary',
  'description',
  'status',
  'assignee',
  'priority',
  'duedate',
  'fixVersions',
  'parent',
  'created',
  'updated',
];

/** A load that failed in a way the PO can act on. */
export class SourceFeatureLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceFeatureLoadError';
  }
}

/** The issue shape this module reads back from Jira. */
interface LoadedJiraIssue {
  key: string;
  self?: string;
  fields: {
    project?: { key?: string };
    issuetype?: { id?: string; name?: string };
    summary?: string;
    description?: unknown;
    [fieldId: string]: unknown;
  };
}

/** Jira returns rich-text as a string on v2, so anything else is not usable prose. */
function readTextField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Reads acceptance criteria from whichever field this instance keeps them in, as clean plain text. */
function readAcceptanceCriteria(issue: LoadedJiraIssue, fieldConfig: HygieneFieldConfig): string {
  for (const candidateFieldId of fieldConfig.acceptanceCriteriaFieldIds) {
    // `description` is a legitimate fallback in the config, but it is not acceptance criteria —
    // showing the description in both boxes would be actively misleading.
    if (candidateFieldId === 'description') {
      continue;
    }
    // Jira may return this field as rendered HTML — strip tags/entities so the PO reads clean prose.
    const candidateValue = normalizeRichTextToPlainText(issue.fields[candidateFieldId]);
    if (candidateValue.trim() !== '') {
      return candidateValue;
    }
  }
  return '';
}

/** The fields worth carrying for display, the AI prompt, and hygiene evaluation. */
function buildFieldsToRequest(fieldConfig: HygieneFieldConfig): string[] {
  const hygieneFieldIds = [
    ...fieldConfig.acceptanceCriteriaFieldIds,
    ...fieldConfig.applicationFieldIds,
    ...fieldConfig.initiativeTypeFieldIds,
    ...fieldConfig.productOwnerFieldIds,
    ...fieldConfig.programIncrementFieldIds,
    ...fieldConfig.targetStartFieldIds,
    ...fieldConfig.targetEndFieldIds,
  ];
  return Array.from(new Set([...SOURCE_FEATURE_BASE_FIELDS, ...hygieneFieldIds]));
}

/**
 * Loads a Feature by key and reduces it to the snapshot a split works from.
 *
 * `nowIso` is injected rather than read here so the module stays deterministic and testable.
 */
export async function loadSourceFeature(
  featureKey: string,
  fieldConfig: HygieneFieldConfig,
  nowIso: string,
): Promise<SourceFeatureSnapshot> {
  const trimmedKey = featureKey.trim().toUpperCase();
  if (trimmedKey === '') {
    throw new SourceFeatureLoadError('Enter the key of the Feature you want to split, for example ABC-123.');
  }

  const requestedFields = buildFieldsToRequest(fieldConfig).join(',');
  let loadedIssue: LoadedJiraIssue;
  try {
    loadedIssue = await jiraGet<LoadedJiraIssue>(
      `/rest/api/2/issue/${encodeURIComponent(trimmedKey)}?fields=${encodeURIComponent(requestedFields)}`,
    );
  } catch (loadError) {
    const reason = loadError instanceof Error ? loadError.message : String(loadError);
    throw new SourceFeatureLoadError(`Could not load ${trimmedKey}: ${reason}`);
  }

  // A response with no issue type is not an empty Feature — it means the read did not really succeed
  // (an unreachable Jira behind a VPN is the usual cause). Saying "no content" here would send the PO
  // looking for a Jira problem that does not exist.
  if (!loadedIssue?.fields?.issuetype?.id) {
    throw new SourceFeatureLoadError(
      `Jira returned no usable data for ${trimmedKey}. If you are off the VPN this is a connection problem rather than a problem with the Feature — check your connection and try again.`,
    );
  }
  if (!loadedIssue.fields.project?.key) {
    throw new SourceFeatureLoadError(
      `Jira did not say which project ${trimmedKey} belongs to, so new Features cannot be created from it.`,
    );
  }

  return {
    key: loadedIssue.key || trimmedKey,
    projectKey: loadedIssue.fields.project.key,
    issueTypeId: loadedIssue.fields.issuetype.id,
    issueTypeName: loadedIssue.fields.issuetype.name ?? '',
    summary: readTextField(loadedIssue.fields.summary),
    // Jira returns the description as rendered HTML on this instance; strip tags/entities so the
    // Splitter shows and carries clean, human-readable prose (not raw <p data-renderer…> markup).
    description: normalizeRichTextToPlainText(loadedIssue.fields.description),
    acceptanceCriteria: readAcceptanceCriteria(loadedIssue, fieldConfig),
    fields: loadedIssue.fields as Record<string, unknown>,
    loadedAtIso: nowIso,
  };
}

/** The link types this instance actually defines, for the link picker. Never hard-coded (FR-037). */
export async function loadIssueLinkTypeNames(): Promise<string[]> {
  const response = await jiraGet<{ issueLinkTypes?: Array<{ name?: string }> }>('/rest/api/2/issueLinkType');
  const linkTypeNames = (response.issueLinkTypes ?? [])
    .map((linkType) => linkType.name ?? '')
    .filter((linkTypeName) => linkTypeName !== '');
  return Array.from(new Set(linkTypeNames));
}
