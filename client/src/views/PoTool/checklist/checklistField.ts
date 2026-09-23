// checklistField.ts — Finds the Jira field an Epic's Smart Checklist lives in, and reads and writes it.
//
// The field is DISCOVERED by name, never hard-coded. Two reasons: this instance's field ids are its own
// configuration rather than a platform constant (a hard-coded id on a new Jira reads a different field that
// happens to share the number), and a new file naming a customfield id is refused by the field-mapping ratchet.
//
// When no matching field exists, this says so plainly. A checklist tool that silently finds nothing would look
// exactly like an Epic whose checklist is already complete.

import { matchFieldIdsByName } from '../../Hygiene/checks/hygieneFieldConfig.ts';
import { jiraGet } from '../../../services/jiraApi.ts';
import { saveFeatureReviewSimpleField } from '../../SprintDashboard/featureReviewFixes.ts';
import type { JiraField } from '../../../types/jira.ts';

/** Field names the Smart Checklist app uses across its Jira versions. Matched case- and spacing-insensitively. */
export const CHECKLIST_FIELD_NAME_CANDIDATES = ['Smart Checklist', 'Checklist Text', 'Checklist'];

/** What the instance turned out to have — including, honestly, nothing. */
export interface ChecklistFieldResolution {
  /** The field id to read and write, or null when this instance exposes no checklist field. */
  fieldId: string | null;
  /** The field's name as the instance calls it, for saying which field was used. */
  fieldName: string | null;
  /** Every candidate found, so an instance with two can be told it has two. */
  matchedFieldIds: string[];
}

/**
 * Picks the checklist field out of the instance's own field list.
 *
 * The first match wins and the rest are reported rather than discarded: an instance carrying both a writable
 * checklist field and a read-only export copy should say so, because writing to the wrong one silently does
 * nothing.
 */
export function resolveChecklistField(availableFields: readonly JiraField[]): ChecklistFieldResolution {
  const matchedFieldIds = matchFieldIdsByName([...availableFields], CHECKLIST_FIELD_NAME_CANDIDATES);
  const [chosenFieldId] = matchedFieldIds;
  const chosenField = availableFields.find((availableField) => availableField.id === chosenFieldId);

  return {
    fieldId: chosenFieldId ?? null,
    fieldName: chosenField?.name ?? null,
    matchedFieldIds,
  };
}

/** Asks the instance which fields it has, then picks the checklist one. */
export async function loadChecklistField(): Promise<ChecklistFieldResolution> {
  const availableFields = await jiraGet<JiraField[]>('/rest/api/2/field');
  return resolveChecklistField(availableFields);
}

/** One Epic, as the checklist screen needs it. */
export interface EpicChecklistSource {
  issueKey: string;
  summary: string;
  status: string;
  description: string;
  acceptanceCriteria: string;
  /** The checklist field's raw text, exactly as Jira holds it. */
  checklistText: string;
}

/** Reads a string field off an issue, tolerating the shapes Jira returns for empty and rich values. */
function readFieldAsText(fieldValue: unknown): string {
  if (typeof fieldValue === 'string') {
    return fieldValue;
  }
  if (fieldValue && typeof fieldValue === 'object' && 'value' in fieldValue) {
    const wrappedValue = (fieldValue as { value: unknown }).value;
    return typeof wrappedValue === 'string' ? wrappedValue : '';
  }
  return '';
}

/**
 * Fetches the Epic and its checklist text in one request.
 *
 * The acceptance-criteria field is requested when this instance has one, because "scope and acceptance criteria
 * are understood" is a checklist item the AI cannot judge without seeing them.
 */
export async function fetchEpicChecklistSource(
  issueKey: string,
  checklistFieldId: string,
  acceptanceCriteriaFieldId: string | null,
): Promise<EpicChecklistSource> {
  const requestedFieldIds = ['summary', 'status', 'description', checklistFieldId];
  if (acceptanceCriteriaFieldId) {
    requestedFieldIds.push(acceptanceCriteriaFieldId);
  }

  const issue = await jiraGet<{ key: string; fields: Record<string, unknown> }>(
    `/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=${requestedFieldIds.join(',')}`,
  );
  const issueFields = issue.fields ?? {};
  const statusValue = issueFields.status as { name?: string } | undefined;

  return {
    issueKey: issue.key ?? issueKey,
    summary: readFieldAsText(issueFields.summary),
    status: statusValue?.name ?? '',
    description: readFieldAsText(issueFields.description),
    acceptanceCriteria: acceptanceCriteriaFieldId ? readFieldAsText(issueFields[acceptanceCriteriaFieldId]) : '',
    checklistText: readFieldAsText(issueFields[checklistFieldId]),
  };
}

/**
 * Writes the ticked checklist back to the Epic.
 *
 * This writes the ISSUE's own checklist field. The shared checklist template the Epic was created from is a
 * different record entirely and is never touched — ticking an item on one Epic must not tick it for every Epic.
 */
export async function saveEpicChecklist(
  issueKey: string,
  checklistFieldId: string,
  checklistText: string,
): Promise<void> {
  await saveFeatureReviewSimpleField(issueKey, checklistFieldId, checklistText);
}
