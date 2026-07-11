// acceptanceCriteria.ts — Resolves and reads a Jira issue's Acceptance Criteria the way Hygiene does.
//
// Acceptance Criteria lives in an instance-specific custom field. Rather than hard-code an id, this resolves
// the field the same way Hygiene's field config does — matching a Jira field named "Acceptance Criteria" from
// the instance's field list — with the common default (`customfield_10200`) as a fallback. It also reads the
// AC text off an issue, so surfaces that show issue detail (e.g. the Aging triage) can render AC inline.

import { jiraGet } from '../services/jiraApi.ts';
import type { JiraField, JiraIssue } from '../types/jira.ts';
import { normalizeRichTextToPlainText } from './richTextPlainText.ts';

/** The common default Acceptance Criteria custom field id, used when the instance has no better match. */
export const DEFAULT_ACCEPTANCE_CRITERIA_FIELD_ID = 'customfield_10200';

// The display name Jira gives the Acceptance Criteria field, matched case-insensitively.
const ACCEPTANCE_CRITERIA_FIELD_NAME = 'acceptance criteria';

/** Returns the ids of every instance field literally named "Acceptance Criteria" (case-insensitive). */
export function matchAcceptanceCriteriaFieldIds(availableFields: readonly JiraField[]): string[] {
  return availableFields
    .filter((field) => typeof field.name === 'string' && field.name.trim().toLowerCase() === ACCEPTANCE_CRITERIA_FIELD_NAME)
    .map((field) => field.id);
}

/**
 * Resolves the Acceptance Criteria field ids to request and read for this instance: every field named
 * "Acceptance Criteria" plus the common default, de-duplicated. Fully error-tolerant — a failed field
 * lookup falls back to just the default so the caller still works.
 */
export async function resolveAcceptanceCriteriaFieldIds(): Promise<string[]> {
  try {
    const availableFields = await jiraGet<JiraField[]>('/rest/api/2/field');
    const matched = matchAcceptanceCriteriaFieldIds(Array.isArray(availableFields) ? availableFields : []);
    return Array.from(new Set([...matched, DEFAULT_ACCEPTANCE_CRITERIA_FIELD_ID])).filter(Boolean);
  } catch {
    return [DEFAULT_ACCEPTANCE_CRITERIA_FIELD_ID];
  }
}

/**
 * Reads an issue's Acceptance Criteria as plain text: the first configured AC field that holds real content,
 * normalised from whatever rich-text/ADF shape Jira returned. Returns null when no AC field has content, so
 * the caller can simply omit the AC block rather than showing an empty label.
 */
export function readAcceptanceCriteriaText(issue: JiraIssue, fieldIds: readonly string[]): string | null {
  const issueFields = issue.fields as unknown as Record<string, unknown>;
  for (const fieldId of fieldIds) {
    const text = normalizeRichTextToPlainText(issueFields[fieldId]).trim();
    if (text !== '') {
      return text;
    }
  }
  return null;
}
