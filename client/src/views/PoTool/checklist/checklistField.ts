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

/** Lines that mean "this value is a checklist", used to recognise one wherever it turns out to live. */
const CHECKLIST_MARKDOWN_PATTERN = /^\s*(?:[-*+]\s*)?\[( |x|X|~|>)\]/m;

/** Does this value look like a Smart Checklist, whatever field or property it came out of? */
function looksLikeChecklist(value: unknown): boolean {
  return typeof value === 'string' && CHECKLIST_MARKDOWN_PATTERN.test(value);
}

/**
 * Finds the checklist among ALL of the issue's fields.
 *
 * The named field is only a good guess. On this instance the checklist arrives from a linked template, and the
 * field that carries its text is not necessarily the one called "Smart Checklist" — which is how an Epic showing
 * 0/11 in Jira was reported as having no checklist items at all. Recognising the checklist by its own syntax
 * finds it wherever it actually is, and the screen then says which field that was.
 */
export function findChecklistFieldInIssue(
  issueFields: Record<string, unknown>,
  preferredFieldId: string | null,
): { fieldId: string; text: string } | null {
  if (preferredFieldId && looksLikeChecklist(issueFields[preferredFieldId])) {
    return { fieldId: preferredFieldId, text: issueFields[preferredFieldId] as string };
  }
  const matchingEntry = Object.entries(issueFields).find(([, fieldValue]) => looksLikeChecklist(fieldValue));
  return matchingEntry ? { fieldId: matchingEntry[0], text: matchingEntry[1] as string } : null;
}

/** Where the checklist text was eventually found, so the screen can say so and the tick knows where to write. */
export interface ChecklistLocation {
  /** The field id holding the checklist, or null when it was not found in any field. */
  fieldId: string | null;
  text: string;
}

/**
 * Fetches the Epic and its checklist in one request.
 *
 * Every field is requested rather than a named few: the checklist is recognised by its own syntax, which is the
 * only way to find one that lives somewhere other than where its field name suggests.
 */
export async function fetchEpicChecklistSource(
  issueKey: string,
  checklistFieldId: string | null,
  acceptanceCriteriaFieldId: string | null,
): Promise<EpicChecklistSource & { checklistLocation: ChecklistLocation }> {
  const issue = await jiraGet<{ key: string; fields: Record<string, unknown> }>(
    `/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=*all`,
  );
  const issueFields = issue.fields ?? {};
  const statusValue = issueFields.status as { name?: string } | undefined;
  const foundChecklist = findChecklistFieldInIssue(issueFields, checklistFieldId);

  return {
    issueKey: issue.key ?? issueKey,
    summary: readFieldAsText(issueFields.summary),
    status: statusValue?.name ?? '',
    description: readFieldAsText(issueFields.description),
    acceptanceCriteria: acceptanceCriteriaFieldId ? readFieldAsText(issueFields[acceptanceCriteriaFieldId]) : '',
    checklistText: foundChecklist?.text ?? '',
    checklistLocation: { fieldId: foundChecklist?.fieldId ?? null, text: foundChecklist?.text ?? '' },
  };
}

/**
 * Looks for the checklist in the issue's properties, where some versions of the app keep it instead of a field.
 *
 * Returns empty rather than failing: an instance that refuses the properties endpoint should cost the PO a
 * fallback, not the whole review.
 */
export async function fetchChecklistFromIssueProperties(issueKey: string): Promise<string> {
  try {
    const propertyKeys = await jiraGet<{ keys?: Array<{ key: string }> }>(
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}/properties`,
    );
    const checklistKey = (propertyKeys.keys ?? []).find((propertyKey) => /checklist/i.test(propertyKey.key));
    if (!checklistKey) {
      return '';
    }
    const property = await jiraGet<{ value?: unknown }>(
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}/properties/${encodeURIComponent(checklistKey.key)}`,
    );
    if (looksLikeChecklist(property.value)) {
      return property.value as string;
    }
    // Some versions store an object; its JSON still carries the item text, which the parser can read.
    return typeof property.value === 'object' && property.value !== null ? JSON.stringify(property.value) : '';
  } catch {
    return '';
  }
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
